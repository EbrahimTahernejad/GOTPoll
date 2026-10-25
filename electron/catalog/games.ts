import type { SyncProgress } from './anilist.js';
import type { ShowRow } from './schema.js';
import type { CatalogSource } from './store.js';

// Video games, pooled from free sources and merged into one list:
//
//   Wikidata   the backbone – a game is in if 4+ Wikipedias have an article
//              about it (a decent stand-in for "people know it"); other names
//   Wikipedia  box art from the English article
//   Steam      the most-owned PC games (SteamSpy's public list) Wikidata misses
//   IGDB       optional: the streamer's own free Twitch developer keys add
//              IGDB's games, alternative names and covers
//
// No source needs an account except IGDB, and that one is never required.
// Duplicates are merged by Steam app id, IGDB slug (Wikidata knows both),
// then by name and year.
//
// The Wikidata query service stops queries after 60 s, so the list is
// fetched in light slices by popularity, then the other names, the English
// article and the IGDB slug in batches of a few hundred games.

const ENDPOINT = 'https://query.wikidata.org/sparql';
const UA = 'GOTPoll (https://github.com/EbrahimTahernejad/GOTPoll)';
/** catalog ids for games: Q49740 → 3_000_049_740 */
export const GAME_ID_BASE = 3_000_000_000;
/** games only Steam knows: app id 1172470 → 3_801_172_470 */
export const STEAM_ID_BASE = GAME_ID_BASE + 800_000_000;
/** games only IGDB knows: IGDB id 1942 → 3_900_001_942 */
export const IGDB_ID_BASE = GAME_ID_BASE + 900_000_000;
export const MIN_SITELINKS = 4;
// each slice must finish well inside the 60 s limit, uncached (4 alone ≈ 15 s)
const SLICES: [number, number][] = [
  [MIN_SITELINKS, 4],
  [5, 5],
  [6, 7],
  [8, 10],
  [11, 15],
  [16, 25],
  [26, 100000],
];
const ALIAS_BATCH = 300;
const WIKI_BATCH = 50;
/** SteamSpy's full list: 1000 games a page, most owned first, one page a minute */
const STEAM_PAGES = 5;
const STEAM_GAP_MS = 61_000;
const STEAM_MIN_REVIEWS = 1000;
const IGDB_PAGE = 500;
const IGDB_MAX = 20_000;

export type IgdbKeys = { clientId: string; clientSecret: string };

export const isGameId = (id: number) => id >= GAME_ID_BASE && id < GAME_ID_BASE + 1_000_000_000;
export const GAME_FORMATS: FormatLabel[] = [{ id: 'TV', label: 'Game' }];

// popularity is "how many Wikipedias" for every game; the other sources are put on that scale
const steamPopularity = (positive: number) => Math.round(4 * Math.log10(Math.max(1, positive)));
const igdbPopularity = (ratings: number) => Math.round(6 * Math.log10(Math.max(1, ratings)));

