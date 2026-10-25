// Catalogs: custom catalogs, the movies & series import, switching.
// Runs under Electron's Node (better-sqlite3 is built for Electron).
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { gzipSync } from 'node:zlib';
import Database from 'better-sqlite3';
import { Catalogs } from '../build/electron/catalog/catalogs.js';
import { CustomCatalog } from '../build/electron/catalog/custom.js';
import { imdbSource, IMDB_ID_BASE, tconstOf } from '../build/electron/catalog/imdb.js';
import { CATALOG_SQL } from '../build/electron/catalog/schema.js';

const YEAR = new Date().getFullYear();
const tmp = () => mkdtempSync(path.join(tmpdir(), 'gotpoll-cat-'));

function seed(dir) {
  const file = path.join(dir, 'seed.db');
  const db = new Database(file);
  db.exec(CATALOG_SQL);
  const ins = db.prepare(
    `INSERT INTO shows (id, title_romaji, synonyms, format, popularity, status, start_year) VALUES (?, ?, '[]', 'TV', ?, 'FINISHED', 2020)`
  );
  for (let i = 1; i <= 5; i++) ins.run(i, `Anime ${i}`, 100 * i);
  db.close();
  return file;
}

function catalogs(dir, saved = new Map()) {
  let selected = 'anime';
  const c = new Catalogs(dir, seed(dir), {
    selected: () => selected,
    setSelected: (id) => (selected = id),
    animeExtras: () => [],
    overrides: () => new Map(saved),
    saveOverride: (id, o) => (o ? saved.set(id, o) : saved.delete(id)),
  });
  c.init();
  return c;
}

const entry = (title, extra = {}) => ({ title, altTitles: [], year: 2020, format: 'TV', cover: null, release: null, ...extra });

test('custom catalogs: own id ranges, alt names, labels, kinds in use', () => {
  const dir = tmp();
  const c = catalogs(dir);
  const a = c.create('Games');
  const b = c.create('Songs');
  const g1 = c.custom(a).add(entry('Elden Ring', { altTitles: ['ER', 'Elden'], format: 'MOVIE' }));
  const g2 = c.custom(a).add(entry('Hollow Knight'));
  const s1 = c.custom(b).add(entry('Idol'));
  // ids never collide with each other, AniList or IMDb
  assert.ok(g1.id >= 2_000_000_000 && g2.id === g1.id + 1);
  assert.ok(Math.abs(s1.id - g1.id) >= 100_000);
  assert.equal(c.lookup(s1.id).titleRomaji, 'Idol');
  // first alternate name is the subtitle, the rest are synonyms
  assert.equal(g1.titleEnglish, 'ER');
  assert.deepEqual(g1.synonyms, ['Elden']);

  c.custom(a).setLabels({ MOVIE: 'Game', TV: 'Series' });
  c.select(a);
  assert.deepEqual(c.info().formats, [
    { id: 'TV', label: 'Series' },
    { id: 'MOVIE', label: 'Game' },
  ]);
  assert.equal(c.info().releases, false);
  assert.equal(c.all().length, 2);

  // reopen from disk
  const again = new CustomCatalog(path.join(dir, 'catalogs', 'custom', `${a}.db`));
  assert.equal(again.name, 'Games');
  assert.equal(again.all().length, 2);
  again.close();

  // removing the selected catalog falls back to anime
  c.remove(a);
  assert.equal(c.selectedId(), 'anime');
  assert.equal(c.list().filter((x) => x.kind === 'custom').length, 1);
});

