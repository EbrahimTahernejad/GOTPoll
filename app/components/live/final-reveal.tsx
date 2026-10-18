import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { cn } from '~/lib/utils';
import AnimatedNumber from './animated-number';
import Confetti, { type ConfettiHandle } from './confetti';
import Cover from './cover';
import { MEDAL } from './leaderboard';

// The reveal is a little show in steps:
//   0 "POLL CLOSED" slams in
//   1 totals
//   2 third place rises      3 second place rises
//   4 drumroll               5 WINNER + confetti
//   6 the rest of the standings
const TIMELINE = [0, 1500, 2700, 3900, 5200, 6600, 8800];

export default function FinalReveal({
  snap,
  onWinner,
}: {
  snap: PublicSnapshot;
  onWinner?: (entry: PublicEntry | null) => void;
}) {
  const [run, setRun] = useState(0);
  const [step, setStep] = useState(0);
  const confetti = useRef<ConfettiHandle>(null);
  const voted = snap.ranking.filter((r) => r.count > 0);
  const [first, second, third] = voted;
  const rest = voted.slice(3, 9);

  useEffect(() => {
    setStep(0);
    onWinner?.(null);
    const timers = TIMELINE.map((ms, i) => setTimeout(() => setStep(i), ms));
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run]);

  useEffect(() => {
    if (step === 5 && first) {
      onWinner?.(first);
      confetti.current?.burst(['#f5c542', '#ffe9a3', '#ffffff', first.color ?? '#ff5d8f', '#7c5cff']);
      const t = setTimeout(() => confetti.current?.burst(), 1400);
      return () => clearTimeout(t);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  // "R" replays the reveal – handy when the stream missed it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key.toLowerCase() === 'r') setRun((r) => r + 1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="relative flex flex-1 flex-col items-center">
      <Confetti ref={confetti} />

      {/* headline */}
      <div className="relative h-[6.5vw] w-full">
        <AnimatePresence mode="wait">
          {step < 4 ? (
            <motion.div
              key="closed"
              className="absolute inset-0 flex flex-col items-center justify-center"
              exit={{ opacity: 0, y: -20, filter: 'blur(10px)' }}
            >
              <motion.h1
                initial={{ scale: 2.4, opacity: 0, filter: 'blur(24px)' }}
                animate={{ scale: 1, opacity: 1, filter: 'blur(0px)' }}
                transition={{ type: 'spring', stiffness: 160, damping: 16 }}
                className="live-shine text-[4vw] leading-none font-black tracking-tight"
              >
                POLL CLOSED
              </motion.h1>
              <motion.p
                initial={{ opacity: 0, y: 10 }}
                animate={step >= 1 ? { opacity: 1, y: 0 } : {}}
                className="mt-[0.5vw] text-[1.1vw] text-white/60"
              >
                <AnimatedNumber value={step >= 1 ? snap.totalVotes : 0} from={0} className="font-bold text-white tabular-nums" />{' '}
                votes from{' '}
                <AnimatedNumber value={step >= 1 ? snap.totalVoters : 0} from={0} className="font-bold text-white tabular-nums" />{' '}
                viewers
              </motion.p>
            </motion.div>
          ) : step === 4 ? (
            <motion.div
              key="drum"
              className="absolute inset-0 flex items-center justify-center"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0, scale: 1.3, filter: 'blur(12px)' }}
            >
              <motion.span
                animate={{ scale: [1, 1.06, 1] }}
                transition={{ repeat: Infinity, duration: 0.45 }}
                className="text-[3.2vw] font-black tracking-tight text-white/90"
              >
                And the winner is…
              </motion.span>
            </motion.div>
          ) : (
            <motion.div
              key="winner"
              className="absolute inset-0 flex items-center justify-center"
              initial={{ opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ type: 'spring', stiffness: 200, damping: 14 }}
            >
              <span className="live-gold text-[4.2vw] leading-none font-black tracking-[0.12em]">WINNER</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      {/* podium: 2 · 1 · 3 */}
      <div className="mt-[0.6vw] grid w-full max-w-[70vw] grid-cols-[1fr_1.25fr_1fr] items-end gap-[2vw]">
        <Podium entry={second} rank={1} show={step >= 3} total={snap.totalVotes} height="6vw" />
        <Podium entry={first} rank={0} show={step >= 5} total={snap.totalVotes} height="8.5vw" />
        <Podium entry={third} rank={2} show={step >= 2} total={snap.totalVotes} height="4vw" />
      </div>

      {/* the rest */}
      <AnimatePresence>
        {step >= 6 && rest.length > 0 && (
          <motion.ol
            initial="hidden"
            animate="show"
            variants={{ show: { transition: { staggerChildren: 0.08 } } }}
            className="mt-[1.2vw] grid w-full max-w-[78vw] grid-cols-3 gap-x-[1.4vw] gap-y-[0.5vw]"
          >
            {rest.map((e, i) => (
              <motion.li
                key={e.id}
                variants={{ hidden: { opacity: 0, y: 16 }, show: { opacity: 1, y: 0 } }}
                className="flex items-center gap-[0.8vw] rounded-[0.8vw] border border-white/[0.07] bg-white/[0.04] px-[0.8vw] py-[0.45vw] backdrop-blur"
              >
                <span className="w-[2vw] text-center text-[1.1vw] font-black text-white/40">{i + 4}</span>
                <Cover entry={e} className="h-[2.6vw] w-[2.6vw] shrink-0 rounded-[0.45vw]" />
                <span className="min-w-0 flex-1 truncate text-[1vw] font-semibold text-white">{e.title}</span>
                <span className="text-[1.1vw] font-bold text-white/80 tabular-nums">{e.count}</span>
              </motion.li>
            ))}
          </motion.ol>
        )}
      </AnimatePresence>

      <div className="absolute right-0 bottom-0 text-[0.7vw] text-white/25">press R to replay</div>
    </div>
  );
}

function Podium({
  entry,
  rank,
  show,
  total,
  height,
}: {
  entry: PublicEntry | undefined;
  rank: number;
  show: boolean;
  total: number;
  height: string;
}) {
  const medal = MEDAL[rank];
  const isWinner = rank === 0;
  return (
    <div className="flex flex-col items-center">
      <div className="relative flex w-full flex-col items-center" style={{ minHeight: isWinner ? '20vw' : '16vw' }}>
        <AnimatePresence>
          {show && entry && (
            <motion.div
              initial={{ opacity: 0, y: 80, scale: 0.8, rotateX: 25 }}
              animate={{ opacity: 1, y: 0, scale: 1, rotateX: 0 }}
              transition={{ type: 'spring', stiffness: 140, damping: 15 }}
              className="mt-auto flex w-full flex-col items-center"
              style={{ perspective: 800 }}
            >
              <div className={cn('relative', isWinner ? 'w-[10.5vw]' : 'w-[8vw]')}>
                {isWinner && (
                  <motion.div
                    className="absolute -inset-[1.6vw] -z-10 rounded-full blur-[3vw]"
                    style={{ background: entry.color ?? medal }}
                    animate={{ opacity: [0.35, 0.7, 0.35], scale: [0.95, 1.05, 0.95] }}
                    transition={{ repeat: Infinity, duration: 2.6 }}
                  />
                )}
                <Cover
                  entry={entry}
                  className={cn(
                    'aspect-[3/4] w-full rounded-[1vw] shadow-2xl shadow-black/70',
                    isWinner && 'live-winner-ring'
                  )}
                />
                {isWinner && (
                  <motion.div
                    initial={{ y: -30, opacity: 0, rotate: -20 }}
                    animate={{ y: 0, opacity: 1, rotate: -8 }}
                    transition={{ delay: 0.25, type: 'spring', stiffness: 260, damping: 12 }}
                    className="absolute -top-[2.4vw] -left-[1.2vw] text-[3.4vw] drop-shadow-[0_4px_12px_rgba(0,0,0,.6)]"
                  >
                    👑
                  </motion.div>
                )}
              </div>
              <div className="mt-[0.8vw] w-full px-[0.5vw] text-center">
                <div className={cn('truncate font-black text-white', isWinner ? 'text-[1.7vw]' : 'text-[1.15vw]')}>
                  {entry.title}
                </div>
                {entry.subtitle && (
                  <div className="truncate text-[0.85vw] text-white/55">{entry.subtitle}</div>
                )}
                <div className="mt-[0.3vw] text-[1vw] text-white/70">
                  <AnimatedNumber
                    value={entry.count}
                    from={0}
                    stiffness={40}
                    damping={18}
                    className="font-black text-white tabular-nums"
                  />{' '}
                  votes · {total ? Math.round((entry.count / total) * 100) : 0}%
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
      <motion.div
        initial={{ height: 0 }}
        animate={{ height: show && entry ? height : '1vw' }}
        transition={{ type: 'spring', stiffness: 90, damping: 16 }}
        className="mt-[0.8vw] flex w-full items-start justify-center overflow-hidden rounded-t-[0.8vw] border border-b-0 border-white/10"
        style={{ background: `linear-gradient(180deg, ${medal}55, ${medal}10 70%, transparent)` }}
      >
        <span className="mt-[0.5vw] text-[2.4vw] leading-none font-black" style={{ color: medal }}>
          {rank + 1}
        </span>
      </motion.div>
    </div>
  );
}
