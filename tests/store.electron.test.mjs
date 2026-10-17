// Catalog update safety. Runs under Electron's Node (better-sqlite3 is built
// for Electron):  ELECTRON_RUN_AS_NODE=1 electron --test tests/store.electron.test.mjs
import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import Database from 'better-sqlite3';
import { CatalogStore } from '../build/electron/catalog/store.js';

const YEAR = new Date().getFullYear();

/** A legacy (got-poll v1) seed with 30 shows, incl. a hand-made fake id. */
function legacySeed(dir) {
  const file = path.join(dir, 'seed.db');
  const db = new Database(file);
  db.exec(`CREATE TABLE anime (id INTEGER PRIMARY KEY, title_romaji TEXT, title_english TEXT, synonyms TEXT,
    start_year INTEGER, season TEXT, format TEXT, cover_image TEXT, has_prequel INTEGER, popularity INTEGER,
    score INTEGER, favourites INTEGER, score_count INTEGER)`);
  const ins = db.prepare('INSERT INTO anime VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)');
  for (let i = 1; i <= 30; i++) ins.run(i, `Old Show ${i}`, null, 'A,B', 2010, 'FALL', 'TV', null, i % 5 === 0 ? 1 : 0, 100 * i, 70, 1, 1);
  ins.run(193297, 'Avatar the Last Airbender', null, 'ATLA', 2005, 'SPRING', 'TV', null, 0, 1, 1, 1, 1);
  db.close();
  return file;
}

