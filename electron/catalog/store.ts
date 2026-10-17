import Database from 'better-sqlite3';
import { EventEmitter } from 'node:events';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fetchCatalog, type SyncProgress } from './anilist.js';
import {
  releaseOf,
  CATALOG_SQL,
  getMeta,
  mediaToRow,
  migrateLegacy,
  prepareUpsert,
  SCHEMA_VERSION,
  setMeta,
  type ShowRow,
} from './schema.js';

// Catalog files live in <userData>/catalog:
//
//   current.json              { "file": "catalog-1760000000000.db", "previous": "..." }
//   catalog-<ts>.db           immutable once published
//   catalog-<ts>.partial.db   an update in progress (deleted on failure / next start)
//
// An update NEVER touches the live file. It builds a brand new database next
// to it, validates it, and only then flips current.json with an atomic
// rename. A crash, a network drop or a cancel at any point leaves the app on
// the old catalog. The previous file is kept so a bad update can be reverted.

export type CatalogInfo = {
  file: string;
  /** false for catalogs synced before release status was stored */
  hasRelease: boolean;
  count: number;
  eligible: number;
  syncedAt: number;
  source: string;
  canRevert: boolean;
};

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'running'; startedAt: number; progress: SyncProgress | null }
  | { state: 'validating' | 'applying'; startedAt: number; progress: SyncProgress | null }
  | {
      state: 'done';
      startedAt: number;
      finishedAt: number;
      added: number;
      removed: number;
      total: number;
    }
  | { state: 'error' | 'cancelled'; startedAt: number; finishedAt: number; error?: string };

type Pointer = { file: string; previous?: string | null };