test('movies & series: nothing until imported, then votes-filtered titles with their own labels', async () => {
  const dir = tmp();
  const c = catalogs(dir);
  assert.equal(c.list().find((x) => x.id === 'screen').installed, false);
  assert.throws(() => c.select('nope'), /Unknown catalog/);
  c.select('screen');
  assert.equal(c.all().length, 0);
  assert.deepEqual(
    c.info().formats.map((f) => f.label),
    ['Movie', 'Series', 'Mini-series']
  );

  // a fake IMDb: 6000 rated titles (enough for the sanity floor), plus noise
  const ratings = ['tconst\taverageRating\tnumVotes'];
  const basics = ['tconst\ttitleType\tprimaryTitle\toriginalTitle\tisAdult\tstartYear\tendYear\truntimeMinutes\tgenres'];
  for (let i = 1; i <= 6000; i++) {
    const tt = `tt${String(i).padStart(7, '0')}`;
    ratings.push(`${tt}\t7.5\t${i === 3 ? 10 : 5000 + i}`);
    const type = i % 3 === 0 ? 'tvSeries' : i % 3 === 1 ? 'movie' : 'tvMiniSeries';
    basics.push(`${tt}\t${type}\tTitle ${i}\t${i === 1 ? 'Original 1' : `Title ${i}`}\t${i === 4 ? 1 : 0}\t${i === 6 ? YEAR + 1 : 2001}\t\\N\t100\tDrama`);
  }
  basics.push('tt9999999\ttvEpisode\tAn episode\tAn episode\t0\t2001\t\\N\t20\tDrama');
  const files = { 'title.ratings.tsv.gz': gzipSync(ratings.join('\n')), 'title.basics.tsv.gz': gzipSync(basics.join('\n')) };
  const fetchImpl = async (url, init) => {
    const body = files[url.split('/').pop()];
    if (init?.method === 'HEAD') return new Response(null, { headers: { 'content-length': String(body.length) } });
    return new Response(body);
  };
  await c.screen.update({ fetchImpl });
  assert.equal(c.screen.status.state, 'done', JSON.stringify(c.screen.status));
  const shows = c.all();
  const byId = new Map(shows.map((s) => [s.id, s]));
  // too few votes (3), adult (4) dropped
  assert.equal(byId.has(IMDB_ID_BASE + 3), false);
  assert.equal(byId.has(IMDB_ID_BASE + 4), false);
  const one = byId.get(IMDB_ID_BASE + 1);
  assert.equal(one.format, 'MOVIE');
  assert.equal(one.titleEnglish, 'Original 1');
  assert.equal(one.popularity, 5001);
  assert.equal(byId.get(IMDB_ID_BASE + 2).format, 'TV_SHORT');
  assert.equal(byId.get(IMDB_ID_BASE + 6).release, 'upcoming');
  assert.equal(tconstOf(IMDB_ID_BASE + 111161), 'tt0111161');
  assert.equal(imdbSource.id, 'imdb');
});

test('games: sliced Wikidata import, names, Steam covers, other names in batches', async () => {
  const { GAME_ID_BASE } = await import('../build/electron/catalog/games.js');
  const dir = tmp();
  const c = catalogs(dir);
  assert.equal(c.list().find((x) => x.id === 'games').installed, false);
  // 3000 fake games spread over the popularity slices; a few edge cases
  const games = Array.from({ length: 3000 }, (_, i) => ({
    q: 1000 + i,
    label: i === 0 ? 'Elden Ring' : i === 1 ? 'Q1001' : i === 2 ? 'ゼルダの伝説' : `Game ${i}`,
    sl: 8 + (i % 40),
    date: i === 3 ? `${YEAR + 1}-01-01T00:00:00Z` : '2017-02-24T00:00:00Z',
    steam: i % 2 === 0 ? String(10 + i) : null,
  }));
  let aliasCalls = 0;
  const fetchImpl = async (_url, init) => {
    const q = new URLSearchParams(init.body).get('query');
    let bindings;
    if (q.includes('skos:altLabel')) {
      aliasCalls++;
      const ids = [...q.matchAll(/wd:Q(\d+)/g)].map((m) => Number(m[1]));
      bindings = ids.filter((id) => id === 1000).map((id) => ({ item: { value: `http://www.wikidata.org/entity/Q${id}` }, alts: { value: 'ER|Elden|エルデンリング' } }));
    } else {
      const [lo, hi] = /\?sl >= (\d+) && \?sl <= (\d+)/.exec(q).slice(1).map(Number);
      bindings = games
        .filter((g) => g.sl >= lo && g.sl <= hi)
        .map((g) => ({
          item: { value: `http://www.wikidata.org/entity/Q${g.q}` },
          itemLabel: { value: g.label },
          sl: { value: String(g.sl) },
          d: { value: g.date },
          ...(g.steam ? { s: { value: g.steam } } : {}),
        }));
    }
    return new Response(JSON.stringify({ results: { bindings } }), { headers: { 'content-type': 'application/json' } });
  };
  await c.games.update({ fetchImpl });
  assert.equal(c.games.status.state, 'done', JSON.stringify(c.games.status));
  c.select('games');
  const byId = new Map(c.all().map((s) => [s.id, s]));
  assert.equal(byId.size, 2998); // a Q-id label and a non-Latin one are dropped
  const er = byId.get(GAME_ID_BASE + 1000);
  assert.equal(er.titleRomaji, 'Elden Ring');
  assert.deepEqual(er.synonyms, ['ER', 'Elden']);
  assert.match(er.coverImage, /steam\/apps\/10\/library_600x900\.jpg$/);
  assert.equal(byId.get(GAME_ID_BASE + 1003).release, 'upcoming');
  assert.equal(aliasCalls, 10); // 2998 games, 300 per request
  assert.deepEqual(c.info().formats, [{ id: 'TV', label: 'Game' }]);
  assert.equal(c.lookup(GAME_ID_BASE + 1000).titleRomaji, 'Elden Ring');
});

