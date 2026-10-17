import { NotLive, SeenIds, type SessionContext } from '../supervisor.js';
import { BROWSER_HEADERS, fetchWithin, type Deliver } from './types.js';

// Rumble live chat is a public Server-Sent Events stream:
//   GET https://web7.rumble.com/chat/api/chat/<stream id, base 10>/stream
// "init" carries config + recent history, "messages" carries new ones.
// HTTP 204 = the chat is over. There are no event ids, so a reconnect
// replays history – deduped here by message id.
//
// What the streamer can paste – no API key, no login:
//   * their channel link (rumble.com/c/Name) or just the name
//     → follows whatever they stream, across streams  (recommended)
//   * a live video link (rumble.com/v…-title.html) → resolved via oEmbed
//   * an embed / chat popup link

type Target = { id36: string; title?: string; follows: boolean };

/** Finds candidate video links on a channel page (a hidden browser in the app). */
export type CandidateFinder = (channelPath: string, signal: AbortSignal) => Promise<string[]>;

type OEmbed = { html?: string; title?: string; author_url?: string; duration?: number };

async function oembed(url: string, signal: AbortSignal, fetchImpl: typeof fetch): Promise<OEmbed | null> {
  const res = await fetchWithin(
    fetchImpl,
    `https://rumble.com/api/Media/oembed.json?url=${encodeURIComponent(url.split('?')[0])}`,
    { signal, headers: BROWSER_HEADERS }
  );
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Rumble lookup HTTP ${res.status}`);
  return (await res.json()) as OEmbed;
}

const embedId = (o: OEmbed | null) => /embed\/v([a-z0-9]+)/i.exec(o?.html ?? '')?.[1]?.toLowerCase();

/** "/c/Name" for channel links and bare names, null for anything else. */
export function rumbleChannelPath(input: string): string | null {
  const s = input.trim().replace(/\/+$/, '');
  const m = /rumble\.com\/((?:c|user)\/[\w.-]+)/i.exec(s);
  if (m) return `/${m[1]}`;
  if (/^[\w.-]{2,60}$/.test(s) && !/^v[a-z0-9]{5,8}$/.test(s)) return `/c/${s}`;
  return null;
}

export async function resolveRumble(
  input: string,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
  findCandidates?: CandidateFinder
): Promise<Target> {
  const s = input.trim();
  const embed =
    /embed\/v([a-z0-9]+)/i.exec(s)?.[1] ?? /chat\/popup\/([a-z0-9]+)/i.exec(s)?.[1] ?? /^v([a-z0-9]{5,8})$/.exec(s)?.[1];
  if (embed) return { id36: embed.toLowerCase(), follows: false };

  if (/rumble\.com\/v[a-z0-9]+-/i.test(s)) {
    const id = embedId(await oembed(s, signal, fetchImpl));
    if (!id) throw new Error("that Rumble link isn't a video");
    return { id36: id, follows: false };
  }

  const channel = rumbleChannelPath(s);
  if (!channel) throw new Error('paste your Rumble channel link or a live video link');
  if (!findCandidates) throw new Error('channel lookup unavailable');
  const links = await findCandidates(channel, signal);
  // Confirm each candidate with keyless APIs: oEmbed says whose video it is
  // and duration 0 means live; the chat stream itself has the final word.
  for (const link of links.slice(0, 8)) {
    const o = await oembed(link, signal, fetchImpl).catch(() => null);
    const owner = o?.author_url ? new URL(o.author_url).pathname.toLowerCase() : '';
    const id = embedId(o);
    if (!id || o?.duration !== 0 || owner !== channel.toLowerCase()) continue;
    return { id36: id, title: o.title, follows: true };
  }
  throw new NotLive('waiting for the stream to go live');
}

type RumbleEvent = {
  type: string;
  data: {
    messages?: { id: string; time: string; user_id: string; text: string }[];
    users?: { id: string; username: string }[];
  };
};

/** Minimal SSE parser: yields the `data:` payload of each event. */
export async function* sseEvents(body: ReadableStream<Uint8Array>, onBytes: () => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) return;
      onBytes();
      buf += decoder.decode(value, { stream: true });
      let cut: number;
      while ((cut = buf.search(/\r?\n\r?\n/)) !== -1) {
        const block = buf.slice(0, cut);
        buf = buf.slice(cut).replace(/^\r?\n\r?\n/, '');
        const data = block
          .split(/\r?\n/)
          .filter((l) => l.startsWith('data:'))
          .map((l) => l.slice(5).replace(/^ /, ''))
          .join('\n');
        if (data) yield data;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export function rumbleSession(
  input: string,
  since: () => number,
  deliver: Deliver,
  fetchImpl: typeof fetch = fetch,
  findCandidates?: CandidateFinder
) {
  const seen = new SeenIds();
  return async (ctx: SessionContext) => {
    const target = await resolveRumble(input, ctx.signal, fetchImpl, findCandidates);
    ctx.alive();
    const id10 = parseInt(target.id36, 36);
    const res = await fetchImpl(`https://web7.rumble.com/chat/api/chat/${id10}/stream`, {
      signal: ctx.signal,
      headers: { ...BROWSER_HEADERS, Accept: 'text/event-stream' },
    });
    if (res.status === 204) {
      throw new NotLive(
        target.follows ? 'stream ended – waiting for the next one' : 'this stream has ended – paste the new link'
      );
    }
    if (!res.ok || !res.body) throw new Error(`Rumble chat HTTP ${res.status}`);

    for await (const data of sseEvents(res.body, ctx.alive)) {
      let event: RumbleEvent;
      try {
        event = JSON.parse(data);
      } catch {
        continue;
      }
      if (event.type === 'init') ctx.live(target.title ?? `v${target.id36}`);
      if (event.type !== 'init' && event.type !== 'messages') continue;
      const from = since();
      for (const m of event.data.messages ?? []) {
        if (!seen.add(m.id)) continue;
        if (Date.parse(m.time) < from) continue;
        if (m.text?.trim()) deliver({ platform: 'rumble', userId: m.user_id, text: m.text });
      }
    }
    // server closed the stream: reconnect; a 204 then means it's over
  };
}
