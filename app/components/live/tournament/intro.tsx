import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { matchLabel } from '~/lib/tournament';
import Cover from '../cover';
import { T_COVER } from './ids';

// Fighting-game "A vs B" card before a match opens: the two sides slam in
// along a diagonal, VS hits with a flash and a shake, then a bar counts
// down to the vote. Covers carry a shared id, so they fly in from the
// bracket and on into the voting screen.

const INTRO_MS = 5200; // matches the controller's intro length
const COLORS = ['#7c5cff', '#ff4d6d'] as const;

export default function IntroScreen({ t, m }: { t: PublicTournament; m: PublicMatch }) {
  const live = t.live?.key === m.key && t.live.stage === 'intro' ? t.live : null;
  if (!m.a || !m.b) return null;
  const sides = [m.a, m.b] as const;
  return (
    <motion.div
      className="relative h-full w-full overflow-hidden bg-[#07060d]"
      // the impact shake when VS lands
      animate={{ x: [0, 0, -14, 12, -8, 5, 0] }}
      transition={{ duration: 0.5, delay: 0.55, times: [0, 0.01, 0.2, 0.4, 0.6, 0.8, 1] }}
    >
      {sides.map((e, i) => (
        <Panel key={e.id} entry={e} side={i as 0 | 1} />
      ))}

      {/* the split: a white-hot diagonal that draws itself */}
      <motion.div
        className="pointer-events-none absolute top-[-10%] left-1/2 z-10 h-[120%] w-[0.5vw] -translate-x-1/2 rotate-[9deg] bg-white"
        style={{ boxShadow: '0 0 3vw 1vw #ffffffaa, 0 0 8vw 2vw #a78bfa88' }}
        initial={{ scaleY: 0 }}
        animate={{ scaleY: 1 }}
        transition={{ duration: 0.35, delay: 0.35, ease: 'easeOut' }}
      />

      {sides.map((e, i) => (
        <Fighter key={e.id} entry={e} side={i as 0 | 1} />
      ))}

      {/* VS */}
      <motion.div
        className="absolute top-1/2 left-1/2 z-30 -translate-x-1/2 -translate-y-1/2"
        initial={{ scale: 5, opacity: 0, rotate: -12 }}
        animate={{ scale: 1, opacity: 1, rotate: -6 }}
        transition={{ delay: 0.45, duration: 0.25, ease: [0.5, 0, 0.75, 0] }}
      >
        <span
          className="block text-[13vw] leading-none font-black tracking-tighter italic"
          style={{
            background: 'linear-gradient(180deg,#fff 0%,#ffe9a3 45%,#f5c542 55%,#b8860b 100%)',
            WebkitBackgroundClip: 'text',
            color: 'transparent',
            WebkitTextStroke: '0.25vw #07060d',
            filter: 'drop-shadow(0 0 2vw rgba(245,197,66,.6)) drop-shadow(0 1vw 1vw rgba(0,0,0,.6))',
          }}
        >
          VS
        </span>
      </motion.div>

      {/* impact flash */}
      <motion.div
        className="pointer-events-none absolute inset-0 z-40 bg-white"
        initial={{ opacity: 0 }}
        animate={{ opacity: [0, 0.85, 0] }}
        transition={{ delay: 0.62, duration: 0.45, times: [0, 0.15, 1] }}
      />

      {/* match banner */}
      <motion.div
        className="absolute inset-x-0 top-[7.6vw] z-30 flex justify-center"
        initial={{ y: -40, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.9, type: 'spring', stiffness: 260, damping: 20 }}
      >
        <span className="skew-x-[-12deg] bg-white px-[2vw] py-[0.4vw] text-[1.6vw] font-black tracking-[0.3em] text-black uppercase shadow-2xl">
          {matchLabel(m.key, t.rounds.length)}
        </span>
      </motion.div>

      <Countdown at={live?.at ?? null} />
    </motion.div>
  );
}

