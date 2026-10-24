import { EventEmitter } from 'node:events';
import { cleanFilters, cleanShortlist } from '../poll/filters.js';
import { publicEntry, type PollEngine } from '../poll/engine.js';
import type { UserStore } from '../user-store.js';
import {
  MAX_ENTRIES,
  MIN_ENTRIES,
  THIRD,
  championOf,
  cutTie,
  deriveRounds,
  deriveThird,
  nextReady,
  pruneResults,
  qualify,
  runnerUpOf,
  seedSlots,
  thirdOf,
} from './bracket.js';

// The tournament drives the poll engine through its steps:
//
//   open round ─ stop ─▶ qualifiers ─ build ─▶ bracket ─ 1v1 … ─▶ champion
//
// Every step can be undone. Undo restores the tournament exactly as it was
// before the step; if that step had stopped a vote whose count the engine
// still holds, the vote simply picks up again. Chats stay connected for the
// whole tournament, so moving between matches never waits on a reconnect.

const UNDO_MAX = 40;
/** the Tekken-style "A vs B" screen before a match's voting opens */
export const INTRO_MS = 5200;
const SAVE_EVERY_MS = 5000;

type UndoEntry = { label: string; t: Tournament | null };

const clone = <T>(v: T): T => (v === null ? v : structuredClone(v));
const newId = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const int = (v: unknown, min: number, max: number, fallback: number) =>
  typeof v === 'number' && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.round(v))) : fallback;

type Engine = Pick<
  PollEngine,
  'start' | 'stop' | 'resume' | 'reset' | 'snapshot' | 'show' | 'on' | 'run' | 'currentOwner' | 'isRunning' | 'setExclude'
>;
type Store = Pick<UserStore, 'settings' | 'loadState' | 'saveState' | 'tournaments' | 'tournament' | 'saveTournament' | 'forgetTournament'>;

/** Returning shows still in (not struck out). */
const carriedOf = (t: Tournament) => t.config.carried.filter((id) => !t.removed?.includes(id));
/** Open-round standings without struck-out shows. */
const rankingOf = (t: Tournament) => (t.removed?.length ? t.open.ranking.filter((r) => !t.removed!.includes(r.id)) : t.open.ranking);
/** What the open round's count leaves out: returning shows (already in) and struck-out ones. */
const excludedOf = (t: Tournament) => [...new Set([...t.config.carried, ...(t.removed ?? [])])];

const summary = (r: TournamentRecord): TournamentSummary => {
  const { data, ...rest } = r;
  return { ...rest, viewable: !!data };
};

