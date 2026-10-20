import readline from 'node:readline';
import { Readable, Transform } from 'node:stream';
import { createGunzip } from 'node:zlib';
import type { SyncProgress } from './anilist.js';
import type { ShowRow } from './schema.js';
import type { CatalogSource } from './store.js';

// Movies & series from IMDb's official, free datasets (no account, no key):
//   https://datasets.imdbws.com/title.ratings.tsv.gz   ~9 MB  votes + rating
//   https://datasets.imdbws.com/title.basics.tsv.gz  ~230 MB  type, titles, years
// Only titles with enough votes are kept – chat votes for things people know.
// Both files are streamed and parsed on the fly; nothing large hits the disk.

const BASE = 'https://datasets.imdbws.com';
/** catalog ids for IMDb titles: tt0111161 → 1_000_111_161 */
export const IMDB_ID_BASE = 1_000_000_000;
export const MIN_VOTES = 2500;

// the three format slots, as this catalog names them: Movie · Series · Mini-series
const TYPES: Record<string, ShowFormat> = { movie: 'MOVIE', tvSeries: 'TV', tvMiniSeries: 'TV_SHORT' };
export const IMDB_FORMATS: FormatLabel[] = [
  { id: 'MOVIE', label: 'Movie' },
  { id: 'TV', label: 'Series' },
  { id: 'TV_SHORT', label: 'Mini-series' },
];

export const imdbIdOf = (tconst: string) => IMDB_ID_BASE + Number(tconst.slice(2));
export const tconstOf = (id: number) => `tt${String(id - IMDB_ID_BASE).padStart(7, '0')}`;
export const isImdbId = (id: number) => id >= IMDB_ID_BASE && id < 2 * IMDB_ID_BASE;

export const imdbSource: CatalogSource = {
  id: 'imdb',
  async fetch({ signal, fetchImpl = fetch, onBatch, onProgress }) {
    const year = new Date().getFullYear();
    const sizes = await Promise.all(
      ['title.ratings.tsv.gz', 'title.basics.tsv.gz'].map(async (f) => {
        const r = await fetchImpl(`${BASE}/${f}`, { method: 'HEAD', signal });
        if (!r.ok) throw new Error(`IMDb datasets unavailable (${r.status})`);
        return Number(r.headers.get('content-length') || 0);
      })
    );
    const totalMb = Math.max(1, Math.round((sizes[0] + sizes[1]) / 1e6));
    let doneBytes = 0;
    let kept = 0;
    const report = (label: string, bytes: number) =>
      onProgress({
        phase: 'fetching',
        requests: 2,
        fetched: kept,
        partitionsDone: Math.round((doneBytes + bytes) / 1e6),
        partitionsTotal: totalMb,
        waitUntil: null,
        label,
        unit: 'MB',
      } satisfies SyncProgress);

    // 1) who has enough votes
    const ratings = new Map<string, [number, number]>();
    await streamTsv(fetchImpl, `${BASE}/title.ratings.tsv.gz`, signal, (b) => report('Ratings', b), (c) => {
      const votes = Number(c[2]);
      if (votes >= MIN_VOTES) ratings.set(c[0], [Number(c[1]), votes]);
    });
    doneBytes += sizes[0];

    // 2) their titles
    let batch: ShowRow[] = [];
    await streamTsv(fetchImpl, `${BASE}/title.basics.tsv.gz`, signal, (b) => report('Titles', b), (c) => {
      const r = ratings.get(c[0]);
      if (!r) return;
      const format = TYPES[c[1]];
      if (!format || c[4] === '1') return;
      const start = c[5] === '\\N' ? null : Number(c[5]);
      const primary = c[2];
      const original = c[3];
      // released = out (a series with at least a season behind it)
      const status =
        start === null || start > year
          ? 'NOT_YET_RELEASED'
          : format === 'MOVIE' || start < year
            ? 'FINISHED'
            : 'RELEASING';
      batch.push({
        id: imdbIdOf(c[0]),
        title_romaji: primary,
        title_english: original && original !== primary ? original : null,
        title_native: null,
        synonyms: '[]',
        start_year: start,
        season: null,
        format,
        raw_format: c[1],
        country: null,
        cover_image: null, // fetched as needed (see covers.ts)
        cover_color: null,
        parent_id: null,
        status,
        popularity: r[1],
        score: Math.round(r[0] * 10),
        favourites: null,
      });
      kept++;
      if (batch.length >= 2000) {
        onBatch(batch);
        batch = [];
      }
    });
    if (batch.length) onBatch(batch);
    doneBytes += sizes[1];
    report('Done', 0);
  },
};

/** Download a gzipped TSV and hand each data row's columns to `row`. */
async function streamTsv(
  fetchImpl: typeof fetch,
  url: string,
  signal: AbortSignal,
  progress: (bytes: number) => void,
  row: (cols: string[]) => void
) {
  const res = await fetchImpl(url, { signal });
  if (!res.ok || !res.body) throw new Error(`Download failed: ${url} (${res.status})`);
  let bytes = 0;
  let lastReport = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, cb) {
      bytes += chunk.length;
      if (bytes - lastReport > 2e6) {
        lastReport = bytes;
        progress(bytes);
      }
      cb(null, chunk);
    },
  });
  const source = Readable.fromWeb(res.body as never);
  const lines = readline.createInterface({ input: source.pipe(counter).pipe(createGunzip()), crlfDelay: Infinity });
  const onAbort = () => source.destroy(new Error('cancelled'));
  signal.addEventListener('abort', onAbort, { once: true });
  try {
    let header = true;
    for await (const line of lines) {
      if (header) {
        header = false;
        continue;
      }
      row(line.split('\t'));
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
  }
  signal.throwIfAborted();
  progress(bytes);
}
