import { COMMON_WORDS } from './common-words.js';
import {
  canonical,
  cleanMessage,
  compact,
  normalize,
  stripSeasonMarkers,
} from './normalize.js';

// Matching pipeline (see docs/matching.md for the research behind it):
//
//   1. clean   – strip "!vote", emoji, links, season markers, fold romaji.
//   2. exact   – hash lookup on every alias key (spaced + compact). O(1).
//   3. recall  – character-trigram TF-IDF cosine over all alias keys via an
//                inverted index. Robust to typos, missing spaces, word order.
//   4. rerank  – SoftTFIDF-style token score (Jaro-Winkler per token, Cohen et
//                al. 2003) + alias-kind weight + small popularity prior.
//   5. decide  – accept only if score >= threshold and the runner-up show is
//                far enough behind; otherwise the message is "unmatched" and
//                surfaces in the UI so the streamer can teach an alias.

export type MatchableShow = {
  id: number;
  titleRomaji: string;
  titleEnglish: string | null;
  synonyms: string[];
  popularity: number;
};

export type AliasKind =
  | 'learned' // taught by the streamer – always wins
  | 'title'
  | 'synonym'
  | 'main' // part before ":" / " - "
  | 'base' // season markers / years stripped
  | 'sequel'; // title of a later season, pointing at the franchise root

const KIND_WEIGHT: Record<AliasKind, number> = {
  learned: 1.08,
  title: 1,
  synonym: 0.97,
  main: 0.95,
  base: 0.96,
  sequel: 0.97,
};

type Alias = {
  showId: number;
  key: string; // canonical spaced form
  tokens: string[];
  kind: AliasKind;
  grams: Map<number, number>; // gram id -> tf-idf weight (L2 normalised)
};

export type MatchCandidate = {
  showId: number;
  alias: string;
  kind: AliasKind;
  score: number;
};

export type MatchResult = {
  showId: number;
  score: number;
  stage: 'exact' | 'token' | 'fuzzy' | 'learned';
  alias: string;
  query: string;
};

export type MatcherOptions = {
  threshold?: number;
  margin?: number;
  /**
   * A 1–2 word message naming a title less popular than this is taken as
   * chatter. In the catalog's own popularity units (AniList users, IMDb
   * votes, Wikipedias…); 0 turns the guard off.
   */
  minPopularityShort?: number;
  /** several catalogs pooled: each title's own floor (overrides minPopularityShort) */
  floorOf?: (showId: number) => number;
  /** several catalogs pooled: which one a title is from, so popularity is weighed within it */
  groupOf?: (showId: number) => string;
};

export type MatcherInput = MatcherOptions & {
  shows: MatchableShow[];
  /** streamer-taught phrases */
  learned?: { alias: string; showId: number }[];
  /** titles of later seasons, mapped to their franchise root */
  sequels?: { title: string; rootId: number }[];
};

const DEFAULTS: Required<Omit<MatcherOptions, 'floorOf' | 'groupOf'>> = {
  threshold: 0.72,
  margin: 0.03,
  minPopularityShort: 5000,
};

// Twitch/YouTube chatter that happens to be (part of) some obscure title.
// These never count unless the streamer teaches them as an alias.
const CHAT_STOPLIST = new Set(
  (
    'lol lmao lmfao rofl w l gg ggs pog poggers pogchamp kekw kek lul omegalul kappa keepo monkas ' +
    'sadge copium hopium pepega pepehands feelsbadman feelsgoodman residentsleeper biblethump ' +
    'hello hi hey yo sup hola bonjour bye gn gm ty thx thanks yes no yeah yep nope nah ok okay ' +
    'what why who how when where wait same true real facts based cringe mid peak love hype ' +
    'nice cool wow omg bruh xd xdd brb idk idc any random first anime manga movie the a'
  ).split(' ')
);


const OWNING = new Set<AliasKind>(['title', 'synonym', 'learned', 'sequel']);

// hahaha, jajaja, kkkkk, lmaooo, xddd, wwww, 555 (Thai)
const LAUGHTER = /^(?:(?:a?h+a+)+h*|(?:h+e+)+|(?:j+a+)+|k{3,}|l+m+a+o+|l+o+l+|x+d+|w{3,}|5{3,}|(?:r+s+)+|(?:a+s+)+)$/;

const NON_LATIN = /[^\p{Script=Latin}\p{N}\s]/u;

