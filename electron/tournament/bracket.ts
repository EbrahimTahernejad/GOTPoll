// Pure bracket maths – no I/O, so it's easy to test.
//
// A bracket is just its first-round slots plus the results recorded so far.
// Everything else (who meets whom later, byes, the champion) is derived, so
// editing a slot or undoing a result can never leave the tree inconsistent:
// a result only counts while the pairing it was played for still stands.

export const MIN_ENTRIES = 2;
export const MAX_ENTRIES = 32;

export const matchKey = (round: number, index: number) => `${round}-${index}`;
/** the third-place match: the two semi-final losers */
export const THIRD = '3p';

/** Smallest power of two that holds n entries (at least 2). */
export function bracketSize(n: number) {
  let p = 2;
  while (p < n) p *= 2;
  return p;
}

/**
 * Standard seeding order: position → seed (1-based). Seed 1 meets the
 * lowest seed, and 1 and 2 can only meet in the final.
 *   4 → [1,4,2,3]   8 → [1,8,4,5,2,7,3,6]
 */
export function seedOrder(size: number): number[] {
  let order = [1, 2];
  while (order.length < size) {
    const n = order.length * 2;
    order = order.flatMap((s) => [s, n + 1 - s]);
  }
  return order;
}

/** Seeded slots for these entries (best first); missing seeds become byes. */
export function seedSlots(ids: number[]): (number | null)[] {
  return seedOrder(bracketSize(ids.length)).map((seed) => ids[seed - 1] ?? null);
}

/**
 * Who goes through: returning shows first, then the open round's best that
 * actually got votes, up to `size` in all.
 */
export function qualify(ranking: { id: number; count: number }[], carried: number[], size: number): number[] {
  const out = [...new Set(carried)].slice(0, size);
  for (const r of ranking) {
    if (out.length >= size) break;
    if (r.count > 0 && !out.includes(r.id)) out.push(r.id);
  }
  return out;
}

/** Every match, round by round, with who's in it and how it stands. */
export function deriveRounds(
  slots: (number | null)[],
  results: Record<string, MatchResult>,
  live: string | null = null
): BracketMatch[][] {
  if (slots.length < 2) return [];
  const rounds: BracketMatch[][] = [];
  let feed: (number | null | undefined)[] = slots;
  for (let round = 0; feed.length > 1; round++) {
    const row: BracketMatch[] = [];
    const next: (number | null | undefined)[] = [];
    for (let index = 0; index < feed.length / 2; index++) {
      const a = feed[2 * index];
      const b = feed[2 * index + 1];
      const m = settle(matchKey(round, index), round, index, a, b, results, live);
      row.push(m);
      next.push(m.winner);
    }
    rounds.push(row);
    feed = next;
  }
  return rounds;
}

/** Where one match stands, given who's in it and the results so far. */
function settle(
  key: string,
  round: number,
  index: number,
  a: number | null | undefined,
  b: number | null | undefined,
  results: Record<string, MatchResult>,
  live: string | null
): BracketMatch {
  let status: BracketStatus;
  let winner: number | null | undefined;
  let result: MatchResult | null = null;
  if (a === null && b === null) {
    status = 'empty';
    winner = null;
  } else if ((a === null && b !== undefined) || (b === null && a !== undefined)) {
    // one side has nobody: the other walks through
    status = 'bye';
    winner = a ?? b;
  } else if (a === undefined || b === undefined || a === null || b === null) {
    status = 'waiting';
    winner = undefined;
  } else {
    const r = results[key];
    if (r && r.a === a && r.b === b) {
      result = r;
      status = r.winner === null ? 'tie' : 'done';
      winner = r.winner ?? undefined;
    } else {
      status = key === live ? 'live' : 'ready';
      winner = undefined;
    }
  }
  return { key, round, index, a, b, status, winner, result };
}

/** Who lost a match: undefined while it's undecided, null when nobody did (a bye). */
function loserOf(m: BracketMatch): number | null | undefined {
  if (m.status === 'bye' || m.status === 'empty') return null;
  if (m.status !== 'done') return undefined;
  return m.winner === m.a ? m.b : m.a;
}

/**
 * The third-place match, between the semi-final losers. Playable as soon as
 * both semis are decided – before or after the final, the streamer's call.
 */
export function deriveThird(
  rounds: BracketMatch[][],
  results: Record<string, MatchResult>,
  live: string | null = null
): BracketMatch | null {
  if (rounds.length < 2) return null;
  const semis = rounds[rounds.length - 2];
  return settle(THIRD, rounds.length - 1, 1, loserOf(semis[0]), loserOf(semis[1]), results, live);
}

/** Drop results whose pairing no longer stands (after an edit or undo). */
export function pruneResults(slots: (number | null)[], results: Record<string, MatchResult>) {
  // one pass per round is enough: a stale early result can only invalidate later ones
  let current = results;
  for (let i = 0; i < 8; i++) {
    const valid: Record<string, MatchResult> = {};
    const rounds = deriveRounds(slots, current);
    for (const row of rounds) {
      for (const m of row) if (m.result) valid[m.key] = m.result;
    }
    const third = deriveThird(rounds, current);
    if (third?.result) valid[THIRD] = third.result;
    if (Object.keys(valid).length === Object.keys(current).length) return valid;
    current = valid;
  }
  return current;
}

/** The next match that can be played, in bracket order. */
export function nextReady(rounds: BracketMatch[][]): BracketMatch | null {
  for (const row of rounds) for (const m of row) if (m.status === 'ready') return m;
  return null;
}

export function finalOf(rounds: BracketMatch[][]): BracketMatch | null {
  return rounds.at(-1)?.[0] ?? null;
}

export function championOf(rounds: BracketMatch[][]): number | null {
  const f = finalOf(rounds);
  return f && (f.status === 'done' || f.status === 'bye') && typeof f.winner === 'number' ? f.winner : null;
}

export function runnerUpOf(rounds: BracketMatch[][]): number | null {
  const f = finalOf(rounds);
  const champ = championOf(rounds);
  if (!f || champ === null) return null;
  const other = f.a === champ ? f.b : f.a;
  return typeof other === 'number' ? other : null;
}

export function thirdOf(third: BracketMatch | null): number | null {
  return third && (third.status === 'done' || third.status === 'bye') && typeof third.winner === 'number' ? third.winner : null;
}

/** "Final", "Semi-finals", "Quarter-finals", "Round of 16" … */
export function roundName(round: number, rounds: number) {
  const fromEnd = rounds - 1 - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semi-finals';
  if (fromEnd === 2) return 'Quarter-finals';
  return `Round of ${2 ** (fromEnd + 1)}`;
}