test('built-in catalogs: split a sequel out, edit a title, add one – kept apart from the catalog file', () => {
  const dir = tmp();
  // a franchise: Naruto ← Shippuden ← Boruto ← Boruto: Two Blue Vortex
  const file = path.join(dir, 'franchise.db');
  const db = new Database(file);
  db.exec(CATALOG_SQL);
  const ins = db.prepare(
    `INSERT INTO shows (id, title_romaji, synonyms, format, popularity, status, start_year, parent_id) VALUES (?, ?, '[]', 'TV', 1000, 'FINISHED', 2002, ?)`
  );
  ins.run(20, 'NARUTO', null);
  ins.run(1735, 'NARUTO: Shippuuden', 20);
  ins.run(97938, 'BORUTO: NARUTO NEXT GENERATIONS', 1735);
  ins.run(179, 'BORUTO: Two Blue Vortex', 97938);
  db.close();
  const saved = new Map();
  let selected = 'anime';
  const c = new Catalogs(dir, file, {
    selected: () => selected,
    setSelected: (id) => (selected = id),
    animeExtras: () => [],
    overrides: () => new Map(saved),
    saveOverride: (id, o) => (o ? saved.set(id, o) : saved.delete(id)),
  });
  c.init();
  const rootOf = (title) => c.sequelAliases().find((x) => x.title === title)?.rootId;
  assert.deepEqual(c.all().filter((s) => s.eligible).map((s) => s.id), [20]);
  assert.equal(rootOf('BORUTO: Two Blue Vortex'), 20);

  c.setOverride(97938, { split: true });
  assert.deepEqual(c.all().filter((s) => s.eligible).map((s) => s.id).sort((a, b) => a - b), [20, 97938]);
  assert.equal(c.all().find((s) => s.id === 97938).split, true);
  // its own sequel now follows it, not Naruto
  assert.equal(rootOf('BORUTO: Two Blue Vortex'), 97938);
  assert.equal(rootOf('NARUTO: Shippuuden'), 20);

  c.setOverride(20, { title: 'Naruto', altTitles: ['Naruto (2002)', 'Naruto OG'] });
  const n = c.all().find((s) => s.id === 20);
  assert.equal(n.titleRomaji, 'Naruto');
  assert.equal(n.titleEnglish, 'Naruto (2002)');
  assert.deepEqual(n.synonyms, ['Naruto OG']);
  assert.equal(n.edited, true);

  const added = c.editable('anime').add({ title: 'Some Missing Show', altTitles: [], year: 2024, format: 'TV', cover: null, release: 'released' });
  assert.ok(c.all().some((s) => s.id === added.id && s.added));
  assert.equal(c.lookup(added.id).titleRomaji, 'Some Missing Show');
  assert.equal(c.list().filter((x) => x.kind === 'custom').length, 0); // additions aren't a catalog of their own

  // undo the split: back to the franchise
  c.setOverride(97938, null);
  assert.equal(rootOf('BORUTO: Two Blue Vortex'), 20);

  // a fresh start (e.g. after a catalog update) keeps every change
  const again = new Catalogs(dir, file, {
    selected: () => 'anime',
    setSelected: () => {},
    animeExtras: () => [],
    overrides: () => new Map(saved),
    saveOverride: () => {},
  });
  again.init();
  assert.equal(again.all().find((s) => s.id === 20).titleRomaji, 'Naruto');
  assert.ok(again.all().some((s) => s.id === added.id));
});
