// Live smoke test of every chat source against the real services, including a
// forced reconnect mid-stream. No keys, no login.
//
//   TWITCH=chan1,chan2 YOUTUBE=@handle RUMBLE=<live video link> RUMBLE_CHANNEL=<channel link> pnpm test:live
//
// Pick channels that are live right now. Unset ones are skipped.

import { app } from 'electron';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

app.setPath('userData', mkdtempSync(path.join(tmpdir(), 'gotpoll-live-')));
app.on('window-all-closed', () => {});
// (no top-level await of whenReady – Electron holds 'ready' until ESM top-level awaits settle)
app.whenReady().then(main);

async function main() {

const { Supervisor } = await import('../build/electron/poll/supervisor.js');
const { twitchSession } = await import('../build/electron/poll/sources/twitch.js');
const { youtubeSession } = await import('../build/electron/poll/sources/youtube.js');
const { rumbleSession } = await import('../build/electron/poll/sources/rumble.js');
const { findRumbleCandidates } = await import('../build/electron/poll/sources/rumble-browser.js');

const RUN_MS = Number(process.env.RUN_MS ?? 70_000);
const KICK_AT = RUN_MS / 2;
const since = Date.now();
const results = {};

function track(name, session) {
  const r = (results[name] = { before: 0, after: 0, statuses: [], kicked: false, sample: '' });
  const sup = new Supervisor({
    name,
    session,
    onStatus: (s) => {
      const line = `${((Date.now() - since) / 1000).toFixed(1)}s ${s.state}${s.detail ? ` (${s.detail})` : ''}`;
      r.statuses.push(line);
      console.log(`[${name}] ${line}`);
    },
  });
  return { sup, deliver: (m) => {
    r[r.kicked ? 'after' : 'before']++;
    if (!r.sample) r.sample = m.text.slice(0, 40);
  }, r };
}

const twitchChannels = (process.env.TWITCH ?? '').split(',').filter(Boolean);
if (!twitchChannels.length && !process.env.YOUTUBE && !process.env.RUMBLE && !process.env.RUMBLE_CHANNEL) {
  console.log('Set TWITCH / YOUTUBE / RUMBLE / RUMBLE_CHANNEL to channels that are live right now.');
  app.exit(2);
}
const sources = [];
// Twitch: several big channels in parallel – whichever are live will talk
for (const ch of twitchChannels) {
  const t = track(`twitch #${ch}`, null);
  t.sup.opts.session = twitchSession(ch, t.deliver);
  sources.push(t);
}
if (process.env.YOUTUBE) {
  const t = track('youtube', null);
  t.sup.opts.session = youtubeSession(process.env.YOUTUBE, () => since, t.deliver);
  sources.push(t);
}
if (process.env.RUMBLE) {
  const t = track('rumble (video link)', null);
  t.sup.opts.session = rumbleSession(process.env.RUMBLE, () => since, t.deliver);
  sources.push(t);
}
if (process.env.RUMBLE_CHANNEL) {
  const t = track('rumble (channel)', null);
  t.sup.opts.session = rumbleSession(
    process.env.RUMBLE_CHANNEL,
    () => since,
    t.deliver,
    fetch,
    findRumbleCandidates
  );
  sources.push(t);
}

sources.forEach((s) => s.sup.start());
setTimeout(() => {
  for (const s of sources) {
    s.r.kicked = true;
    s.sup.kick('network change');
  }
}, KICK_AT);

setTimeout(async () => {
  await Promise.all(sources.map((s) => s.sup.stop()));
  let ok = true;
  const twitchOk = Object.entries(results).some(([n, r]) => n.startsWith('twitch') && r.before > 0 && r.after > 0);
  for (const [name, r] of Object.entries(results)) {
    if (name.startsWith('twitch') && r.before + r.after === 0) {
      console.log(`  (twitch ${name.slice(7)}: joined, offline)`);
      continue;
    }
    const pass = r.before > 0 && r.after > 0;
    if (!name.startsWith('twitch')) ok &&= pass;
    console.log(`\n${pass ? '✓' : '✗'} ${name}: ${r.before} msgs before reconnect, ${r.after} after  e.g. "${r.sample}"`);
    for (const s of r.statuses) console.log(`    ${s}`);
  }
  if (twitchChannels.length) {
    console.log(`\nTwitch: ${twitchOk ? '✓ live channel kept flowing across the reconnect' : '✗ no live channel delivered on both sides'}`);
  }
  app.exit(ok && (twitchOk || !twitchChannels.length) ? 0 : 1);
}, RUN_MS);

// never hang CI / a terminal
setTimeout(() => {
  console.log('✗ timed out stopping sources');
  app.exit(2);
}, RUN_MS + 15_000).unref();
}
