import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '~/lib/utils';
import AnimatedNumber from './animated-number';
import Confetti, { type ConfettiHandle } from './confetti';
import Cover from './cover';

// Two-option shortlist poll: a tug of war. Each option owns its side of the
// screen; the split follows the vote share, so the side that's winning
// literally pushes the other one away. At the end the winner takes it all.

const SIDE_COLORS = ['#7c5cff', '#ff4d6d'] as const;
// neither side ever drops below a fifth of the screen
const CLAMP = [20, 80] as const;

function useBump(count: number) {
  const prev = useRef(count);
  const [bump, setBump] = useState<{ n: number; k: number } | null>(null);
  useEffect(() => {
    if (count > prev.current) setBump({ n: count - prev.current, k: Date.now() });
    prev.current = count;
  }, [count]);
  useEffect(() => {
    if (!bump) return;
    const t = setTimeout(() => setBump(null), 900);
    return () => clearTimeout(t);
  }, [bump]);
  return bump;
}

function Side({
  entry,
  side,
  share,
  total,
  state,
}: {
  entry: PublicEntry;
  side: 0 | 1;
  share: number; // 0..100 of the screen this side owns
  total: number;
  state: 'live' | 'winner' | 'loser' | 'tie';
}) {
  const color = entry.color ?? SIDE_COLORS[side];
  const pct = total ? Math.round((entry.count / total) * 100) : 50;
  const bump = useBump(entry.count);
  const lead = share > 50;
  return (
    <div className={cn('relative flex h-full min-w-0 items-center overflow-hidden', side === 0 ? 'justify-center' : 'justify-center')}>
      {/* the show's art, blurred, tinted with its colour */}
      {entry.cover && (
        <motion.div
          className="absolute inset-0 bg-cover bg-center"
          style={{ backgroundImage: `url('${entry.cover}')`, filter: 'blur(40px) saturate(1.4)' }}
          animate={{ opacity: state === 'loser' ? 0.15 : 0.45, scale: 1.3 }}
        />
      )}
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(${side === 0 ? '90deg' : '270deg'}, ${color}55, transparent 70%), radial-gradient(circle at 50% 50%, transparent 30%, #07060dcc 100%)`,
        }}
      />
      <motion.div
        // centred in the space below the fixed top bar
        className="relative flex flex-col items-center gap-[1vw] px-[2vw] pt-[6vw] text-center"
        animate={{ scale: state === 'winner' ? 1.15 : state === 'loser' ? 0.8 : lead ? 1.05 : 0.95 }}
        transition={{ type: 'spring', stiffness: 120, damping: 18 }}
      >
        <div className="relative">
          <Cover
            entry={entry}
            className="aspect-[3/4] w-[min(14vw,32vh)] rounded-[1.2vw] shadow-2xl shadow-black/70"
          />
          <div
            className="absolute -top-[1vw] grid h-[3.4vw] w-[3.4vw] place-items-center rounded-full text-[1.7vw] font-black text-white shadow-xl"
            style={{ background: color, [side === 0 ? 'left' : 'right']: '-1vw' } as React.CSSProperties}
          >
            {entry.option ?? side + 1}
          </div>
          <AnimatePresence>
            {bump && (
              <motion.span
                key={bump.k}
                initial={{ opacity: 0, y: 10, scale: 0.6 }}
                animate={{ opacity: 1, y: -30, scale: 1 }}
                exit={{ opacity: 0, y: -50 }}
                transition={{ duration: 0.6 }}
                className="absolute -top-[2vw] left-1/2 -translate-x-1/2 rounded-full bg-white px-[0.7vw] py-[0.15vw] text-[1vw] font-black"
                style={{ color }}
              >
                +{bump.n}
              </motion.span>
            )}
          </AnimatePresence>
        </div>
        <div className="max-w-[28vw]">
          <div className="line-clamp-2 text-[1.8vw] leading-tight font-black text-white drop-shadow-lg">{entry.title}</div>
          {entry.subtitle && <div className="truncate text-[1vw] text-white/60">{entry.subtitle}</div>}
        </div>
        <div className="flex items-baseline gap-[0.6vw]">
          <AnimatedNumber value={entry.count} className="text-[5vw] leading-none font-black text-white tabular-nums drop-shadow-xl" />
          <span className="text-[1.6vw] font-bold tabular-nums" style={{ color }}>
            {pct}%
          </span>
        </div>
        {state === 'live' && (
          <div className="rounded-full bg-white/10 px-[1vw] py-[0.3vw] text-[0.95vw] text-white/80 backdrop-blur">
            type <b className="text-white">{entry.option ?? side + 1}</b> or the title
          </div>
        )}
        {state === 'winner' && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.6 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            transition={{ delay: 0.4, type: 'spring', stiffness: 200, damping: 12 }}
            className="live-gold text-[3.5vw] leading-none font-black tracking-[0.12em]"
          >
            WINNER
          </motion.div>
        )}
      </motion.div>
    </div>
  );
}