export class Matcher {
  private aliases: Alias[] = [];
  private exact = new Map<string, Alias[]>();
  private postings = new Map<number, { alias: number; w: number }[]>();
  private gramIds = new Map<string, number>();
  private idf: number[] = [];
  private popPrior = new Map<number, number>();
  private tokenShows = new Map<string, Set<number>>();
  private popularity = new Map<number, number>();
  private opts: Required<Omit<MatcherOptions, 'floorOf' | 'groupOf'>>;
  private floorOf?: (showId: number) => number;

  constructor({ shows, learned = [], sequels = [], floorOf, groupOf, ...opts }: MatcherInput) {
    this.opts = { ...DEFAULTS, ...opts };
    this.floorOf = floorOf;
    // AniList users, IMDb votes and Wikipedias don't compare: weigh each title within its own catalog
    const maxByGroup = new Map<string, number>();
    for (const s of shows) {
      const g = groupOf?.(s.id) ?? '';
      maxByGroup.set(g, Math.max(maxByGroup.get(g) ?? 1, s.popularity || 0));
    }
    const maxPop = (id: number) => maxByGroup.get(groupOf?.(id) ?? '') ?? 1;
    const raw: Omit<Alias, 'grams'>[] = [];
    const seen = new Set<string>();

    const add = (showId: number, text: string | null, kind: AliasKind) => {
      if (!text) return;
      const key = canonical(text);
      if (key.length < 2) return;
      const dedupe = `${showId}|${key}`;
      if (seen.has(dedupe)) return;
      seen.add(dedupe);
      raw.push({ showId, key, tokens: key.split(' '), kind });
    };

    for (const show of shows) {
      this.popularity.set(show.id, show.popularity || 0);
      // log-scaled popularity prior in [0, 1]
      this.popPrior.set(
        show.id,
        Math.log1p(show.popularity || 0) / Math.log1p(maxPop(show.id))
      );

      const titles: [string | null, AliasKind][] = [
        [show.titleRomaji, 'title'],
        [show.titleEnglish, 'title'],
        ...show.synonyms.map((s) => [s, 'synonym'] as [string, AliasKind]),
      ];
      for (const [title, kind] of titles) {
        if (!title) continue;
        // Chat is overwhelmingly Latin-script; non-Latin synonyms only bloat
        // the index and occasionally collide after normalisation.
        if (kind === 'synonym' && NON_LATIN.test(normalize(title))) continue;
        add(show.id, title, kind);
        const noParens = title.replace(/\([^)]*\)|\[[^\]]*\]/g, ' ');
        add(show.id, noParens, 'base');
        add(show.id, stripSeasonMarkers(normalize(noParens)), 'base');
        if (kind !== 'title') continue;
        // "Demon Slayer: Kimetsu no Yaiba" -> "Demon Slayer"
        const main = noParens.split(/:|\s[-–—]\s/)[0]?.trim();
        if (main && main !== noParens.trim() && (main.length >= 4 || /^\d{2,}$/.test(main))) {
          add(show.id, main, 'main');
        }
      }
    }
    for (const s of sequels) {
      add(s.rootId, s.title, 'sequel');
      add(s.rootId, stripSeasonMarkers(normalize(s.title)), 'sequel');
    }
    for (const { alias, showId } of learned) add(showId, alias, 'learned');

    // A derived alias (main title / stripped form) must not shadow a real
    // title or synonym of a MORE popular show. ("Evangelion" from a movie
    // subtitle loses to the TV series; "Demon Slayer" from Kimetsu no Yaiba
    // beats an obscure show that lists it as a synonym.)
    const bestOwner = new Map<string, number>();
    for (const a of raw) {
      if (!OWNING.has(a.kind)) continue;
      const p = this.prior(a.showId);
      if ((bestOwner.get(a.key) ?? -1) < p) bestOwner.set(a.key, p);
    }
    const kept = raw.filter((a) => {
      if (OWNING.has(a.kind)) return true;
      const owner = bestOwner.get(a.key);
      return owner === undefined || owner <= this.prior(a.showId);
    });

    // token -> shows containing it as a whole word (for one-word votes)
    for (const a of kept) {
      if (a.kind === 'learned') continue;
      for (const t of new Set(a.tokens)) {
        if (t.length < 4 || STOPWORDS.has(t)) continue;
        let set = this.tokenShows.get(t);
        if (!set) this.tokenShows.set(t, (set = new Set()));
        set.add(a.showId);
      }
    }

    this.buildIndex(kept);
  }

  private gramsOf(key: string): string[] {
    const padded = ` ${key} `;
    const out: string[] = [];
    for (let i = 0; i + 3 <= padded.length; i++) out.push(padded.slice(i, i + 3));
    // also index the compact form so "onepunchman" meets "one punch man"
    const c = compact(key);
    if (c !== key) {
      const p = ` ${c} `;
      for (let i = 0; i + 3 <= p.length; i++) out.push(p.slice(i, i + 3));
    }
    return out;
  }

  private buildIndex(raw: Omit<Alias, 'grams'>[]) {
    const df: number[] = [];
    const tfs: Map<number, number>[] = [];

    for (const a of raw) {
      const tf = new Map<number, number>();
      for (const g of this.gramsOf(a.key)) {
        let id = this.gramIds.get(g);
        if (id === undefined) {
          id = this.gramIds.size;
          this.gramIds.set(g, id);
          df[id] = 0;
        }
        tf.set(id, (tf.get(id) ?? 0) + 1);
      }
      for (const id of tf.keys()) df[id]++;
      tfs.push(tf);
    }

    const n = raw.length;
    this.idf = df.map((d) => Math.log((n + 1) / (d + 1)) + 1);

    raw.forEach((a, idx) => {
      const grams = this.weigh(tfs[idx]);
      const alias: Alias = { ...a, grams };
      this.aliases.push(alias);
      for (const k of [a.key, compact(a.key)]) {
        const list = this.exact.get(k);
        if (list) list.push(alias);
        else this.exact.set(k, [alias]);
      }
      for (const [id, w] of grams) {
        let p = this.postings.get(id);
        if (!p) this.postings.set(id, (p = []));
        p.push({ alias: idx, w });
      }
    });
  }

  private weigh(tf: Map<number, number>): Map<number, number> {
    const out = new Map<number, number>();
    let norm = 0;
    for (const [id, c] of tf) {
      const w = (1 + Math.log(c)) * (this.idf[id] ?? 0);
      out.set(id, w);
      norm += w * w;
    }
    norm = Math.sqrt(norm) || 1;
    for (const [id, w] of out) out.set(id, w / norm);
    return out;
  }

  private prior(showId: number) {
    return this.popPrior.get(showId) ?? 0;
  }

  /** Top-k distinct shows for a (cleaned) query, best first. */
  candidates(query: string, k = 5): MatchCandidate[] {
    const key = canonical(stripSeasonMarkers(query)) || canonical(query);
    if (!key) return [];

    // query vector (unknown grams are ignored – they can't match anything)
    const tf = new Map<number, number>();
    for (const g of this.gramsOf(key)) {
      const id = this.gramIds.get(g);
      if (id !== undefined) tf.set(id, (tf.get(id) ?? 0) + 1);
    }
    const qv = this.weigh(tf);

    const acc = new Map<number, number>();
    for (const [id, w] of qv) {
      for (const p of this.postings.get(id) ?? []) {
        acc.set(p.alias, (acc.get(p.alias) ?? 0) + w * p.w);
      }
    }

    const top = [...acc.entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
    const qTokens = key.split(' ');
    const byShow = new Map<number, MatchCandidate>();

    for (const [idx, cos] of top) {
      const a = this.aliases[idx];
      const soft = softTokenScore(qTokens, a.tokens);
      const raw = 0.4 * cos + 0.6 * soft;
      // Votes are Zipf-distributed: a popular show is a far likelier intent
      // than an obscure one with a similar name.
      const score =
        Math.min(1, raw * KIND_WEIGHT[a.kind]) * 0.88 +
        0.12 * this.prior(a.showId);
      const prev = byShow.get(a.showId);
      if (!prev || score > prev.score) {
        byShow.set(a.showId, { showId: a.showId, alias: a.key, kind: a.kind, score });
      }
    }
    return [...byShow.values()].sort((a, b) => b.score - a.score).slice(0, k);
  }

  /** Add a streamer-taught phrase without rebuilding the index. */
  teach(phrase: string, showId: number) {
    const key = canonical(phrase);
    if (!key) return;
    const alias: Alias = { showId, key, tokens: key.split(' '), kind: 'learned', grams: new Map() };
    for (const k of new Set([key, compact(key)])) {
      const list = (this.exact.get(k) ?? []).filter((a) => a.kind !== 'learned');
      this.exact.set(k, [alias, ...list]);
    }
  }

  forget(phrase: string) {
    const key = canonical(phrase);
    for (const k of new Set([key, compact(key)])) {
      const list = this.exact.get(k)?.filter((a) => a.kind !== 'learned');
      if (list?.length) this.exact.set(k, list);
      else this.exact.delete(k);
    }
  }

  /** Match a raw chat message. Returns null when not confident. */
  /**
   * True when a cleaned message is chatter no strategy should guess on:
   * too short, stoplisted, laughter, plain English, or only "season 2".
   * Shared so vector / LLM strategies apply the exact same guard rails.
   */
  isChatter(query: string): boolean {
    const plain = normalize(query);
    const key = canonical(stripSeasonMarkers(query));
    if (!key || compact(canonical(query)).length < 4) return true;
    if (CHAT_STOPLIST.has(plain) || LAUGHTER.test(compact(plain))) return true;
    return plain.split(' ').every((t) => COMMON_WORDS.has(t));
  }

  /** The same "obscure show from a 1–2 word message" floor match() applies. */
  passesPopularityFloor(query: string, showId: number): boolean {
    return query.split(' ').length > 2 || (this.popularity.get(showId) ?? 0) >= this.floor(showId);
  }

  private floor(showId: number) {
    return this.floorOf ? this.floorOf(showId) : this.opts.minPopularityShort;
  }

  popularityOf(showId: number) {
    return this.popularity.get(showId) ?? 0;
  }

  match(message: string, ignored?: Set<number>): MatchResult | null {
    const query = cleanMessage(message);
    if (!query) return null;
    const hit = this.resolve(query, ignored);
    // Bayes, roughly: a one- or two-word message that names an obscure show
    // ("ratio", "happy birthday") is far more likely chatter than a vote.
    if (
      hit &&
      hit.stage !== 'learned' &&
      query.split(' ').length <= 2 &&
      (this.popularity.get(hit.showId) ?? 0) < this.floor(hit.showId)
    ) {
      return null;
    }
    return hit;
  }

  private resolve(query: string, ignored?: Set<number>): MatchResult | null {
    const allowed = (id: number) => !ignored?.has(id);

    // exact: try as typed, then without season markers, then compact
    const keys = [canonical(query), canonical(stripSeasonMarkers(query))];
    keys.push(...keys.map(compact));
    const plain = normalize(query);
    const learnedOnly = CHAT_STOPLIST.has(plain) || LAUGHTER.test(compact(plain));
    for (const key of keys) {
      const hits = this.exact.get(key)?.filter(
        (a) => allowed(a.showId) && (!learnedOnly || a.kind === 'learned')
      );
      if (hits?.length) {
        const rank = (a: Alias) =>
          (a.kind === 'learned' ? 10 : KIND_WEIGHT[a.kind]) + this.prior(a.showId);
        const best = hits.reduce((b, a) => (rank(a) > rank(b) ? a : b));
        return {
          showId: best.showId,
          score: 1,
          stage: best.kind === 'learned' ? 'learned' : 'exact',
          alias: best.key,
          query,
        };
      }
    }

    // very short queries only match exactly – "w", "gg", "ok" aren't votes
    if (compact(keys[0]).length < 4 || learnedOnly) return null;
    // nothing left once season markers go ("season 2", "s3")
    if (!keys[1]) return null;
    // plain English chatter ("love you", "up to you") never matches fuzzily
    if (normalize(query).split(' ').every((t) => COMMON_WORDS.has(t))) return null;

    // One distinctive word ("frieren", "jojo", "mushoku", "shingeki"): chat
    // shortens titles to their most memorable word. If that word belongs to
    // a handful of shows and one of them clearly dominates, take it.
    const single = keys[1] || keys[0];
    if (!single.includes(' ')) {
      const owners = [...(this.tokenShows.get(single) ?? [])].filter(allowed);
      if (owners.length && owners.length <= 25) {
        owners.sort((a, b) => this.prior(b) - this.prior(a));
        const [top, next] = owners;
        if (!next || this.prior(top) - this.prior(next) >= 0.04) {
          return { showId: top, score: 0.9, stage: 'token', alias: single, query };
        }
      }
    }

    const cands = this.candidates(query, 8).filter((c) => allowed(c.showId));
    const [first, second] = cands;
    if (!first || first.score < this.opts.threshold) return null;
    if (second && first.score - second.score < this.opts.margin) {
      // Close call. Accept only when it's the same text (identical titles)
      // or the leader is clearly the more popular show.
      const samText = first.alias === second.alias;
      const morePopular = this.prior(first.showId) - this.prior(second.showId) >= 0.05;
      if (!samText && !morePopular) return null;
    }
    return { showId: first.showId, score: first.score, stage: 'fuzzy', alias: first.alias, query };
  }
}

