import { app } from 'electron';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CatalogStore } from './catalog/store.js';
import { Matcher } from './matching/matcher.js';
import { cleanMessage } from './matching/normalize.js';
import { PollEngine } from './poll/engine.js';
import { findRumbleCandidates } from './poll/sources/rumble-browser.js';
import { rumbleChannelPath } from './poll/sources/rumble.js';
import { UserStore } from './user-store.js';
import { LocalAi, recommendLlm } from './ai.js';
import { createStrategy, needsEmbedding, needsLlm, type Strategy } from './matching/strategies.js';

const dirname = path.resolve(fileURLToPath(import.meta.url), '..');
const userData = app.getPath('userData');
mkdirSync(userData, { recursive: true });

export const catalog = new CatalogStore(
  path.join(userData, 'catalog'),
  path.resolve(dirname, '../assets/shows.db')
);
catalog.init();

export const user = new UserStore(userData);
export const ai = new LocalAi(path.join(userData, 'ai'), {
  shows: () => [...getLibrary().values()],
  sequels: () => {
    const lib = getLibrary();
    return catalog.sequelAliases().filter((s) => lib.has(s.rootId));
  },
  catalogKey: () => catalog.info().file.replace(/\W/g, ''),
});

const showInfo = (id: number) => {
  const s = getLibrary().get(id);
  return s && { title: s.titleRomaji, english: s.titleEnglish, year: s.startYear };
};

/** The configured strategy if its models are loaded – otherwise classic (null). */
function currentStrategy(matcher: Matcher): Strategy | null {
  const { matcherStrategy: id } = user.settings();
  if (id === 'classic') return null;
  if (needsEmbedding(id) && (!ai.embedder || !ai.index)) return null;
  if (needsLlm(id) && !ai.judge) return null;
  return createStrategy(id, {
    matcher,
    embedder: ai.embedder ?? undefined,
    index: ai.index ?? undefined,
    judge: ai.judge ?? undefined,
    showInfo,
  });
}

export const poll = new PollEngine(catalog, user, {
  rumbleCandidates: findRumbleCandidates,
  makeStrategy: currentStrategy,
});

/** Load (not download) whatever the selected strategy needs. */
export async function resolvedLlm() {
  const s = user.settings();
  return s.llmModel === 'auto' ? recommendLlm(await ai.hardwareInfo()) : s.llmModel;
}

export async function prepareAi() {
  const s = user.settings();
  return ai.ensure(s.matcherStrategy, s.embedModel, await resolvedLlm()).catch(() => {});
}

export async function hardware() {
  const hw = await ai.hardwareInfo();
  return { ...hw, recommended: recommendLlm(hw) };
}

/**
 * Load the Rumble channel page once in the background so the one-time browser
 * check is done before a poll starts, not during it. Call after app ready.
 */
export function warmUpRumble() {
  // one page load is enough – the browser check is per site, not per channel
  const first = user
    .settings()
    .channels.find((c) => c.enabled && c.platform === 'rumble' && rumbleChannelPath(c.target));
  const channel = first && rumbleChannelPath(first.target);
  if (channel) findRumbleCandidates(channel, AbortSignal.timeout(180_000)).catch(() => {});
}

export const sourceDeps = { rumbleCandidates: findRumbleCandidates };

// A matcher over the whole votable library, for search / "assign to…" and
// the match tester. Built lazily and rebuilt when the catalog swaps.
let searchMatcher: Matcher | null = null;
let library: Map<number, Show> | null = null;
catalog.on('changed', () => {
  searchMatcher = null;
  library = null;
});

export function getLibrary() {
  if (!library) {
    library = new Map(
      [...catalog.all(), ...user.customShows()].filter((s) => s.eligible).map((s) => [s.id, s])
    );
  }
  return library;
}

function getSearchMatcher() {
  if (!searchMatcher) {
    const lib = getLibrary();
    searchMatcher = new Matcher({
      shows: [...lib.values()],
      sequels: catalog.sequelAliases().filter((s) => lib.has(s.rootId)),
    });
  }
  // learned aliases change often – apply them on top every time
  for (const a of user.aliases()) searchMatcher.teach(a.phrase, a.showId);
  return searchMatcher;
}

export function search(query: string, limit = 8): SearchHit[] {
  const lib = getLibrary();
  return getSearchMatcher()
    .candidates(query, limit)
    .flatMap((c) => {
      const show = lib.get(c.showId);
      return show ? [{ show, score: c.score, alias: c.alias }] : [];
    });
}

export async function probe(message: string): Promise<MatchProbe> {
  const m = getSearchMatcher();
  const cleaned = cleanMessage(message);
  const result = cleaned ? m.match(cleaned, user.ignores()) : null;
  const strategy = currentStrategy(m);
  let aiResult: MatchProbe['aiResult'];
  let aiMs: number | undefined;
  if (strategy && cleaned) {
    const t = performance.now();
    const hit = await strategy.match(cleaned, user.ignores());
    aiMs = performance.now() - t;
    aiResult = hit && { showId: hit.showId, score: hit.score, stage: hit.stage, alias: hit.alias };
  }
  return {
    strategy: user.settings().matcherStrategy,
    aiResult,
    aiMs,
    cleaned,
    result: result && {
      showId: result.showId,
      score: result.score,
      stage: result.stage,
      alias: result.alias,
    },
    candidates: cleaned ? search(cleaned, 6) : [],
  };
}
