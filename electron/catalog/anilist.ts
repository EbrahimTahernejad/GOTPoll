// AniList catalog fetcher.
//
// Constraints discovered against the live API (Oct 2026):
//   * rate limit is 30 requests/minute (X-RateLimit-Limit: 30)
//   * a single query can't page past 5000 entries ("Page depth exceeds
//     maximum allowed") – so we partition by start date and bisect any range
//     that still reports >= 5000 results
//   * `updatedAt` is bumped in bulk by AniList jobs, so incremental "changed
//     since" syncs don't work – a full sync is the only reliable way
//   * aliasing several Page() blocks into one request costs ONE request of
//     quota – 8 pages (400 shows) per call keeps a full sync around 2 minutes

export type AniListMedia = {
  id: number;
  isAdult: boolean;
  countryOfOrigin: string | null;
  title: { romaji: string | null; english: string | null; native: string | null };
  synonyms: string[] | null;
  startDate: { year: number | null; month: number | null } | null;
  season: string | null;
  seasonYear: number | null;
  format: string | null;
  status: string | null;
  popularity: number | null;
  averageScore: number | null;
  favourites: number | null;
  coverImage: { large: string | null; extraLarge: string | null; color: string | null } | null;
  relations: {
    edges: {
      relationType: string;
      node: { id: number; format: string | null; type: string; startDate?: { year: number | null } | null };
    }[];
  } | null;
};

export type SyncProgress = {
  phase: 'fetching' | 'waiting';
  requests: number;
  fetched: number;
  partitionsDone: number;
  partitionsTotal: number;
  waitUntil: number | null;
  label: string;
  /** what partitions count: AniList year ranges, or megabytes of a download */
  unit?: 'ranges' | 'MB';
};

const API_URL = 'https://graphql.anilist.co';
const PAGES_PER_REQUEST = 8;
const PER_PAGE = 50;
const DEPTH_LIMIT = 5000;
// TV-ish formats. ONA/OVA are folded into TV when stored (as before), but
// OVAs are mostly side stories – ONAs (Netflix & co) are real shows.
const FORMATS = ['TV', 'TV_SHORT', 'MOVIE', 'ONA'];

const FIELDS = `
  id isAdult countryOfOrigin
  title { romaji english native }
  synonyms
  startDate { year month }
  season seasonYear format status
  popularity averageScore favourites
  coverImage { large extraLarge color }
  relations { edges { relationType(version: 2) node { id format type startDate { year } } } }
`;

type Range = { from: number; to: number; label: string }; // FuzzyDateInt [from, to)

class RateLimiter {
  private remaining = 30;
  private resetAt = 0;
  private lastAt = 0;

  constructor(
    private signal: AbortSignal,
    private onWait: (until: number | null) => void,
    // ~28/min keeps us politely under the 30/min ceiling even with clock skew
    private minGap = 2150
  ) {}

  async take() {
    const now = Date.now();
    let until = this.lastAt + this.minGap;
    if (this.remaining <= 1 && this.resetAt > now) until = Math.max(until, this.resetAt);
    if (until > now) {
      if (until - now > 3000) this.onWait(until);
      await sleep(until - now, this.signal);
      this.onWait(null);
    }
    this.lastAt = Date.now();
  }

  update(res: Response) {
    const rem = Number(res.headers.get('x-ratelimit-remaining'));
    if (Number.isFinite(rem)) this.remaining = rem;
    const reset = Number(res.headers.get('x-ratelimit-reset'));
    if (Number.isFinite(reset) && reset > 0) this.resetAt = reset * 1000;
  }

  async backoff(res: Response) {
    const retry = Number(res.headers.get('retry-after')) || 60;
    const until = Date.now() + (retry + 1) * 1000;
    this.onWait(until);
    await sleep(until - Date.now(), this.signal);
    this.onWait(null);
  }
}

