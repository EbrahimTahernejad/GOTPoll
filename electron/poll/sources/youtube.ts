import { parseChatData } from 'youtube-chat/dist/parser.js';
import type { ChatItem } from 'youtube-chat/dist/types/data.js';
import { NotLive, SeenIds, sleep, type SessionContext } from '../supervisor.js';
import { BROWSER_HEADERS, fetchWithin, type Deliver } from './types.js';

// Our own poll loop on top of youtube-chat's parser. The library's loop fires
// every second regardless of whether the last request finished (overlapping
// requests race the continuation token), keeps hammering after errors and
// never notices a stream ending. Here: one request at a time, YouTube's own
// suggested delay, a timeout per request, dedupe across reconnects, and
// "ended" → back to waiting for the next stream.

// skip the EU cookie-consent interstitial
const CONSENT = { Cookie: 'CONSENT=YES+cb.20240101-00-p0.en+FX+000; SOCS=CAI' };

/** Accepts UC… ids, @handles, channel URLs or a watch/live URL. */
export function youtubeLiveUrl(input: string): string {
  const s = input.trim();
  const video =
    /(?:v=|youtu\.be\/|\/live\/|\/shorts\/)([\w-]{11})/.exec(s)?.[1] ?? (/^[\w-]{11}$/.test(s) ? s : null);
  if (video) return `https://www.youtube.com/watch?v=${video}`;
  const handle = /(?:youtube\.com\/)?(@[\w.-]+)/.exec(s)?.[1];
  if (handle) return `https://www.youtube.com/${handle}/live`;
  const channel = /(UC[\w-]{22})/.exec(s)?.[1];
  if (channel) return `https://www.youtube.com/channel/${channel}/live`;
  throw new Error(`"${input}" isn't a YouTube channel id, @handle or link`);
}

/**
 * youtube-chat's parser throws on the first item it doesn't understand,
 * losing the whole batch. Parse action by action and skip only bad ones.
 */
function parseRobust(json: any, cont: any): { items: ChatItem[]; continuation: string } {
  const [, continuation] = parseChatData({ continuationContents: { liveChatContinuation: { ...cont, actions: [] } } } as any);
  const items: ChatItem[] = [];
  for (const action of cont.actions ?? []) {
    try {
      const [parsed] = parseChatData({
        continuationContents: { liveChatContinuation: { continuations: cont.continuations, actions: [action] } },
      } as any);
      items.push(...parsed);
    } catch {
      // unknown/malformed item (new YouTube renderer, partial data) – skip it
    }
  }
  return { items, continuation };
}

async function fetchPage(url: string, signal: AbortSignal, fetchImpl: typeof fetch) {
  const page = await fetchWithin(fetchImpl, url, { signal, headers: { ...BROWSER_HEADERS, ...CONSENT } });
  if (!page.ok) throw new Error(`YouTube page HTTP ${page.status}`);
  return page.text();
}

export type LiveOptions = { liveId: string | null; apiKey: string; clientVersion: string; continuation: string };

/**
 * Pull what the chat API needs out of a watch / live page. Anchored on the
 * live-chat block itself rather than the canonical link: YouTube sometimes
 * serves a "confirm you're not a bot" player with canonical="undefined" while
 * the chat data is all there. null = no live chat on this page.
 */
export function parseOptions(html: string, fallbackId?: string): LiveOptions | null {
  if (/["']isReplay["']:\s*true/.test(html)) return null; // finished stream (replay)
  // the data block – the bare name also appears in a list of renderer names
  const chat = html.indexOf('"liveChatRenderer":{');
  if (chat === -1) return null;
  const continuation = /"continuation":"([^"]+)"/.exec(html.slice(chat))?.[1];
  const apiKey = /"INNERTUBE_API_KEY":\s*"([^"]+)"/.exec(html)?.[1];
  const clientVersion =
    /"INNERTUBE_CONTEXT_CLIENT_VERSION":\s*"([\d.]+)"/.exec(html)?.[1] ?? /"clientVersion":\s*"([\d.]+)"/.exec(html)?.[1];
  // only used as a label
  const liveId =
    /"videoDetails":\{"videoId":"([\w-]{11})"/.exec(html)?.[1] ??
    /<link rel="canonical" href="https:\/\/www\.youtube\.com\/watch\?v=([\w-]{11})"/.exec(html)?.[1] ??
    fallbackId ??
    null;
  if (!continuation || !apiKey || !clientVersion) {
    throw new Error('YouTube page changed – chat data not found');
  }
  return { liveId, apiKey, clientVersion, continuation };
}

/**
 * /live redirects to the stream – unless the channel runs several at once,
 * then it's the channel page. Fall back to the first video with a LIVE badge.
 */
async function resolveLive(url: string, signal: AbortSignal, fetchImpl: typeof fetch) {
  const html = await fetchPage(url, signal, fetchImpl);
  const direct = parseOptions(html, /watch\?v=([\w-]{11})/.exec(url)?.[1]);
  if (direct) return direct;
  const badge = html.indexOf('"style":"LIVE"');
  if (badge !== -1 && !url.includes('watch?v=')) {
    const ids = [...html.slice(Math.max(0, badge - 4000), badge).matchAll(/"videoId":"([\w-]{11})"/g)];
    const id = ids.at(-1)?.[1];
    if (id) {
      const viaWatch = parseOptions(await fetchPage(`https://www.youtube.com/watch?v=${id}`, signal, fetchImpl), id);
      if (viaWatch) return viaWatch;
    }
  }
  throw new NotLive('waiting for the stream to go live');
}

export function youtubeSession(
  input: string,
  since: () => number,
  deliver: Deliver,
  fetchImpl: typeof fetch = fetch
) {
  const seen = new SeenIds();
  return async (ctx: SessionContext) => {
    const options = await resolveLive(youtubeLiveUrl(input), ctx.signal, fetchImpl);
    ctx.alive();

    let first = true;
    for (;;) {
      const res = await fetchWithin(
        fetchImpl,
        `https://www.youtube.com/youtubei/v1/live_chat/get_live_chat?key=${options.apiKey}&prettyPrint=false`,
        {
          signal: ctx.signal,
          method: 'POST',
          headers: { ...BROWSER_HEADERS, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            context: { client: { clientName: 'WEB', clientVersion: options.clientVersion } },
            continuation: options.continuation,
          }),
        }
      );
      if (!res.ok) throw new Error(`YouTube chat HTTP ${res.status}`);
      const json = (await res.json()) as any;
      const cont = json?.continuationContents?.liveChatContinuation;
      const next = cont?.continuations?.[0];
      if (!cont || !next) throw new NotLive('stream ended – waiting for the next one');

      const { items, continuation } = parseRobust(json, cont);
      ctx.alive();
      if (first) {
        ctx.live(options.liveId ?? 'live chat');
        first = false;
      }
      const from = since();
      for (const item of items) {
        if (!seen.add(item.id)) continue;
        if (item.timestamp.getTime() < from) continue;
        const text = item.message
          .map((p) => ('text' in p ? p.text : ''))
          .join(' ')
          .trim();
        if (text) deliver({ platform: 'youtube', userId: item.author.channelId, text });
      }
      options.continuation = continuation;
      const hinted = Number((next.timedContinuationData ?? next.invalidationContinuationData)?.timeoutMs);
      await sleep(Math.min(5_000, Math.max(1_000, Number.isFinite(hinted) ? hinted : 1_500)), ctx.signal);
    }
  };
}
