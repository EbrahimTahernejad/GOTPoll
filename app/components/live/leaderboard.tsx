import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '~/lib/utils';
import AnimatedNumber from './animated-number';
import Cover from './cover';

export const MEDAL = ['#f5c542', '#d7dde5', '#d4935a'] as const;
const SPRING = { type: 'spring', stiffness: 420, damping: 38, mass: 0.9 } as const;

/**
 * Counts update live, but positions only re-sort every `ms`. Chat bursts would
 * otherwise reshuffle rows several times a second – this reads like a
 * broadcast scoreboard instead of a slot machine.
 */
function useCalmOrder(ranking: PublicEntry[], ms = 1200) {
  const [order, setOrder] = useState<number[]>(() => ranking.map((r) => r.id));
  const last = useRef(0);

  useEffect(() => {
    const ids = ranking.map((r) => r.id);
    const apply = () => {
      last.current = Date.now();
      setOrder((cur) => (cur.join() === ids.join() ? cur : ids));
    };
    const wait = ms - (Date.now() - last.current);
    if (wait <= 0) {
      apply();
      return;
    }
    const t = setTimeout(apply, wait);
    return () => clearTimeout(t);
  }, [ranking, ms]);

  const byId = new Map(ranking.map((r) => [r.id, r]));
  const shown = order.flatMap((id) => byId.get(id) ?? []);
  for (const r of ranking) if (!order.includes(r.id)) shown.push(r);
  return shown;
}

