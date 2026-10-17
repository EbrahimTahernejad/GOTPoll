import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import AnimatedNumber from '~/components/live/animated-number';
import FinalReveal from '~/components/live/final-reveal';
import Leaderboard from '~/components/live/leaderboard';
import useLiveRanking from '~/hooks/useLiveRanking';
import useLiveTime from '~/hooks/useLiveTime';

// Viewer page (OBS browser source / second screen). Designed for 16:9 and
// sized in vw so it looks identical at 720p, 1080p or 4K.
// ?transparent=1 drops the backdrop for overlaying on top of a scene.

const EXAMPLES = ['frieren', 'jjk', 'one piece', 'demon slayer', 'spy x family', 'chainsaw man'];

export default function Public() {
  const { snap, connected } = useLiveRanking();
  const [transparent] = useState(
    () => typeof location !== 'undefined' && new URLSearchParams(location.search).has('transparent')
  );
  const [winner, setWinner] = useState<PublicEntry | null>(null);
  const time = useLiveTime(snap?.startedAt ?? null, snap?.endedAt ?? null);

  const state = snap?.state ?? 'idle';
  const hasVotes = (snap?.ranking.length ?? 0) > 0;
  const view: 'idle' | 'live' | 'final' =
    state === 'ended' && hasVotes ? 'final' : state === 'idle' ? 'idle' : 'live';

  useEffect(() => {
    if (view !== 'final') setWinner(null);
  }, [view]);

  useEffect(() => {
    document.documentElement.classList.add('live-page');
    return () => document.documentElement.classList.remove('live-page');
  }, []);

  const backdrop = view === 'final' ? winner : view === 'live' ? (snap?.ranking[0] ?? null) : null;

  return (
    <div className="live-root relative flex min-h-screen w-full flex-col overflow-hidden text-white select-none">
      {!transparent && <Backdrop entry={backdrop} />}

      <header className="relative z-10 flex items-center gap-[1vw] px-[2.4vw] pt-[1.6vw]">
        <div className="h-[3.4vw] w-[3.4vw] bg-[url(/icon.png)] bg-cover bg-center bg-no-repeat drop-shadow-xl" />
        <div className="flex flex-col">
          <span className="text-[1.6vw] leading-tight font-black tracking-tight">{snap?.title ?? 'Anime Poll'}</span>
          <span className="text-[0.85vw] text-white/50">Type an anime title in chat to vote</span>
        </div>
        <div className="grow" />
        {snap && state !== 'idle' && (
          <div className="flex items-center gap-[1.6vw] text-[0.95vw]">
            <Stat label="votes" value={snap.totalVotes} />
            <Stat label="viewers" value={snap.totalVoters} />
            {time && <span className="font-mono text-[1.1vw] text-white/70 tabular-nums">{time}</span>}
            <StatePill state={state} />
          </div>
        )}
        {!connected && (
          <span className="rounded-full bg-amber-500/20 px-3 py-1 text-[0.8vw] text-amber-300">reconnecting…</span>
        )}
      </header>

      <main className="relative z-10 flex flex-1 flex-col px-[2.4vw] pt-[1.6vw] pb-[1.6vw]">
        <AnimatePresence mode="wait">
          {/* nothing until the first snapshot – joining mid-poll must not flash the idle screen */}
          {snap && view === 'idle' && (
            <motion.div
              key="idle"
              className="flex flex-1 flex-col items-center justify-center gap-[1.2vw]"
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 1.04, filter: 'blur(10px)' }}
            >
              <motion.div
                className="h-[16vw] w-[16vw] bg-[url(/icon.png)] bg-cover bg-center bg-no-repeat"
                animate={{ y: [0, -10, 0], filter: ['drop-shadow(0 0 0px #a78bfa)', 'drop-shadow(0 0 40px #a78bfa)', 'drop-shadow(0 0 0px #a78bfa)'] }}
                transition={{ repeat: Infinity, duration: 4, ease: 'easeInOut' }}
              />
              <div className="live-shine text-[3.4vw] font-black tracking-tight">The poll opens soon</div>
              <Examples />
            </motion.div>
          )}

          {view === 'live' && snap && (
            <motion.div
              key="live"
              className="flex flex-1 flex-col"
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, filter: 'blur(16px)', transition: { duration: 0.7 } }}
            >
              {hasVotes ? (
                <Leaderboard snap={snap} />
              ) : (
                <div className="flex flex-1 flex-col items-center justify-center gap-[1.2vw]">
                  <motion.div
                    className="text-[3vw] font-black"
                    animate={{ opacity: [0.6, 1, 0.6] }}
                    transition={{ repeat: Infinity, duration: 2 }}
                  >
                    Waiting for the first vote…
                  </motion.div>
                  <Examples />
                </div>
              )}
            </motion.div>
          )}

          {view === 'final' && snap && (
            <motion.div
              key={`final-${snap.endedAt}`}
              className="flex flex-1 flex-col"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              <FinalReveal snap={snap} onWinner={setWinner} />
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <span className="flex items-baseline gap-[0.35vw]">
      <AnimatedNumber value={value} className="text-[1.3vw] font-extrabold tabular-nums" />
      <span className="text-white/45 uppercase">{label}</span>
    </span>
  );
}

function StatePill({ state }: { state: PollState }) {
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

function Examples() {
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setI((n) => (n + 1) % EXAMPLES.length), 1800);
    return () => clearInterval(t);
  }, []);
  return (
    <div className="flex items-center gap-[0.6vw] text-[1.3vw] text-white/60">
      <span>e.g.</span>
      <span className="relative inline-flex h-[2vw] min-w-[12vw] items-center overflow-hidden rounded-[0.5vw] bg-white/10 px-[0.8vw] font-mono text-white">
        <AnimatePresence mode="popLayout">
          <motion.span
            key={i}
            initial={{ y: '100%', opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: '-100%', opacity: 0 }}
            transition={{ type: 'spring', stiffness: 300, damping: 26 }}
          >
            {EXAMPLES[i]}
          </motion.span>
        </AnimatePresence>
      </span>
    </div>
  );
}

/** Blurred cover of whoever leads, cross-fading as the lead changes. */
function Backdrop({ entry }: { entry: PublicEntry | null }) {
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