export class TournamentController extends EventEmitter<{ update: [TournamentSnapshot] }> {
  private t: Tournament | null;
  /** a past tournament re-opened for the viewer page */
  private viewing: { record: TournamentRecord; t: Tournament } | null = null;
  private undoStack: UndoEntry[];
  private draft: TournamentConfig;
  private introTimer: NodeJS.Timeout | null = null;
  private lastSave = 0;
  /** steps run one after another – a double click can't start two votes */
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private poll: Engine,
    private user: Store,
    private opts: { introMs?: number } = {}
  ) {
    super();
    this.draft = this.cleanDraft(user.loadState<Partial<TournamentConfig>>('tournament-draft') ?? {});
    this.t = user.loadState<Tournament>('tournament');
    this.undoStack = user.loadState<UndoEntry[]>('tournament-undo') ?? [];
    if (this.t) this.recoverAfterRestart();
    poll.on('update', (s) => this.onPoll(s));
  }

  // ------------------------------------------------------------ views

  snapshot(): TournamentSnapshot {
    const t = this.t;
    const rounds = this.rounds();
    return {
      tournament: t,
      rounds,
      third: this.third(rounds),
      ...this.standing(),
      draft: this.draft,
      history: this.user.tournaments().map(summary),
      viewing: this.viewing && (() => {
        const v = this.viewing.t;
        const vr = this.rounds(v);
        return { record: summary(this.viewing.record), tournament: v, rounds: vr, third: this.third(vr, v) };
      })(),
      canUndo: this.undoStack.length > 0,
      undoLabel: this.undoStack.at(-1)?.label ?? null,
    };
  }

  /** The viewer page's slice of it. */
  publicView(): PublicTournament | null {
    // a re-opened past tournament takes the screen while it's being viewed
    const archived = !!this.viewing;
    const t = this.viewing?.t ?? this.t;
    if (!t) return null;
    const entry = (id: number | null | undefined, count = 0) => {
      if (typeof id !== 'number') return null;
      const s = this.poll.show(id);
      return s ? publicEntry(s, count) : null;
    };
    const rounds = this.rounds(t);
    const third = this.third(rounds, t);
    const pub = (m: BracketMatch): PublicMatch => ({
      key: m.key,
      round: m.round,
      index: m.index,
      a: entry(m.a, m.result?.votes[0]),
      b: entry(m.b, m.result?.votes[1]),
      status: m.status,
      winner: m.winner ?? null,
      votes: m.result?.votes ?? null,
      breakdown: m.result?.breakdown ?? null,
      coin: !!m.result?.coin,
      manual: !!m.result?.manual,
    });
    const coinMatch = t.coin && t.coin.key !== 'cut' ? [...rounds.flat(), third].find((m) => m?.key === t.coin!.key) : null;
    return {
      id: t.id,
      title: t.config.title,
      archived,
      createdAt: t.createdAt,
      finishedAt: archived ? this.viewing!.record.finishedAt : null,
      openVotes: t.open.ranking.reduce((n, r) => n + r.count, 0),
      phase: t.phase,
      screen: t.screen,
      size: t.config.size,
      qualifySpots: Math.max(0, t.config.size - carriedOf(t).length),
      carried: carriedOf(t).flatMap((id) => entry(id) ?? []),
      standings: rankingOf(t).slice(0, t.config.showTop).flatMap((r) => entry(r.id, r.count) ?? []),
      ...this.standing(t),
      cut: t.cut ? { ...t.cut, candidates: t.cut.candidates.flatMap((id) => entry(id, t.cut!.votes) ?? []) } : null,
      coin: this.coinInfo(t, coinMatch),
      rounds: rounds.map((row) => row.map(pub)),
      third: third && pub(third),
      live: !archived && t.live ? { key: t.live.key, stage: t.live.stage, at: t.live.at } : null,
      focus: t.focus,
      champion: entry(championOf(rounds)),
      runnerUp: entry(runnerUpOf(rounds)),
      thirdPlace: entry(thirdOf(third)),
    };
  }

  /** A match counts as live from its intro until its result is in. */
  private liveKey(t = this.t) {
    return t === this.t && t?.live && t.live.stage !== 'result' ? t.live.key : null;
  }

  private rounds(t = this.t) {
    return t ? deriveRounds(t.slots, t.results, this.liveKey(t)) : [];
  }

  /** the third-place match, when the tournament plays one */
  private third(rounds = this.rounds(), t = this.t) {
    return t?.config.thirdPlace ? deriveThird(rounds, t.results, this.liveKey(t)) : null;
  }

  private match(key: string) {
    const rounds = this.rounds();
    const m = [...rounds.flat(), this.third(rounds)].find((x) => x?.key === key);
    if (!m) throw new Error('That match is not in the bracket');
    return m;
  }

  // ------------------------------------------------------------ actions

  act(a: TournamentAction): Promise<void> {
    const run = this.chain.then(async () => {
      const depth = this.undoStack.length;
      try {
        await this.apply(a);
      } catch (err) {
        // a step that fails halfway leaves nothing behind
        if (this.undoStack.length > depth) {
          this.t = this.undoStack.pop()!.t;
          await this.syncEngine().catch(() => {});
        }
        throw err;
      } finally {
        this.commit();
      }
    });
    this.chain = run.catch(() => {});
    return run;
  }

  private async apply(a: TournamentAction) {
    switch (a.type) {
      case 'draft': {
        this.draft = this.cleanDraft({ ...this.draft, ...a.patch });
        this.user.saveState('tournament-draft', this.draft);
        return;
      }
      case 'start-open': {
        if (this.t) throw new Error('A tournament is already open');
        this.viewing = null; // a new tournament takes the viewer page back
        if (this.poll.isRunning && this.poll.currentOwner === 'poll') throw new Error('End the running poll first');
        if (this.draft.carried.length >= this.draft.size) throw new Error('Leave at least one spot for the open round');
        this.push('Start the open round');
        const now = Date.now();
        this.t = {
          id: newId(),
          createdAt: now,
          config: clone(this.draft),
          phase: 'open',
          screen: 'open',
          open: { ranking: [], startedAt: now, endedAt: null, run: -1 },
          slots: [],
          results: {},
          live: null,
          focus: null,
        };
        await this.startOpenRun();
        return;
      }
      case 'stop-open': {
        const t = this.need('open');
        this.push('Stop the open round');
        this.poll.stop({ keepSources: true });
        t.open.ranking = this.openRanking();
        t.open.endedAt = Date.now();
        t.cut = this.findCut(t);
        t.phase = 'open-results';
        t.screen = 'open-results';
        return;
      }
      case 'retry-open': {
        const t = this.need('open', 'open-results');
        this.push('Restart the open round');
        t.phase = 'open';
        t.screen = 'open';
        t.slots = [];
        t.results = {};
        t.cut = null;
        await this.startOpenRun();
        return;
      }
      case 'cut-draw':
      case 'cut-pick': {
        const t = this.need('open-results');
        const cut = t.cut;
        if (!cut) throw new Error('Nobody is tied on the qualifying line');
        let picked: number[];
        if (a.type === 'cut-draw') {
          // a fair shuffle; the viewer page plays it out as a ball draw
          const pool = [...cut.candidates];
          for (let i = pool.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [pool[i], pool[j]] = [pool[j], pool[i]];
          }
          picked = pool.slice(0, cut.slots);
        } else {
          picked = [...new Set(a.ids)].filter((id) => cut.candidates.includes(id));
          if (picked.length !== cut.slots) throw new Error(`Pick exactly ${cut.slots} of the tied shows`);
        }
        // two level for one spot is a coin toss; the ball draw is for three or more
        const method = a.type === 'cut-pick' ? 'manual' : cut.candidates.length === 2 ? 'coin' : 'draw';
        this.push(method === 'manual' ? 'Pick the tied places' : method === 'coin' ? 'Flip for the last place' : 'Draw the tied places');
        const at = Date.now();
        t.cut = { ...cut, picked, method, at };
        if (method === 'coin') t.coin = { key: 'cut', at };
        t.screen = method === 'manual' ? 'open-results' : method;
        return;
      }
      case 'remove-nominee':
      case 'restore-nominee': {
        const t = this.need('open', 'open-results');
        const removed = new Set(t.removed ?? []);
        if (a.type === 'remove-nominee' ? removed.has(a.showId) : !removed.has(a.showId)) return;
        if (a.type === 'remove-nominee' && !this.poll.show(a.showId)) throw new Error('Unknown show');
        this.push(a.type === 'remove-nominee' ? 'Remove a nominee' : 'Bring a nominee back');
        if (a.type === 'remove-nominee') removed.add(a.showId);
        else removed.delete(a.showId);
        t.removed = [...removed];
        if (t.phase === 'open') {
          // the open round keeps going; votes for it just stop counting
          if (this.poll.currentOwner === 'tournament' && this.poll.run === t.open.run) this.poll.setExclude(excludedOf(t));
        } else {
          this.refreshCut(t);
        }
        return;
      }
      case 'disqualify': {
        const t = this.need('bracket', 'done');
        this.noLive();
        const out = t.slots[a.index];
        if (!Number.isInteger(a.index) || typeof out !== 'number') throw new Error('Nobody in that slot');
        this.push('Disqualify a show');
        t.removed = [...new Set([...(t.removed ?? []), out])];
        // the best open-round show not already in takes the place (or it's a bye)
        const inBracket = new Set(t.slots.filter((x): x is number => x !== null));
        const next = qualify(this.effectiveRanking(t), [], MAX_ENTRIES).find((id) => !inBracket.has(id) && !t.removed!.includes(id));
        t.slots[a.index] = next ?? null;
        this.afterEdit();
        return;
      }
      case 'build-bracket': {
        const t = this.need('open-results');
        if (t.cut && !t.cut.picked) throw new Error('Settle the tie on the qualifying line first');
        const ids = qualify(this.effectiveRanking(t), carriedOf(t), t.config.size);
        if (ids.length < MIN_ENTRIES) throw new Error('Not enough shows got votes to make a bracket');
        this.push('Build the bracket');
        t.slots = seedSlots(ids);
        t.results = {};
        t.phase = 'bracket';
        t.screen = 'bracket';
        t.focus = nextReady(this.rounds())?.key ?? null;
        return;
      }
      case 'reseed':
      case 'shuffle': {
        const t = this.need('bracket', 'done');
        this.noLive();
        const ids = t.slots.filter((x): x is number => x !== null);
        this.push(a.type === 'shuffle' ? 'Shuffle the bracket' : 'Reseed the bracket');
        if (a.type === 'shuffle') {
          for (let i = ids.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [ids[i], ids[j]] = [ids[j], ids[i]];
          }
        } else {
          const order = qualify(this.effectiveRanking(t), carriedOf(t), MAX_ENTRIES);
          const rank = (id: number) => (order.includes(id) ? order.indexOf(id) : 999);
          ids.sort((x, y) => rank(x) - rank(y));
        }
        t.slots = seedSlots(ids);
        t.results = {};
        t.focus = nextReady(this.rounds())?.key ?? null;
        return;
      }
      case 'set-slot': {
        const t = this.need('bracket', 'done');
        this.noLive();
        if (!Number.isInteger(a.index) || a.index < 0 || a.index >= t.slots.length) throw new Error('No such slot');
        if (a.showId !== null && !this.poll.show(a.showId)) throw new Error('Unknown show');
        this.push(a.showId === null ? 'Clear a slot' : 'Change a slot');
        const existing = a.showId === null ? -1 : t.slots.indexOf(a.showId);
        // a show can only be in the bracket once: picking one already in it swaps them
        if (existing >= 0) t.slots[existing] = t.slots[a.index];
        t.slots[a.index] = a.showId;
        this.afterEdit();
        return;
      }
      case 'swap-slots': {
        const t = this.need('bracket', 'done');
        this.noLive();
        if ([a.a, a.b].some((i) => !Number.isInteger(i) || i < 0 || i >= t.slots.length)) throw new Error('No such slot');
        this.push('Swap two slots');
        [t.slots[a.a], t.slots[a.b]] = [t.slots[a.b], t.slots[a.a]];
        this.afterEdit();
        return;
      }
      case 'start-match': {
        const t = this.need('bracket', 'done');
        this.noLive();
        const m = this.match(a.key);
        if (m.status !== 'ready') throw new Error('Both sides of that match need to be known first');
        this.push('Start the match');
        this.beginIntro(t, a.key);
        return;
      }
      case 'begin-voting': {
        const t = this.need('bracket', 'done');
        if (t.live?.stage !== 'intro') return;
        await this.startMatchRun();
        return;
      }
      case 'stop-match': {
        const t = this.need('bracket', 'done');
        if (t.live?.stage !== 'voting') throw new Error('No match is being voted on');
        const m = this.match(t.live.key);
        this.push('Stop the vote');
        this.poll.stop({ keepSources: true });
        const ranking = this.poll.snapshot().ranking;
        const ra = ranking.find((r) => r.id === m.a);
        const rb = ranking.find((r) => r.id === m.b);
        const votes: [number, number] = [ra?.count ?? 0, rb?.count ?? 0];
        t.results[m.key] = {
          a: m.a as number,
          b: m.b as number,
          winner: votes[0] > votes[1] ? (m.a as number) : votes[1] > votes[0] ? (m.b as number) : null,
          votes,
          breakdown: [ra?.breakdown ?? {}, rb?.breakdown ?? {}],
          endedAt: Date.now(),
        };
        t.live = { ...t.live, stage: 'result', at: Date.now() };
        t.screen = 'match';
        return;
      }
      case 'cancel-match': {
        const t = this.need('bracket', 'done');
        if (!t.live) return;
        this.push('Cancel the match');
        this.clearIntro();
        if (t.live.stage !== 'result') this.poll.stop({ keepSources: true });
        t.live = null;
        t.screen = 'bracket';
        return;
      }
      case 'retry-match': {
        const t = this.need('bracket', 'done');
        const m = this.match(a.key);
        if (t.live && t.live.key !== a.key && t.live.stage !== 'result') throw new Error('Another match is live');
        if (!m.result && m.status !== 'ready' && m.status !== 'live') throw new Error('That match can’t be played yet');
        this.push('Rematch');
        this.clearIntro();
        if (this.poll.isRunning) this.poll.stop({ keepSources: true });
        delete t.results[a.key];
        t.results = pruneResults(t.slots, t.results);
        this.beginIntro(t, a.key);
        return;
      }
      case 'set-winner': {
        const t = this.need('bracket', 'done');
        const m = this.match(a.key);
        if (typeof m.a !== 'number' || typeof m.b !== 'number' || (a.showId !== m.a && a.showId !== m.b)) {
          throw new Error('Pick one of the two shows in that match');
        }
        if (t.live && t.live.key === a.key && t.live.stage !== 'result') throw new Error('Stop the vote first');
        this.push('Pick a winner');
        const prev = m.result;
        t.results[a.key] = {
          a: m.a,
          b: m.b,
          winner: a.showId,
          votes: prev?.votes ?? [0, 0],
          breakdown: prev?.breakdown ?? [{}, {}],
          manual: true,
          endedAt: Date.now(),
        };
        t.results = pruneResults(t.slots, t.results);
        return;
      }
      case 'coin-flip': {
        const t = this.need('bracket', 'done');
        const m = this.match(a.key);
        if (m.status !== 'tie' || !m.result) throw new Error('Only a tied match goes to a coin flip');
        this.push('Flip a coin');
        const winner = Math.random() < 0.5 ? m.result.a : m.result.b;
        t.results[a.key] = { ...m.result, winner, coin: true, manual: false };
        t.coin = { key: a.key, at: Date.now() };
        t.focus = a.key;
        t.screen = 'coin';
        return;
      }
      case 'clear-result': {
        const t = this.need('bracket', 'done');
        if (!t.results[a.key]) return;
        this.push('Clear a result');
        delete t.results[a.key];
        t.results = pruneResults(t.slots, t.results);
        if (t.live?.key === a.key) t.live = null;
        if (t.screen === 'champion' || (t.screen === 'match' && !t.live)) t.screen = 'bracket';
        return;
      }
      case 'continue': {
        const t = this.need('open-results', 'bracket', 'done');
        if (t.screen === 'draw' || (t.screen === 'coin' && t.phase === 'open-results')) {
          t.screen = 'open-results';
          return;
        }
        if (t.live?.stage === 'result') t.live = null;
        else if (t.screen !== 'coin') return;
        t.screen = championOf(this.rounds()) !== null ? 'champion' : 'bracket';
        t.focus = nextReady(this.rounds())?.key ?? t.focus;
        return;
      }
      case 'show': {
        if (this.viewing) {
          this.showArchived(a.screen, a.focus);
          return;
        }
        const t = this.t;
        if (!t) throw new Error('No tournament is open');
        const focus = a.focus === undefined ? t.focus : a.focus;
        const ok: Record<TournamentScreen, boolean> = {
          open: t.phase === 'open',
          'open-results': t.phase !== 'open',
          bracket: t.phase === 'bracket' || t.phase === 'done',
          intro: (t.phase === 'bracket' || t.phase === 'done') && !!focus && this.pairOf(focus),
          match:
            (t.phase === 'bracket' || t.phase === 'done') &&
            !!focus &&
            (t.live?.key === focus || !!this.match(focus).result),
          champion: t.phase === 'done',
          draw: t.cut?.method === 'draw',
          coin: !!this.coinInfo(t),
          report: t.phase === 'bracket' || t.phase === 'done',
        };
        if (!ok[a.screen]) throw new Error('Nothing to show there yet');
        t.screen = a.screen;
        t.focus = a.screen === 'coin' && t.coin!.key !== 'cut' ? t.coin!.key : focus;
        return;
      }
      case 'undo': {
        const entry = this.undoStack.pop();
        if (!entry) return;
        this.clearIntro();
        this.t = entry.t;
        await this.syncEngine();
        return;
      }
      case 'close': {
        this.clearIntro();
        if (this.poll.currentOwner === 'tournament') this.poll.reset();
        this.t = null;
        this.undoStack = [];
        return;
      }
      case 'third-place': {
        const t = this.need('open', 'open-results', 'bracket', 'done');
        if (t.config.thirdPlace === a.on) return;
        if (!a.on && t.live?.key === THIRD && t.live.stage !== 'result') throw new Error('Finish or cancel the third-place match first');
        this.push(a.on ? 'Add the third-place match' : 'Drop the third-place match');
        t.config.thirdPlace = a.on;
        if (!a.on) {
          delete t.results[THIRD];
          if (t.live?.key === THIRD) t.live = null;
          if (t.focus === THIRD) t.focus = nextReady(this.rounds())?.key ?? null;
        }
        return;
      }
      case 'forget-history': {
        if (this.viewing?.record.id === a.id) this.viewing = null;
        this.user.forgetTournament(a.id);
        return;
      }
      case 'view-archive': {
        const record = this.user.tournament(a.id);
        if (!record?.data) throw new Error('That tournament was finished before reports were kept');
        // read-only: nothing live, opens on its report
        const t: Tournament = { ...structuredClone(record.data), live: null, screen: 'report' };
        this.viewing = { record, t };
        return;
      }
      case 'stop-viewing': {
        this.viewing = null;
        return;
      }
    }
  }

  // ------------------------------------------------------------ internals

  /** Point the viewer page at a screen of the re-opened past tournament. */
  private showArchived(screen: TournamentScreen, focusArg?: string | null) {
    const t = this.viewing!.t;
    const rounds = this.rounds(t);
    const all = [...rounds.flat(), this.third(rounds, t)];
    const focus = focusArg === undefined ? t.focus : focusArg;
    const fm = focus ? all.find((m) => m?.key === focus) : null;
    const coinMatch = t.coin && t.coin.key !== 'cut' ? all.find((m) => m?.key === t.coin!.key) : null;
    const ok: Partial<Record<TournamentScreen, boolean>> = {
      'open-results': true,
      draw: t.cut?.method === 'draw',
      bracket: rounds.length > 0,
      report: true,
      champion: championOf(rounds) !== null,
      intro: !!fm && typeof fm.a === 'number' && typeof fm.b === 'number',
      match: !!fm?.result,
      coin: !!this.coinInfo(t, coinMatch ?? null),
    };
    if (!ok[screen]) throw new Error('Nothing to show there');
    t.screen = screen;
    t.focus = screen === 'coin' && t.coin!.key !== 'cut' ? t.coin!.key : focus;
  }

  private need(...phases: TournamentPhase[]): Tournament {
    if (!this.t) throw new Error('No tournament is open');
    if (!phases.includes(this.t.phase)) throw new Error('That step isn’t available right now');
    return this.t;
  }

  private noLive() {
    if (this.t?.live && this.t.live.stage !== 'result') throw new Error('Finish or cancel the live match first');
  }

  private pairOf(key: string) {
    const m = this.match(key);
    return typeof m.a === 'number' && typeof m.b === 'number';
  }

  private push(label: string) {
    this.undoStack.push({ label, t: clone(this.t) });
    if (this.undoStack.length > UNDO_MAX) this.undoStack.shift();
  }

  private afterEdit() {
    const t = this.t!;
    t.results = pruneResults(t.slots, t.results);
    t.focus = nextReady(this.rounds())?.key ?? null;
  }

  /** The coin flip the coin screen can show: on the qualifying line, or a tied match. */
  private coinInfo(t: Tournament, m?: BracketMatch | null): { key: string; at: number; winner: number } | null {
    const coin = t.coin;
    if (!coin) return null;
    if (coin.key === 'cut') {
      const won = t.cut?.method === 'coin' ? t.cut.picked?.[0] : undefined;
      return won === undefined ? null : { key: 'cut', at: coin.at, winner: won };
    }
    if (t.phase !== 'bracket' && t.phase !== 'done') return null;
    const match = m === undefined ? this.match(coin.key) : m;
    return match?.result?.coin && typeof match.winner === 'number' ? { key: coin.key, at: coin.at, winner: match.winner } : null;
  }

  /** Recompute the tie on the qualifying line; a settled one stays settled if it's the same tie. */
  private refreshCut(t: Tournament) {
    const next = this.findCut(t);
    const prev = t.cut;
    const same =
      !!prev && !!next && prev.slots === next.slots && prev.candidates.length === next.candidates.length && prev.candidates.every((id) => next.candidates.includes(id));
    t.cut = same ? prev! : next;
    if (!same && (t.screen === 'draw' || (t.screen === 'coin' && t.coin?.key === 'cut'))) t.screen = 'open-results';
  }

  private findCut(t: Tournament): CutTie | null {
    const tie = cutTie(rankingOf(t), carriedOf(t), t.config.size);
    return tie && { ...tie, picked: null, method: null, at: null };
  }

  /** The open round's standings with the tied shows that lost out removed. */
  private effectiveRanking(t: Tournament) {
    const cut = t.cut;
    return rankingOf(t).filter((r) => !cut || !cut.candidates.includes(r.id) || cut.picked?.includes(r.id));
  }

  /** Who's through from the open round, and who's still level on the line. */
  private standing(t = this.t): { qualified: number[]; tied: number[] } {
    if (!t) return { qualified: [], tied: [] };
    const carried = carriedOf(t);
    const spots = Math.max(0, t.config.size - carried.length);
    const list = rankingOf(t).filter((r) => r.count > 0 && !carried.includes(r.id));
    const cut = t.phase === 'open' ? null : t.cut;
    if (!cut) return { qualified: list.slice(0, spots).map((r) => r.id), tied: [] };
    const above = list.filter((r) => r.count > cut.votes).map((r) => r.id);
    return { qualified: [...above, ...(cut.picked ?? [])], tied: cut.picked ? [] : cut.candidates };
  }

  private openRanking() {
    return this.poll
      .snapshot()
      .ranking.slice(0, 100)
      .map((r) => ({ id: r.id, count: r.count }));
  }

  private async startOpenRun() {
    const t = this.t!;
    if (this.poll.isRunning) this.poll.stop({ keepSources: true });
    // chat may back as many shows as it likes; returning shows are already in
    await this.poll.start(
      { mode: 'open', filters: t.config.filters, shortlist: [] },
      { owner: 'tournament', onePerViewer: false, exclude: excludedOf(t) }
    );
    t.open = { ranking: [], startedAt: Date.now(), endedAt: null, run: this.poll.run };
  }

  private beginIntro(t: Tournament, key: string) {
    t.live = { key, stage: 'intro', run: -1, at: Date.now() };
    t.focus = key;
    t.screen = 'intro';
    this.armIntro();
  }

  private armIntro() {
    this.clearIntro();
    const live = this.t?.live;
    if (live?.stage !== 'intro') return;
    const ms = this.opts.introMs ?? INTRO_MS;
    const left = Math.max(Math.min(1500, ms), ms - (Date.now() - live.at));
    this.introTimer = setTimeout(() => {
      this.introTimer = null;
      this.act({ type: 'begin-voting' }).catch(() => {});
    }, left);
  }

  private clearIntro() {
    if (this.introTimer) clearTimeout(this.introTimer);
    this.introTimer = null;
  }

  private async startMatchRun() {
    const t = this.t!;
    const live = t.live!;
    const m = this.match(live.key);
    if (typeof m.a !== 'number' || typeof m.b !== 'number') throw new Error('That match is missing a side');
    this.clearIntro();
    if (this.poll.isRunning) this.poll.stop({ keepSources: true });
    // a 1v1: one vote per viewer per platform, "1" / "2" or the title
    await this.poll.start(
      { mode: 'shortlist', filters: t.config.filters, shortlist: [m.a, m.b] },
      { owner: 'tournament', onePerViewer: true }
    );
    t.live = { key: live.key, stage: 'voting', run: this.poll.run, at: Date.now() };
    t.screen = 'match';
  }

  /** After an undo: make the engine match the restored state. */
  private async syncEngine() {
    const t = this.t;
    const ours = this.poll.currentOwner === 'tournament';
    if (!t) {
      if (ours) this.poll.reset();
      return;
    }
    const wanted = t.phase === 'open' ? t.open.run : t.live?.stage === 'voting' ? t.live.run : null;
    if (wanted === null) {
      if (ours && this.poll.isRunning) this.poll.stop({ keepSources: true });
      this.armIntro();
      return;
    }
    if (ours && this.poll.run === wanted) {
      // the engine still holds that vote's count: carry on with it
      this.poll.resume();
      if (t.phase === 'open') this.poll.setExclude(excludedOf(t));
      return;
    }
    // the count is gone (another vote ran since, or the app restarted): go again
    if (t.phase === 'open') await this.startOpenRun();
    else await this.startMatchRun();
  }

  /** After a restart nothing is being counted any more – settle what was live. */
  private recoverAfterRestart() {
    const t = this.t!;
    const forget = (x: Tournament | null) => {
      if (!x) return;
      x.open.run = -1;
      if (x.live) x.live.run = -1;
    };
    forget(t);
    this.undoStack.forEach((u) => forget(u.t));
    if (t.phase === 'open') {
      t.phase = 'open-results';
      t.screen = 'open-results';
      t.open.endedAt = Date.now();
      t.cut = this.findCut(t);
    }
    if (t.live && t.live.stage !== 'result') {
      t.live = null;
      if (t.screen === 'intro' || t.screen === 'match') t.screen = 'bracket';
    }
  }

  private onPoll(s: PollSnapshot) {
    const t = this.t;
    if (!t || t.phase !== 'open' || s.owner !== 'tournament' || this.poll.run !== t.open.run) return;
    // keep the standings fresh so a crash mid-round loses little
    t.open.ranking = s.ranking.slice(0, 100).map((r) => ({ id: r.id, count: r.count }));
    if (Date.now() - this.lastSave > SAVE_EVERY_MS) this.save();
  }

  /** Settle the phase, record a finished tournament, save, tell everyone. */
  private commit() {
    const t = this.t;
    if (t && (t.phase === 'bracket' || t.phase === 'done')) {
      const rounds = this.rounds();
      const champion = championOf(rounds);
      if (champion !== null) {
        t.phase = 'done';
        this.user.saveTournament({
          id: t.id,
          title: t.config.title,
          finishedAt: this.user.tournament(t.id)?.finishedAt ?? Date.now(),
          data: { ...structuredClone(t), live: null },
          champion,
          runnerUp: runnerUpOf(rounds) ?? champion,
          third: thirdOf(this.third(rounds)) ?? undefined,
          entries: t.slots.filter((x): x is number => x !== null),
        });
      } else {
        // no champion (any more): it isn't a finished tournament
        if (t.phase === 'done') t.phase = 'bracket';
        if (t.screen === 'champion') t.screen = 'bracket';
        this.user.forgetTournament(t.id);
      }
    }
    this.save();
    this.emit('update', this.snapshot());
  }

  private save() {
    this.lastSave = Date.now();
    this.user.saveState('tournament', this.t);
    this.user.saveState('tournament-undo', this.undoStack.length ? this.undoStack : null);
  }

  private cleanDraft(d: Partial<TournamentConfig>): TournamentConfig {
    const size = int(d.size, MIN_ENTRIES, MAX_ENTRIES, 8);
    return {
      title: typeof d.title === 'string' && d.title.trim() ? d.title.trim().slice(0, 60) : 'Anime Tournament',
      size,
      showTop: int(d.showTop, 1, 30, 10),
      carried: cleanShortlist(Array.isArray(d.carried) ? d.carried : []).slice(0, size),
      filters: cleanFilters(d.filters ?? this.user.settings().pollFilters),
      thirdPlace: d.thirdPlace !== false,
    };
  }
}
