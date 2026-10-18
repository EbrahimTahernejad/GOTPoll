import { motion } from 'motion/react';
import { Crown } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { roundName } from '~/lib/tournament';
import Confetti, { type ConfettiHandle } from '../confetti';
import Cover from '../cover';
import { T_COVER } from './ids';

// The end: the champion under a crown, rays turning behind it, and the road
// it took to get there.

export default function ChampionScreen({ t }: { t: PublicTournament }) {
  const confetti = useRef<ConfettiHandle>(null);
  const champ = t.champion;

  useEffect(() => {
    if (!champ) return;
    const colors = ['#f5c542', '#ffe9a3', '#ffffff', champ.color ?? '#ff5d8f'];
    const first = setTimeout(() => confetti.current?.burst(colors), 900);
    const again = setInterval(() => confetti.current?.burst(colors), 6000);
    return () => {
      clearTimeout(first);
      clearInterval(again);
    };
  }, [champ]);

  if (!champ) return null;
  const road = t.rounds.flatMap((row) =>
    row.flatMap((m) => {
      if (m.status !== 'done' || m.winner !== champ.id || !m.a || !m.b) return [];
      const mine = m.a.id === champ.id ? 0 : 1;
      const other = mine === 0 ? m.b : m.a;
      return [{ key: m.key, round: m.round, other, us: m.votes?.[mine] ?? 0, them: m.votes?.[1 - mine] ?? 0 }];
    })
  );

  return (
    <div className="relative flex h-full flex-col items-center justify-center pt-[6vw]">
      <Confetti ref={confetti} />
      {/* turning rays */}
      <motion.div
        className="pointer-events-none absolute top-1/2 left-1/2 h-[140vw] w-[140vw] -translate-x-1/2 -translate-y-1/2 opacity-25"
        style={{ background: 'repeating-conic-gradient(from 0deg, #f5c54255 0deg 6deg, transparent 6deg 18deg)', maskImage: 'radial-gradient(circle, #000 0%, transparent 55%)' }}
        animate={{ rotate: 360 }}
        transition={{ repeat: Infinity, duration: 60, ease: 'linear' }}
      />

      <div className="relative flex items-center gap-[4vw]">
        <div className="relative">
          <motion.div
            className="absolute -top-[5.4vw] left-1/2 z-10 -translate-x-1/2 text-amber-300"
            initial={{ y: -80, opacity: 0, rotate: -20 }}
            animate={{ y: 0, opacity: 1, rotate: 0 }}
            transition={{ delay: 0.7, type: 'spring', stiffness: 220, damping: 12 }}
          >
            <Crown className="h-[6vw] w-[6vw] fill-amber-300/40 drop-shadow-[0_0_2vw_rgba(245,197,66,.8)]" />
          </motion.div>
          <Cover
            entry={champ}
            layoutId={`${T_COVER}${champ.id}`}
            className="aspect-[3/4] h-[52vh] rounded-[1.6vw] shadow-[0_0_6vw_1vw_rgba(245,197,66,.45)] ring-[0.35vw] ring-amber-300"
          />
        </div>

        <div className="flex max-w-[42vw] flex-col gap-[1vw]">
          <motion.span
            className="live-gold text-[6vw] leading-none font-black tracking-[0.08em]"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.4, type: 'spring', stiffness: 180, damping: 14 }}
          >
            CHAMPION
          </motion.span>
          <motion.div initial={{ opacity: 0, x: 40 }} animate={{ opacity: 1, x: 0 }} transition={{ delay: 0.9 }}>
            <div className="line-clamp-2 text-[3vw] leading-tight font-black">{champ.title}</div>
            {champ.subtitle && <div className="truncate text-[1.3vw] text-white/60">{champ.subtitle}</div>}
          </motion.div>

          {road.length > 0 && (
            <div className="mt-[1vw] flex flex-col gap-[0.5vw]">
              <span className="text-[0.85vw] font-bold tracking-[0.3em] text-white/45 uppercase">Road to the title</span>
              {road.map((r, i) => (
                <motion.div
                  key={r.key}
                  className="flex items-center gap-[0.8vw] rounded-[0.7vw] bg-white/[0.06] py-[0.35vw] pr-[1vw] pl-[0.35vw] ring-1 ring-white/10"
                  initial={{ opacity: 0, x: 30 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 1.3 + i * 0.15 }}
                >
                  <Cover entry={r.other} className="aspect-square w-[2.2vw] shrink-0 rounded-[0.4vw] opacity-80" />
                  <span className="w-[9vw] shrink-0 text-[0.8vw] font-bold tracking-wider text-white/50 uppercase">
                    {roundName(r.round, t.rounds.length)}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[1vw]">
                    <span className="text-white/45">beat </span>
                    {r.other.title}
                  </span>
                  <span className="text-[1.1vw] font-black tabular-nums">
                    {r.us}
                    <span className="text-white/35">–</span>
                    {r.them}
                  </span>
                </motion.div>
              ))}
            </div>
          )}
          {t.runnerUp && (
            <motion.div
              className="flex items-center gap-[0.6vw] text-[1vw] text-white/60"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 1.6 + road.length * 0.15 }}
            >
              <span className="rounded-full bg-slate-300/20 px-[0.6vw] py-[0.1vw] text-[0.8vw] font-bold tracking-widest text-slate-200">
                RUNNER-UP
              </span>
              {t.runnerUp.title}
              {t.thirdPlace && (
                <>
                  <span className="ml-[1vw] rounded-full bg-[#d4935a]/25 px-[0.6vw] py-[0.1vw] text-[0.8vw] font-bold tracking-widest text-[#f0c09a]">
                    THIRD
                  </span>
                  {t.thirdPlace.title}
                </>
              )}
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}
