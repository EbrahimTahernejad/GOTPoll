import { app } from 'electron';
import { createHash } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Catalogs } from './catalog/catalogs.js';
import { Matcher } from './matching/matcher.js';
import { cleanMessage } from './matching/normalize.js';
import { PollEngine } from './poll/engine.js';
import { TournamentController } from './tournament/controller.js';
import { findRumbleCandidates } from './poll/sources/rumble-browser.js';
import { rumbleChannelPath } from './poll/sources/rumble.js';
import { UserStore } from './user-store.js';
import { LocalAi, recommendLlm } from './ai.js';
import { createStrategy, needsEmbedding, needsLlm, type Strategy } from './matching/strategies.js';

const dirname = path.resolve(fileURLToPath(import.meta.url), '..');
const userData = app.getPath('userData');
mkdirSync(userData, { recursive: true });

export const user = new UserStore(userData);

/** Every catalog; everything that says `catalog` works on the selected one. */
export const catalog = new Catalogs(userData, path.resolve(dirname, '../assets/shows.db'), {
  selected: () => user.settings().catalog,
  setSelected: (id) => user.setSettings({ catalog: id }),
  animeExtras: () => user.customShows(),
  overrides: () => user.overrides(),
  saveOverride: (id, o) => user.setOverride(id, o),
  igdbKeys: () => {
    const { igdbClientId, igdbClientSecret } = user.settings();
    return igdbClientId && igdbClientSecret ? { clientId: igdbClientId, clientSecret: igdbClientSecret } : null;
  },
});
catalog.init();
export const ai = new LocalAi(path.join(userData, 'ai'), {
  shows: () => [...getLibrary().values()],
  sequels: () => {
    const lib = getLibrary();
    return catalog.sequelAliases().filter((s) => lib.has(s.rootId));
  },
  catalogKey: () => `${catalog.info().id}-${catalog.info().file}`.replace(/\W/g, ''),
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

export const tournament = new TournamentController(poll, user);

/** What the viewer page gets: the poll, and the tournament when one is open. */
export function publicFeed(s?: PollSnapshot, opts: { all?: boolean } = {}): PublicSnapshot {
  return { ...poll.publicSnapshot(s, opts.all ? 1000 : 40), tournament: tournament.publicView() };
}

/** Switch the catalog in use. Not mid-poll or mid-tournament: they hold its titles. */
export function selectCatalog(id: string) {
  if (poll.isRunning) throw new Error('End the running poll first');
  if (tournament.snapshot().tournament) throw new Error('Close the open tournament first');
  catalog.select(id);
}

/** Keep an uploaded cover image; served to the app and the viewer page at /media/covers/. */
export const coversDir = path.join(userData, 'covers');
export function saveCover(bytes: ArrayBuffer, type: string) {
  const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif' }[type];
  if (!ext) throw new Error('Use a PNG, JPEG, WebP or GIF image');
  if (bytes.byteLength > 8 * 1024 * 1024) throw new Error('That image is too big (8 MB max)');
  const buf = Buffer.from(bytes);
  const name = `${createHash('sha1').update(buf).digest('hex')}.${ext}`;
  mkdirSync(coversDir, { recursive: true });
  writeFileSync(path.join(coversDir, name), buf);
  return `/media/covers/${name}`;
}

catalog.on('covers', () => poll.refresh());

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
let reindex: NodeJS.Timeout | null = null;
catalog.on('changed', () => {
  searchMatcher = null;
  library = null;
  // the AI index belongs to a catalog; a custom one changes entry by entry
  if (reindex) clearTimeout(reindex);
  reindex = setTimeout(() => void prepareAi(), 2500);
});
const otherSearch = new Map<string, { matcher: Matcher; lib: Map<number, Show> }>();
catalog.on('list', () => otherSearch.clear());

export function getLibrary() {
  if (!library) {
    library = new Map(catalog.all().filter((s) => s.eligible).map((s) => [s.id, s]));
  }
  return library;
}

function getSearchMatcher() {
  if (!searchMatcher) {
    const lib = getLibrary();
    const pooled = catalog.info().parts.length > 1;
    searchMatcher = new Matcher({
      minPopularityShort: catalog.info().popularityFloor,
      ...(pooled ? { floorOf: (id: number) => catalog.floorFor(id), groupOf: (id: number) => catalog.ownerOf(id) } : {}),
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
  const hits = getSearchMatcher()
    .candidates(query, limit)
    .flatMap((c) => {
      const show = lib.get(c.showId);
      return show ? [{ show, score: c.score, alias: c.alias }] : [];
    });
  catalog.wantCovers(hits.filter((h) => !h.show.coverImage).map((h) => h.show.id));
  return hits;
}

/** Search any catalog, not just the one in use (copying titles into a custom catalog). */
export function searchIn(id: string, query: string, limit = 10): SearchHit[] {
  if (id === catalog.selectedId()) return search(query, limit);
  if (!catalog.has(id)) throw new Error('Unknown catalog');
  let entry = otherSearch.get(id);
  if (!entry) {
    const shows = catalog.showsOf(id).filter((s) => s.eligible);
    entry = {
      lib: new Map(shows.map((s) => [s.id, s])),
      matcher: new Matcher({
        shows,
        sequels: catalog.sequelsOf(id),
        minPopularityShort: catalog.floorOf(id),
        ...(id.includes('+') ? { floorOf: (s: number) => catalog.floorFor(s), groupOf: (s: number) => catalog.ownerOf(s) } : {}),
      }),
    };
    otherSearch.set(id, entry);
  }
  const { lib, matcher } = entry;
  const hits = matcher.candidates(query, limit).flatMap((c) => {
    const show = lib.get(c.showId);
    return show ? [{ show, score: c.score, alias: c.alias }] : [];
  });
  catalog.wantCovers(hits.filter((h) => !h.show.coverImage).map((h) => h.show.id));
  return hits;
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
  // exactly how the poll keys phrases: cleaned message
  const dismissed = cleaned ? user.dismissed().has(cleaned) : false;
  const taught = cleaned ? (user.aliases().find((a) => a.phrase === cleaned)?.showId ?? null) : null;
  return {
    dismissed,
    taughtTo: taught,
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
