// aria2-style downloader, built in (no extra binary for antivirus to flag):
//
//   * splits big files into ranges fetched over several connections at once
//   * resumable: progress is journaled next to the file, so pause, quit,
//     crash or network loss all continue where they stopped
//   * every range retries with backoff; an expired redirect URL is refreshed
//   * the file only appears under its real name after the size checks out
//     (and sha256, when known) – a half file is never mistaken for a model

import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import { createReadStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { open, type FileHandle } from 'node:fs/promises';
import path from 'node:path';

export type DownloadJob = {
  id: string;
  url: string;
  dest: string;
  label: string;
  /** expected size if known up front */
  size?: number;
  sha256?: string;
};

export type DownloadState = {
  id: string;
  label: string;
  dest: string;
  state: 'queued' | 'downloading' | 'paused' | 'verifying' | 'done' | 'error';
  total: number;
  received: number;
  /** bytes/sec, smoothed */
  speed: number;
  etaSec: number | null;
  connections: number;
  error?: string;
};

type Segment = { start: number; end: number; pos: number };
type Journal = { url: string; total: number; segments: Segment[] };

const MIN_SEGMENT = 16 * 1024 * 1024;
const MAX_CONNECTIONS = 8;
const UA = 'GOTPoll/2 (model downloader)';

export class Downloader extends EventEmitter<{ update: [DownloadState]; done: [DownloadState] }> {
  private states = new Map<string, DownloadState>();
  private runs = new Map<string, { abort: AbortController; promise: Promise<void> }>();
  private jobs = new Map<string, DownloadJob>();

  list() {
    return [...this.states.values()];
  }

  get(id: string) {
    return this.states.get(id);
  }

  /** Start or resume. Resolves when the file is complete and verified. */
  start(job: DownloadJob): Promise<void> {
    const running = this.runs.get(job.id);
    if (running) return running.promise;
    this.jobs.set(job.id, job);
    if (existsSync(job.dest)) {
      const size = statSync(job.dest).size;
      this.set(job, { state: 'done', total: size, received: size, speed: 0, etaSec: 0, connections: 0 });
      return Promise.resolve();
    }
    const abort = new AbortController();
    const promise = this.run(job, abort.signal).finally(() => this.runs.delete(job.id));
    this.runs.set(job.id, { abort, promise });
    return promise;
  }

  pause(id: string) {
    this.runs.get(id)?.abort.abort(new Error('paused'));
  }

  resume(id: string) {
    const job = this.jobs.get(id);
    return job ? this.start(job) : Promise.resolve();
  }

  async cancel(id: string) {
    const run = this.runs.get(id);
    const job = this.jobs.get(id);
    if (run) {
      run.abort.abort(new Error('cancelled'));
      await run.promise.catch(() => {}); // the run deletes its files on the way out
    } else if (job) {
      rmSync(`${job.dest}.part`, { force: true });
      rmSync(`${job.dest}.part.json`, { force: true });
    }
    this.states.delete(id);
  }

  private set(job: DownloadJob, patch: Partial<DownloadState>) {
    const prev = this.states.get(job.id);
    const next: DownloadState = {
      id: job.id,
      label: job.label,
      dest: job.dest,
      state: 'queued',
      total: job.size ?? 0,
      received: 0,
      speed: 0,
      etaSec: null,
      connections: 0,
      ...prev,
      ...patch,
    };
    this.states.set(job.id, next);
    this.emit('update', next);
    if (next.state === 'done') this.emit('done', next);
  }

  private async run(job: DownloadJob, signal: AbortSignal) {
    mkdirSync(path.dirname(job.dest), { recursive: true });
    const part = `${job.dest}.part`;
    const journalPath = `${part}.json`;
    let journal: Journal | null = null;
    try {
      journal = JSON.parse(readFileSync(journalPath, 'utf8'));
      if (!existsSync(part)) journal = null;
    } catch {
      journal = null;
    }

    this.set(job, { state: 'downloading', error: undefined });
    let handle: FileHandle | null = null;
    let ticker: NodeJS.Timeout | null = null;
    try {
      // resolve redirects + size once (HF sends you to a signed CDN URL)
      let { url, total, ranges } = await probe(job.url, signal);
      if (journal && journal.total !== total) journal = null;
      if (!journal) {
        const n = ranges ? Math.max(1, Math.min(MAX_CONNECTIONS, Math.floor(total / MIN_SEGMENT))) : 1;
        const size = Math.ceil(total / n);
        journal = {
          url,
          total,
          segments: Array.from({ length: n }, (_, i) => {
            const start = i * size;
            return { start, end: Math.min(total, start + size) - 1, pos: start };
          }),
        };
        writeFileSync(part, Buffer.alloc(0));
      }
      handle = await open(part, 'r+');
      const j = journal;
      const done = () => j.segments.reduce((n, s) => n + (s.pos - s.start), 0);

      // progress + journal every 400ms
      let lastBytes = done();
      let lastAt = Date.now();
      let speed = 0;
      ticker = setInterval(() => {
        const now = Date.now();
        const got = done();
        const inst = ((got - lastBytes) * 1000) / Math.max(1, now - lastAt);
        speed = speed ? speed * 0.8 + inst * 0.2 : inst;
        lastBytes = got;
        lastAt = now;
        writeFileSync(journalPath, JSON.stringify(j));
        this.set(job, {
          state: 'downloading',
          total: j.total,
          received: got,
          speed,
          etaSec: speed > 1 ? Math.round((j.total - got) / speed) : null,
          connections: j.segments.filter((s) => s.pos <= s.end).length,
        });
      }, 400);

      const fileHandle = handle;
      await Promise.all(
        j.segments.map((seg) =>
          fetchSegment(seg, () => url, signal, fileHandle, async () => {
            // signed URL expired: resolve again
            url = (await probe(job.url, signal)).url;
            j.url = url;
          })
        )
      );
      clearInterval(ticker);
      ticker = null;
      await handle.close();
      handle = null;
      writeFileSync(journalPath, JSON.stringify(j));

      // ---- verify before it gets its real name
      this.set(job, { state: 'verifying', received: j.total, speed: 0, etaSec: 0, connections: 0 });
      const size = statSync(part).size;
      if (size !== j.total) throw new Error(`size mismatch (${size} of ${j.total} bytes)`);
      if (job.sha256) {
        const sum = await sha256(part);
        if (sum !== job.sha256.toLowerCase()) {
          rmSync(part, { force: true });
          rmSync(journalPath, { force: true });
          throw new Error('checksum mismatch – the download was corrupted, please retry');
        }
      }
      renameSync(part, job.dest);
      rmSync(journalPath, { force: true });
      this.set(job, { state: 'done', total: j.total, received: j.total });
    } catch (err) {
      if (ticker) clearInterval(ticker);
      await handle?.close().catch(() => {});
      const reason = signal.aborted ? (signal.reason as Error)?.message : null;
      if (reason === 'cancelled') {
        // cleanup happens here, after the last write – not racing it
        rmSync(part, { force: true });
        rmSync(journalPath, { force: true });
        return;
      }
      if (journal) writeFileSync(journalPath, JSON.stringify(journal));
      this.set(job, {
        state: reason === 'paused' ? 'paused' : 'error',
        speed: 0,
        etaSec: null,
        connections: 0,
        error: reason === 'paused' ? undefined : err instanceof Error ? err.message : String(err),
      });
      if (reason !== 'paused') throw err;
    }
  }
}

/** probe with retries – a flaky network shouldn't fail a download before it starts */
async function probe(url: string, signal: AbortSignal) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await probeOnce(url, signal);
    } catch (err) {
      if (signal.aborted || attempt >= 6) throw err;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

async function probeOnce(url: string, signal: AbortSignal) {
  // a 1-byte ranged GET tells us size, range support and the final URL
  const res = await fetch(url, {
    headers: { Range: 'bytes=0-0', 'User-Agent': UA },
    redirect: 'follow',
    signal: AbortSignal.any([signal, AbortSignal.timeout(30_000)]),
  });
  await res.body?.cancel();
  if (res.status === 206) {
    const total = Number(/\/(\d+)$/.exec(res.headers.get('content-range') ?? '')?.[1]);
    if (!total) throw new Error('server did not report a size');
    return { url: res.url, total, ranges: true };
  }
  if (res.ok) {
    const total = Number(res.headers.get('content-length'));
    if (!total) throw new Error('server did not report a size');
    return { url: res.url, total, ranges: false };
  }
  throw new Error(`HTTP ${res.status}`);
}

async function fetchSegment(
  seg: Segment,
  url: () => string,
  signal: AbortSignal,
  fh: FileHandle,
  refresh: () => Promise<void>
) {
  for (let attempt = 0; seg.pos <= seg.end; attempt++) {
    signal.throwIfAborted();
    try {
      const res = await fetch(url(), {
        headers: { Range: `bytes=${seg.pos}-${seg.end}`, 'User-Agent': UA },
        signal,
      });
      if (res.status === 403 || res.status === 410) {
        await res.body?.cancel();
        await refresh();
        continue;
      }
      if (res.status !== 206 && !(res.status === 200 && seg.pos === 0)) {
        await res.body?.cancel();
        throw new Error(`HTTP ${res.status}`);
      }
      const reader = res.body!.getReader();
      // stall detector: no bytes for 30s → reconnect this range
      let stall: NodeJS.Timeout | null = null;
      const arm = () => {
        if (stall) clearTimeout(stall);
        stall = setTimeout(() => reader.cancel(new Error('stalled')).catch(() => {}), 30_000);
      };
      arm();
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          arm();
          const take = Math.min(value.byteLength, seg.end - seg.pos + 1);
          await fh.write(value, 0, take, seg.pos);
          seg.pos += take;
          attempt = 0;
          if (seg.pos > seg.end) break;
        }
      } finally {
        if (stall) clearTimeout(stall);
        await reader.cancel().catch(() => {});
      }
    } catch (err) {
      if (signal.aborted) throw signal.reason;
      if (attempt >= 30) throw err;
      await new Promise((r) => setTimeout(r, Math.min(15_000, 500 * 2 ** Math.min(attempt, 5))));
    }
  }
}

function sha256(file: string) {
  return new Promise<string>((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(file)
      .on('data', (d) => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}
