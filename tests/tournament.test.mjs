import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { PollEngine } from '../build/electron/poll/engine.js';
import { TournamentController } from '../build/electron/tournament/controller.js';
import {
  championOf,
  deriveRounds,
  pruneResults,
  qualify,
  seedOrder,
  seedSlots,
} from '../build/electron/tournament/bracket.js';

const S = (id, titleRomaji, popularity) => ({
  id, titleRomaji, titleEnglish: null, synonyms: [], startYear: 2020, season: 'FALL', format: 'TV',
  coverImage: null, coverColor: null, popularity, score: null, favourites: null, parentId: null,
  eligible: true, release: 'released',
});
const SHOWS = [
  S(1, 'Sousou no Frieren', 90000000), S(2, 'Jujutsu Kaisen', 80000000), S(3, 'Chainsaw Man', 70000000),
  S(4, 'One Piece', 60000000), S(5, 'Vinland Saga', 50000000), S(6, 'Dandadan', 40000000),
];

function setup() {
  const catalog = Object.assign(new EventEmitter(), {
    all: () => SHOWS,
    info: () => ({ file: 'a.db', hasRelease: true }),
    sequelAliases: () => [],
  });
  const state = new Map();
  const history = new Map();
  const user = {
    settings: () => ({
      channels: [], onePerViewer: false, pollTitle: 'Test',
      pollFilters: { formats: ['TV', 'TV_SHORT', 'MOVIE'], release: ['released', 'airing', 'upcoming'] },
    }),
    ignores: () => new Set(), dismissed: () => new Set(), aliases: () => [], customShows: () => [],
    teach: () => {}, setSettings: () => {}, dismiss: () => {}, undismiss: () => {}, setIgnored: () => {},
    loadState: (k) => (state.has(k) ? structuredClone(state.get(k)) : null),
    saveState: (k, v) => (v == null ? state.delete(k) : state.set(k, structuredClone(v))),
    tournaments: () => [...history.values()],
    tournament: (id) => history.get(id) ?? null,
    saveTournament: (r) => history.set(r.id, r),
    forgetTournament: (id) => history.delete(id),
  };
  const engine = new PollEngine(catalog, user);
  const t = new TournamentController(engine, user, { introMs: 10 });
  return { engine, t, user, state, history };
}
const say = (e, user, text, platform = 'twitch') => e.ingest({ platform, userId: user, text });
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

test('seeding: 1 and 2 can only meet in the final, top seeds get the byes', () => {
  assert.deepEqual(seedOrder(8), [1, 8, 4, 5, 2, 7, 3, 6]);
  // 6 entries in an 8 bracket: seeds 1 and 2 walk through round one
  const rounds = deriveRounds(seedSlots([10, 20, 30, 40, 50, 60]), {});
  assert.equal(rounds.length, 3);
  assert.deepEqual(rounds[0].map((m) => m.status), ['bye', 'ready', 'bye', 'ready']);
  assert.deepEqual([rounds[1][0].a, rounds[1][1].a], [10, 20]);
});

test('qualify: returning shows first, then the open round, only shows with votes', () => {
  const ranking = [{ id: 5, count: 9 }, { id: 1, count: 7 }, { id: 2, count: 3 }, { id: 3, count: 0 }];
  assert.deepEqual(qualify(ranking, [1, 4], 4), [1, 4, 5, 2]);
  assert.deepEqual(qualify(ranking, [], 8), [5, 1, 2]);
});

test('a result stops counting once its pairing changes', () => {
  const slots = [1, 2, 3, 4];
  const results = {
    '0-0': { a: 1, b: 2, winner: 1, votes: [5, 3], breakdown: [{}, {}], endedAt: 1 },
    '0-1': { a: 3, b: 4, winner: 4, votes: [1, 3], breakdown: [{}, {}], endedAt: 1 },
    '1-0': { a: 1, b: 4, winner: 4, votes: [2, 9], breakdown: [{}, {}], endedAt: 1 },
  };
  assert.equal(championOf(deriveRounds(slots, results)), 4);
  // 5 replaces 3: the semi stands, but its result is gone and so is the final's
  const edited = [1, 2, 5, 4];
  const kept = pruneResults(edited, results);
  assert.deepEqual(Object.keys(kept), ['0-0']);
  assert.equal(championOf(deriveRounds(edited, kept)), null);
});