// ---------------------------------------------------------------- scoring

/**
 * SoftTFIDF-flavoured token similarity: every query token is paired with its
 * closest alias token by Jaro-Winkler (counted only above 0.86), blended with
 * how much of the alias the query covers. Symmetric enough that "frieren"
 * still scores well against "sousou no frieren", while "sousou" alone does not
 * claim a 3-word title outright.
 */
export function softTokenScore(q: string[], a: string[]): number {
  const STOP = STOPWORDS;
  const qs = q.filter((t) => !STOP.has(t));
  const as = a.filter((t) => !STOP.has(t));
  const qt = qs.length ? qs : q;
  const at = as.length ? as : a;

  let qSum = 0;
  const used = new Set<number>();
  for (const t of qt) {
    let best = 0;
    let bestJ = -1;
    at.forEach((u, j) => {
      const s = tokenSim(t, u);
      if (s > best) {
        best = s;
        bestJ = j;
      }
    });
    if (best >= 0.8) {
      qSum += best;
      used.add(bestJ);
    }
  }
  const precision = qSum / qt.length; // how much of the query is explained
  let covered = 0;
  used.forEach((j) => (covered += at[j].length));
  const recall = covered / at.reduce((n, t) => n + t.length, 0); // char-weighted
  // precision matters more: chat usually types a *shortened* title
  // ("frieren", "jojo", "mushoku"), so missing alias words cost little.
  return precision * (0.72 + 0.28 * recall);
}