function Panel({ entry, side }: { entry: PublicEntry; side: 0 | 1 }) {
  const color = entry.color ?? COLORS[side];
  // two halves cut along a slanted line
  const clip = side === 0 ? 'polygon(0 0, 58% 0, 42% 100%, 0 100%)' : 'polygon(58% 0, 100% 0, 100% 100%, 42% 100%)';
  return (
    <motion.div
      className="absolute inset-0"
      style={{ clipPath: clip }}
      initial={{ x: side === 0 ? '-55%' : '55%' }}
      animate={{ x: 0 }}
      transition={{ type: 'spring', stiffness: 140, damping: 22 }}
    >
      {entry.cover && (
        <div
          className="absolute inset-0 scale-125 bg-cover bg-center"
          style={{ backgroundImage: `url('${entry.cover}')`, filter: 'blur(30px) saturate(1.6) brightness(.7)' }}
        />
      )}
      <div
        className="absolute inset-0"
        style={{ background: `linear-gradient(${side === 0 ? '100deg' : '260deg'}, ${color}cc 0%, ${color}33 45%, #07060dee 100%)` }}
      />
      {/* speed lines */}
      <motion.div
        className="absolute inset-0 opacity-25 mix-blend-overlay"
        style={{
          backgroundImage: 'repeating-linear-gradient(100deg, transparent 0 2.2vw, rgba(255,255,255,.5) 2.2vw 2.35vw)',
          backgroundSize: '200% 100%',
        }}
        animate={{ backgroundPositionX: side === 0 ? ['0%', '100%'] : ['100%', '0%'] }}
        transition={{ repeat: Infinity, duration: 1.4, ease: 'linear' }}
      />
    </motion.div>
  );
}

function Fighter({ entry, side }: { entry: PublicEntry; side: 0 | 1 }) {
  const color = entry.color ?? COLORS[side];
  const left = side === 0;
  return (
    <div
      className={`absolute top-0 bottom-0 z-20 flex w-1/2 flex-col justify-center gap-[1.4vw] pt-[6vw] ${
        left ? 'left-0 items-start pl-[7vw]' : 'right-0 items-end pr-[7vw]'
      }`}
    >
      <div className="relative">
        <Cover
          entry={entry}
          layoutId={`${T_COVER}${entry.id}`}
          className={`aspect-[3/4] h-[52vh] rounded-[1.4vw] shadow-[0_2vw_4vw_rgba(0,0,0,.7)] ring-[0.3vw] ring-white/80 ${left ? 'rotate-[-4deg]' : 'rotate-[4deg]'}`}
        />
        <motion.span
          className={`absolute -top-[1.4vw] grid h-[4.4vw] w-[4.4vw] place-items-center rounded-full text-[2.4vw] font-black text-white shadow-2xl ring-[0.3vw] ring-white ${left ? '-left-[1.4vw]' : '-right-[1.4vw]'}`}
          style={{ background: color }}
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ delay: 1.1, type: 'spring', stiffness: 400, damping: 14 }}
        >
          {side + 1}
        </motion.span>
      </div>
      <motion.div
        className={`max-w-[34vw] ${left ? 'text-left' : 'text-right'}`}
        initial={{ x: left ? -120 : 120, opacity: 0 }}
        animate={{ x: 0, opacity: 1 }}
        transition={{ delay: 0.75, type: 'spring', stiffness: 200, damping: 18 }}
      >
        <div
          className="line-clamp-2 skew-x-[-8deg] text-[3.4vw] leading-[0.95] font-black tracking-tight uppercase italic"
          style={{ textShadow: `0 0.3vw 0 ${color}, 0 0.6vw 1.6vw rgba(0,0,0,.8)` }}
        >
          {entry.title}
        </div>
        {entry.subtitle && <div className="mt-[0.4vw] truncate text-[1.1vw] font-semibold text-white/70">{entry.subtitle}</div>}
      </motion.div>
    </div>
  );
}

/** "Voting opens in…" bar while the intro runs on its own. */
function Countdown({ at }: { at: number | null }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!at) return;
    const i = setInterval(() => setNow(Date.now()), 100);
    return () => clearInterval(i);
  }, [at]);
  if (!at) return null;
  const left = Math.max(0, INTRO_MS - (now - at));
  return (
    <motion.div
      className="absolute inset-x-[30vw] bottom-[3vw] z-30 flex flex-col items-center gap-[0.6vw]"
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 1.2 }}
    >
      <span className="rounded-full bg-black/60 px-[1.2vw] py-[0.3vw] text-[1vw] font-bold tracking-[0.35em] text-white/90 uppercase backdrop-blur">
        Voting opens in {Math.ceil(left / 1000)}
      </span>
      <div className="h-[0.4vw] w-full overflow-hidden rounded-full bg-white/15">
        <div className="h-full rounded-full bg-white transition-[width] duration-100 ease-linear" style={{ width: `${(left / INTRO_MS) * 100}%` }} />
      </div>
    </motion.div>
  );
}
