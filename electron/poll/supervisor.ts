// Keeps one chat connection alive for the length of a poll.
//
// A source only implements `session()`: connect, deliver messages, and
// return/throw when the connection is gone. Everything about *staying*
// connected lives here, identically for every platform:
//
//   * exponential backoff with full jitter (1s → 30s), reset once a session
//     has been healthy for a while, so a flapping network doesn't hammer
//   * a silence watchdog: no bytes for `idleMs` means a half-dead socket
//     (laptop sleep, Wi-Fi switch, NAT timeout) – abort and reconnect
//   * `NotLive` → a calm "waiting for the stream" state, re-checked slowly
//   * kick(): reconnect immediately (system resume, network back)
//   * stop() is final and cancels everything in flight

export class NotLive extends Error {
  constructor(message = 'not live yet') {
    super(message);
    this.name = 'NotLive';
  }
}

export type SessionContext = {
  signal: AbortSignal;
  /** call on any sign of life (message, ping, poll response) */
  alive: () => void;
  /** connection is up and receiving */
  live: (detail?: string) => void;
  status: (s: SourceStatus) => void;
};

export type SupervisorOptions = {
  name: string;
  session: (ctx: SessionContext) => Promise<void>;
  onStatus: (s: SourceStatus) => void;
  idleMs?: number;
  minDelayMs?: number;
  maxDelayMs?: number;
  /** delay between "is it live yet?" checks */
  notLiveDelayMs?: number;
  /** a session this long resets the backoff */
  stableMs?: number;
};

export class Supervisor {
  private stopped = true;
  private attempt = 0;
  private session: AbortController | null = null;
  private wake: (() => void) | null = null;
  private loop: Promise<void> | null = null;
  readonly opts: Required<SupervisorOptions>;

  constructor(opts: SupervisorOptions) {
    this.opts = {
      idleMs: 120_000,
      minDelayMs: 1_000,
      maxDelayMs: 30_000,
      notLiveDelayMs: 20_000,
      stableMs: 30_000,
      ...opts,
    };
  }

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.attempt = 0;
    this.loop = this.run();
  }

  async stop() {
    this.stopped = true;
    this.session?.abort(new Error('stopped'));
    this.wake?.();
    // sessions honour abort, but a stuck one must never block stopping a poll
    await Promise.race([this.loop, new Promise((r) => setTimeout(r, 3_000))]);
    this.loop = null;
    this.opts.onStatus({ state: 'off' });
  }

  /** Reconnect right now (e.g. after the computer wakes up). */
  kick(reason = 'network change') {
    if (this.stopped) return;
    this.attempt = 0;
    if (this.wake) this.wake(); // waiting → retry now
    else this.session?.abort(new Error(reason)); // connected → fresh connection
  }

  private async run() {
    const { onStatus } = this.opts;
    while (!this.stopped) {
      const ac = (this.session = new AbortController());
      const startedAt = Date.now();
      let lastLife = Date.now();
      let wentLive = false;
      const watchdog = setInterval(() => {
        if (Date.now() - lastLife > this.opts.idleMs) ac.abort(new Error('connection went quiet'));
      }, Math.min(5_000, this.opts.idleMs / 4));

      onStatus({ state: 'connecting', detail: this.attempt ? `attempt ${this.attempt + 1}` : undefined });
      let error: unknown = null;
      try {
        await this.opts.session({
          signal: ac.signal,
          alive: () => {
            lastLife = Date.now();
          },
          live: (detail) => {
            lastLife = Date.now();
            wentLive = true;
            onStatus({ state: 'live', detail });
          },
          status: (s) => {
            if (!ac.signal.aborted) onStatus(s);
          },
        });
      } catch (err) {
        error = err;
      } finally {
        clearInterval(watchdog);
        this.session = null;
      }
      if (this.stopped) break;

      // what happened, and how long until the next try?
      const abortReason = ac.signal.aborted ? (ac.signal.reason as Error | undefined)?.message : null;
      let delay: number;
      let status: SourceStatus;
      if (error instanceof NotLive) {
        this.attempt = 0;
        delay = this.opts.notLiveDelayMs;
        status = { state: 'waiting', detail: error.message };
      } else {
        if (wentLive && Date.now() - startedAt > this.opts.stableMs) this.attempt = 0;
        const cap = Math.min(this.opts.maxDelayMs, this.opts.minDelayMs * 2 ** this.attempt);
        delay = abortReason === 'network change' ? 0 : cap / 2 + Math.random() * (cap / 2);
        this.attempt++;
        const why = abortReason ?? (error instanceof Error ? error.message : error ? String(error) : 'disconnected');
        status = {
          state: this.attempt > 3 ? 'error' : 'connecting',
          detail: `${why.slice(0, 80)} – retrying in ${Math.ceil(delay / 1000)}s`,
          retryAt: Date.now() + delay,
        };
      }
      onStatus(status);
      await this.sleep(delay);
    }
  }

  private sleep(ms: number) {
    return new Promise<void>((resolve) => {
      if (ms <= 0 || this.stopped) return resolve();
      const t = setTimeout(done, ms);
      function done() {
        clearTimeout(t);
        resolve();
      }
      this.wake = () => {
        this.wake = null;
        done();
      };
    }).finally(() => {
      this.wake = null;
    });
  }
}

/** Remembers recently seen message ids so reconnect backlogs never double count. */
export class SeenIds {
  private set = new Set<string>();
  constructor(private max = 20_000) {}
  /** true the first time an id is seen */
  add(id: string) {
    if (this.set.has(id)) return false;
    this.set.add(id);
    if (this.set.size > this.max) {
      // drop the oldest quarter (Sets iterate in insertion order)
      let n = this.max / 4;
      for (const k of this.set) {
        this.set.delete(k);
        if (--n <= 0) break;
      }
    }
    return true;
  }
}

/** Abortable sleep for session loops. */
export function sleep(ms: number, signal: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    if (signal.aborted) return reject(signal.reason);
    const t = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(t);
      reject(signal.reason);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}
