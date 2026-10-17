import { NotLive, type SessionContext, type SupervisorOptions } from '../supervisor.js';
import { rumbleChannelPath, rumbleSession, type CandidateFinder } from './rumble.js';
import { twitchSession } from './twitch.js';
import type { Deliver } from './types.js';
import { youtubeLiveUrl, youtubeSession } from './youtube.js';

export type SourceDeps = { rumbleCandidates?: CandidateFinder; fetchImpl?: typeof fetch };

/** Session + supervisor tuning for one configured channel. */
export function sessionFor(
  c: Pick<ChannelConfig, 'platform' | 'target'>,
  deliver: Deliver,
  since: () => number,
  deps: SourceDeps = {}
): { session: SupervisorOptions['session']; tuning: Partial<SupervisorOptions> } {
  const f = deps.fetchImpl ?? fetch;
  switch (c.platform) {
    case 'twitch':
      // tmi pings every 60s, so 3 min of silence means the socket is dead
      return { session: twitchSession(c.target, deliver), tuning: { idleMs: 180_000 } };
    case 'youtube':
      // polls every 1–5s, so 45s without a response is a stuck connection
      return { session: youtubeSession(c.target, since, deliver, f), tuning: { idleMs: 45_000 } };
    case 'rumble':
      // quiet chats can be silent for ~90s; reconnecting is cheap
      return {
        session: rumbleSession(c.target, since, deliver, f, deps.rumbleCandidates),
        tuning: { idleMs: 120_000, notLiveDelayMs: 30_000 },
      };
  }
}

/** Validate + normalise what the user typed, without touching the network. */
export function describeChannel(
  platform: ChatPlatform,
  input: string
): { ok: true; target: string; name: string; follows: boolean } | { ok: false; error: string } {
  const s = input.trim();
  if (!s) return { ok: false, error: 'Enter a channel' };
  try {
    if (platform === 'twitch') {
      const name = (/twitch\.tv\/([a-z0-9_]{2,25})/i.exec(s)?.[1] ?? s.replace(/^#/, '')).toLowerCase();
      if (!/^[a-z0-9_]{2,25}$/.test(name)) return { ok: false, error: 'Twitch names are 2–25 letters, numbers or _' };
      return { ok: true, target: name, name: `#${name}`, follows: true };
    }
    if (platform === 'youtube') {
      const url = youtubeLiveUrl(s);
      const handle = /\/(@[\w.-]+)\//.exec(url)?.[1];
      const channel = /channel\/(UC[\w-]{22})/.exec(url)?.[1];
      const video = /watch\?v=([\w-]{11})/.exec(url)?.[1];
      if (video) return { ok: true, target: s, name: `video ${video}`, follows: false };
      return { ok: true, target: handle ?? channel ?? s, name: handle ?? channel ?? s, follows: true };
    }
    const embed = /embed\/v([a-z0-9]+)/i.exec(s)?.[1] ?? /chat\/popup\/([a-z0-9]+)/i.exec(s)?.[1];
    if (embed) return { ok: true, target: s, name: `stream v${embed}`, follows: false };
    if (/rumble\.com\/v[a-z0-9]+-/i.test(s)) {
      const slug = /rumble\.com\/v[a-z0-9]+-([^.?]+)/i.exec(s)?.[1]?.replace(/-/g, ' ') ?? 'video';
      return { ok: true, target: s.split('?')[0], name: slug, follows: false };
    }
    const path = rumbleChannelPath(s);
    if (path) return { ok: true, target: `https://rumble.com${path}`, name: path.split('/').pop()!, follows: true };
    return { ok: false, error: 'Paste a Rumble channel link or live video link' };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Connect once and report. Waits up to `ms`; once live, listens a few
 * seconds more to count messages so "live" means chat is actually flowing.
 */
export async function testChannel(
  c: Pick<ChannelConfig, 'platform' | 'target'>,
  deps: SourceDeps = {},
  ms = 25_000
): Promise<ChannelTestResult> {
  let messages = 0;
  let liveDetail: string | undefined;
  let wentLive = false;
  const ac = new AbortController();
  const { session } = sessionFor(c, () => messages++, () => Date.now(), deps);
  const ctx: SessionContext = {
    signal: ac.signal,
    alive: () => {},
    live: (d) => {
      wentLive = true;
      liveDetail = d;
      setTimeout(() => ac.abort(new Error('done')), 5_000);
    },
    status: () => {},
  };
  const timer = setTimeout(() => ac.abort(new Error('timed out')), ms);
  try {
    await session(ctx);
  } catch (err) {
    if (!wentLive) {
      if (err instanceof NotLive) return { result: 'offline', detail: err.message };
      const msg = ac.signal.aborted ? "couldn't connect in time" : err instanceof Error ? err.message : String(err);
      return { result: 'error', detail: msg };
    }
  } finally {
    clearTimeout(timer);
    ac.abort();
  }
  return wentLive ? { result: 'live', detail: liveDetail, messages } : { result: 'error', detail: 'no response' };
}