/** Fake AniList: `perYear` shows for each year in range, paged like the real API. */
function fakeAniList({ perYear = 40, failAfter = Infinity, delayMs = 0 } = {}) {
  let calls = 0;
  const impl = async (_url, init) => {
    calls++;
    if (calls > failAfter) throw new TypeError('fetch failed (simulated network drop)');
    if (delayMs) await new Promise((r) => setTimeout(r, delayMs));
    init.signal?.throwIfAborted();
    const { query } = JSON.parse(init.body);
    const data = {};
    if (query.includes('NOT_YET_RELEASED')) {
      data.Page = { media: [] };
    } else {
      const from = Number(/startDate_greater: (\d+)/.exec(query)[1]) + 1;
      const year = Math.floor(from / 10000);
      for (const [, alias, page] of query.matchAll(/(p\d+): Page\(page: (\d+)/g)) {
        const all = Array.from({ length: perYear }, (_, i) => media(year * 1000 + i, year));
        const slice = all.slice((page - 1) * 50, page * 50);
        data[alias] = { pageInfo: { total: 5000, hasNextPage: page * 50 < all.length }, media: slice };
      }
    }
    return new Response(JSON.stringify({ data }), {
      status: 200,
      headers: { 'content-type': 'application/json', 'x-ratelimit-remaining': '29' },
    });
  };
  impl.calls = () => calls;
  return impl;
}

function media(id, year) {
  return {
    id, isAdult: false, countryOfOrigin: 'JP',
    title: { romaji: `Show ${id}`, english: null, native: null },
    synonyms: ['x, with a comma'], startDate: { year, month: 4 }, season: 'SPRING', seasonYear: year,
    format: 'TV', status: 'FINISHED', popularity: id, averageScore: 70, favourites: 1,
    coverImage: { large: null, extraLarge: null, color: '#ff0000' },
    relations: { edges: id % 10 === 1 ? [{ relationType: 'PREQUEL', node: { id: id - 1, format: 'TV', type: 'ANIME' } }] : [] },
  };
}

function fresh() {
  const dir = mkdtempSync(path.join(tmpdir(), 'gotpoll-'));
  const store = new CatalogStore(path.join(dir, 'catalog'), legacySeed(dir), 5);
  store.init();
  return { dir, store, files: () => readdirSync(path.join(dir, 'catalog')) };
}
const OPTS = { fromYear: YEAR - 1, minGapMs: 0 }; // only recent years → few fake requests

test('first launch migrates the legacy seed (and drops the fake id)', () => {
  const { store } = fresh();
  const info = store.info();
  assert.equal(info.count, 30);
  assert.equal(info.source, 'legacy');
  assert.ok(!store.all().some((s) => s.id === 193297));
  assert.equal(store.all().filter((s) => !s.eligible).length, 6, 'has_prequel rows stay out of polls');
});

test('successful update swaps atomically and can be reverted', async () => {
  const { store, files } = fresh();
  const before = store.info().file;
  const changed = [];
  store.on('changed', (i) => changed.push(i.file));
  await store.update({ ...OPTS, fetchImpl: fakeAniList() });
  assert.equal(store.status.state, 'done', JSON.stringify(store.status));
  const after = store.info();
  assert.notEqual(after.file, before);
  assert.equal(after.source, 'anilist');
  assert.ok(after.count >= 5 * 40);
  assert.deepEqual(changed, [after.file]);
  assert.deepEqual(store.all().find((s) => s.id === (YEAR - 1) * 1000 + 3).synonyms, ['x, with a comma']);
  assert.ok(!files().some((f) => f.includes('partial')));
  assert.ok(store.revert());
  assert.equal(store.info().file, before);
});

test('network drop mid-update leaves the live catalog untouched', async () => {
  const { store, files } = fresh();
  const before = store.info();
  const shows = store.all();
  await store.update({ ...OPTS, fetchImpl: fakeAniList({ failAfter: 2 }) });
  assert.equal(store.status.state, 'error');
  assert.match(store.status.error, /unreachable|network/i);
  assert.deepEqual(store.info(), before);
  assert.equal(store.all(), shows, 'same in-memory catalog object');
  assert.ok(!files().some((f) => f.includes('partial')), 'staging file removed');
}, { timeout: 120_000 });

test('a suspiciously small result is rejected by validation', async () => {
  const { store } = fresh();
  await store.update({ ...OPTS, fetchImpl: fakeAniList() }); // ~200+ shows live now
  const before = store.info();
  await store.update({ ...OPTS, fetchImpl: fakeAniList({ perYear: 2 }) });
  assert.equal(store.status.state, 'error');
  assert.match(store.status.error, /incomplete/);
  assert.equal(store.info().file, before.file);
});

test('cancel stops cleanly', async () => {
  const { store, files } = fresh();
  const before = store.info().file;
  const run = store.update({ ...OPTS, fetchImpl: fakeAniList({ delayMs: 200 }) });
  setTimeout(() => store.cancel(), 300);
  await run;
  assert.equal(store.status.state, 'cancelled');
  assert.equal(store.info().file, before);
  assert.ok(!files().some((f) => f.includes('partial')));
});

test('crash leftovers and a corrupt pointer are recovered on start', async () => {
  const { dir, store } = fresh();
  await store.update({ ...OPTS, fetchImpl: fakeAniList() });
  const good = store.info().file;
  const cat = path.join(dir, 'catalog');
  writeFileSync(path.join(cat, 'catalog-9999999999999.partial.db'), 'half written');
  writeFileSync(path.join(cat, 'current.json'), '{"fi');
  const again = new CatalogStore(cat, path.join(dir, 'seed.db'), 5);
  again.init();
  assert.equal(again.info().file, good, 'falls back to newest valid catalog');
  assert.ok(!readdirSync(cat).some((f) => f.includes('partial')));
  assert.equal(JSON.parse(readFileSync(path.join(cat, 'current.json'), 'utf8')).file, good);
});

test('old one-channel-per-platform settings become a channel list', async () => {
  const { UserStore } = await import('../build/electron/user-store.js');
  const dir = mkdtempSync(path.join(tmpdir(), 'gotpoll-user-'));
  const first = new UserStore(dir);
  // write settings the way the previous version stored them
  first.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('twitchChannel', ?), ('twitchEnabled', 'true'), ('youtubeChannelId', ?), ('youtubeEnabled', 'false'), ('rumbleUrl', ?), ('rumbleEnabled', 'true')")
    .run(JSON.stringify('example_channel'), JSON.stringify('@ExampleChannel'), JSON.stringify('https://rumble.com/c/ExampleChannel'));
  const s = first.settings();
  assert.deepEqual(
    s.channels.map((c) => [c.platform, c.target, c.enabled]),
    [['twitch', 'example_channel', true], ['youtube', '@ExampleChannel', false], ['rumble', 'https://rumble.com/c/ExampleChannel', true]]
  );
  // saving the list makes it the source of truth
  first.setSettings({ channels: [...s.channels, { id: '', platform: 'twitch', target: ' second_channel ', label: '', enabled: true }] });
  const again = new UserStore(dir).settings();
  assert.equal(again.channels.length, 4);
  assert.equal(again.channels[3].target, 'second_channel');
  assert.ok(again.channels[3].id, 'gets an id');
});
