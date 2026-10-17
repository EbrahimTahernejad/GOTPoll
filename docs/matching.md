# How chat messages become votes

## The problem

A vote is a short, noisy chat line ("!vote FRIEREN 🔥", "frieran s2", "jjk", "onepunchman") that has to land on one of ~11k AniList shows. Most chat lines aren't votes at all ("lol", "W", "love you"). Guessing wrong is worse than not guessing: it silently inflates the wrong show.

The old matcher (got-poll) used SQL `LIKE '%word%'` plus word overlap. On the benchmark below it put **35% of votes on the wrong show** and counted **49 of 59** ordinary chat lines as votes ("gg" → ONE PIECE, "W" → Attack on Titan).

## What the literature says

For short name-like strings, the best-performing family is a **hybrid of token-level TF-IDF weighting and a character-level edit similarity**. Cohen, Ravikumar & Fienberg's comparison of name-matching metrics found that "SoftTFIDF" (TF-IDF with Jaro-Winkler token similarity) beat every pure edit-distance or pure token method. Character n-gram TF-IDF is the standard *retrieval* step in entity resolution, because IDF discounts grams that occur everywhere (" no ", "the"). Jaro-Winkler alone over-rewards substrings and shared prefixes, so on its own it is not enough.

- Cohen, Ravikumar, Fienberg (2003), *A Comparison of String Distance Metrics for Name-Matching Tasks*: https://pubs.dbs.uni-leipzig.de/dc/node/691
- Papadakis et al. (2021), *Bipartite Graph Matching Algorithms for Clean-Clean Entity Resolution*: https://arxiv.org/pdf/2112.14030

## The pipeline (`electron/matching/`)

1. **Clean** (`normalize.ts`): strip URLs, @mentions, emoji, emoticons (`<3`), `!vote` prefixes, "pls", and season markers ("s2", "2nd season", "part 2"). Then NFKD-fold diacritics and fold romaji long vowels and particles (Kyōjin = Kyoujin = Kyojin, wo/o, wa/ha).
2. **Exact**: an O(1) hash lookup over every alias, both spaced and compact ("hunterxhunter"). Aliases are:
   - titles and synonyms
   - the main title before ":" (only if no more popular show owns that string)
   - sequel titles and synonyms pointing at the franchise root ("Dragon Ball Z", "Frieren 2nd Season")
   - phrases the streamer taught

   Ties go to the alias kind first, then popularity.
3. **Keyword**: a single distinctive word ("frieren", "jojo", "mushoku") that appears in at most 25 shows, where one show is clearly the most popular.
4. **Fuzzy**: character-trigram TF-IDF cosine over an inverted index, then a rerank of the top 40 with a soft token score. That score blends Jaro-Winkler and normalised Damerau-Levenshtein per token and weights precision over recall, because chat shortens titles. A small log-popularity prior is added, since votes follow a Zipf distribution.
5. **Decide**: accept only above the threshold (0.72) and with a margin over the runner-up show, unless the leader is clearly more popular. On top of that:
   - one- and two-word messages may only hit shows with ≥ 5,000 AniList users
   - messages made only of common English words never match fuzzily
   - laughter ("hahaha", "kkkk", "xddd") never counts

   Anything uncertain goes to **Unmatched chat**. One click there assigns the phrase, recounts everyone who typed it, and teaches the matcher for the next poll.

## Benchmark (`pnpm bench:matching`)

The queries are generated deterministically from the catalog to mimic chat: typos, missing spaces, shouting, emoji, season suffixes and so on. On top of that come 97 hand-written chat votes, 90 chatter lines used while tuning, and **59 held-out chatter lines written after tuning**, never used to adjust anything.

| | legacy (got-poll) | new |
|---|---|---|
| correct show | 47.3% | **92.9%** |
| wrong show | 34.9% | **0.6%** |
| chatter counted (tuning set) | 62/90 | **0/90** |
| chatter counted (held-out) | 49/59 | **1/59** |
| hand-written chat votes | 88.2% | **100%** |
| time for 2.6k queries | 96 s | 3.6 s |

These figures are from the old v1 catalog, so both matchers see the same data. On the new catalog (10.9k votable shows, including ONAs and sequel aliases) the new matcher scores 93.4% correct, 0.6% wrong, 0/90 and 1/59.

By category on the new catalog: exact 99.5%, chat noise 99.8%, season suffix 99.3%, one typo 93.9%, no spaces 85.3%, two typos 74.1%. Two-typo misses come back as "no match" rather than a wrong match (0.9% wrong), so they show up in Unmatched chat instead of skewing the result.

## Knobs

- `threshold` / `margin` in `matcher.ts` (`pnpm bench:matching -- --sweep` prints the trade-off curve)
- `MIN_POPULARITY_SHORT`, `CHAT_STOPLIST`, `COMMON_WORDS`
- `--debug "<category>"` lists misses for one category
