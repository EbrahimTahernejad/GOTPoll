import Database from 'better-sqlite3';
import { EventEmitter } from 'node:events';
import { CATALOG_SQL, getMeta, prepareUpsert, setMeta, type ShowRow } from './schema.js';
import type { CatalogInfo } from './store.js';

// A catalog the streamer builds in the app: games, characters, songs,
// anything chat can name. Same shape as the other catalogs, so matching,
// polls and tournaments treat it the same. One SQLite file per catalog,
// edited in place.
//
// Ids: 2_000_000_000 + catalogNumber × 100_000 + n – never the same as an
// AniList or IMDb id, nor another custom catalog's, so taught phrases and
// ignores stay with the right title.

export const CUSTOM_ID_BASE = 2_000_000_000;
const PER_CATALOG = 100_000;

export const isCustomId = (id: number) => id >= CUSTOM_ID_BASE && id < CUSTOM_ID_BASE + 1_000_000_000;
export const customNumberOf = (id: number) => (isCustomId(id) ? Math.floor((id - CUSTOM_ID_BASE) / PER_CATALOG) : -1);

const RELEASE_STATUS: Record<ShowRelease, string> = { released: 'FINISHED', airing: 'RELEASING', upcoming: 'NOT_YET_RELEASED' };

export class CustomCatalog extends EventEmitter<{ changed: [] }> {
  private db: Database.Database;
  private cache: Show[] | null = null;
  readonly id: string;
  readonly number: number;

  constructor(
    readonly file: string,
    init?: { number: number; name: string }
  ) {
    super();
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.exec(CATALOG_SQL);
    if (init) setMeta(this.db, { number: init.number, name: init.name, created_at: Date.now(), updated_at: Date.now() });
    const meta = getMeta(this.db);
    this.number = Number(meta.number);
    this.id = `custom-${this.number}`;
    if (!Number.isFinite(this.number)) throw new Error(`Not a custom catalog: ${file}`);
  }

  get name() {
    return getMeta(this.db).name || 'Custom catalog';
  }

  /** What this catalog calls its three kinds of entry (Game / DLC / Mod, …). */
  labels(): Record<ShowFormat, string> {
    const def: Record<ShowFormat, string> = { TV: 'Series', MOVIE: 'Movie', TV_SHORT: 'Short' };
    try {
      return { ...def, ...JSON.parse(getMeta(this.db).labels || '{}') };
    } catch {
      return def;
    }
  }

  setLabels(labels: Partial<Record<ShowFormat, string>>) {
    const clean = Object.fromEntries(
      Object.entries(labels)
        .filter(([k, v]) => ['TV', 'MOVIE', 'TV_SHORT'].includes(k) && typeof v === 'string' && v.trim())
        .map(([k, v]) => [k, (v as string).trim().slice(0, 24)])
    );
    this.touch({ labels: JSON.stringify({ ...this.labels(), ...clean }) });
  }

  /** The kinds in use, as chips should show them. */
  formats(): FormatLabel[] {
    const used = new Set(this.all().map((s) => s.format));
    const labels = this.labels();
    return (['TV', 'MOVIE', 'TV_SHORT'] as ShowFormat[]).filter((f) => used.has(f)).map((id) => ({ id, label: labels[id] }));
  }

  rename(name: string) {
    this.touch({ name: name.trim().slice(0, 60) || 'Custom catalog' });
  }

  info(): CatalogInfo {
    const meta = getMeta(this.db);
    const n = this.all().length;
    return {
      file: `${this.id}@${meta.updated_at}`,
      installed: true,
      hasRelease: true,
      count: n,
      eligible: n,
      syncedAt: Number(meta.updated_at || 0),
      source: 'custom',
      canRevert: false,
    };
  }

  all(): Show[] {
    if (this.cache) return this.cache;
    const rows = this.db.prepare('SELECT * FROM shows ORDER BY title_romaji COLLATE NOCASE').all() as ShowRow[];
    this.cache = rows.map((r) => ({
      id: r.id,
      titleRomaji: r.title_romaji,
      titleEnglish: r.title_english,
      synonyms: safeJson(r.synonyms),
      startYear: r.start_year,
      season: null,
      format: r.format as ShowFormat,
      coverImage: r.cover_image,
      coverColor: r.cover_color,
      popularity: r.popularity,
      score: r.score,
      favourites: null,
      parentId: null,
      eligible: true,
      release: r.status === 'FINISHED' ? 'released' : r.status === 'RELEASING' ? 'airing' : r.status === 'NOT_YET_RELEASED' ? 'upcoming' : null,
      custom: true,
    }));
    return this.cache;
  }

  add(input: CustomEntryInput): Show {
    const meta = getMeta(this.db);
    const n = Number(meta.next || 1);
    if (n >= PER_CATALOG) throw new Error('This catalog is full');
    const id = CUSTOM_ID_BASE + this.number * PER_CATALOG + n;
    prepareUpsert(this.db)([this.row(id, input)]);
    this.touch({ next: n + 1 });
    return this.all().find((s) => s.id === id)!;
  }

  update(id: number, input: CustomEntryInput) {
    if (!this.all().some((s) => s.id === id)) throw new Error('No such entry');
    prepareUpsert(this.db)([this.row(id, input)]);
    this.touch();
  }

  remove(id: number) {
    this.db.prepare('DELETE FROM shows WHERE id = ?').run(id);
    this.touch();
  }

  close() {
    this.db.close();
  }

  private row(id: number, e: CustomEntryInput): ShowRow {
    const title = e.title.trim().slice(0, 200);
    if (!title) throw new Error('A title is needed');
    const alts = [...new Set(e.altTitles.map((a) => a.trim()).filter((a) => a && a !== title))].slice(0, 30);
    const year = typeof e.year === 'number' && e.year > 1800 && e.year < 3000 ? Math.round(e.year) : null;
    return {
      id,
      title_romaji: title,
      // the first alternate name doubles as the subtitle shown under the title
      title_english: alts[0] ?? null,
      title_native: null,
      synonyms: JSON.stringify(alts.slice(1)),
      start_year: year,
      season: null,
      format: ['TV', 'TV_SHORT', 'MOVIE'].includes(e.format) ? e.format : 'TV',
      raw_format: e.format,
      country: null,
      cover_image: e.cover?.trim() || null,
      cover_color: null,
      parent_id: null,
      status: e.release ? RELEASE_STATUS[e.release] : null,
      // custom titles have no popularity; keep the order they were added in
      popularity: 0,
      score: null,
      favourites: null,
    };
  }

  private touch(meta: Record<string, string | number> = {}) {
    setMeta(this.db, { ...meta, updated_at: Date.now() });
    this.cache = null;
    this.emit('changed');
  }
}

function safeJson(text: string): string[] {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