// chat is Latin-script; skip names in other scripts
const LATIN = /^[\p{Script=Latin}\p{N}\p{P}\p{S}\s]+$/u;
const nameKey = (s: string) =>
  s
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '');
// "DARK SOULS: REMASTERED", "Disco Elysium - The Final Cut", "Skyrim Special Edition": the same game as Wikidata's
const EDITION =
  /\s*(?:[:\-–—]\s*)?(?:the\s+)?(?:(?:game of the year|goty|definitive|special|complete|enhanced|ultimate|deluxe|anniversary|legendary|royal|remastered|director'?s|final)\s+)?(?:edition|cut|remastered|redux|golden)\s*$/i;
const baseName = (s: string) => {
  // "Enhanced Edition Director's Cut" takes two goes
  let out = s;
  for (let i = 0; i < 3; i++) {
    const next = out.replace(EDITION, '').trim();
    if (next === out) break;
    out = next;
  }
  return out;
};
// SteamSpy lists every app; these are tools, not games
const NOT_A_GAME = /(?:\b(?:soundtrack|dedicated server|playtest|demo|sdk|benchmark)\b|^(?:wallpaper engine|soundpad|steamvr|aseprite|blender|rpg maker.*|vtube studio|lossless scaling|spacewar)$)/i;
const steamCover = (app: string | number) => `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${app}/library_600x900.jpg`;

type Game = ShowRow & {
  steam?: string;
  igdb?: string;
  article?: string;
};

export function makeGamesSource(igdbKeys: () => IgdbKeys | null = () => null): CatalogSource {
  return {
    id: 'wikidata',
    async fetch({ signal, fetchImpl = fetch, onBatch, onProgress, minGapMs }) {
      const year = new Date().getFullYear();
      const rows = new Map<number, Game>();
      let done = 0;
      let total = SLICES.length + 1;
      const report = (label: string, waitUntil: number | null = null) =>
        onProgress({
          phase: waitUntil ? 'waiting' : 'fetching',
          requests: done,
          fetched: rows.size,
          partitionsDone: done,
          partitionsTotal: total,
          waitUntil,
          label,
        } satisfies SyncProgress);

      // ---- Wikidata: the games, by popularity slice
      for (const [lo, hi] of SLICES) {
        report(`Games known in ${lo}${hi > 1000 ? '+' : `–${hi}`} languages`);
        const data = await sparql(
          fetchImpl,
          signal,
          `SELECT ?item ?itemLabel ?sl (MIN(?date) AS ?d) (SAMPLE(?steam) AS ?s) (SAMPLE(?img) AS ?i) WHERE {
            ?item wdt:P31 wd:Q7889; wikibase:sitelinks ?sl. FILTER(?sl >= ${lo} && ?sl <= ${hi})
            OPTIONAL { ?item wdt:P577 ?date } OPTIONAL { ?item wdt:P1733 ?steam } OPTIONAL { ?item wdt:P18 ?img }
            SERVICE wikibase:label { bd:serviceParam wikibase:language "en,mul". }
          } GROUP BY ?item ?itemLabel ?sl`
        );
        for (const b of data) {
          const q = Number(b.item.value.split('/Q').pop());
          const title = b.itemLabel?.value?.trim();
          // an item without a usable name shows up as its own Q-id
          if (!q || !title || /^Q\d+$/.test(title) || !LATIN.test(title)) continue;
          const start = b.d?.value ? Number(b.d.value.slice(0, 4)) : null;
          const steam = b.s?.value;
          const img = b.i?.value;
          rows.set(GAME_ID_BASE + q, {
            ...row(GAME_ID_BASE + q, title, start && start > 1950 ? start : null, year),
            cover_image: steam ? steamCover(steam) : img ? `${img.replace(/^http:/, 'https:')}?width=400` : null,
            popularity: Number(b.sl.value),
            steam,
          });
        }
        done++;
      }

      // ---- Wikidata: other names ("GTA V", "BotW", …), the English article and IGDB slug, a few hundred games per request
      const ids = [...rows.keys()];
      const batches = Math.ceil(ids.length / ALIAS_BATCH);
      const keys = igdbKeys();
      // (box-art batches are added once the articles are known)
      total = SLICES.length + batches + STEAM_PAGES + (keys ? 2 : 0);
      for (let i = 0; i < batches; i++) {
        report(`Other names · ${Math.min(ids.length, (i + 1) * ALIAS_BATCH).toLocaleString()} of ${ids.length.toLocaleString()} games`);
        const chunk = ids.slice(i * ALIAS_BATCH, (i + 1) * ALIAS_BATCH);
        const data = await sparql(
          fetchImpl,
          signal,
          `SELECT ?item (GROUP_CONCAT(DISTINCT ?alt; separator="|") AS ?alts) (SAMPLE(?article) AS ?w) (SAMPLE(?igdb) AS ?g) WHERE {
            VALUES ?item { ${chunk.map((id) => `wd:Q${id - GAME_ID_BASE}`).join(' ')} }
            OPTIONAL { ?item skos:altLabel ?alt. FILTER(LANG(?alt) IN ("en", "mul")) }
            OPTIONAL { ?item wdt:P5794 ?igdb }
            OPTIONAL { ?article schema:about ?item; schema:isPartOf <https://en.wikipedia.org/> }
          } GROUP BY ?item`
        );
        for (const b of data) {
          const g = rows.get(GAME_ID_BASE + Number(b.item.value.split('/Q').pop()));
          if (!g) continue;
          if (b.alts?.value) addNames(g, b.alts.value.split('|'));
          g.article = b.w?.value;
          g.igdb = b.g?.value;
        }
        done++;
      }

      const articles = [...rows.values()].filter((g) => g.article);
      const wikiBatches = Math.ceil(articles.length / WIKI_BATCH);
      total += wikiBatches;

      // ---- Wikipedia: box art from the English article (a bonus – a failed batch keeps the Steam cover)
      for (let i = 0; i < wikiBatches; i++) {
        report(`Box art · ${Math.min(articles.length, (i + 1) * WIKI_BATCH).toLocaleString()} of ${articles.length.toLocaleString()} articles`);
        const chunk = articles.slice(i * WIKI_BATCH, (i + 1) * WIKI_BATCH);
        await boxArt(fetchImpl, signal, chunk).catch(() => signal.throwIfAborted());
        done++;
      }

      // matching the other sources to what Wikidata has
      const bySteam = new Map<string, Game>();
      const bySlug = new Map<string, Game>();
      const byName = new Map<string, Game[]>();
      const index = (g: Game) => {
        if (g.steam) bySteam.set(g.steam, g);
        if (g.igdb) bySlug.set(g.igdb, g);
        for (const n of [g.title_romaji, ...JSON.parse(g.synonyms)]) {
          const k = nameKey(n);
          if (k.length < 2) continue;
          const list = byName.get(k) ?? [];
          if (!list.includes(g)) list.push(g);
          byName.set(k, list);
        }
      };
      rows.forEach(index);
      const sameGame = (name: string, year: number | null): Game | undefined => {
        const list = byName.get(nameKey(name)) ?? [];
        if (year) return list.find((g) => g.start_year && Math.abs(g.start_year - year) <= 1) ?? (list.length === 1 && !list[0].start_year ? list[0] : undefined);
        return list.length === 1 ? list[0] : undefined;
      };

      // ---- Steam: the most-owned games (a bonus – Steam being down never fails the import)
      for (let page = 0; page < STEAM_PAGES; page++) {
        if (page > 0) {
          const gap = minGapMs ?? STEAM_GAP_MS;
          report('Steam lets the list out one page a minute', Date.now() + gap);
          await sleep(gap, signal);
        }
        report(`Steam's most-owned games · page ${page + 1} of ${STEAM_PAGES}`);
        let apps: { appid: number; name: string; positive: number }[] = [];
        try {
          const res = await fetchImpl(`https://steamspy.com/api.php?request=all&page=${page}`, {
            headers: { 'User-Agent': UA },
            signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
          });
          if (res.ok) apps = Object.values((await res.json()) as Record<string, { appid: number; name: string; positive: number }>);
        } catch {
          signal.throwIfAborted();
        }
        done++;
        if (!apps.length) break;
        for (const a of apps) {
          const name = a.name?.trim();
          if (!name || !LATIN.test(name) || a.positive < STEAM_MIN_REVIEWS || NOT_A_GAME.test(name)) continue;
          const app = String(a.appid);
          const known = bySteam.get(app) ?? sameGame(name, null) ?? (baseName(name) !== name ? sameGame(baseName(name), null) : undefined);
          if (known) {
            known.steam ??= app;
            addNames(known, [name]);
            known.cover_image ??= steamCover(app);
            known.popularity = Math.max(known.popularity, steamPopularity(a.positive));
            continue;
          }
          const g: Game = { ...row(STEAM_ID_BASE + a.appid, name, null, year), cover_image: steamCover(app), popularity: steamPopularity(a.positive), steam: app };
          rows.set(g.id, g);
          index(g);
        }
      }

      // ---- IGDB, with the streamer's own keys
      if (keys) {
        report('IGDB · signing in');
        const token = await igdbToken(fetchImpl, signal, keys);
        done++;
        for (let offset = 0; offset < IGDB_MAX; offset += IGDB_PAGE) {
          report(`IGDB · ${offset.toLocaleString()} games`);
          const games = await igdbQuery(
            fetchImpl,
            signal,
            keys.clientId,
            token,
            `fields name,slug,alternative_names.name,first_release_date,cover.image_id,total_rating_count,external_games.uid,external_games.url;
             where total_rating_count >= 20 & version_parent = null & parent_game = null;
             sort total_rating_count desc; limit ${IGDB_PAGE}; offset ${offset};`
          );
          for (const x of games) {
            const name = x.name?.trim();
            if (!name || !LATIN.test(name)) continue;
            const start = x.first_release_date ? new Date(x.first_release_date * 1000).getUTCFullYear() : null;
            const steam = x.external_games?.find((e) => /store\.steampowered\.com\/app\/\d+/.test(e.url ?? ''))?.url?.match(/app\/(\d+)/)?.[1];
            const known = (x.slug && bySlug.get(x.slug)) || (steam && bySteam.get(steam)) || sameGame(name, start);
            const g: Game = known || { ...row(IGDB_ID_BASE + x.id, name, start, year), popularity: 0 };
            if (!known) {
              rows.set(g.id, g);
              index(g);
            }
            g.igdb ??= x.slug;
            g.start_year ??= start;
            g.popularity = Math.max(g.popularity, igdbPopularity(x.total_rating_count ?? 0));
            addNames(g, (x.alternative_names ?? []).map((a) => a.name));
            if (x.cover?.image_id) {
              g.cover_image = `https://images.igdb.com/igdb/image/upload/t_cover_big/${x.cover.image_id}.jpg`;
            } else if (!g.cover_image && steam) g.cover_image = steamCover(steam);
          }
          if (games.length < IGDB_PAGE) break;
          // IGDB allows 4 requests a second
          await sleep(300, signal);
        }
        done++;
      }

      onBatch([...rows.values()].map(({ steam: _s, igdb: _g, article: _a, ...r }) => r));
      report('Done');
    },
  };
}

/** The Wikidata-only importer (no IGDB keys) – what tests and older code use. */
export const gamesSource = makeGamesSource();

function row(id: number, title: string, start: number | null, year: number): Game {
  return {
    id,
    title_romaji: title,
    title_english: null,
    title_native: null,
    synonyms: '[]',
    start_year: start,
    season: null,
    format: 'TV',
    raw_format: 'game',
    country: null,
    cover_image: null,
    cover_color: null,
    parent_id: null,
    status: start && start > year ? 'NOT_YET_RELEASED' : 'FINISHED',
    popularity: 0,
    score: null,
    favourites: null,
  };
}

function addNames(g: Game, names: string[]) {
  const have: string[] = JSON.parse(g.synonyms);
  const keys = new Set([g.title_romaji, ...have].map(nameKey));
  for (const raw of names) {
    const a = raw?.trim();
    if (!a || a.length > 60 || !LATIN.test(a) || keys.has(nameKey(a))) continue;
    keys.add(nameKey(a));
    have.push(a);
  }
  g.synonyms = JSON.stringify(have.slice(0, 16));
}

/** Box art from English Wikipedia articles, 50 per request. Only portrait-ish images – a logo isn't a cover. */
async function boxArt(fetchImpl: typeof fetch, signal: AbortSignal, games: Game[]) {
  const titleOf = (url: string) => decodeURIComponent(url.split('/wiki/').pop() ?? '').replace(/_/g, ' ');
  const byTitle = new Map(games.map((g) => [titleOf(g.article!), g]));
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    prop: 'pageimages',
    piprop: 'thumbnail',
    pithumbsize: '400',
    // box art is non-free; it lives on English Wikipedia itself
    pilicense: 'any',
    redirects: '1',
    titles: [...byTitle.keys()].join('|'),
  });
  const res = await fetchImpl(`https://en.wikipedia.org/w/api.php?${params}`, {
    headers: { 'User-Agent': UA },
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
  });
  if (!res.ok) return;
  const json = (await res.json()) as {
    query?: {
      normalized?: { from: string; to: string }[];
      redirects?: { from: string; to: string }[];
      pages?: { title: string; thumbnail?: { source: string; width: number; height: number } }[];
    };
  };
  const q = json.query;
  if (!q?.pages) return;
  // follow "Hollow_Knight" → "Hollow Knight" → its redirect target back to the game
  const back = new Map<string, string>();
  for (const t of byTitle.keys()) back.set(t, t);
  for (const n of [...(q.normalized ?? []), ...(q.redirects ?? [])]) back.set(n.to, back.get(n.from) ?? back.get(n.to) ?? n.from);
  for (const p of q.pages) {
    const g = byTitle.get(back.get(p.title) ?? p.title);
    const t = p.thumbnail;
    if (!g || !t || t.height < t.width * 0.9 || /logo|wordmark|icon/i.test(t.source)) continue;
    g.cover_image = t.source.replace(/\?.*$/, '');
  }
}

