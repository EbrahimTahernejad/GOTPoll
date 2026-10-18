import express, { type Request, type Response } from 'express';
import { createServer } from 'node:http';
import { deflateRawSync } from 'node:zlib';
import { createProxyMiddleware } from 'http-proxy-middleware';
import isDev from 'electron-is-dev';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import getFreePort from 'get-port';
import { WebSocketServer, type WebSocket } from 'ws';
import { poll, publicFeed, tournament, user } from './services.js';
import { isPublicRequest, isPublicUpgrade } from './tunnel/allowlist.js';

// Viewer page server (OBS browser source / second screen).
//   GET  /            the live ranking page
//   WS   /ws          pushes a PublicSnapshot on every change (~5/s max)
//   GET  /api/counts  same payload, for anything that can't do websockets

const dirname = path.resolve(fileURLToPath(import.meta.url), '..');
const app = express();
const server = createServer(app);
export const port = await getFreePort({ port: [4747, 4748, 4749] });

app.get('/api/counts', (_req: Request, res: Response) => {
  res.json(publicFeed());
});

// Dev only: drive a poll with fake chat to see the viewer page move.
//   /api/dev/sim?rate=8   start (or speed up) a simulated chat, msgs/sec
//   /api/dev/sim?rate=0   stop the simulation (&end=1 also ends the poll)
if (isDev) {
  const SIM: [string, number][] = [
    ['frieren', 30], ['sousou no frieren', 8], ['FRIEREN!!! 🔥', 6], ['frieran', 3], ['jjk', 22],
    ['jujutsu kaisen', 8], ['one piece', 18], ['onepiece', 4], ['demon slayer', 14], ['kny', 3],
    ['chainsaw man', 12], ['csm', 4], ['spy x family', 10], ['spy family', 4], ['aot', 12],
    ['attack on titan season 4', 5], ['vinland saga', 8], ['dandadan', 9], ['solo leveling', 11],
    ['oshi no ko', 7], ['bocchi', 6], ['mob psycho', 5], ['hxh', 6], ['cyberpunk edgerunners', 5],
    ['steins gate', 5], ['the devil dog one', 3], ['lol', 10], ['W', 8], ['hi chat', 5], ['gg', 5],
    ['the apothecary diaries', 6], ['kusuriya', 3], ['re zero', 5], ['konosuba', 5], ['blue lock', 4],
    // number votes (count in shortlist polls, plain chat otherwise)
    ['1', 25], ['2', 22], ['!vote 1', 8], ['#2', 8], ['vote 3', 5],
  ];
  const total = SIM.reduce((n, [, w]) => n + w, 0);
  const pick = () => {
    let r = Math.random() * total;
    for (const [t, w] of SIM) if ((r -= w) <= 0) return t;
    return SIM[0][0];
  };
  // Dev-only screenshot of the app window itself (never the rest of the screen).
  //   /api/dev/capture?route=/settings&section=channels
  app.get('/api/dev/capture', async (req: Request, res: Response) => {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')) {
      res.status(403).end();
      return;
    }
    const { BrowserWindow } = await import('electron');
    const win = BrowserWindow.getAllWindows().find((w) => /localhost:5173/.test(w.webContents.getURL()));
    if (!win) {
      res.status(404).send('app window not found');
      return;
    }
    const route = String(req.query.route ?? '');
    const section = String(req.query.section ?? '');
    const hash = String(req.query.hash ?? '');
    if (hash && !/^#[a-z-]{2,30}$/.test(hash)) {
      res.status(400).send('bad hash');
      return;
    }
    if (route && !['/', '/settings', '/tournament'].includes(route)) {
      res.status(400).send('unknown route');
      return;
    }
    if (section && !/^[a-z]{2,12}$/.test(section)) {
      res.status(400).send('bad section');
      return;
    }
    if (section) await win.webContents.executeJavaScript(`localStorage.setItem('settings-section', ${JSON.stringify(section)})`);
    if (route) {
      const base = new URL(win.webContents.getURL()).origin;
      await win.loadURL(`${base}${route}${hash}`);
    }
    await new Promise((r) => setTimeout(r, 2000));
    if (req.query.probe === 'dialog') {
      // fixed diagnostic, no caller-supplied code
      const info = await win.webContents.executeJavaScript(
        `(() => { const el = document.querySelector('[data-slot=dialog-content]'); if (!el) return null; const cs = getComputedStyle(el); return { backdrop: cs.backdropFilter, bg: cs.backgroundColor, supports: CSS.supports('backdrop-filter', 'blur(4px)') }; })()`
      );
      res.json(info);
      return;
    }
    const img = await win.webContents.capturePage();
    res.type('png').send(img.toPNG());
  });

  // Dev only: drive the tournament without clicking.
  //   /api/dev/tournament?a={"type":"start-open"}
  app.get('/api/dev/tournament', async (req: Request, res: Response) => {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')) {
      res.status(403).end();
      return;
    }
    try {
      if (req.query.a) await tournament.act(JSON.parse(String(req.query.a)) as TournamentAction);
      const s = tournament.snapshot();
      res.json({ phase: s.tournament?.phase ?? null, screen: s.tournament?.screen, live: s.tournament?.live, focus: s.tournament?.focus, cut: s.tournament?.cut, undo: s.undoLabel });
    } catch (err) {
      res.status(400).json({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // Dev only: play exact chat lines, spread over `over` ms (demos with set results).
  //   POST /api/dev/say {"over": 20000, "m": [["twitch", "user1", "frieren"], …]}
  app.post('/api/dev/say', express.json({ limit: '2mb' }), (req: Request, res: Response) => {
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress ?? '')) {
      res.status(403).end();
      return;
    }
    const lines = (Array.isArray(req.body?.m) ? req.body.m : []) as [ChatPlatform, string, string][];
    const over = Math.max(0, Number(req.body?.over) || 0);
    lines.forEach(([platform, userId, text], i) => {
      setTimeout(() => poll.ingest({ platform, userId, text }), lines.length > 1 ? (over * i) / (lines.length - 1) : 0);
    });
    res.json({ queued: lines.length });
  });

  let timer: NodeJS.Timeout | null = null;
  app.get('/api/dev/sim', async (req: Request, res: Response) => {
    const rate = Number(req.query.rate ?? 6);
    if (timer) clearInterval(timer);
    timer = null;
    if (rate > 0) {
      // a tournament runs its own rounds – the sim only plays chat into them
      if (!poll.isRunning && !tournament.snapshot().tournament) {
        const s = user.settings();
        await poll.start({ mode: s.pollMode, filters: s.pollFilters, shortlist: s.pollShortlist }, { sources: false });
      }
      const platforms = ['twitch', 'twitch', 'youtube', 'rumble'] as const;
      timer = setInterval(() => {
        const platform = platforms[Math.floor(Math.random() * platforms.length)];
        poll.ingest({ platform, userId: `sim${Math.floor(Math.random() * 4000)}`, text: pick() });
      }, 1000 / rate);
    }
    if (rate <= 0 && req.query.end && !tournament.snapshot().tournament) poll.stop();
    res.json({ rate, state: poll.snapshot().state });
  });
}

const viteProxy = isDev
  ? createProxyMiddleware({ target: 'http://localhost:5173', changeOrigin: true, ws: false })
  : null;

if (viteProxy) {
  app.use('/', viteProxy);
} else {
  app.use(express.static(path.join(dirname, '../client/')));
  app.use((_req: Request, res: Response) => {
    res.sendFile(path.join(dirname, '../client/index.html'));
  });
}

// ---- websocket
// permessage-deflate: snapshots are repetitive JSON (~9 KB → ~2.5 KB), which
// matters once viewers come in through a metered tunnel.
const wss = new WebSocketServer({
  noServer: true,
  perMessageDeflate: { zlibDeflateOptions: { level: 6 }, threshold: 512 },
});
const alive = new WeakMap<WebSocket, boolean>();
// Clients that asked for ?z=1 get deflate-raw binary frames. Unlike the
// permessage-deflate extension, this survives tunnels (Cloudflare's edge
// strips WebSocket extensions) – browsers inflate with DecompressionStream.
const packed = new WeakSet<WebSocket>();
let last = JSON.stringify({ type: 'snapshot', data: publicFeed() });
let lastZ: Buffer | null = null;
const deflated = () => (lastZ ??= deflateRawSync(last, { level: 6 }));

wss.on('connection', (ws, req) => {
  alive.set(ws, true);
  ws.on('pong', () => alive.set(ws, true));
  if (new URL(req.url ?? '/', 'http://x').searchParams.get('z') === '1') packed.add(ws);
  ws.send(packed.has(ws) ? deflated() : last);
});

function push(s?: PollSnapshot) {
  const msg = JSON.stringify({ type: 'snapshot', data: publicFeed(s) });
  if (msg === last) return;
  last = msg;
  lastZ = null;
  for (const ws of wss.clients) {
    if (ws.readyState === ws.OPEN) ws.send(packed.has(ws) ? deflated() : msg);
  }
}
poll.on('update', (s) => push(s));
tournament.on('update', () => push());

// drop clients that vanished without closing (sleeping laptops, OBS reloads)
setInterval(() => {
  for (const ws of wss.clients) {
    if (!alive.get(ws)) {
      ws.terminate();
      continue;
    }
    alive.set(ws, false);
    ws.ping();
  }
}, 15_000).unref();

server.on('upgrade', (req, socket, head) => {
  if (req.url?.startsWith('/ws')) {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else if (viteProxy?.upgrade) {
    viteProxy.upgrade(req, socket as never, head); // Vite HMR in dev
  } else {
    socket.destroy();
  }
});

server.listen(port, () => {
  console.log(`Viewer page on http://localhost:${port}`);
});

// ---- public server (what tunnels point at)
// Loopback only, random port, read-only: the viewer page, its assets, the
// counts API and the live feed. Settings, dev endpoints, Vite HMR – 404.
const pub = express();
pub.disable('x-powered-by');
pub.use((req, res, next) => {
  if (!isPublicRequest(req.method, req.originalUrl, isDev)) {
    res.status(404).type('text/plain').send('Not found');
    return;
  }
  res.setHeader('X-Robots-Tag', 'noindex');
  next();
});
pub.get('/api/counts', (_req: Request, res: Response) => {
  res.json(publicFeed());
});
if (viteProxy) {
  pub.use('/', viteProxy);
} else {
  pub.use(express.static(path.join(dirname, '../client/')));
  pub.use((_req: Request, res: Response) => res.sendFile(path.join(dirname, '../client/index.html')));
}
const publicServer = createServer(pub);
publicServer.on('upgrade', (req, socket, head) => {
  if (req.url && isPublicUpgrade(req.url)) {
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  } else {
    socket.destroy();
  }
});
export const publicPort = await getFreePort();
publicServer.listen(publicPort, '127.0.0.1', () => {
  console.log(`Public (tunnel) server on http://127.0.0.1:${publicPort}`);
});