test('full run: open round, qualifiers, 1v1s with one vote each, champion recorded', async () => {
  const { engine, t, history } = setup();
  await t.act({ type: 'draft', patch: { size: 4, carried: [6], title: 'Cup' } });
  await t.act({ type: 'start-open' });
  // open round: viewers may back several shows; the returning show doesn't count here
  say(engine, 'a', 'sousou no frieren'); say(engine, 'a', 'jujutsu kaisen'); say(engine, 'b', 'sousou no frieren');
  say(engine, 'c', 'chainsaw man'); say(engine, 'd', 'one piece'); say(engine, 'd', 'dandadan');
  say(engine, 'e', 'jujutsu kaisen'); say(engine, 'e', 'chainsaw man'); // a clean cut: no tie on the line
  assert.deepEqual(engine.snapshot().ranking.map((r) => [r.id, r.count]), [[1, 2], [2, 2], [3, 2], [4, 1]]);
  await t.act({ type: 'stop-open' });
  await t.act({ type: 'build-bracket' });
  let snap = t.snapshot();
  // Dandadan (returning) is seed 1, then Frieren, JJK, Chainsaw Man
  assert.deepEqual(snap.tournament.slots, [6, 3, 1, 2]);

  // semi 1: 6 vs 3 – number votes, and a viewer changing their mind counts once
  await t.act({ type: 'start-match', key: '0-0' });
  assert.equal(t.snapshot().tournament.live.stage, 'intro');
  await wait(40);
  assert.equal(t.snapshot().tournament.live.stage, 'voting');
  say(engine, 'a', '1'); say(engine, 'b', '!vote 2'); say(engine, 'c', 'chainsaw man');
  say(engine, 'a', '2'); // a switches
  say(engine, 'yt1', '#1', 'youtube');
  const live = engine.publicSnapshot();
  assert.deepEqual(live.ranking.map((r) => [r.id, r.count]), [[3, 3], [6, 1]]);
  assert.deepEqual(live.ranking[0].breakdown, { twitch: 3 });
  assert.deepEqual(live.ranking[1].breakdown, { youtube: 1 });
  await t.act({ type: 'stop-match' });
  snap = t.snapshot();
  assert.equal(snap.tournament.results['0-0'].winner, 3);
  await t.act({ type: 'continue' });
  assert.equal(t.snapshot().tournament.screen, 'bracket');
  assert.equal(t.snapshot().tournament.focus, '0-1');

  // semi 2 ends level: no winner until the streamer settles it
  await t.act({ type: 'start-match', key: '0-1' });
  await t.act({ type: 'begin-voting' });
  say(engine, 'x', '1'); say(engine, 'y', '2');
  await t.act({ type: 'stop-match' });
  assert.equal(t.snapshot().rounds[0][1].status, 'tie');
  await t.act({ type: 'set-winner', key: '0-1', showId: 1 });
  await t.act({ type: 'continue' });

  await t.act({ type: 'start-match', key: '1-0' });
  await t.act({ type: 'begin-voting' });
  say(engine, 'x', 'sousou no frieren'); say(engine, 'y', 'sousou no frieren'); say(engine, 'z', 'chainsaw man');
  await t.act({ type: 'stop-match' });
  snap = t.snapshot();
  assert.equal(snap.tournament.phase, 'done');
  assert.equal([...history.values()][0].champion, 1);
  assert.equal([...history.values()][0].runnerUp, 3);
  await t.act({ type: 'continue' });
  assert.equal(t.snapshot().tournament.screen, 'champion');

  // undoing the final's result un-finishes the tournament
  await t.act({ type: 'undo' }); // continue doesn't count – this undoes the stop
  assert.equal(history.size, 0);
  assert.equal(t.snapshot().tournament.live.stage, 'voting');
  assert.equal(engine.isRunning, true);
  engine.stop();
});

