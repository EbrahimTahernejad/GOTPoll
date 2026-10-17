import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { Downloader } from '../build/electron/downloads.js';

const SIZE = 40 * 1024 * 1024; // > 2 segments
const DATA = randomBytes(SIZE);
const SHA = createHash('sha256').update(DATA).digest('hex');

/** Range-capable server; can drop connections and throttle. */
function serve({ dropEvery = 0, chunk = 256 * 1024, delayMs = 0 } = {}) {
  let served = 0;
  const ranges = [];
  const server = createServer(async (req, res) => {
    const m = /bytes=(\d+)-(\d*)/.exec(req.headers.range ?? '');
    const start = m ? Number(m[1]) : 0;
    const end = m && m[2] ? Number(m[2]) : SIZE - 1;
    ranges.push([start, end]);
    res.writeHead(m ? 206 : 200, {
      'Content-Length': end - start + 1,
      'Content-Range': `bytes ${start}-${end}/${SIZE}`,
      'Accept-Ranges': 'bytes',
    });
    for (let pos = start; pos <= end; pos += chunk) {
      if (res.destroyed) return;
      served += chunk;
      if (dropEvery && served % dropEvery < chunk && pos !== start) {
        res.destroy(); // simulate a dropped connection mid-range
        return;
      }
      // wait for each chunk to flush, so a drop happens mid-stream like on a real network
      await new Promise((r) => res.write(DATA.subarray(pos, Math.min(end + 1, pos + chunk)), r));
      if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    }
    res.end();
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}/model.bin`, server, ranges }))
  );
}

const tmp = () => mkdtempSync(path.join(tmpdir(), 'gotpoll-dl-'));

test('multi-connection download is byte-exact and checksum-verified', async () => {
  const { url, server, ranges } = await serve();
  const dest = path.join(tmp(), 'model.bin');
  const d = new Downloader();
  await d.start({ id: 'a', url, dest, label: 'x', sha256: SHA });
  server.closeAllConnections(); server.close();
  assert.ok(readFileSync(dest).equals(DATA));
  assert.ok(new Set(ranges.map(([s]) => s)).size >= 2, 'used parallel ranges');
  assert.deepEqual(readdirSync(path.dirname(dest)), ['model.bin'], 'no .part leftovers');
});

test('survives dropped connections', async () => {
  const { url, server } = await serve({ dropEvery: 5 * 1024 * 1024 });
  const dest = path.join(tmp(), 'model.bin');
  await new Downloader().start({ id: 'b', url, dest, label: 'x', sha256: SHA });
  server.closeAllConnections(); server.close();
  assert.ok(readFileSync(dest).equals(DATA));
});

test('pause keeps progress; resume (even in a new process) continues from there', async () => {
  const { url, server, ranges } = await serve({ delayMs: 15 });
  const dest = path.join(tmp(), 'model.bin');
  const first = new Downloader();
  const run = first.start({ id: 'c', url, dest, label: 'x' });
  await new Promise((r) => setTimeout(r, 600));
  first.pause('c');
  await run;
  const paused = first.get('c');
  assert.equal(paused.state, 'paused');
  assert.ok(existsSync(`${dest}.part.json`), 'journal written');
  const journal = JSON.parse(readFileSync(`${dest}.part.json`, 'utf8'));
  const doneBefore = journal.segments.reduce((n, s) => n + (s.pos - s.start), 0);
  assert.ok(doneBefore > 0, 'made progress before pause');
  // a brand new downloader = app restarted
  const before = ranges.length;
  await new Downloader().start({ id: 'c', url, dest, label: 'x', sha256: SHA });
  server.closeAllConnections(); server.close();
  assert.ok(readFileSync(dest).equals(DATA));
  // ignore the 1-byte size probe (bytes=0-0)
  const resumedFrom = ranges.slice(before).filter(([s, e]) => !(s === 0 && e === 0)).map(([s]) => s);
  assert.ok(resumedFrom.every((s) => !journal.segments.some((seg) => seg.pos > seg.start && s === seg.start)), 'did not restart finished bytes');
});

test('a corrupted download is rejected and never gets the real name', async () => {
  const { url, server } = await serve();
  const dest = path.join(tmp(), 'model.bin');
  await assert.rejects(new Downloader().start({ id: 'd', url, dest, label: 'x', sha256: 'f'.repeat(64) }), /checksum/);
  server.closeAllConnections(); server.close();
  assert.ok(!existsSync(dest));
});

test('cancel removes partial files', async () => {
  const { url, server } = await serve({ delayMs: 20 });
  const dest = path.join(tmp(), 'model.bin');
  const d = new Downloader();
  const run = d.start({ id: 'e', url, dest, label: 'x' }).catch(() => {});
  await new Promise((r) => setTimeout(r, 300));
  await d.cancel('e');
  await run;
  server.closeAllConnections(); server.close();
  assert.ok(!existsSync(`${dest}.part`) && !existsSync(`${dest}.part.json`) && !existsSync(dest));
});
