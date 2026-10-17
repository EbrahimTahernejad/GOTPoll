import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Matcher } from '../build/electron/matching/matcher.js';
import { cleanMessage } from '../build/electron/matching/normalize.js';

const show = (id, titleRomaji, titleEnglish, synonyms, popularity) => ({
  id, titleRomaji, titleEnglish, synonyms, popularity,
});

const shows = [
  show(1, 'Shingeki no Kyojin', 'Attack on Titan', ['SnK', 'AoT'], 900000),
  show(2, 'Shingeki! Kyojin Chuugakkou', 'Attack on Titan: Junior High', [], 60000),
  show(3, 'Sousou no Frieren', "Frieren: Beyond Journey's End", [], 500000),
  show(4, 'Jujutsu Kaisen', 'JUJUTSU KAISEN', ['JJK'], 850000),
  show(5, 'HUNTER×HUNTER (2011)', 'Hunter x Hunter (2011)', ['HxH'], 800000),
  show(6, 'HUNTER×HUNTER', 'Hunter x Hunter', [], 200000),
  show(7, 'To LOVE-Ru', 'To LOVE Ru', ['To Love You'], 150000),
  show(8, 'Mori no Ratio', null, [], 300),
  show(9, 'Kimetsu no Yaiba', 'Demon Slayer: Kimetsu no Yaiba', ['KnY'], 880000),
];
const m = new Matcher({ shows, threshold: 0.72, sequels: [{ title: 'Shingeki no Kyojin Season 2', rootId: 1 }] });
const id = (q) => m.match(q)?.showId ?? null;

test('exact titles, synonyms and compact forms', () => {
  assert.equal(id('attack on titan'), 1);
  assert.equal(id('AOT'), 1);
  assert.equal(id('jjk'), 4);
  assert.equal(id('hunterxhunter'), 5, 'the more popular of two identical titles wins');
});

test('chat noise is stripped', () => {
  assert.equal(cleanMessage('!vote FRIEREN 🔥🔥 <3'), 'frieren');
  assert.equal(id('!vote FRIEREN!!! 🔥'), 3);
  assert.equal(id('attack on titan season 4'), 1);
  assert.equal(id('Shingeki no Kyojin Season 2'), 1, 'sequel titles count for the franchise');
});

test('typos and partial titles', () => {
  assert.equal(id('sousou no frieran'), 3);
  assert.equal(id('shingeki'), 1, 'a parody does not steal the partial title');
  assert.equal(id('demon slayer'), 9);
});

test('chatter never counts', () => {
  for (const q of ['lol', 'W', 'gg', 'love you', 'up to you', 'season 2', 'ratio', 'hello chat', 'Kappa']) {
    assert.equal(id(q), null, q);
  }
});

test('taught phrases win and can be forgotten', () => {
  const local = new Matcher({ shows });
  assert.equal(local.match('the titan one'), null);
  local.teach('the titan one', 1);
  assert.equal(local.match('THE TITAN ONE!!')?.showId, 1);
  assert.equal(local.match('the titan one')?.stage, 'learned');
  local.forget('the titan one');
  assert.equal(local.match('the titan one'), null);
});

test('ignored shows are skipped', () => {
  assert.equal(m.match('hxh', new Set([5]))?.showId ?? null, null);
  assert.equal(m.match('hunter x hunter', new Set([5]))?.showId, 6);
});
