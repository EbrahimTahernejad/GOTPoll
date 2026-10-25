import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { PollEngine } from '../build/electron/poll/engine.js';

const S = (id, titleRomaji, titleEnglish, popularity, extra = {}) => ({
  id, titleRomaji, titleEnglish, synonyms: [], startYear: 2020, season: 'FALL', format: 'TV',
  coverImage: null, coverColor: null, popularity, score: null, favourites: null, parentId: null,
  eligible: true, release: 'released', ...extra,
});
const ALL = { formats: ['TV', 'TV_SHORT', 'MOVIE'], release: ['released', 'airing', 'upcoming'] };
const SHOWS = [
  S(1, 'Sousou no Frieren', "Frieren: Beyond Journey's End", 500000),
  S(2, 'Jujutsu Kaisen', null, 850000, { synonyms: ['JJK'] }),
  S(3, 'Chainsaw Man', null, 700000),
  // an upcoming sequel-free show whose title overlaps a released one
  S(4, 'Chainsaw Man: The Movie Reze-hen', null, 300000, { format: 'MOVIE', release: 'upcoming' }),
  S(5, 'Sousou no Frieren 2', null, 100000, { release: 'airing' }),
];

function setup(settings = {}) {
  const catalog = Object.assign(new EventEmitter(), {
    all: () => SHOWS,
    info: () => ({ file: 'a.db', hasRelease: true }),
    sequelAliases: () => [],
  });
  const taught = [];
  const user = {
    settings: () => ({ channels: [], onePerViewer: false, ...settings }),
    ignores: () => new Set(),
    dismissed: () => new Set(),
    aliases: () => [],
    customShows: () => [],
    teach: (phrase, showId) => taught.push([phrase, showId]),
    setSettings: () => {},
    dismiss: () => {},
    undismiss: () => {},
    setIgnored: () => {},
  };
  const engine = new PollEngine(catalog, user);
  return { engine, taught };
}
const say = (e, user, text) => e.ingest({ platform: 'twitch', userId: user, text });
const counts = (e) => Object.fromEntries(e.snapshot().ranking.map((r) => [r.id, r.count]));

test('one count per viewer per show, across phrasings', async () => {
  const { engine } = setup();
  await engine.start({ mode: 'open', filters: ALL, shortlist: [] });
  say(engine, 'a', 'frieren');
  say(engine, 'a', 'FRIEREN!!!');
  say(engine, 'a', 'sousou no frieren');
  say(engine, 'b', 'jjk');
  say(engine, 'c', 'jjk');
  assert.deepEqual(counts(engine), { 1: 1, 2: 2 });
  engine.stop();
});

test('assigning an unmatched phrase recounts everyone who typed it', async () => {
  const { engine, taught } = setup();
  await engine.start({ mode: 'open', filters: ALL, shortlist: [] });
  for (const u of ['a', 'b', 'c']) say(engine, u, 'the devil dog one');
  assert.equal(engine.snapshot().unmatched[0].phrase, 'the devil dog one');
  assert.equal(engine.snapshot().unmatched[0].voters, 3);
  engine.assign('the devil dog one', 3);
  assert.deepEqual(counts(engine), { 3: 3 });
  assert.deepEqual(taught, [['the devil dog one', 3]]);
  say(engine, 'd', 'The Devil Dog One!');
  assert.deepEqual(counts(engine), { 3: 4 }, 'later messages use the taught phrase');
  engine.stop();
});

test('dismissing a phrase removes its votes', async () => {
  const { engine } = setup();
  await engine.start({ mode: 'open', filters: ALL, shortlist: [] });
  say(engine, 'a', 'jjk');
  say(engine, 'b', 'jujutsu kaisen');
  engine.dismiss('jjk');
  assert.deepEqual(counts(engine), { 2: 1 });
  say(engine, 'c', 'jjk');
  assert.deepEqual(counts(engine), { 2: 1 });
  engine.stop();
});

test('one vote per viewer: latest vote wins', async () => {
  const { engine } = setup({ onePerViewer: true });
  await engine.start({ mode: 'open', filters: ALL, shortlist: [] });
  say(engine, 'a', 'frieren');
  say(engine, 'a', 'jjk');
  assert.deepEqual(counts(engine), { 2: 1 });
  engine.stop();
});

test('ending freezes the count', async () => {
  const { engine } = setup();
  await engine.start({ mode: 'open', filters: ALL, shortlist: [] });
  say(engine, 'a', 'chainsaw man');
  engine.stop();
  say(engine, 'b', 'chainsaw man');
  const s = engine.snapshot();
  assert.equal(s.state, 'ended');
  assert.deepEqual(counts(engine), { 3: 1 });
  assert.equal(engine.publicSnapshot(s).ranking[0].title, 'Chainsaw Man');
});