/** Remembers where each show was last time, to animate rank changes. */
function useMovement(ranking: PublicEntry[]) {
  const prevRanks = useRef(new Map<number, number>());
  const [moves, setMoves] = useState(new Map<number, { delta: number; at: number }>());

  useEffect(() => {
    const next = new Map(moves);
    let changed = false;
    ranking.forEach((r, i) => {
      const before = prevRanks.current.get(r.id);
      if (before !== undefined && before !== i) {
        next.set(r.id, { delta: before - i, at: Date.now() });
        changed = true;
      }
    });
    prevRanks.current = new Map(ranking.map((r, i) => [r.id, i]));
    if (changed) setMoves(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ranking]);

  // forget arrows after a few seconds
  useEffect(() => {
    if (!moves.size) return;
    const t = setTimeout(() => {
      const now = Date.now();
      setMoves((m) => new Map([...m].filter(([, v]) => now - v.at < 3500)));
    }, 3600);
    return () => clearTimeout(t);
  }, [moves]);

  return moves;
}

/** "+3" that floats up whenever a count grows. */
function Bump({ count, className }: { count: number; className?: string }) {
  const prev = useRef(count);
  const [bump, setBump] = useState<{ n: number; k: number } | null>(null);
  useEffect(() => {
    if (count > prev.current) setBump({ n: count - prev.current, k: Date.now() });
    prev.current = count;
  }, [count]);
  useEffect(() => {
    if (!bump) return;
    const t = setTimeout(() => setBump(null), 1100);
    return () => clearTimeout(t);
  }, [bump]);
  return (
    <AnimatePresence>
      {bump && (
        <motion.span
          key={bump.k}
          initial={{ opacity: 0, y: 8, scale: 0.7 }}
          animate={{ opacity: 1, y: -18, scale: 1 }}
          exit={{ opacity: 0, y: -30 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          className={cn(
            'pointer-events-none absolute rounded-full bg-emerald-400 px-[0.5vw] py-[0.1vw] text-[0.75vw] font-bold text-emerald-950 shadow-lg shadow-emerald-500/30',
            className ?? '-top-[1.2vw] left-0'
          )}
        >
          +{bump.n}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

function Move({ move }: { move?: { delta: number; at: number } }) {
  return (
    <AnimatePresence mode="wait">
      {move && move.delta !== 0 && (
        <motion.span
          key={`${move.at}`}
          initial={{ opacity: 0, x: -6 }}
          animate={{ opacity: 1, x: 0 }}
          exit={{ opacity: 0 }}
          className={cn(
            'text-[0.62em] font-bold tabular-nums',
            move.delta > 0 ? 'text-emerald-400' : 'text-rose-400'
          )}
        >
          {move.delta > 0 ? '▲' : '▼'}
          {Math.abs(move.delta)}
        </motion.span>
      )}
    </AnimatePresence>
  );
}

function HeroCard({
  entry,
  rank,
  total,
  move,
}: {
  entry: PublicEntry;
  rank: number;
  total: number;
  move?: { delta: number; at: number };
}) {
  const medal = MEDAL[rank];
  const pct = total ? Math.round((entry.count / total) * 100) : 0;
  const lead = rank === 0;
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 40, scale: 0.92 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9, filter: 'blur(8px)' }}
      transition={SPRING}
      className={cn(
        'relative flex min-w-0 gap-[1.1vw] overflow-hidden rounded-[1.4vw] border border-white/10 bg-white/[0.045] p-[0.9vw] backdrop-blur-xl',
        lead && 'live-leader'
      )}
      style={{ ['--medal' as string]: medal }}
    >
      {/* the show's own colour bleeding in from the cover side */}
      <div
        className="pointer-events-none absolute inset-0 opacity-30"
        style={{ background: `radial-gradient(circle at 0% 50%, ${entry.color ?? medal}66, transparent 60%)` }}
      />
      <div className="relative shrink-0">
        <Cover
          entry={entry}
          layoutId={`cover-${entry.id}`}
          className={cn(
            'aspect-[3/4] rounded-[0.9vw] shadow-2xl shadow-black/60',
            lead ? 'w-[10.5vw]' : 'w-[8.5vw]'
          )}
        />
        <div
          className="absolute -top-[0.5vw] -left-[0.5vw] grid h-[2.6vw] w-[2.6vw] place-items-center rounded-full text-[1.25vw] font-black text-black shadow-xl"
          style={{ background: `radial-gradient(circle at 30% 30%, #fff8, transparent 60%), ${medal}` }}
        >
          {rank + 1}
        </div>
      </div>
      <div className="relative flex min-w-0 flex-1 flex-col py-[0.2vw]">
        <div className={cn('line-clamp-2 leading-tight font-bold text-white', lead ? 'text-[1.45vw]' : 'text-[1.15vw]')}>
          {entry.title}
        </div>
        {entry.subtitle && <div className="truncate text-[0.8vw] text-white/55">{entry.subtitle}</div>}
        <div className="mt-auto flex items-end justify-between gap-2">
          <div className="relative flex items-baseline gap-[0.4vw]">
            <AnimatedNumber
              value={entry.count}
              className={cn('leading-none font-black tabular-nums text-white', lead ? 'text-[3.4vw]' : 'text-[2.6vw]')}
            />
            <span className="text-[0.75vw] tracking-widest text-white/50 uppercase">votes</span>
            <Bump count={entry.count} />
          </div>
          <div className="flex flex-col items-end gap-[0.2vw]">
            <Move move={move} />
            <span className="text-[1.1vw] font-semibold tabular-nums" style={{ color: medal }}>
              {pct}%
            </span>
          </div>
        </div>
        <div className="mt-[0.6vw] h-[0.35vw] overflow-hidden rounded-full bg-white/10">
          <motion.div
            className="h-full rounded-full"
            style={{ background: `linear-gradient(90deg, ${medal}, #fff)` }}
            animate={{ width: `${Math.max(3, pct)}%` }}
            transition={{ type: 'spring', stiffness: 120, damping: 24 }}
          />
        </div>
      </div>
    </motion.div>
  );
}

function Row({
  entry,
  rank,
  leader,
  move,
}: {
  entry: PublicEntry;
  rank: number;
  leader: number;
  move?: { delta: number; at: number };
}) {
  const width = leader ? (entry.count / leader) * 100 : 0;
  return (
    <motion.li
      layout
      initial={{ opacity: 0, x: -30 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: 30, transition: { duration: 0.25 } }}
      transition={SPRING}
      className="relative flex items-center gap-[0.8vw] overflow-hidden rounded-[0.8vw] border border-white/[0.07] bg-white/[0.035] py-[0.45vw] pr-[1vw] pl-[0.6vw]"
    >
      <motion.div
        className="absolute inset-y-0 left-0 -z-0 bg-gradient-to-r from-violet-500/25 via-fuchsia-500/15 to-transparent"
        animate={{ width: `${width}%` }}
        transition={{ type: 'spring', stiffness: 120, damping: 24 }}
      />
      <span className="relative w-[2.2vw] text-center text-[1.15vw] font-black text-white/40 tabular-nums">
        {rank + 1}
      </span>
      <Cover entry={entry} layoutId={`cover-${entry.id}`} className="relative h-[3vw] w-[3vw] shrink-0 rounded-[0.5vw]" />
      <div className="relative min-w-0 flex-1">
        <div className="truncate text-[1vw] font-semibold text-white">{entry.title}</div>
        {entry.subtitle && <div className="truncate text-[0.72vw] text-white/45">{entry.subtitle}</div>}
      </div>
      <Move move={move} />
      <span className="relative flex items-baseline gap-1">
        <AnimatedNumber value={entry.count} className="text-[1.35vw] font-extrabold text-white tabular-nums" />
        <Bump count={entry.count} className="right-full top-[0.3vw] mr-[0.5vw]" />
      </span>
    </motion.li>
  );
}

export default function Leaderboard({ snap }: { snap: PublicSnapshot }) {
  const ranking = useCalmOrder(snap.ranking);
  const moves = useMovement(ranking);
  const top = ranking.slice(0, 3);
  const rest = ranking.slice(3, 15);
  const leader = ranking[0]?.count ?? 0;

  return (
    <LayoutGroup>
      <div className="grid grid-cols-[1.25fr_1fr_1fr] gap-[1.4vw]">
        <AnimatePresence mode="popLayout">
          {top.map((e, i) => (
            <HeroCard key={e.id} entry={e} rank={i} total={snap.totalVotes} move={moves.get(e.id)} />
          ))}
        </AnimatePresence>
      </div>
      {rest.length > 0 && (
        <ul className="mt-[1.4vw] grid grid-flow-col grid-cols-2 grid-rows-6 gap-x-[1.6vw] gap-y-[0.5vw]">
          <AnimatePresence mode="popLayout">
            {rest.map((e, i) => (
              <Row key={e.id} entry={e} rank={i + 3} leader={leader} move={moves.get(e.id)} />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </LayoutGroup>
  );
}
