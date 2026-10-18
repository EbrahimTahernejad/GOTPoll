import { AnimatePresence, motion } from 'motion/react';
import AnimatedNumber from './animated-number';

// Viewer page chrome shared by polls and tournaments.

export function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex items-baseline gap-[0.35vw]">
      <AnimatedNumber value={value} className="text-[1.3vw] font-extrabold tabular-nums" />
      <span className="text-white/45 uppercase">{label}</span>
    </span>
  );
}

export function StatePill({ state }: { state: PollState }) {
  if (state === 'running') {
    return (
      <span className="flex items-center gap-[0.5vw] rounded-full bg-rose-500/15 px-[0.9vw] py-[0.3vw] font-bold tracking-widest text-rose-300 ring-1 ring-rose-400/30">
        <span className="relative flex h-[0.6vw] w-[0.6vw]">
          <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
          <span className="relative inline-flex h-full w-full rounded-full bg-rose-500" />
        </span>
        LIVE
      </span>
    );
  }
  return (
    <span className="rounded-full bg-white/10 px-[0.9vw] py-[0.3vw] font-bold tracking-widest text-white/70">FINAL</span>
  );
}

/** Blurred cover of whoever leads, cross-fading as the lead changes. */
export function Backdrop({ entry }: { entry: PublicEntry | null }) {
  return (
    <div className="pointer-events-none fixed inset-0 -z-0 bg-[#07060d]">
      <div className="live-aurora absolute inset-0" />
      <AnimatePresence>
        {entry?.cover && (
          <motion.div
            key={entry.id}
            className="absolute inset-0 bg-cover bg-center"
            style={{ backgroundImage: `url('${entry.cover}')`, filter: 'blur(70px) saturate(1.5)' }}
            initial={{ opacity: 0, scale: 1.4 }}
            animate={{ opacity: 0.38, scale: 1.25 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.6, ease: 'easeOut' }}
          />
        )}
      </AnimatePresence>
      <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,transparent_30%,#07060dcc_85%)]" />
      <div className="live-grain absolute inset-0 opacity-[0.07] mix-blend-overlay" />
    </div>
  );
}
