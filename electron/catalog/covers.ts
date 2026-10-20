import Database from 'better-sqlite3';
import { EventEmitter } from 'node:events';
import { tconstOf } from './imdb.js';

// Posters for IMDb titles. The datasets carry no images, so each cover is
// looked up the first time a title is actually shown (search results, a
// poll's ranking, a tournament) through IMDb's public search endpoint – no
// key – and remembered. Misses are remembered too and retried after a week.

const MISS_RETRY_MS = 7 * 86400_000;
const CONCURRENCY = 4;

export class CoverResolver extends EventEmitter<{ resolved: [{ id: number; url: string }[]] }> {
  private db: Database.Database;
  private cache = new Map<number, { url: string | null; at: number }>();
  private queue: number[] = [];
  private queued = new Set<number>();
  private active = 0;
  private pending: { id: number; url: string }[] = [];
  private flushTimer: NodeJS.Timeout | null = null;

  constructor(
    file: string,
    private fetchImpl: typeof fetch = fetch
  ) {
    super();
    this.db = new Database(file);
    this.db.pragma('journal_mode = WAL');
    this.db.exec('CREATE TABLE IF NOT EXISTS covers (id INTEGER PRIMARY KEY, url TEXT, at INTEGER NOT NULL)');
    for (const r of this.db.prepare('SELECT id, url, at FROM covers').all() as { id: number; url: string | null; at: number }[]) {
      this.cache.set(r.id, { url: r.url, at: r.at });
    }
  }

  get(id: number): string | null {
    return this.cache.get(id)?.url ?? null;
  }

  /** Look these up in the background (skips known ones). */
  want(ids: number[]) {
    const now = Date.now();
    for (const id of ids) {
      const c = this.cache.get(id);
      if ((c && (c.url || now - c.at < MISS_RETRY_MS)) || this.queued.has(id)) continue;
      this.queued.add(id);
      this.queue.push(id);
    }
    this.pump();
  }

  private pump() {
    while (this.active < CONCURRENCY && this.queue.length) {
      const id = this.queue.shift()!;
      this.active++;
      this.lookup(id)
        .then((url) => {
          this.cache.set(id, { url, at: Date.now() });
          this.db.prepare('INSERT OR REPLACE INTO covers (id, url, at) VALUES (?, ?, ?)').run(id, url, Date.now());
          if (url) {
            this.pending.push({ id, url });
            this.flushSoon();
          }
        })
        .catch(() => {}) // offline: try again next time it's wanted
        .finally(() => {
          this.active--;
          this.queued.delete(id);
          this.pump();
        });
    }
  }

  private flushSoon() {
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      const batch = this.pending;
      this.pending = [];
      if (batch.length) this.emit('resolved', batch);
    }, 250);
  }

  private async lookup(id: number): Promise<string | null> {
    const tt = tconstOf(id);
    const res = await this.fetchImpl(`https://v3.sg.media-imdb.com/suggestion/x/${tt}.json`, {
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(String(res.status));
    const data = (await res.json()) as { d?: { id: string; i?: { imageUrl?: string } }[] };
    const url = data.d?.find((x) => x.id === tt)?.i?.imageUrl;
    // ask the image CDN for a poster-sized copy instead of the full original
    return url ? url.replace(/\._V1_.*\.(jpg|png)$/i, '._V1_QL75_UX400_.$1') : null;
  }

  close() {
    this.db.close();
  }
}