export class CatalogStore extends EventEmitter<{
  status: [UpdateStatus];
  changed: [CatalogInfo];
}> {
  private db: Database.Database | null = null;
  private pointer: Pointer | null = null;
  private cache: Show[] | null = null;
  private abort: AbortController | null = null;
  status: UpdateStatus = { state: 'idle' };

  constructor(
    private dir: string,
    private seedPath: string,
    /** sanity floor for a fresh sync (tests use a tiny fake catalog) */
    private minShows = 1000
  ) {
    super();
  }

  init() {
    mkdirSync(this.dir, { recursive: true });
    // leftovers from an interrupted update are never trusted
    for (const f of readdirSync(this.dir)) {
      if (f.endsWith('.partial.db') || f.endsWith('.partial.db-journal') || f.endsWith('.tmp')) {
        rmSync(path.join(this.dir, f), { force: true });
      }
    }
    this.pointer = this.readPointer();
    if (!this.pointer || !this.tryOpen(this.pointer.file)) {
      // pointer missing or file damaged: newest valid catalog, else the seed
      const candidates = readdirSync(this.dir)
        .filter((f) => /^catalog-\d+\.db$/.test(f))
        .sort()
        .reverse();
      const good = candidates.find((f) => this.tryOpen(f));
      if (good) {
        this.writePointer({ file: good, previous: null });
      } else {
        this.installSeed();
      }
    }
    this.cleanup();
  }

  // ------------------------------------------------------------ reading

  info(): CatalogInfo {
    const db = this.handle();
    const meta = getMeta(db);
    const count = (db.prepare('SELECT COUNT(*) AS n FROM shows').get() as { n: number }).n;
    const prev = this.pointer?.previous;
    const hasRelease = (db.prepare("SELECT 1 FROM pragma_table_info('shows') WHERE name = 'status'").get() ?? null) !== null;
    return {
      file: this.pointer!.file,
      hasRelease,
      count,
      eligible: this.all().filter((s) => s.eligible).length,
      syncedAt: Number(meta.synced_at || 0),
      source: meta.source || 'unknown',
      canRevert: !!prev && existsSync(path.join(this.dir, prev)),
    };
  }

  /** Every show, with `eligible` = can be voted for (franchise root). */
  all(): Show[] {
    if (this.cache) return this.cache;
    const rows = this.handle().prepare('SELECT * FROM shows').all() as ShowRow[];
    const ids = new Set(rows.map((r) => r.id));
    this.cache = rows.map((r) => ({
      id: r.id,
      titleRomaji: r.title_romaji,
      titleEnglish: r.title_english,
      synonyms: safeJson(r.synonyms),
      startYear: r.start_year,
      season: r.season as ShowSeason | null,
      format: r.format as ShowFormat,
      coverImage: r.cover_image,
      coverColor: r.cover_color,
      popularity: r.popularity,
      score: r.score,
      favourites: r.favourites,
      parentId: r.parent_id,
      release: releaseOf(r.status, r.start_year),
      // a prequel we don't carry (e.g. adult / OVA) doesn't disqualify a show
      eligible: r.parent_id === null || (r.parent_id !== -1 && !ids.has(r.parent_id)),
    }));
    return this.cache;
  }

  /** Titles of sequels, each pointing at the root show of its franchise. */
  sequelAliases(): { title: string; rootId: number }[] {
    const byId = new Map(this.all().map((s) => [s.id, s]));
    const rootOf = (s: Show): Show | null => {
      let cur: Show | undefined = s;
      for (let hops = 0; cur && !cur.eligible && hops < 40; hops++) {
        cur = cur.parentId != null ? byId.get(cur.parentId) : undefined;
      }
      return cur?.eligible ? cur : null;
    };
    const out: { title: string; rootId: number }[] = [];
    for (const s of byId.values()) {
      if (s.eligible) continue;
      const root = rootOf(s);
      if (!root) continue;
      for (const title of [s.titleRomaji, s.titleEnglish, ...s.synonyms]) {
        if (title && LATIN.test(title)) out.push({ title, rootId: root.id });
      }
    }
    return out;
  }

  // ------------------------------------------------------------ updating

  get busy() {
    return this.status.state === 'running' || this.status.state === 'validating' || this.status.state === 'applying';
  }

  async update(opts: { fetchImpl?: typeof fetch; fromYear?: number; minGapMs?: number } = {}) {
    if (this.busy) return;
    const startedAt = Date.now();
    const abort = (this.abort = new AbortController());
    const file = `catalog-${startedAt}.db`;
    const partial = path.join(this.dir, `catalog-${startedAt}.partial.db`);
    let staging: Database.Database | null = null;
    let progress: SyncProgress | null = null;
    this.setStatus({ state: 'running', startedAt, progress });

    try {
      staging = new Database(partial);
      staging.pragma('journal_mode = DELETE');
      staging.pragma('synchronous = NORMAL');
      staging.exec(CATALOG_SQL);
      const upsert = prepareUpsert(staging);

      await fetchCatalog({
        signal: abort.signal,
        fetchImpl: opts.fetchImpl,
        fromYear: opts.fromYear,
        minGapMs: opts.minGapMs,
        onBatch: (media) => {
          upsert(media.map(mediaToRow).filter((r): r is ShowRow => r !== null));
        },
        onProgress: (p) => {
          progress = p;
          this.setStatus({ state: 'running', startedAt, progress });
        },
      });

      // ---- validate before anyone sees it
      this.setStatus({ state: 'validating', startedAt, progress });
      const integrity = staging.pragma('integrity_check', { simple: true });
      if (integrity !== 'ok') throw new Error(`New catalog failed integrity check: ${integrity}`);
      const total = (staging.prepare('SELECT COUNT(*) AS n FROM shows').get() as { n: number }).n;
      const current = this.info().count;
      if (total < this.minShows || total < current * 0.85) {
        throw new Error(
          `New catalog looks incomplete (${total} shows vs ${current} now) – keeping the current one.`
        );
      }
      const oldIds = new Set(this.all().map((s) => s.id));
      const newIds = new Set(
        (staging.prepare('SELECT id FROM shows').all() as { id: number }[]).map((r) => r.id)
      );
      let added = 0;
      for (const id of newIds) if (!oldIds.has(id)) added++;
      let removed = 0;
      for (const id of oldIds) if (!newIds.has(id)) removed++;

      setMeta(staging, { schema: SCHEMA_VERSION, source: 'anilist', synced_at: Date.now() });
      staging.close();
      staging = null;

      // ---- publish: rename is atomic, then flip the pointer atomically
      this.setStatus({ state: 'applying', startedAt, progress });
      renameSync(partial, path.join(this.dir, file));
      this.swapTo(file);

      this.setStatus({ state: 'done', startedAt, finishedAt: Date.now(), added, removed, total });
    } catch (err) {
      staging?.close();
      rmSync(partial, { force: true });
      const cancelled = abort.signal.aborted;
      this.setStatus({
        state: cancelled ? 'cancelled' : 'error',
        startedAt,
        finishedAt: Date.now(),
        error: cancelled ? undefined : err instanceof Error ? err.message : String(err),
      });
    } finally {
      this.abort = null;
    }
  }

  cancel() {
    this.abort?.abort(new Error('cancelled'));
  }

  revert() {
    const prev = this.pointer?.previous;
    if (this.busy || !prev || !existsSync(path.join(this.dir, prev))) return false;
    this.swapTo(prev, this.pointer!.file);
    return true;
  }

  // ------------------------------------------------------------ internals

  private swapTo(file: string, previous = this.pointer?.file ?? null) {
    const next = new Database(path.join(this.dir, file), { readonly: true, fileMustExist: true });
    this.writePointer({ file, previous });
    const old = this.db;
    this.db = next;
    this.cache = null;
    old?.close();
    this.cleanup();
    this.emit('changed', this.info());
  }

  private handle() {
    if (!this.db) throw new Error('catalog not initialised');
    return this.db;
  }

  private tryOpen(file: string) {
    const full = path.join(this.dir, file);
    if (!existsSync(full)) return false;
    try {
      const db = new Database(full, { readonly: true, fileMustExist: true });
      db.prepare('SELECT COUNT(*) FROM shows').get();
      this.db?.close();
      this.db = db;
      this.cache = null;
      return true;
    } catch {
      return false;
    }
  }

  private installSeed() {
    const file = `catalog-${Date.now()}.db`;
    const tmp = path.join(this.dir, `${file}.tmp`);
    copyFileSync(this.seedPath, tmp);
    // seeds shipped by got-poll v1 use the old single-table layout
    const db = new Database(tmp);
    migrateLegacy(db);
    db.exec(CATALOG_SQL);
    if (!getMeta(db).source) setMeta(db, { schema: SCHEMA_VERSION, source: 'bundled', synced_at: 0 });
    db.close();
    renameSync(tmp, path.join(this.dir, file));
    this.writePointer({ file, previous: null });
    if (!this.tryOpen(file)) throw new Error('Bundled catalog is unreadable');
  }

  private readPointer(): Pointer | null {
    try {
      const p = JSON.parse(readFileSync(path.join(this.dir, 'current.json'), 'utf8'));
      return typeof p.file === 'string' ? p : null;
    } catch {
      return null;
    }
  }

  private writePointer(p: Pointer) {
    const target = path.join(this.dir, 'current.json');
    writeFileSync(`${target}.tmp`, JSON.stringify(p));
    renameSync(`${target}.tmp`, target);
    this.pointer = p;
  }

  /** Keep only the live catalog and the one before it. */
  private cleanup() {
    const keep = new Set([this.pointer?.file, this.pointer?.previous]);
    for (const f of readdirSync(this.dir)) {
      if (/^catalog-\d+\.db$/.test(f) && !keep.has(f)) {
        try {
          rmSync(path.join(this.dir, f));
        } catch {
          // still open somewhere (Windows) – next start will get it
        }
      }
    }
  }

  private setStatus(s: UpdateStatus) {
    this.status = s;
    this.emit('status', s);
  }
}

// chat is Latin-script; skip "进击的巨人 第二季" style synonyms
const LATIN = /^[\p{Script=Latin}\p{N}\p{P}\p{S}\s]+$/u;

function safeJson(text: string): string[] {
  try {
    const v = JSON.parse(text);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}