test('undo of a stop resumes the same count; undo of start goes back to nothing', async () => {
  const { engine, t } = setup();
  await t.act({ type: 'draft', patch: { size: 2, carried: [] } });
  await t.act({ type: 'start-open' });
  say(engine, 'a', 'sousou no frieren');
  await t.act({ type: 'stop-open' });
  say(engine, 'b', 'sousou no frieren'); // after the stop: not counted
  await t.act({ type: 'undo' });
  assert.equal(t.snapshot().tournament.phase, 'open');
  say(engine, 'c', 'sousou no frieren');
  assert.equal(engine.snapshot().ranking[0].count, 2);
  await t.act({ type: 'undo' });
  assert.equal(t.snapshot().tournament, null);
  assert.equal(engine.isRunning, false);
  assert.equal(engine.snapshot().owner, 'poll');
});

test('a failed step leaves nothing behind, and normal polls are blocked meanwhile', async () => {
  const { t } = setup();
  await t.act({ type: 'draft', patch: { size: 4 } });
  await t.act({ type: 'start-open' });
  await t.act({ type: 'stop-open' });
  // nobody voted: no bracket, and the undo trail is unchanged
  const before = t.snapshot().undoLabel;
  await assert.rejects(t.act({ type: 'build-bracket' }), /Not enough shows/);
  assert.equal(t.snapshot().undoLabel, before);
  assert.equal(t.snapshot().tournament.phase, 'open-results');
  await t.act({ type: 'close' });
  assert.equal(t.snapshot().tournament, null);
});

test('a restart mid-match settles what was live and keeps the bracket', async () => {
  const { engine, t, state } = setup();
  await t.act({ type: 'draft', patch: { size: 2 } });
  await t.act({ type: 'start-open' });
  say(engine, 'a', 'sousou no frieren'); say(engine, 'b', 'jujutsu kaisen');
  await t.act({ type: 'stop-open' });
  await t.act({ type: 'build-bracket' });
  await t.act({ type: 'start-match', key: '0-0' });
  await t.act({ type: 'begin-voting' });
  engine.stop();
  // a fresh controller over the same saved state
  const user2 = { ...t['user'], loadState: (k) => (state.has(k) ? structuredClone(state.get(k)) : null) };
  const t2 = new TournamentController(engine, user2);
  const snap = t2.snapshot();
  assert.equal(snap.tournament.live, null);
  assert.equal(snap.tournament.screen, 'bracket');
  assert.deepEqual(snap.tournament.slots, [1, 2]);
});

test('third place: semi-final losers, playable before the final, recorded with the champion', async () => {
  const { engine, t, history } = setup();
  await t.act({ type: 'draft', patch: { size: 4, carried: [], thirdPlace: true } });
  await t.act({ type: 'start-open' });
  for (const [u, s] of [['a', 'sousou no frieren'], ['b', 'jujutsu kaisen'], ['c', 'chainsaw man'], ['d', 'one piece']]) say(engine, u, s);
  await t.act({ type: 'stop-open' });
  await t.act({ type: 'build-bracket' });
  // no third-place match until both semis are decided
  assert.equal(t.snapshot().third.status, 'waiting');
  const [s1, s2] = t.snapshot().rounds[0];
  await t.act({ type: 'set-winner', key: s1.key, showId: s1.a });
  await t.act({ type: 'set-winner', key: s2.key, showId: s2.b });
  const third = t.snapshot().third;
  assert.equal(third.status, 'ready');
  assert.deepEqual([third.a, third.b], [s1.b, s2.a]);

  // played before the final
  await t.act({ type: 'start-match', key: '3p' });
  await t.act({ type: 'begin-voting' });
  say(engine, 'x', '2');
  await t.act({ type: 'stop-match' });
  await t.act({ type: 'continue' });
  assert.equal(t.snapshot().tournament.phase, 'bracket');
  assert.equal(t.snapshot().tournament.screen, 'bracket');

  await t.act({ type: 'set-winner', key: '1-0', showId: s1.a });
  const rec = [...history.values()][0];
  assert.equal(rec.champion, s1.a);
  assert.equal(rec.third, s2.a);
  assert.equal(t.publicView().thirdPlace.id, s2.a);

  // dropping it is a step like any other
  await t.act({ type: 'third-place', on: false });
  assert.equal(t.snapshot().third, null);
  assert.equal([...history.values()][0].third, undefined);
  await t.act({ type: 'undo' });
  assert.equal(t.snapshot().third.winner, s2.a);
});

