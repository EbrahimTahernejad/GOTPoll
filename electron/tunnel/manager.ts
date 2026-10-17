// Share the viewer page outside this machine.
//
//   cloudflare  Cloudflare Quick Tunnel – free, no account, no key. The app
//               fetches the official cloudflared binary once. Random
//               *.trycloudflare.com URL, new on every start.
//   ngrok       official ngrok SDK (no binary) with the streamer's own free
//               authtoken. Stable *.ngrok-free.app URL; ngrok shows browsers
//               a one-click warning page (remembered 7 days).
//
// Either way the tunnel points at the loopback-only public server, which
// serves nothing but the read-only viewer page (see allowlist.ts).

import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { chmodSync, existsSync, mkdirSync, renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { Downloader } from '../downloads.js';
import { NotLive, Supervisor, type SessionContext } from '../poll/supervisor.js';

export type TunnelProvider = 'cloudflare' | 'ngrok';

export type TunnelStatus = {
  provider: TunnelProvider;
  state: 'off' | 'installing' | 'starting' | 'online' | 'reconnecting' | 'error';
  url: string | null;
  detail?: string;
  /** cloudflared download progress 0..1 */
  progress?: number;
};

const CLOUDFLARED_ASSET: Record<string, string> = {
  'win32-x64': 'cloudflared-windows-amd64.exe',
  'linux-x64': 'cloudflared-linux-amd64',
  'darwin-arm64': 'cloudflared-darwin-arm64.tgz',
  'darwin-x64': 'cloudflared-darwin-amd64.tgz',
};

export class TunnelManager extends EventEmitter<{ status: [TunnelStatus] }> {
  status: TunnelStatus = { provider: 'cloudflare', state: 'off', url: null };
  private sup: Supervisor | null = null;
  private downloads = new Downloader();

  constructor(
    private binDir: string,
    private targetPort: () => number
  ) {
    super();
  }

  private set(patch: Partial<TunnelStatus>) {
    this.status = { ...this.status, ...patch };
    this.emit('status', this.status);
  }

  get running() {
    return this.sup !== null;
  }

  async start(provider: TunnelProvider, ngrokToken = '') {
    await this.stop();
    this.set({ provider, state: 'starting', url: null, detail: undefined, progress: undefined });
    const session =
      provider === 'ngrok' ? (ctx: SessionContext) => this.ngrokSession(ctx, ngrokToken) : (ctx: SessionContext) => this.cloudflareSession(ctx);
    const sup = new Supervisor({
      name: `tunnel-${provider}`,
      session,
      // the tunnel keeps itself alive; silence isn't a failure
      idleMs: 24 * 3600_000,
      maxDelayMs: 60_000,
      notLiveDelayMs: 60_000,
      onStatus: (s) => {
        if (this.sup !== sup) return;
        if (s.state === 'live') this.set({ state: 'online', url: s.detail ?? this.status.url, detail: undefined });
        else if (s.state === 'connecting') this.set({ state: this.status.url ? 'reconnecting' : 'starting', detail: s.detail });
        else if (s.state === 'error' || s.state === 'waiting') this.set({ state: 'error', url: null, detail: s.detail });
      },
    });
    this.sup = sup;
    sup.start();
  }

  async stop() {
    const sup = this.sup;
    this.sup = null;
    await sup?.stop();
    this.set({ state: 'off', url: null, detail: undefined, progress: undefined });
  }

  // ------------------------------------------------------------ cloudflare

  private binPath() {
    return path.join(this.binDir, process.platform === 'win32' ? 'cloudflared.exe' : 'cloudflared');
  }

  /** Download the official cloudflared release for this OS, once. */
  private async ensureCloudflared(signal: AbortSignal) {
    const bin = this.binPath();
    if (existsSync(bin) && spawnSync(bin, ['--version'], { timeout: 15_000 }).status === 0) return bin;
    const asset = CLOUDFLARED_ASSET[`${process.platform}-${process.arch}`];
    if (!asset) throw new NotLive(`cloudflared has no build for ${process.platform}-${process.arch}`);
    this.set({ state: 'installing', detail: 'Downloading cloudflared (one time)', progress: 0 });
    mkdirSync(this.binDir, { recursive: true });
    const dest = path.join(this.binDir, asset);
    const onUpdate = (s: { id: string; received: number; total: number }) => {
      if (s.id === 'cloudflared' && s.total) this.set({ progress: s.received / s.total });
    };
    this.downloads.on('update', onUpdate);
    const onAbort = () => this.downloads.pause('cloudflared');
    signal.addEventListener('abort', onAbort, { once: true });
    try {
      await this.downloads.start({
        id: 'cloudflared',
        url: `https://github.com/cloudflare/cloudflared/releases/latest/download/${asset}`,
        dest,
        label: 'cloudflared',
      });
    } finally {
      this.downloads.off('update', onUpdate);
      signal.removeEventListener('abort', onAbort);
    }
    signal.throwIfAborted();
    if (asset.endsWith('.tgz')) {
      const r = spawnSync('tar', ['-xzf', dest, '-C', this.binDir], { timeout: 60_000 });
      rmSync(dest, { force: true });
      if (r.status !== 0) throw new Error('could not unpack cloudflared');
    } else {
      renameSync(dest, bin);
    }
    if (process.platform !== 'win32') chmodSync(bin, 0o755);
    if (spawnSync(bin, ['--version'], { timeout: 15_000 }).status !== 0) {
      rmSync(bin, { force: true });
      throw new Error('downloaded cloudflared does not run');
    }
    return bin;
  }

  private async cloudflareSession(ctx: SessionContext) {
    const bin = await this.ensureCloudflared(ctx.signal);
    this.set({ state: this.status.url ? 'reconnecting' : 'starting', detail: 'Opening tunnel…', progress: undefined });
    await new Promise<void>((resolve, reject) => {
      const child: ChildProcess = spawn(
        bin,
        // HTTP/2 over TCP 443 instead of the default QUIC: many networks
        // throttle UDP – measured 20 KB/s over QUIC vs 430 KB/s over HTTP/2
        ['tunnel', '--no-autoupdate', '--protocol', 'http2', '--url', `http://127.0.0.1:${this.targetPort()}`],
        { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true }
      );
      let url: string | null = null;
      let tail = '';
      const onData = (buf: Buffer) => {
        const text = buf.toString();
        tail = (tail + text).slice(-2000);
        ctx.alive();
        url ??= /https:\/\/[a-z0-9-]+\.trycloudflare\.com/.exec(text)?.[0] ?? null;
        // the URL is printed before the edge connection is ready
        if (url && /Registered tunnel connection|Connection [\w-]+ registered/i.test(text)) ctx.live(url);
      };
      child.stdout?.on('data', onData);
      child.stderr?.on('data', onData);
      child.on('error', reject);
      child.on('exit', (code) => {
        if (ctx.signal.aborted) resolve();
        else {
          const why = /error[^\n]*/i.exec(tail)?.[0]?.slice(0, 120);
          reject(new Error(why ?? `cloudflared exited (${code})`));
        }
      });
      ctx.signal.addEventListener('abort', () => child.kill(), { once: true });
    });
  }

  // ------------------------------------------------------------ ngrok

  private async ngrokSession(ctx: SessionContext, token: string) {
    if (!token.trim()) throw new NotLive('Paste your ngrok authtoken in Settings → Sharing');
    const ngrok = await import('@ngrok/ngrok');
    let listener: { url(): string | null; close(): Promise<void> } | null = null;
    try {
      listener = await ngrok.forward({ addr: `127.0.0.1:${this.targetPort()}`, authtoken: token.trim() });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // bad / revoked token: no point hammering ngrok
      if (/ERR_NGROK_(105|106|107|4018)|authtoken|authentication/i.test(msg)) throw new NotLive('ngrok rejected the authtoken');
      throw new Error(msg.slice(0, 160));
    }
    ctx.live(listener.url() ?? undefined);
    await new Promise<void>((resolve) => ctx.signal.addEventListener('abort', () => resolve(), { once: true }));
    await listener.close().catch(() => {});
  }
}