type IgdbGame = {
  id: number;
  name?: string;
  slug?: string;
  alternative_names?: { name: string }[];
  first_release_date?: number;
  cover?: { image_id?: string };
  total_rating_count?: number;
  external_games?: { uid?: string; url?: string }[];
};

async function igdbToken(fetchImpl: typeof fetch, signal: AbortSignal, keys: IgdbKeys): Promise<string> {
  const params = new URLSearchParams({ client_id: keys.clientId, client_secret: keys.clientSecret, grant_type: 'client_credentials' });
  const res = await fetchImpl(`https://id.twitch.tv/oauth2/token?${params}`, { method: 'POST', signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]) });
  if (!res.ok) throw new Error(res.status === 400 || res.status === 403 ? 'IGDB: Twitch didn’t accept the client id / secret' : `IGDB sign-in failed (${res.status})`);
  return ((await res.json()) as { access_token: string }).access_token;
}

async function igdbQuery(fetchImpl: typeof fetch, signal: AbortSignal, clientId: string, token: string, body: string): Promise<IgdbGame[]> {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl('https://api.igdb.com/v4/games', {
      method: 'POST',
      headers: { 'Client-ID': clientId, Authorization: `Bearer ${token}`, Accept: 'application/json', 'Content-Type': 'text/plain' },
      body,
      signal: AbortSignal.any([signal, AbortSignal.timeout(60_000)]),
    });
    if (res.status === 429 && attempt < 3) {
      await sleep(1000, signal);
      continue;
    }
    if (!res.ok) throw new Error(`IGDB answered ${res.status}`);
    return (await res.json()) as IgdbGame[];
  }
}

