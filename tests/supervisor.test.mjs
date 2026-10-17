import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NotLive, SeenIds, Supervisor } from '../build/electron/poll/supervisor.js';

const tick = (ms) => new Promise((r) => setTimeout(r, ms));

function harness(session, opts = {}) {
  const statuses = [];
  const sup = new Supervisor({
    name: 't', session, onStatus: (s) => statuses.push(s),
    minDelayMs: 20, maxDelayMs: 200, notLiveDelayMs: 60, stableMs: 100, idleMs: 1000, ...opts,
  });
  return { sup, statuses };
}

test('failed connects back off exponentially, with a cap', async () => {
  const at = [];
  const { sup, statuses } = harness(async () => {
    at.push(Date.now());
    throw new Error('boom');
  });
  sup.start();
  await tick(900);
  await sup.stop();
  const gaps = at.slice(1).map((t, i) => t - at[i]);
  assert.ok(at.length >= 4, `attempts: ${at.length}`);
  assert.ok(gaps.every((g) => g <= 230), `capped: ${gaps}`);
  assert.ok(gaps[3] >= gaps[0], `grows: ${gaps}`);
  assert.ok(statuses.some((s) => /boom – retrying in/.test(s.detail ?? '')));
  assert.equal(statuses.at(-1).state, 'off');
});

test('a long healthy session resets the backoff', async () => {
  let n = 0;
  const { sup, statuses } = harness(async (ctx) => {
    n++;
    ctx.live('ok');
    await tick(n === 1 ? 150 : 5); // first one is "stable"
    throw new Error('dropped');
  });
  sup.start();
  await tick(120 + 150);
  await sup.stop();
  const first = statuses.find((s) => /dropped/.test(s.detail ?? ''));
  assert.match(first.detail, /retrying in 1s/, 'first retry after a stable session is quick');
});

test('not live → waiting, re-checked slowly, never "error"', async () => {
  let n = 0;
  const { sup, statuses } = harness(async () => {
    n++;
    throw new NotLive('waiting for the stream');
  });
  sup.start();
  await tick(250);
  await sup.stop();
  assert.ok(n >= 3 && n <= 6, `checks: ${n}`);
  assert.ok(statuses.every((s) => s.state !== 'error'));
  assert.ok(statuses.some((s) => s.state === 'waiting' && s.detail === 'waiting for the stream'));
});

test('watchdog kills a session that went silent', async () => {
  let aborted = 0;
  const { sup } = harness(
    (ctx) =>
      new Promise((resolve, reject) => {
        ctx.live('up');
        ctx.signal.addEventListener('abort', () => {
          aborted++;
          reject(ctx.signal.reason);
        });
      }),
    { idleMs: 80 }
  );
  sup.start();
  await tick(400);
  await sup.stop();
  assert.ok(aborted >= 2, `watchdog aborts: ${aborted}`);
});

test('kick() reconnects immediately (computer woke up)', async () => {
  let n = 0;
  const { sup } = harness(async () => {
    n++;
    throw new NotLive();
  }, { notLiveDelayMs: 10_000 });
  sup.start();
  await tick(30);
  assert.equal(n, 1);
  sup.kick('network change');
  await tick(30);
  assert.equal(n, 2);
  await sup.stop();
});

test('stop() is final', async () => {
  let n = 0;
  const { sup } = harness(async (ctx) => {
    n++;
    await new Promise((_, rej) => ctx.signal.addEventListener('abort', () => rej(ctx.signal.reason)));
  });
  sup.start();
  await tick(20);
  await sup.stop();
  const after = n;
  await tick(150);
  assert.equal(n, after);
});

test('SeenIds dedupes and stays bounded', () => {
  const s = new SeenIds(100);
  assert.equal(s.add('a'), true);
  assert.equal(s.add('a'), false);
  for (let i = 0; i < 1000; i++) s.add(String(i));
  assert.equal(s.add('999'), false);
  assert.equal(s.add('a'), true, 'oldest ids are forgotten');
});
