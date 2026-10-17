import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { PollEngine } from '../build/electron/poll/engine.js';

const S = (id, titleRomaji, titleEnglish, popularity, extra = {}) => ({
  id, titleRomaji, titleEnglish, synonyms: [], startYear: 2020, season: 'FALL', format: 'TV',
  coverImage: null, coverColor: null, popularity, score: null, favourites: null, parentId: null,
  eligible: true, ...extra,
});
const SHOWS = [
  S(1, 'Sousou no Frieren', "Frieren: Beyond Journey's End", 500000),
  S(2, 'Jujutsu Kaisen', null, 850000, { synonyms: ['JJK'] }),
  S(3, 'Chainsaw Man', null, 700000),
];

function setup(settings = {}) {
  const catalog = Object.assign(new EventEmitter(), {
    all: () => SHOWS,
    info: () => ({ file: 'a.db' }),
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
    dismiss: () => {},
    setIgnored: () => {},
  };
  const engine = new PollEngine(catalog, user);
  return { engine, taught };
}
const say = (e, user, text) => e.ingest({ platform: 'twitch', userId: user, text });
const counts = (e) => Object.fromEntries(e.snapshot().ranking.map((r) => [r.id, r.count]));

test('one count per viewer per show, across phrasings', async () => {
  const { engine } = setup();
  await engine.start([]);
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
  await engine.start([]);
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
  await engine.start([]);
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
  await engine.start([]);
  say(engine, 'a', 'frieren');
  say(engine, 'a', 'jjk');
  assert.deepEqual(counts(engine), { 2: 1 });
  engine.stop();
});

test('ending freezes the count', async () => {
  const { engine } = setup();
  await engine.start([]);
  say(engine, 'a', 'chainsaw man');
  engine.stop();
  say(engine, 'b', 'chainsaw man');
  const s = engine.snapshot();
  assert.equal(s.state, 'ended');
  assert.deepEqual(counts(engine), { 3: 1 });
  assert.equal(engine.publicSnapshot(s).ranking[0].title, 'Chainsaw Man');
});