export default function Versus({ snap, final = false }: { snap: PublicSnapshot; final?: boolean }) {
  // fixed sides by option number – the board shouldn't flip when the lead changes
  const [a, b] = [...snap.ranking].sort((x, y) => (x.option ?? 0) - (y.option ?? 0));
  const total = (a?.count ?? 0) + (b?.count ?? 0);
  const rawShare = total ? (a.count / total) * 100 : 50;
  const share = Math.min(CLAMP[1], Math.max(CLAMP[0], rawShare));
  const tie = a && b && a.count === b.count;
  const winner = !final || tie ? null : a.count > b.count ? 0 : 1;

  // finale: a beat of suspense, then the winner pushes the loser off screen
  const [revealed, setRevealed] = useState(false);
  const confetti = useRef<ConfettiHandle>(null);
  useEffect(() => {
    setRevealed(false);
    if (!final) return;
    const t = setTimeout(() => {
      setRevealed(true);
      if (winner !== null) {
        const w = winner === 0 ? a : b;
        confetti.current?.burst(['#f5c542', '#ffffff', w.color ?? SIDE_COLORS[winner]]);
      }
    }, 1600);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [final, snap.endedAt]);

  if (!a || !b) return null;
  const leftWidth = final && revealed && winner !== null ? (winner === 0 ? 100 : 0) : share;
  const stateOf = (i: 0 | 1): 'live' | 'winner' | 'loser' | 'tie' =>
    !final ? 'live' : !revealed ? 'live' : tie ? 'tie' : winner === i ? 'winner' : 'loser';

  return (
    <div className="relative flex h-full w-full overflow-hidden">
      <Confetti ref={confetti} />
      <motion.div
        className="relative h-full shrink-0"
        animate={{ width: `${leftWidth}%` }}
        transition={{ type: 'spring', stiffness: final && revealed ? 60 : 90, damping: final && revealed ? 14 : 20 }}
      >
        <Side entry={a} side={0} share={leftWidth} total={total} state={stateOf(0)} />
      </motion.div>
      <div className="relative h-full min-w-0 flex-1">
        <Side entry={b} side={1} share={100 - leftWidth} total={total} state={stateOf(1)} />
      </div>

      {/* the front line + VS medallion riding it */}
      <motion.div
        className="pointer-events-none absolute inset-y-0 z-10 w-0"
        animate={{ left: `${leftWidth}%`, opacity: final && revealed && winner !== null ? 0 : 1 }}
        transition={{ type: 'spring', stiffness: 90, damping: 20 }}
      >
        <div
          className="absolute inset-y-0 -left-[2px] w-[4px]"
          style={{ background: 'linear-gradient(180deg, transparent, #fff 20%, #fff 80%, transparent)', boxShadow: '0 0 30px 6px #ffffff88' }}
        />
        <motion.div
          key={total}
          initial={{ scale: 1.25 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 12 }}
          className="absolute top-1/2 left-0 grid h-[6vw] w-[6vw] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full border-[0.25vw] border-white bg-[#07060d] text-[2.2vw] font-black text-white italic shadow-[0_0_40px_10px_rgba(255,255,255,0.35)]"
        >
          VS
        </motion.div>
      </motion.div>

      {final && (
        <AnimatePresence>
          {!revealed && (
            <motion.div
              className="absolute inset-0 z-20 grid place-items-center bg-black/40 backdrop-blur-sm"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <motion.span
                animate={{ scale: [1, 1.08, 1] }}
                transition={{ repeat: Infinity, duration: 0.5 }}
                className="text-[4vw] font-black text-white"
              >
                POLL CLOSED
              </motion.span>
            </motion.div>
          )}
          {revealed && tie && (
            <motion.div
              className="absolute inset-x-0 top-[6%] z-20 text-center"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
            >
              <span className="live-gold text-[4vw] font-black tracking-[0.12em]">IT’S A TIE</span>
            </motion.div>
          )}
        </AnimatePresence>
      )}
    </div>
  );
}
