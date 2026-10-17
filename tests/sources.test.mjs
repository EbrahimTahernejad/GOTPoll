import assert from 'node:assert/strict';
import { test } from 'node:test';
import { rumbleChannelPath, resolveRumble, rumbleSession, sseEvents } from '../build/electron/poll/sources/rumble.js';
import { youtubeLiveUrl, youtubeSession } from '../build/electron/poll/sources/youtube.js';
import { NotLive } from '../build/electron/poll/supervisor.js';

const ctx = () => {
  const ac = new AbortController();
  const events = [];
  return { ac, events, signal: ac.signal, alive: () => {}, live: (d) => events.push(['live', d]), status: () => {} };
};
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });

test('SSE parser handles split chunks, CRLF and comments', async () => {
  const enc = new TextEncoder();
  const chunks = ['data: {"a":', '1}\r\n\r\n: keepalive\n\nevent: x\ndata: {"b":2}\n', '\ndata: {"c"', ':3}\n\n'];
  const body = new ReadableStream({ start(c) { chunks.forEach((x) => c.enqueue(enc.encode(x))); c.close(); } });
  const out = [];
  for await (const d of sseEvents(body, () => {})) out.push(JSON.parse(d));
  assert.deepEqual(out, [{ a: 1 }, { b: 2 }, { c: 3 }]);
});

test('Rumble inputs: channel links, names, video links, embeds', async () => {
  assert.equal(rumbleChannelPath('https://rumble.com/c/ExampleChannel/'), '/c/ExampleChannel');
  assert.equal(rumbleChannelPath('rumble.com/user/someone'), '/user/someone');
  assert.equal(rumbleChannelPath('ExampleChannel'), '/c/ExampleChannel');
  const s = new AbortController().signal;
  assert.equal((await resolveRumble('https://rumble.com/embed/v6jth3u/', s)).id36, '6jth3u');
  const fake = async (url) => {
    assert.match(url, /oembed/);
    return json({ html: '<iframe src="https://rumble.com/embed/v6jth3u/">', duration: 0, author_url: 'https://rumble.com/c/X' });
  };
  assert.equal((await resolveRumble('https://rumble.com/v1abcde-some-live-stream.html?x=1', s, fake)).id36, '6jth3u');
});

test('Rumble channel follow: picks the channel\'s own live video, not recommendations', async () => {
  const oembeds = {
    'https://rumble.com/vAAA-old.html': { html: 'embed/vold111', duration: 3600, author_url: 'https://rumble.com/c/Me' },
    'https://rumble.com/vBBB-other.html': { html: 'embed/voth222', duration: 0, author_url: 'https://rumble.com/c/SomeoneElse' },
    'https://rumble.com/vCCC-live.html': { html: 'embed/vliv333', duration: 0, author_url: 'https://rumble.com/c/Me', title: 'Poll night' },
  };
  const fake = async (url) => json(oembeds[decodeURIComponent(url.split('url=')[1])] ?? {}, 200);
  const finder = async (path) => {
    assert.equal(path, '/c/Me');
    return Object.keys(oembeds);
  };
  const t = await resolveRumble('https://rumble.com/c/Me', new AbortController().signal, fake, finder);
  assert.deepEqual(t, { id36: 'liv333', title: 'Poll night', follows: true });
  await assert.rejects(
    resolveRumble('Me', new AbortController().signal, fake, async () => ['https://rumble.com/vAAA-old.html']),
    NotLive
  );
});

