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

## Free local AI strategies (`pnpm bench:strategies`)

The same queries, plus 56 "hard" ones (paraphrases, mixed English/romaji, heavier typos) and a romaji-only slice: 862 queries built from romaji titles. Everything runs locally: ONNX embeddings via transformers.js and Qwen2.5 GGUF via llama.cpp. Timings are from an M1 Pro (Metal); an RTX 3070 is faster.

| strategy | correct | wrong | romaji | hard | hard wrong | chatter | held-out | ms/msg |
|---|---|---|---|---|---|---|---|---|
| classic | 93.4% | 0.6% | 92.8% | 75.0% | 5.4% | 0/90 | 1/59 | 2 |
| vector only (MiniLM) | 70.1% | 1.1% | 77.1% | 44.6% | 7.1% | 0/90 | 2/59 | 24 |
| vector only (e5) | 60.7% | 0.5% | 51.0% | 37.5% | 3.6% | 0/90 | 2/59 | 27 |
| hybrid (MiniLM) | 94.5% | 0.8% | 94.4% | 82.1% | 5.4% | 0/90 | 2/59 | 4 |
| hybrid (e5) | 94.3% | 0.6% | 93.4% | 75.0% | 5.4% | 0/90 | 1/59 | 4 |
| hybrid + judge (e5 + Qwen 3B) | 94.9% | 0.8% | 93.6% | 78.6% | 7.1% | 0/90 | 2/59 | 84 |
| **hybrid + judge (e5 + Qwen 7B)** | **97.5%** | 0.7% | **96.4%** | **92.9%** | 5.4% | 2/90 | 1/59 | 180 |

What we learned:

- **Embeddings alone are bad at this.** Sentence models (even multilingual ones) don't understand romaji or typos. They're useful only as a fallback that finds candidates.
- **The LLM judge is what understands romaji.** Qwen knows "shingeki" is Attack on Titan. With 7B it beats everything on every axis, and stays as careful as classic on wrong votes and chatter.
- **The judge must not invent matches.** Without guard rails, the 3B judge counted 11 chatter lines as votes ("wait what" → *Nani ka?*, "i am hungry" → *Hungry to Win*). A stricter prompt with counter-examples, plus an evidence floor (the chosen show needs text score or cosine ≥ 0.6), fixed it.
- **Letting the LLM decide everything is worse** (80%: it overrides good text matches), so that mode isn't offered.
- **Qwen 0.5B is too small**: it picked a show for "lol this stream is great".

## Knobs

- `threshold` / `margin` in `matcher.ts` (`pnpm bench:matching -- --sweep` prints the trade-off curve)
- `MIN_POPULARITY_SHORT`, `CHAT_STOPLIST`, `COMMON_WORDS`
- `--debug "<category>"` lists misses for one category
