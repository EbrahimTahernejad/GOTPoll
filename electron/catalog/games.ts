import type { SyncProgress } from './anilist.js';
import type { ShowRow } from './schema.js';
import type { CatalogSource } from './store.js';

// Video games from Wikidata's public query service – free, no account, no
// key. A game is in if enough Wikipedias have an article about it (a decent
// stand-in for "people know it"). Covers: Steam's portrait art when the game
// is on Steam (public store images), else the item's Commons image.
//
// The query service stops queries after 60 s, so the list is fetched in
// slices by popularity, and the other names in batches.

const ENDPOINT = 'https://query.wikidata.org/sparql';
const UA = 'GOTPoll (https://github.com/EbrahimTahernejad/GOTPoll)';
/** catalog ids for games: Q49740 → 3_000_049_740 */
export const GAME_ID_BASE = 3_000_000_000;
export const MIN_SITELINKS = 8;
const SLICES: [number, number][] = [
  [MIN_SITELINKS, 10],
  [11, 15],
  [16, 25],
  [26, 100000],
];
const ALIAS_BATCH = 300;

export const isGameId = (id: number) => id >= GAME_ID_BASE && id < GAME_ID_BASE + 1_000_000_000;
export const GAME_FORMATS: FormatLabel[] = [{ id: 'TV', label: 'Game' }];

// chat is Latin-script; skip names in other scripts
const LATIN = /^[\p{Script=Latin}\p{N}\p{P}\p{S}\s]+$/u;

export const gamesSource: CatalogSource = {
  id: 'wikidata',
  async fetch({ signal, fetchImpl = fetch, onBatch, onProgress }) {
    const year = new Date().getFullYear();
    const rows = new Map<number, ShowRow>();
    let done = 0;
    let total = SLICES.length + 1;
    const report = (label: string) =>
      onProgress({
        phase: 'fetching',
        requests: done,
        fetched: rows.size,
        partitionsDone: done,
        partitionsTotal: total,
        waitUntil: null,
        label,
      } satisfies SyncProgress);

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
          id: GAME_ID_BASE + q,
          title_romaji: title,
          title_english: null,
          title_native: null,
          synonyms: '[]',
          start_year: start && start > 1950 ? start : null,
          season: null,
          format: 'TV',
          raw_format: 'game',
          country: null,
          cover_image: steam
            ? `https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/${steam}/library_600x900.jpg`
            : img
              ? `${img.replace(/^http:/, 'https:')}?width=400`
              : null,
          cover_color: null,
          parent_id: null,
          status: start && start > year ? 'NOT_YET_RELEASED' : 'FINISHED',
          popularity: Number(b.sl.value),
          score: null,
          favourites: null,
        });
      }
      done++;
    }

    // other names ("GTA V", "BotW", …), a few hundred games per request
    const ids = [...rows.keys()];
    const batches = Math.ceil(ids.length / ALIAS_BATCH);
    total = SLICES.length + batches;
    for (let i = 0; i < batches; i++) {
      report(`Other names · ${Math.min(ids.length, (i + 1) * ALIAS_BATCH).toLocaleString()} of ${ids.length.toLocaleString()} games`);
      const chunk = ids.slice(i * ALIAS_BATCH, (i + 1) * ALIAS_BATCH);
      const data = await sparql(
        fetchImpl,
        signal,
        `SELECT ?item (GROUP_CONCAT(DISTINCT ?alt; separator="|") AS ?alts) WHERE {
          VALUES ?item { ${chunk.map((id) => `wd:Q${id - GAME_ID_BASE}`).join(' ')} }
          ?item skos:altLabel ?alt. FILTER(LANG(?alt) IN ("en", "mul"))
        } GROUP BY ?item`
      );
      for (const b of data) {
        const row = rows.get(GAME_ID_BASE + Number(b.item.value.split('/Q').pop()));
        if (!row) continue;
        const alts = [...new Set(b.alts.value.split('|').map((a) => a.trim()))]
          .filter((a) => a && a !== row.title_romaji && a.length <= 60 && LATIN.test(a))
          .slice(0, 12);
        row.synonyms = JSON.stringify(alts);
      }
      done++;
    }
    onBatch([...rows.values()]);
    report('Done');
  },
};

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