/**
 * Per-token similarity. Jaro-Winkler alone is too forgiving with substrings
 * ("mushoku" vs "shoku" = 0.9), so blend it with normalised Damerau-
 * Levenshtein, which charges for every missing character.
 */
export function tokenSim(a: string, b: string): number {
  if (a === b) return 1;
  const ed = 1 - osaDistance(a, b) / Math.max(a.length, b.length);
  return 0.5 * jaroWinkler(a, b) + 0.5 * ed;
}

/** Optimal-string-alignment (restricted Damerau-Levenshtein) distance. */
export function osaDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  let prev2 = new Array<number>(n + 1).fill(0);
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let cur = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        v = Math.min(v, prev2[j - 2] + 1);
      }
      cur[j] = v;
    }
    [prev2, prev, cur] = [prev, cur, prev2];
  }
  return prev[n];
}

const STOPWORDS = new Set([
  'no', 'the', 'a', 'an', 'of', 'to', 'ni', 'ga', 'ha', 'o', 'de', 'and', 'in', 'wa', 'e', 'x',
]);

export function jaroWinkler(s1: string, s2: string): number {
  if (s1 === s2) return 1;
  const l1 = s1.length;
  const l2 = s2.length;
  if (!l1 || !l2) return 0;
  const range = Math.max(0, Math.floor(Math.max(l1, l2) / 2) - 1);
  const m1 = new Uint8Array(l1);
  const m2 = new Uint8Array(l2);
  let matches = 0;
  for (let i = 0; i < l1; i++) {
    const lo = Math.max(0, i - range);
    const hi = Math.min(i + range + 1, l2);
    for (let j = lo; j < hi; j++) {
      if (!m2[j] && s1[i] === s2[j]) {
        m1[i] = m2[j] = 1;
        matches++;
        break;
      }
    }
  }
  if (!matches) return 0;
  let t = 0;
  for (let i = 0, k = 0; i < l1; i++) {
    if (!m1[i]) continue;
    while (!m2[k]) k++;
    if (s1[i] !== s2[k]) t++;
    k++;
  }
  const jaro = (matches / l1 + matches / l2 + (matches - t / 2) / matches) / 3;
  let prefix = 0;
  while (prefix < 4 && s1[prefix] === s2[prefix]) prefix++;
  return jaro + prefix * 0.1 * (1 - jaro);
}
