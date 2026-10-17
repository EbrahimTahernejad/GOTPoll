import type Database from 'better-sqlite3';
import type { AniListMedia } from './anilist.js';

export const SCHEMA_VERSION = 2;

export const CATALOG_SQL = `
  CREATE TABLE IF NOT EXISTS shows (
    id INTEGER PRIMARY KEY,
    title_romaji TEXT NOT NULL,
    title_english TEXT,
    title_native TEXT,
    synonyms TEXT NOT NULL DEFAULT '[]',   -- JSON array (synonyms may contain commas)
    start_year INTEGER,
    season TEXT,
    format TEXT NOT NULL,                  -- TV | TV_SHORT | MOVIE (ONA/OVA folded into TV)
    raw_format TEXT,
    country TEXT,
    cover_image TEXT,
    cover_color TEXT,
    parent_id INTEGER,                     -- same-format prequel, if any
    status TEXT,                           -- AniList: FINISHED / RELEASING / NOT_YET_RELEASED / HIATUS / CANCELLED
    popularity INTEGER NOT NULL DEFAULT 0,
    score INTEGER,
    favourites INTEGER
  );
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`;

export type ShowRow = {
  id: number;
  title_romaji: string;
  title_english: string | null;
  title_native: string | null;
  synonyms: string;
  start_year: number | null;
  season: string | null;
  format: string;
  raw_format: string | null;
  country: string | null;
  cover_image: string | null;
  cover_color: string | null;
  parent_id: number | null;
  /** absent in catalogs synced before 0.3 */
  status?: string | null;
  popularity: number;
  score: number | null;
  favourites: number | null;
};

const foldFormat = (f: string | null) =>
  f === 'ONA' || f === 'OVA' ? 'TV' : (f ?? 'TV');

export function mediaToRow(m: AniListMedia): ShowRow | null {
  const romaji = m.title.romaji ?? m.title.english;
  if (!romaji || m.isAdult) return null;
  const format = foldFormat(m.format);
  const year = m.startDate?.year ?? m.seasonYear ?? null;
  // A real prequel came out first. AniList also tags *story* prequels made
  // later (One Piece's prequel is a 2024 ONA one-shot) – those don't make
  // the original a sequel.
  const prequel = m.relations?.edges.find(
    (e) =>
      e.relationType === 'PREQUEL' &&
      e.node.type === 'ANIME' &&
      foldFormat(e.node.format) === format &&
      !(year && e.node.startDate?.year && e.node.startDate.year > year)
  );
  return {
    id: m.id,
    title_romaji: romaji.trim(),
    title_english: m.title.english?.trim() || null,
    title_native: m.title.native?.trim() || null,
    synonyms: JSON.stringify((m.synonyms ?? []).map((s) => s.trim()).filter(Boolean)),
    start_year: year,
    season: m.season,
    format,
    raw_format: m.format,
    country: m.countryOfOrigin,
    cover_image: m.coverImage?.extraLarge ?? m.coverImage?.large ?? null,
    cover_color: m.coverImage?.color ?? null,
    parent_id: prequel?.node.id ?? null,
    status: m.status,
    popularity: m.popularity ?? 0,
    score: m.averageScore,
    favourites: m.favourites,
  };
}

export function prepareUpsert(db: Database.Database) {
  const stmt = db.prepare(`
    INSERT INTO shows (id, title_romaji, title_english, title_native, synonyms, start_year, season,
      format, raw_format, country, cover_image, cover_color, parent_id, status, popularity, score, favourites)
    VALUES (@id, @title_romaji, @title_english, @title_native, @synonyms, @start_year, @season,
      @format, @raw_format, @country, @cover_image, @cover_color, @parent_id, @status, @popularity, @score, @favourites)
    ON CONFLICT(id) DO UPDATE SET
      title_romaji = excluded.title_romaji, title_english = excluded.title_english,
      title_native = excluded.title_native, synonyms = excluded.synonyms,
      start_year = excluded.start_year, season = excluded.season, format = excluded.format,
      raw_format = excluded.raw_format, country = excluded.country,
      cover_image = excluded.cover_image, cover_color = excluded.cover_color,
      parent_id = excluded.parent_id, status = excluded.status, popularity = excluded.popularity,
      score = excluded.score, favourites = excluded.favourites
  `);
  return db.transaction((rows: ShowRow[]) => {
    for (const r of rows) stmt.run(r);
  });
}

export function setMeta(db: Database.Database, values: Record<string, string | number>) {
  const stmt = db.prepare('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)');
  db.transaction(() => {
    for (const [k, v] of Object.entries(values)) stmt.run(k, String(v));
  })();
}

export function getMeta(db: Database.Database): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM meta').all() as { key: string; value: string }[];
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

/** Convert a v1 (got-poll) catalog into the v2 layout, in place. */
export function migrateLegacy(db: Database.Database) {
  const hasLegacy = db
    .prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='anime'")
    .get();
  if (!hasLegacy) return false;
  db.exec(CATALOG_SQL);
  const legacy = db.prepare('SELECT * FROM anime').all() as any[];
  const upsert = prepareUpsert(db);
  upsert(
    legacy
      // the hand-made rows used ids that now belong to real AniList entries
      .filter((r) => !(r.id >= 193297 && r.id <= 193300))
      .map((r) => ({
        id: r.id,
        title_romaji: r.title_romaji,
        title_english: r.title_english,
        title_native: null,
        synonyms: JSON.stringify(
          String(r.synonyms ?? '')
            .split(',')
            .map((s: string) => s.trim())
            .filter(Boolean)
        ),
        start_year: r.start_year,
        season: r.season,
        format: r.format,
        raw_format: r.format,
        country: null,
        cover_image: r.cover_image,
        cover_color: null,
        // v1 only knew *whether* there was a prequel; -1 keeps it out of polls
        parent_id: r.has_prequel ? -1 : null,
        status: null,
        popularity: r.popularity ?? 0,
        score: r.score,
        favourites: r.favourites,
      }))
  );
  db.exec('DROP TABLE anime');
  setMeta(db, { schema: SCHEMA_VERSION, source: 'legacy', synced_at: 0 });
  return true;
}

/**
 * Where a franchise stands, judged by its FIRST season only (polls count
 * franchise roots): one finished season = released, even while a sequel airs.
 */
export function releaseOf(status: string | null | undefined, startYear: number | null): ShowRelease | null {
  switch (status) {
    case 'FINISHED':
      return 'released';
    case 'RELEASING':
    case 'HIATUS':
      return 'airing';
    case 'NOT_YET_RELEASED':
      return 'upcoming';
    case 'CANCELLED':
      // cancelled before or after it started airing
      return startYear !== null && startYear <= new Date().getFullYear() ? 'released' : 'upcoming';
    default:
      return null; // catalog predates release status – update it
  }
}
