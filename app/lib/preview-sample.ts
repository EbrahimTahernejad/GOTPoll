import { useEffect, useMemo, useState } from 'react';

// The viewer page in preview mode (?preview=board|final|versus|bracket|coin|
// draw|other): one screen built from sample titles – the catalog's
// best-known, real covers – for the app's Layout dialog. Room for the
// streamer's overlay and the board size come from the dialog as it moves
// the sliders (postMessage), so the preview follows them live.

export type PreviewKind = 'board' | 'final' | 'versus' | 'bracket' | 'coin' | 'draw' | 'other';

type Sample = { base: PublicSnapshot; entries: PublicEntry[]; /** when it came – one time for every rebuild, so the 3D screens don't restart */ at: number };
type LayoutMessage = { gotpoll: 'layout'; kind?: PreviewKind; freeSpace: ViewerFreeSpace; liveRows: number; liveColumns: number };

export function previewKind(): PreviewKind | null {
  if (typeof location === 'undefined') return null;
  const k = new URLSearchParams(location.search).get('preview');
  return k && ['board', 'final', 'versus', 'bracket', 'coin', 'draw', 'other'].includes(k) ? (k as PreviewKind) : null;
}

/** A snapshot for the preview, rebuilt when the dialog sends new layout values. */
export function usePreviewFeed(initial: PreviewKind | null): PublicSnapshot | null {
  // the dialog switches screens by message – one page, no reloads
  const [kind, setKind] = useState(initial);
  const [sample, setSample] = useState<Sample | null>(null);
  const [layout, setLayout] = useState<Omit<LayoutMessage, 'gotpoll'> | null>(null);
  useEffect(() => {
    if (!initial) return;
    fetch('/api/preview-sample')
      .then((r) => r.json())
      .then((x: Omit<Sample, 'at'>) => setSample({ ...x, at: Date.now() }))
      .catch(() => {});
    const onMessage = (e: MessageEvent) => {
      // only the app window that embeds this page, and only layout values
      if (e.source !== window.parent || (e.data as LayoutMessage)?.gotpoll !== 'layout') return;
      const { kind: next, freeSpace, liveRows, liveColumns } = e.data as LayoutMessage;
      if (next) setKind(next);
      setLayout({ freeSpace, liveRows, liveColumns });
    };
    window.addEventListener('message', onMessage);
    // listening now: ask the app's dialog for the current values
    if (window.parent !== window) window.parent.postMessage({ gotpoll: 'preview-ready' }, '*');
    return () => window.removeEventListener('message', onMessage);
  }, [initial]);
  // built once per change – the 3D screens restart whenever their tournament object does
  return useMemo(() => (kind && sample ? build(kind, sample, layout) : null), [kind, sample, layout]);
}

function build(kind: PreviewKind, { base, entries, at: now }: Sample, layout: Omit<LayoutMessage, 'gotpoll'> | null): PublicSnapshot {
  const e = (i: number, count?: number): PublicEntry => {
    const x = entries[i % Math.max(1, entries.length)];
    return { ...x, count: count ?? x.count };
  };
  const snap: PublicSnapshot = {
    ...base,
    ...(layout ?? {}),
    state: 'running',
    mode: 'open',
    startedAt: now - 95_000,
    endedAt: null,
    tournament: null,
  };
  const ranking = (n: number) => Array.from({ length: Math.min(n, entries.length) }, (_, i) => e(i));
  const total = (r: PublicEntry[]) => r.reduce((n, x) => n + x.count, 0);

  if (kind === 'board') {
    const r = ranking(snap.liveRows ?? 15);
    return { ...snap, ranking: r, totalVotes: total(r), totalVoters: total(r) };
  }
  if (kind === 'final') {
    const r = ranking(12);
    return { ...snap, state: 'ended', endedAt: now, ranking: r, totalVotes: total(r), totalVoters: total(r) };
  }
  if (kind === 'versus') {
    // votes per chat, keyed by the streamer's own channels
    const ids = base.channels.map((c) => c.id);
    const split = (...n: number[]) => Object.fromEntries(ids.map((id, i) => [id, n[i % n.length]]));
    const r = [
      { ...e(0, 34), option: 1, breakdown: split(18, 9, 7) },
      { ...e(1, 27), option: 2, breakdown: split(12, 10, 5) },
    ];
    return { ...snap, mode: 'shortlist', ranking: r, totalVotes: 61, totalVoters: 61 };
  }

  // the tournament screens: an 8-show bracket part-way through
  const show = (i: number) => e(i);
  const match = (round: number, index: number, a: number | null, b: number | null, extra: Partial<PublicMatch> = {}): PublicMatch => ({
    key: `${round}-${index}`,
    round,
    index,
    a: a === null ? null : show(a),
    b: b === null ? null : show(b),
    status: 'ready',
    winner: null,
    votes: null,
    breakdown: null,
    coin: false,
    manual: false,
    ...extra,
  });
  const done = (votes: [number, number], winner: number) => ({ status: 'done' as const, votes, winner: show(winner).id });
  const rounds: PublicMatch[][] = [
    [
      match(0, 0, 0, 7, done([41, 18], 0)),
      match(0, 1, 3, 4, { ...done([22, 22], 3), coin: true }),
      match(0, 2, 1, 6, done([37, 25], 1)),
      match(0, 3, 2, 5, done([29, 31], 5)),
    ],
    [match(1, 0, 0, 3, { status: 'live', votes: [14, 11] }), match(1, 1, 1, 5)],
    [match(2, 0, null, null, { status: 'waiting' })],
  ];
  const standings = ranking(10);
  const t: PublicTournament = {
    id: 'preview',
    title: base.title,
    archived: false,
    createdAt: now - 3_600_000,
    finishedAt: null,
    openVotes: total(standings),
    phase: 'bracket',
    screen: 'bracket',
    size: 8,
    qualifySpots: 8,
    carried: [],
    standings,
    allStandings: standings,
    removed: [],
    qualified: standings.slice(0, 8).map((x) => x.id),
    tied: [],
    cut: null,
    coin: null,
    rounds,
    third: null,
    live: null,
    focus: null,
    champion: null,
    runnerUp: null,
    thirdPlace: null,
  };
  if (kind === 'bracket') return { ...snap, tournament: t };
  if (kind === 'coin') return { ...snap, tournament: { ...t, screen: 'coin', coin: { key: '0-1', at: now, winner: show(3).id } } };
  if (kind === 'draw') {
    const candidates = [show(7), show(8), show(9), show(10)];
    return {
      ...snap,
      tournament: {
        ...t,
        phase: 'open-results',
        screen: 'draw',
        rounds: [],
        cut: { candidates, votes: 9, slots: 1, picked: [candidates[1].id], method: 'draw', at: now },
      },
    };
  }
  // other: the qualifiers screen
  return { ...snap, state: 'ended', tournament: { ...t, phase: 'open-results', screen: 'open-results', rounds: [] } };
}