test('cut tie: level shows across the line hold the bracket until drawn or picked', async () => {
  const { engine, t } = setup();
  // 3 spots: Frieren clear, then JJK / Chainsaw Man / One Piece level for 2
  await t.act({ type: 'draft', patch: { size: 3, carried: [], thirdPlace: false } });
  await t.act({ type: 'start-open' });
  say(engine, 'a', 'sousou no frieren'); say(engine, 'b', 'sousou no frieren');
  say(engine, 'c', 'jujutsu kaisen'); say(engine, 'd', 'chainsaw man'); say(engine, 'e', 'one piece');
  await t.act({ type: 'stop-open' });
  let snap = t.snapshot();
  assert.deepEqual(snap.tournament.cut.candidates.sort(), [2, 3, 4]);
  assert.equal(snap.tournament.cut.slots, 2);
  assert.deepEqual(snap.qualified, [1]);
  assert.deepEqual(snap.tied.sort(), [2, 3, 4]);
  await assert.rejects(t.act({ type: 'build-bracket' }), /Settle the tie/);
  await assert.rejects(t.act({ type: 'cut-pick', ids: [2] }), /exactly 2/);

  await t.act({ type: 'cut-draw' });
  snap = t.snapshot();
  assert.equal(snap.tournament.screen, 'draw');
  assert.equal(snap.tournament.cut.picked.length, 2);
  assert.deepEqual(snap.tied, []);
  assert.equal(snap.qualified.length, 3);
  await t.act({ type: 'continue' });
  assert.equal(t.snapshot().tournament.screen, 'open-results');

  // undo the draw, pick by hand instead
  await t.act({ type: 'undo' });
  await t.act({ type: 'cut-pick', ids: [4, 2] });
  await t.act({ type: 'build-bracket' });
  assert.deepEqual(t.snapshot().tournament.slots.filter((x) => x !== null).sort(), [1, 2, 4]);
});

test('coin flip settles a tied 1v1, and can be undone back to the tie', async () => {
  const { engine, t } = setup();
  await t.act({ type: 'draft', patch: { size: 2, carried: [] } });
  await t.act({ type: 'start-open' });
  say(engine, 'a', 'sousou no frieren'); say(engine, 'a', 'jujutsu kaisen');
  await t.act({ type: 'stop-open' });
  await t.act({ type: 'build-bracket' });
  await assert.rejects(t.act({ type: 'coin-flip', key: '0-0' }), /tied match/);
  await t.act({ type: 'start-match', key: '0-0' });
  await t.act({ type: 'begin-voting' });
  say(engine, 'x', '1'); say(engine, 'y', '2');
  await t.act({ type: 'stop-match' });
  await t.act({ type: 'coin-flip', key: '0-0' });
  const s = t.snapshot();
  assert.equal(s.tournament.screen, 'coin');
  assert.equal(s.tournament.phase, 'done');
  const pub = t.publicView();
  assert.equal(pub.coin.key, '0-0');
  assert.ok([1, 2].includes(pub.coin.winner));
  assert.equal(pub.rounds[0][0].coin, true);
  await t.act({ type: 'continue' });
  assert.equal(t.snapshot().tournament.screen, 'champion');
  await t.act({ type: 'undo' });
  assert.equal(t.snapshot().rounds[0][0].status, 'tie');
});

test('two level for one spot: the random option is a coin flip, not a draw', async () => {
  const { engine, t } = setup();
  await t.act({ type: 'draft', patch: { size: 2, carried: [] } });
  await t.act({ type: 'start-open' });
  say(engine, 'a', 'sousou no frieren'); say(engine, 'b', 'sousou no frieren');
  say(engine, 'c', 'jujutsu kaisen'); say(engine, 'd', 'chainsaw man');
  await t.act({ type: 'stop-open' });
  assert.equal(t.snapshot().tournament.cut.candidates.length, 2);
  await t.act({ type: 'cut-draw' });
  const s = t.snapshot().tournament;
  assert.equal(s.cut.method, 'coin');
  assert.equal(s.screen, 'coin');
  const pub = t.publicView();
  assert.equal(pub.coin.key, 'cut');
  assert.equal(pub.coin.winner, s.cut.picked[0]);
  await t.act({ type: 'continue' });
  assert.equal(t.snapshot().tournament.screen, 'open-results');
  await t.act({ type: 'build-bracket' });
  assert.deepEqual(t.snapshot().tournament.slots.sort(), [1, s.cut.picked[0]].sort());
});

