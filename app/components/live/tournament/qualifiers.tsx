import { motion } from 'motion/react';
import { Crown } from 'lucide-react';
import { cn } from '~/lib/utils';
import Cover from '../cover';

// Open round results: the top M, revealed from the bottom up. Places inside
// the cut get stamped IN; returning shows stand apart on the left.

export default function QualifiersScreen({ t }: { t: PublicTournament }) {
  const list = t.standings;
  const n = list.length;
  const cols = n <= 5 ? Math.max(n, 1) : n <= 10 ? 5 : n <= 16 ? 8 : 10;
  const rows = Math.max(1, Math.ceil(n / cols));
  // posters shrink with the number of rows so everything fits one screen
  const posterH = `calc((100vh - 19vw) / ${rows} - ${rows > 1 ? 5 : 6}vw)`;
  const step = Math.min(0.18, 2.4 / Math.max(n, 1));

  return (
    <div className="flex h-full flex-col px-[2.4vw] pt-[7.6vw] pb-[1.6vw]">
      <motion.div
        className="mb-[1.4vw] flex items-baseline gap-[1vw]"
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
      >
        <span className="live-shine text-[3vw] leading-none font-black tracking-tight">The qualifiers</span>
        <span className="text-[1.1vw] text-white/50">
          top {t.qualifySpots} of the open round{t.carried.length ? ` + ${t.carried.length} returning` : ''} · {t.size} in the bracket
        </span>
      </motion.div>

      <div className="flex min-h-0 flex-1 gap-[2vw]">
        {t.carried.length > 0 && (
          <div className="flex w-[13vw] shrink-0 flex-col gap-[0.8vw] border-r border-white/10 pr-[2vw]">
            <span className="flex items-center gap-[0.4vw] text-[0.85vw] font-bold tracking-[0.25em] text-amber-300 uppercase">
              <Crown className="h-[1vw] w-[1vw]" /> Returning
            </span>
            {t.carried.map((e, i) => (
              <motion.div
                key={e.id}
                className="flex items-center gap-[0.7vw]"
                initial={{ opacity: 0, x: -30 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.3 + i * 0.1, type: 'spring', stiffness: 200, damping: 20 }}
              >
                <Cover entry={e} className="aspect-[3/4] w-[3.6vw] shrink-0 rounded-[0.5vw] ring-[0.15vw] ring-amber-300/70" />
                <span className="line-clamp-2 text-[0.95vw] leading-tight font-semibold">{e.title}</span>
              </motion.div>
            ))}
          </div>
        )}

        <div className="grid min-h-0 flex-1 content-center gap-x-[1.2vw] gap-y-[1.4vw]" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
          {list.map((e, i) => {
            const inside = i < t.qualifySpots;
            const delay = 0.5 + (n - 1 - i) * step; // last place first, the winner last
            return (
              <motion.div
                key={e.id}
                className="flex min-w-0 flex-col items-center gap-[0.5vw]"
                initial={{ opacity: 0, y: 40, scale: 0.85 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay, type: 'spring', stiffness: 220, damping: 20 }}
              >
                <div className="relative aspect-[3/4] max-w-full" style={{ height: posterH }}>
                  <Cover
                    entry={e}
                    className={cn(
                      'h-full w-full rounded-[0.9vw] shadow-2xl shadow-black/60',
                      inside ? 'ring-[0.2vw] ring-emerald-400/80' : 'opacity-55 grayscale'
                    )}
                  />
                  <span
                    className="absolute -top-[0.6vw] -left-[0.6vw] grid h-[2.2vw] w-[2.2vw] place-items-center rounded-full bg-white text-[1.1vw] font-black text-black shadow-xl"
                  >
                    {i + 1}
                  </span>
                  <motion.span
                    className={cn(
                      'absolute right-[-0.6vw] bottom-[0.8vw] rotate-[-8deg] rounded-[0.3vw] px-[0.6vw] py-[0.1vw] text-[1vw] font-black tracking-widest shadow-xl',
                      inside ? 'bg-emerald-400 text-emerald-950' : 'bg-black/70 text-white/50'
                    )}
                    initial={{ scale: 2.6, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: delay + 0.35, type: 'spring', stiffness: 500, damping: 16 }}
                  >
                    {inside ? 'IN' : 'OUT'}
                  </motion.span>
                </div>
                <div className="w-full text-center">
                  <div className={cn('truncate text-[1vw] font-bold', !inside && 'text-white/50')}>{e.title}</div>
                  <div className="text-[0.85vw] text-white/45 tabular-nums">{e.count.toLocaleString()} votes</div>
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