/** Do these keys work? (Settings → "Check") */
export async function checkIgdbKeys(keys: IgdbKeys, fetchImpl: typeof fetch = fetch): Promise<void> {
  const signal = AbortSignal.timeout(30_000);
  const token = await igdbToken(fetchImpl, signal, keys);
  await igdbQuery(fetchImpl, signal, keys.clientId, token, 'fields name; limit 1;');
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (ms <= 0) return resolve();
    const t = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(t);
        reject(signal.reason);
      },
      { once: true }
    );
  });
}

type Binding = Record<string, { value: string } | undefined> & { item: { value: string } } & Record<string, { value: string }>;

/** One query to the Wikidata query service; retried once (it's a busy public service). */
async function sparql(fetchImpl: typeof fetch, signal: AbortSignal, query: string): Promise<Binding[]> {
  for (let attempt = 0; ; attempt++) {
    try {
      const res = await fetchImpl(ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/sparql-results+json', 'User-Agent': UA },
        body: new URLSearchParams({ query }).toString(),
        signal: AbortSignal.any([signal, AbortSignal.timeout(90_000)]),
      });
      if (!res.ok) throw new Error(`Wikidata answered ${res.status}`);
      const json = (await res.json()) as { results: { bindings: Binding[] } };
      return json.results.bindings;
    } catch (err) {
      signal.throwIfAborted();
      if (attempt >= 1) throw err;
      await new Promise((r) => setTimeout(r, 5000));
    }
  }
}