export async function fetchCatalog(opts: {
  signal: AbortSignal;
  onBatch: (media: AniListMedia[]) => void;
  onProgress: (p: SyncProgress) => void;
  fetchImpl?: typeof fetch;
  fromYear?: number;
  minGapMs?: number;
}) {
  const { signal, onBatch, onProgress } = opts;
  const doFetch = opts.fetchImpl ?? fetch;
  const thisYear = new Date().getFullYear();
  const progress: SyncProgress = {
    phase: 'fetching',
    requests: 0,
    fetched: 0,
    partitionsDone: 0,
    partitionsTotal: 0,
    waitUntil: null,
    label: '',
  };
  const emit = () => onProgress({ ...progress });
  const limiter = new RateLimiter(
    signal,
    (until) => {
      progress.phase = until ? 'waiting' : 'fetching';
      progress.waitUntil = until;
      emit();
    },
    opts.minGapMs
  );

  async function request(query: string, variables: Record<string, unknown> = {}) {
    for (let attempt = 0; ; attempt++) {
      signal.throwIfAborted();
      await limiter.take();
      let res: Response;
      try {
        res = await doFetch(API_URL, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            'User-Agent': 'GOTPoll/2 (vote counter)',
          },
          body: JSON.stringify({ query, variables }),
          signal: AbortSignal.any([signal, AbortSignal.timeout(45_000)]),
        });
      } catch (err) {
        if (signal.aborted) throw err;
        if (attempt >= 5) throw new Error(`AniList unreachable: ${String(err)}`);
        await sleep(2 ** attempt * 1000 + Math.random() * 500, signal);
        continue;
      }
      progress.requests++;
      limiter.update(res);
      if (res.status === 429) {
        await limiter.backoff(res);
        continue;
      }
      const json = (await res.json().catch(() => null)) as {
        data?: Record<string, any>;
        errors?: { message: string }[];
      } | null;
      if (!res.ok || !json?.data) {
        const msg = json?.errors?.map((e) => e.message).join('; ') || `HTTP ${res.status}`;
        if (res.status >= 500 && attempt < 5) {
          await sleep(2 ** attempt * 1000, signal);
          continue;
        }
        throw new Error(`AniList error: ${msg}`);
      }
      return json.data;
    }
  }

  const filter = (r: Range) =>
    `type: ANIME, isAdult: false, format_in: [${FORMATS.join(', ')}], startDate_greater: ${r.from - 1}, startDate_lesser: ${r.to}, sort: [ID]`;

  // Fetch `count` consecutive pages of a range in ONE request (aliased Page blocks).
  async function fetchPages(r: Range, first: number, count: number) {
    const blocks = Array.from({ length: count }, (_, i) =>
      `p${i}: Page(page: ${first + i}, perPage: ${PER_PAGE}) { pageInfo { total hasNextPage } media(${filter(r)}) { ${FIELDS} } }`
    );
    const data = await request(`{ ${blocks.join('\n')} }`);
    const pages = Object.keys(data)
      .sort((a, b) => Number(a.slice(1)) - Number(b.slice(1)))
      .map((k) => data[k] as { pageInfo: { total: number; hasNextPage: boolean }; media: AniListMedia[] });
    return pages;
  }

  // Coarse decades for old shows, single years for the busy recent era.
  const fromYear = opts.fromYear ?? 1900;
  const coarse: Range[] = [];
  for (let y = fromYear; y < 1990; y += 10) {
    coarse.push(range(y, Math.min(y + 10, 1990)));
  }
  for (let y = Math.max(1990, fromYear); y <= thisYear + 3; y++) coarse.push(range(y, y + 1));

  progress.label = 'Planning';
  progress.partitionsTotal = coarse.length;
  emit();

  const queue = [...coarse];
  const maxPage = DEPTH_LIMIT / PER_PAGE; // 100
  while (queue.length) {
    signal.throwIfAborted();
    const r = queue.shift()!;
    progress.label = r.label;
    emit();

    // NB: pageInfo.total is not trustworthy (AniList reports 5000 for almost
    // any filter), so only hasNextPage drives paging.
    const rows: AniListMedia[] = [];
    let first = 1;
    let more = true;
    while (more && first <= maxPage) {
      const pages = await fetchPages(r, first, Math.min(PAGES_PER_REQUEST, maxPage - first + 1));
      const media = pages.flatMap((p) => p.media);
      rows.push(...media);
      progress.fetched += media.length;
      emit();
      more = !!pages[pages.length - 1]?.pageInfo.hasNextPage;
      first += PAGES_PER_REQUEST;
    }
    if (more) {
      // hit the 5000-deep wall: split the range and do both halves properly
      const halves = midpoint(r);
      if (halves) {
        progress.fetched -= rows.length;
        queue.unshift(...halves);
        progress.partitionsTotal += 1;
        emit();
        continue;
      }
    }
    if (rows.length) onBatch(rows);
    progress.partitionsDone++;
    emit();
  }

  // Popular announced shows often have no start date at all.
  progress.label = 'Upcoming';
  emit();
  const data = await request(
    `{ Page(page: 1, perPage: 50) { media(type: ANIME, isAdult: false, status: NOT_YET_RELEASED, format_in: [${FORMATS.join(', ')}], sort: [POPULARITY_DESC]) { ${FIELDS} } } }`
  );
  const upcoming = (data.Page.media as AniListMedia[]).filter((m) => !m.startDate?.year);
  if (upcoming.length) {
    onBatch(upcoming);
    progress.fetched += upcoming.length;
  }
  emit();
  return progress;
}

function range(fromYear: number, toYear: number): Range {
  return {
    from: fromYear * 10000,
    to: toYear * 10000,
    label: toYear - fromYear === 1 ? `${fromYear}` : `${fromYear}–${toYear - 1}`,
  };
}

/** Split [from, to) at its middle month. Dates are YYYYMMDD ints. */
function midpoint(r: Range): [Range, Range] | null {
  const toMonths = (d: number) => Math.floor(d / 10000) * 12 + (Math.floor(d / 100) % 100);
  const fromM = toMonths(r.from);
  const toM = toMonths(r.to);
  if (toM - fromM < 2) return null;
  const midM = Math.floor((fromM + toM) / 2);
  const mid = Math.floor(midM / 12) * 10000 + (midM % 12) * 100;
  return [
    { from: r.from, to: mid, label: `${r.label}a` },
    { from: mid, to: r.to, label: `${r.label}b` },
  ];
}

function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, Math.max(0, ms));
    const onAbort = () => {
      clearTimeout(t);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
