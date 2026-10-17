import type { Judge } from './llm-judge.js';
import type { Matcher, MatchResult } from './matcher.js';
import { cleanMessage } from './normalize.js';
import type { Embedder, VectorIndex } from './semantic.js';

// Swappable ways to turn a chat line into a vote. All share the same guard
// rails (chatter filter, popularity floor for 1–2 word messages) so they
// differ only in how they find the show.
//
//   classic     exact → keyword → trigram TF-IDF + Jaro-Winkler (no model)
//   vector      local sentence embeddings only
//   hybrid      classic; if unsure, a stricter embedding fallback
//   hybrid-llm  hybrid; if still unsure, a local LLM picks from the candidates
//   llm         certain hits (exact / taught / keyword) stay instant; the LLM
//               decides everything else from classic + vector candidates
//   precise-hybrid-llm  classic only when highly confident (exact / taught /
//               keyword / fuzzy ≥ PRECISE_FUZZY); anything less is the LLM's
//               call, choosing from text + embedding candidates
//   precise-llm same, but text candidates only – no embedding model needed

export type StrategyId = 'classic' | 'vector' | 'hybrid' | 'hybrid-llm' | 'llm' | 'precise-hybrid-llm' | 'precise-llm';

export const needsEmbedding = (id: StrategyId) => id !== 'classic' && id !== 'precise-llm';
export const needsLlm = (id: StrategyId) => id === 'hybrid-llm' || id === 'llm' || id === 'precise-hybrid-llm' || id === 'precise-llm';

/** fuzzy score above which classic is trusted without asking the LLM */
export const PRECISE_FUZZY = 0.9;

export type Strategy = {
  id: StrategyId;
  match: (message: string, ignored?: Set<number>) => Promise<MatchResult | null>;
};

export type ShowInfo = { title: string; english: string | null; year: number | null };

export type StrategyDeps = {
  matcher: Matcher;
  embedder?: Embedder;
  index?: VectorIndex;
  judge?: Judge;
  showInfo?: (id: number) => ShowInfo | undefined;
  /** cosine thresholds – tuned with scripts/bench-strategies.mjs */
  vector?: { threshold: number; margin: number };
  fallback?: { threshold: number; margin: number };
};

// tuned per model with scripts/bench-strategies.mjs (see docs/matching.md)
const TUNED: Record<string, { vector: { threshold: number; margin: number }; fallback: { threshold: number; margin: number } }> = {
  minilm: { vector: { threshold: 0.7, margin: 0.05 }, fallback: { threshold: 0.75, margin: 0.05 } },
  e5: { vector: { threshold: 0.85, margin: 0.02 }, fallback: { threshold: 0.9, margin: 0.03 } },
};
/** minimum text score / cosine the judge's pick must also have */
const EVIDENCE_FLOOR = 0.6;
export const DEFAULT_VECTOR = TUNED.minilm.vector;
export const DEFAULT_FALLBACK = TUNED.minilm.fallback;

async function vectorMatch(
  d: StrategyDeps,
  query: string,
  ignored: Set<number> | undefined,
  { threshold, margin }: { threshold: number; margin: number }
): Promise<MatchResult | null> {
  if (!d.embedder || !d.index) return null;
  const q = await d.embedder.embed([query], 'query');
  const hits = d.index.search(q, 6).filter((h) => !ignored?.has(h.showId));
  const [a, b] = hits;
  if (!a || a.score < threshold) return null;
  if (b && a.score - b.score < margin) return null;
  if (!d.matcher.passesPopularityFloor(query, a.showId)) return null;
  return { showId: a.showId, score: a.score, stage: 'fuzzy', alias: a.text, query };
}

export function createStrategy(id: StrategyId, d: StrategyDeps): Strategy {
  const tuned = TUNED[d.embedder?.model.id ?? 'minilm'] ?? TUNED.minilm;
  const vec = d.vector ?? tuned.vector;
  const fb = d.fallback ?? tuned.fallback;
  const classic = (m: string, ig?: Set<number>) => d.matcher.match(m, ig);

  const match = async (message: string, ignored?: Set<number>): Promise<MatchResult | null> => {
    const query = cleanMessage(message);
    if (!query) return null;
    if (id === 'classic') return classic(query, ignored);

    if (id === 'vector') {
      // taught phrases still win – they're the streamer's explicit decision
      const exact = classic(query, ignored);
      if (exact?.stage === 'learned') return exact;
      if (d.matcher.isChatter(query)) return null;
      return vectorMatch(d, query, ignored, vec);
    }

    const first = classic(query, ignored);
    if (id === 'precise-llm' || id === 'precise-hybrid-llm') {
      if (first && (first.stage !== 'fuzzy' || first.score >= PRECISE_FUZZY)) return first;
      if (d.matcher.isChatter(query)) return null;
      return llmPick(query, message, ignored);
    }
    if (id === 'llm') {
      if (first && first.stage !== 'fuzzy') return first; // exact / taught / keyword: certain
      if (d.matcher.isChatter(query)) return null;
      return (await llmPick(query, message, ignored)) ?? null;
    }
    if (first || d.matcher.isChatter(query)) return first;
    const second = await vectorMatch(d, query, ignored, fb);
    if (second || id === 'hybrid') return second;
    return llmPick(query, message, ignored);
  };

  // let the local model choose among classic + vector candidates (or "none")
  const llmPick = async (query: string, message: string, ignored?: Set<number>): Promise<MatchResult | null> => {
    if (!d.judge || !d.showInfo) return null;
    // candidates + how much evidence each has (text score / embedding cosine)
    const ids: number[] = [];
    const evidence = new Map<number, number>();
    for (const c of d.matcher.candidates(query, 5)) {
      ids.push(c.showId);
      evidence.set(c.showId, Math.max(evidence.get(c.showId) ?? 0, c.score));
    }
    if (d.embedder && d.index && id !== 'precise-llm') {
      const q = await d.embedder.embed([query], 'query');
      for (const h of d.index.search(q, 5)) {
        ids.push(h.showId);
        evidence.set(h.showId, Math.max(evidence.get(h.showId) ?? 0, h.score));
      }
    }
    const options = [...new Set(ids)].filter((x) => !ignored?.has(x)).slice(0, 8);
    if (!options.length) return null;
    const infos = options.map((x) => d.showInfo!(x) ?? { title: String(x), english: null, year: null });
    const choice = await d.judge.pick(message, infos);
    if (choice === null) return null;
    const showId = options[choice];
    if (!d.matcher.passesPopularityFloor(query, showId)) return null;
    // the LLM chooses among plausible shows; it can't conjure one from a shared word
    if ((evidence.get(showId) ?? 0) < EVIDENCE_FLOOR) return null;
    return { showId, score: 0.75, stage: 'fuzzy', alias: infos[choice].title, query };
  };

  return { id, match };
}