test('Rumble session: history filtered by poll start, deduped across reconnects, 204 = ended', async () => {
  const start = Date.parse('2026-10-17T15:00:00Z');
  const frame = (o) => `data: ${JSON.stringify(o)}\n\n`;
  const init = frame({ type: 'init', data: { messages: [
    { id: '1', time: '2026-10-17T14:59:00+00:00', user_id: 'u1', text: 'before start' },
    { id: '2', time: '2026-10-17T15:00:05+00:00', user_id: 'u2', text: 'frieren' },
  ] } });
  const more = frame({ type: 'messages', data: { messages: [{ id: '3', time: '2026-10-17T15:00:09+00:00', user_id: 'u3', text: 'jjk' }] } });
  let calls = 0;
  const fake = async () => {
    calls++;
    if (calls === 3) return new Response(null, { status: 204 });
    const body = calls === 1 ? init : init + more; // reconnect replays history
    return new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
  const got = [];
  const session = rumbleSession('v6jth3u', () => start, (m) => got.push(m.text), fake);
  await session(ctx());
  await session(ctx());
  await assert.rejects(session(ctx()), NotLive);
  assert.deepEqual(got, ['frieren', 'jjk']);
});

test('YouTube inputs', () => {
  assert.equal(youtubeLiveUrl('UCaaaaaaaaaaaaaaaaaaaaaa'), 'https://www.youtube.com/channel/UCaaaaaaaaaaaaaaaaaaaaaa/live');
  assert.equal(youtubeLiveUrl('@somechannel'), 'https://www.youtube.com/@somechannel/live');
  assert.equal(youtubeLiveUrl('https://www.youtube.com/@somechannel/streams'), 'https://www.youtube.com/@somechannel/live');
  assert.equal(youtubeLiveUrl('https://youtu.be/jfKfPfyJRdk'), 'https://www.youtube.com/watch?v=jfKfPfyJRdk');
  assert.equal(youtubeLiveUrl('https://www.youtube.com/live/jfKfPfyJRdk?si=x'), 'https://www.youtube.com/watch?v=jfKfPfyJRdk');
});

test('YouTube session: polls sequentially, dedupes, ends cleanly into "waiting"', async () => {
  // like the real gated page: canonical is "undefined", chat data present
  const page = `<link rel="canonical" href="undefined">"INNERTUBE_API_KEY":"KEY","INNERTUBE_CONTEXT_CLIENT_VERSION":"2.2026","continuation":"NOT-CHAT","videoDetails":{"videoId":"abcdefghijk"},"liveChatRenderer":{"continuations":[{"reloadContinuationData":{"continuation":"C0"}}]}`;
  const item = (id, text) => ({ addChatItemAction: { item: { liveChatTextMessageRenderer: {
    id, timestampUsec: String(Date.now() * 1000), authorExternalChannelId: `ch-${id}`,
    authorName: { simpleText: 'x' }, message: { runs: [{ text }] },
    authorPhoto: { thumbnails: [{ url: 'u', width: 1, height: 1 }] },
  } } } });
  const broken = { addChatItemAction: { item: { liveChatTextMessageRenderer: { id: 'bad', message: { runs: [] } } } } };
  const responses = [
    { continuationContents: { liveChatContinuation: { actions: [item('a', 'frieren')], continuations: [{ timedContinuationData: { continuation: 'C1', timeoutMs: 10 } }] } } },
    { continuationContents: { liveChatContinuation: { actions: [item('a', 'frieren'), broken, item('b', 'jjk')], continuations: [{ invalidationContinuationData: { continuation: 'C2', timeoutMs: 10 } }] } } },
    { continuationContents: { liveChatContinuation: {} } }, // stream over
  ];
  let inFlight = 0;
  let maxInFlight = 0;
  const seenConts = [];
  const fake = async (url, init) => {
    if (!url.includes('get_live_chat')) return new Response(page);
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    seenConts.push(JSON.parse(init.body).continuation);
    await new Promise((r) => setTimeout(r, 5));
    inFlight--;
    return json(responses.shift());
  };
  const got = [];
  const c = ctx();
  await assert.rejects(youtubeSession('@x', () => 0, (m) => got.push(m.text), fake)(c), NotLive);
  assert.deepEqual(got, ['frieren', 'jjk']);
  assert.deepEqual(seenConts, ['C0', 'C1', 'C2']);
  assert.equal(maxInFlight, 1);
  assert.deepEqual(c.events, [['live', 'abcdefghijk']]);
});

test('YouTube: channel not live → waiting', async () => {
  const fake = async () => new Response('<html>no live here</html>');
  await assert.rejects(youtubeSession('@x', () => 0, () => {}, fake)(ctx()), NotLive);
});
