import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Backdrop, Stat, StatePill } from '~/components/live/chrome';
import TournamentView from '~/components/live/tournament/view';
import FinalReveal from '~/components/live/final-reveal';
import Leaderboard from '~/components/live/leaderboard';
import Versus from '~/components/live/versus';
import useLiveRanking from '~/hooks/useLiveRanking';
import useLiveTime from '~/hooks/useLiveTime';

// Viewer page (OBS browser source / second screen). Designed for 16:9 and
// sized in vw so it looks identical at 720p, 1080p or 4K.
// ?transparent=1 drops the backdrop for overlaying on top of a scene.

const EXAMPLES: Record<CatalogKind, string[]> = {
  anilist: ['frieren', 'jjk', 'one piece', 'demon slayer', 'spy x family', 'chainsaw man'],
  imdb: ['breaking bad', 'interstellar', 'the office', 'dune', 'oppenheimer', 'severance'],
  custom: [],
};
/** "Type an anime title …" – what one vote is, for the catalog in use */
export const WHAT: Record<CatalogKind, string> = { anilist: 'an anime title', imdb: 'a movie or show', custom: 'a title' };

export default function Public() {
  const { snap, connected } = useLiveRanking();
  const [transparent] = useState(
    () => typeof location !== 'undefined' && new URLSearchParams(location.search).has('transparent')
  );
  const [winner, setWinner] = useState<PublicEntry | null>(null);
  const time = useLiveTime(snap?.startedAt ?? null, snap?.endedAt ?? null);

  const state = snap?.state ?? 'idle';
  const versus = snap?.mode === 'shortlist' && snap.ranking.length === 2;
  const options = snap?.mode === 'shortlist' ? snap.ranking.length : 0;
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

  if (snap?.tournament) return <TournamentView snap={snap} t={snap.tournament} connected={connected} transparent={transparent} />;

  const backdrop = versus ? null : view === 'final' ? winner : view === 'live' ? (snap?.ranking[0] ?? null) : null;

  return (
    // exactly one screen: no scrolling in an OBS source or a fullscreen tab
    <div className="live-root relative h-screen w-full overflow-hidden text-white select-none">
      {!transparent && <Backdrop entry={backdrop} />}

      {/* fixed, blurred top bar – content (and the versus art) runs underneath */}
      <header className="fixed inset-x-0 top-0 z-30 flex items-center gap-[1vw] border-b border-white/[0.06] bg-[#07060d]/40 px-[2.4vw] py-[1.1vw] backdrop-blur-xl backdrop-saturate-150">
        <div className="h-[3.4vw] w-[3.4vw] bg-[url(/icon.png)] bg-cover bg-center bg-no-repeat drop-shadow-xl" />
        <div className="flex flex-col">
          <span className="text-[1.6vw] leading-tight font-black tracking-tight">{snap?.title ?? 'Anime Poll'}</span>
          <span className="text-[0.85vw] text-white/50">
            {state === 'ended'
              ? 'Final results'
              : options
                ? `Type ${options === 2 ? '1 or 2' : `a number 1–${options}`} (or the title) in chat to vote`
                : `Type ${WHAT[snap?.catalog?.kind ?? 'anilist']} in chat to vote`}
          </span>
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

      <main className="relative z-10 flex h-full flex-col px-[2.4vw] pt-[7.4vw] pb-[1.6vw]">
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
              <Examples kind={snap.catalog?.kind ?? 'anilist'} />
            </motion.div>
          )}

          {view === 'live' && snap && (
            <motion.div
              key="live"
              // versus fills the whole screen (under the bar); boards sit below it
              className={versus ? 'absolute inset-0' : 'flex min-h-0 flex-1 flex-col'}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.94, filter: 'blur(16px)', transition: { duration: 0.7 } }}
            >
              {versus ? (
                <Versus snap={snap} />
              ) : hasVotes ? (
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
                  <Examples kind={snap.catalog?.kind ?? 'anilist'} />
                </div>
              )}
            </motion.div>
          )}

          {view === 'final' && snap && (
            <motion.div
              key={`final-${snap.endedAt}`}
              className={versus ? 'absolute inset-0' : 'flex min-h-0 flex-1 flex-col'}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
            >
              {versus ? <Versus snap={snap} final /> : <FinalReveal snap={snap} onWinner={setWinner} />}
            </motion.div>
          )}
        </AnimatePresence>
      </main>
    </div>
  );
}

function Examples({ kind }: { kind: CatalogKind }) {
  const list = EXAMPLES[kind];
  const [i, setI] = useState(0);
  useEffect(() => {
    if (!list.length) return;
    const t = setInterval(() => setI((n) => (n + 1) % list.length), 1800);
    return () => clearInterval(t);
  }, [list]);
  if (!list.length) return null;
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
            {list[i % list.length]}
          </motion.span>
        </AnimatePresence>
      </span>
    </div>
  );
}