test('a finished tournament can be re-opened read-only, on its report', async () => {
  const { engine, t } = setup();
  await t.act({ type: 'draft', patch: { size: 2, carried: [], title: 'Old Cup' } });
  await t.act({ type: 'start-open' });
  say(engine, 'a', 'sousou no frieren'); say(engine, 'a', 'jujutsu kaisen'); say(engine, 'b', 'sousou no frieren');
  await t.act({ type: 'stop-open' });
  await t.act({ type: 'build-bracket' });
  await t.act({ type: 'set-winner', key: '0-0', showId: 1 });
  await t.act({ type: 'close' });
  const [rec] = t.snapshot().history;
  assert.equal(rec.viewable, true);
  assert.equal('data' in rec, false); // lists stay light

  await t.act({ type: 'view-archive', id: rec.id });
  let pub = t.publicView();
  assert.equal(pub.archived, true);
  assert.equal(pub.screen, 'report');
  assert.equal(pub.champion.id, 1);
  assert.equal(pub.openVotes, 3);
  await t.act({ type: 'show', screen: 'bracket' });
  assert.equal(t.publicView().screen, 'bracket');
  await assert.rejects(t.act({ type: 'set-winner', key: '0-0', showId: 2 }), /No tournament is open/);

  // a new tournament takes the viewer page back
  await t.act({ type: 'start-open' });
  pub = t.publicView();
  assert.equal(pub.archived, false);
  assert.equal(t.snapshot().viewing, null);
  engine.stop();
});

test('removing nominees: mid-round, on the qualifiers step, returning shows, and in the bracket', async () => {
  const { engine, t } = setup();
  await t.act({ type: 'draft', patch: { size: 3, carried: [6], thirdPlace: false } });
  await t.act({ type: 'start-open' });
  for (const [u, s] of [['a', 'sousou no frieren'], ['b', 'sousou no frieren'], ['c', 'sousou no frieren'], ['d', 'jujutsu kaisen'], ['e', 'jujutsu kaisen'], ['f', 'chainsaw man']]) say(engine, u, s);
  // mid-round: Frieren is struck out – its votes stop counting, the round goes on
  await t.act({ type: 'remove-nominee', showId: 1 });
  assert.deepEqual(engine.snapshot().ranking.map((r) => r.id), [2, 3]);
  say(engine, 'g', 'sousou no frieren');
  await t.act({ type: 'undo' }); // and back: everyone who voted for it counts again
  assert.equal(engine.snapshot().ranking.find((r) => r.id === 1).count, 4);
  assert.equal(engine.isRunning, true);

  await t.act({ type: 'stop-open' });
  assert.deepEqual(t.snapshot().qualified, [1, 2]);
  // after the round: JJK breaks the rules – Chainsaw Man moves up
  await t.act({ type: 'remove-nominee', showId: 2 });
  assert.deepEqual(t.snapshot().qualified, [1, 3]);
  assert.deepEqual(t.publicView().standings.map((e) => e.id), [1, 3]);
  // a returning show can go too – its spot opens for the open round
  await t.act({ type: 'remove-nominee', showId: 6 });
  assert.equal(t.publicView().qualifySpots, 3);
  assert.deepEqual(t.snapshot().qualified, [1, 3]); // only two left with votes
  await t.act({ type: 'restore-nominee', showId: 6 });
  await t.act({ type: 'build-bracket' });
  assert.deepEqual(t.snapshot().tournament.slots.filter((x) => x !== null).sort(), [1, 3, 6]);

  // in the bracket: disqualify brings in the best open-round show not in yet (none left → a bye)
  const at = t.snapshot().tournament.slots.indexOf(3);
  await t.act({ type: 'disqualify', index: at });
  assert.equal(t.snapshot().tournament.slots[at], null);
  assert.ok(t.snapshot().tournament.removed.includes(3));
  await t.act({ type: 'undo' });
  assert.equal(t.snapshot().tournament.slots[at], 3);
  engine.stop();
});
