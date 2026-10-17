// Live check of the tunnel against a running app's public server:
// opens a real tunnel, fetches the viewer page + live feed through it,
// confirms private routes are blocked, then closes it.
//
//   node scripts/live-tunnel.mjs <publicPort> [cloudflare|ngrok]
//   (ngrok needs NGROK_AUTHTOKEN; the public port is in the app's log)

import os from 'node:os';
import path from 'node:path';
import WebSocket from 'ws';
import { inflateRawSync } from 'node:zlib';
import { TunnelManager } from '../build/electron/tunnel/manager.js';

const port = Number(process.argv[2]);
const provider = process.argv[3] ?? 'cloudflare';
if (!port) {
  console.log('usage: node scripts/live-tunnel.mjs <publicPort> [cloudflare|ngrok]');
  process.exit(2);
}
const t = new TunnelManager(path.join(os.tmpdir(), 'gotpoll-bin'), () => port);
const started = Date.now();
const secs = () => ((Date.now() - started) / 1000).toFixed(1);
t.on('status', (s) => console.log(`${secs()}s ${s.state}${s.url ? ` ${s.url}` : ''}${s.detail ? ` – ${s.detail}` : ''}${s.progress != null ? ` ${(s.progress * 100).toFixed(0)}%` : ''}`));
const url = await new Promise((resolve, reject) => {
  t.on('status', (s) => s.state === 'online' && s.url && resolve(s.url));
  setTimeout(() => reject(new Error('tunnel did not come online in 120s')), 120_000);
  t.start(provider, process.env.NGROK_AUTHTOKEN ?? '');
});

let ok = true;
const check = (name, pass, extra = '') => {
  ok &&= pass;
  console.log(`${pass ? '✓' : '✗'} ${name}${extra ? `  ${extra}` : ''}`);
};
// edge DNS for a brand-new hostname can take a moment
for (let i = 0; i < 20; i++) {
  const r = await fetch(url, { headers: { 'ngrok-skip-browser-warning': '1' } }).catch(() => null);
  if (r?.ok) break;
  await new Promise((r) => setTimeout(r, 2000));
}
const get = (p) =>
  fetch(url + p, { headers: { 'ngrok-skip-browser-warning': '1' } }).catch((e) => ({
    status: `error ${e.cause?.code ?? e.message}`,
    ok: false,
    json: async () => ({}),
  }));
const page = await get('/');
check('viewer page', page.status === 200, `HTTP ${page.status}`);
const counts = await get('/api/counts');
check('counts API', counts.status === 200 && (await counts.json()).title !== undefined, `HTTP ${counts.status}`);
for (const p of ['/api/dev/capture', '/settings', '/api/dev/sim?rate=1']) {
  const r = await get(p);
  check(`blocked ${p}`, r.status === 404, `HTTP ${r.status}`);
}
const wsUrl = url.replace(/^https/, 'wss') + '/ws?z=1';
await new Promise((resolve) => {
  const ws = new WebSocket(wsUrl, { headers: { 'ngrok-skip-browser-warning': '1' } });
  const timer = setTimeout(() => {
    check('websocket feed', false, 'no message in 20s');
    ws.terminate();
    resolve();
  }, 20_000);
  ws.on('message', (m, isBinary) => {
    clearTimeout(timer);
    const text = isBinary ? inflateRawSync(m).toString() : m.toString();
    const msg = JSON.parse(text);
    check(
      'websocket feed',
      msg.type === 'snapshot' && isBinary,
      `${wsUrl} · ${isBinary ? `compressed ${m.length} B → ${text.length} B` : 'uncompressed'}`
    );
    ws.close();
    resolve();
  });
  ws.on('error', (e) => {
    clearTimeout(timer);
    check('websocket feed', false, e.message);
    resolve();
  });
});
await t.stop();
const gone = await get('/').then((r) => r.status).catch(() => 'unreachable');
check('tunnel closed', gone !== 200, `after stop: ${gone}`);
process.exit(ok ? 0 : 1);