test('filters decide what counts – a filtered vote never drifts onto a look-alike', async () => {
  const { engine } = setup();
  await engine.start({ mode: 'open', filters: { formats: ['TV'], release: ['released'] }, shortlist: [] });
  say(engine, 'a', 'chainsaw man the movie reze hen'); // upcoming movie: filtered twice over
  say(engine, 'b', 'chainsaw man');
  const s = engine.snapshot();
  assert.deepEqual(counts(engine), { 3: 1 }, 'only the released TV show counts');
  assert.equal(s.filteredVotes, 1, 'the movie vote is tallied as filtered, not moved to Chainsaw Man');
  assert.equal(s.unmatched.length, 0);
  engine.stop();
});

test('released means one full first season, whatever its sequels do', async () => {
  const { engine } = setup();
  await engine.start({ mode: 'open', filters: { formats: ['TV', 'MOVIE', 'TV_SHORT'], release: ['released'] }, shortlist: [] });
  say(engine, 'a', 'sousou no frieren'); // root finished → counts
  assert.deepEqual(counts(engine), { 1: 1 });
  engine.stop();
});

test('a phrase marked "Not a vote" can be restored, even mid-poll', async () => {
  const { engine } = setup();
  await engine.start({ mode: 'open', filters: ALL, shortlist: [] });
  engine.dismiss('jjk');
  say(engine, 'a', 'JJK');
  assert.deepEqual(counts(engine), {}, 'dismissed phrase is dropped');
  engine.undismiss('jjk');
  say(engine, 'b', 'jjk');
  assert.deepEqual(counts(engine), { 2: 1 }, 'restored phrase counts again');
  engine.stop();
});

test('shortlist: number votes, forgiving option titles, non-options filtered', async () => {
  const { engine } = setup();
  await engine.start({ mode: 'shortlist', filters: ALL, shortlist: [3, 1] });
  say(engine, 'a', '1'); // option 1 = Chainsaw Man
  say(engine, 'b', '#2'); // option 2 = Frieren
  say(engine, 'c', '!vote 2');
  say(engine, 'd', 'vote 1');
  say(engine, 'e', 'freiren pls'); // typo – resolves to the option
  say(engine, 'f', 'jjk'); // a real show, but not an option
  say(engine, 'g', '7'); // no option 7 – just chat
  const s = engine.snapshot();
  assert.deepEqual(counts(engine), { 3: 2, 1: 3 });
  assert.equal(s.filteredVotes, 1, 'jjk is filtered, not pushed onto an option');
  assert.deepEqual(s.ranking.map((r) => [r.id, r.option]), [[1, 2], [3, 1]]);
  assert.equal(engine.publicSnapshot(s).ranking[0].option, 2);
  engine.stop();
});

test('shortlist: every option shows from the start, at zero', async () => {
  const { engine } = setup();
  await engine.start({ mode: 'shortlist', filters: ALL, shortlist: [2, 3] });
  const s = engine.snapshot();
  assert.deepEqual(s.ranking.map((r) => [r.id, r.count, r.option]), [[2, 0, 1], [3, 0, 2]]);
  engine.stop();
});

test('several catalogs: each one filtered by its own chips, each title by its own floor', async () => {
  const pool = [
    S(1, 'Akira', null, 200000, { format: 'MOVIE' }),
    S(2, 'Naruto', null, 900000),
    S(1_000_000_010, 'Heat', null, 900000, { format: 'MOVIE' }),
    S(1_000_000_011, 'The Wire', null, 400000),
    // obscure on IMDb's scale, popular on AniList's
    S(1_000_000_012, 'Arrival', null, 9000, { format: 'MOVIE' }),
  ];
  const owner = (id) => (id >= 1_000_000_000 ? 'screen' : 'anime');
  const catalog = Object.assign(new EventEmitter(), {
    all: () => pool,
    info: () => ({ file: 'a+b', hasRelease: true, parts: [{ id: 'anime' }, { id: 'screen' }] }),
    sequelAliases: () => [],
    ownerOf: owner,
    floorFor: (id) => (owner(id) === 'screen' ? 15000 : 5000),
  });
  const user = {
    settings: () => ({ channels: [], onePerViewer: false }),
    ignores: () => new Set(),
    dismissed: () => new Set(),
    aliases: () => [],
    setSettings: () => {},
  };
  const engine = new PollEngine(catalog, user);
  const movies = { formats: ['MOVIE'], release: ALL.release };
  await engine.start({ mode: 'open', filters: { ...ALL, byCatalog: { anime: movies, screen: movies } }, shortlist: [] });
  for (const [u, text] of [['a', 'akira'], ['b', 'naruto'], ['c', 'heat'], ['d', 'the wire'], ['e', 'arrival']]) say(engine, u, text);
  // Naruto and The Wire are series; "arrival" is chatter by IMDb's floor
  assert.deepEqual(counts(engine), { 1: 1, 1_000_000_010: 1 });
  assert.equal(engine.snapshot().filteredVotes, 2);
  engine.stop();
});
