import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { useEffect, useState } from 'react';
import useLiveTime from '~/hooks/useLiveTime';
import { matchLabel } from '~/lib/tournament';
import { Backdrop, Stat, StatePill } from '../chrome';
import Leaderboard from '../leaderboard';
import Versus from '../versus';
import BracketScreen from './bracket';
import ChampionScreen from './champion';
import CoinScreen from './coin';
import DrawScreen from './draw';
import { T_COVER } from './ids';
import IntroScreen from './intro';
import QualifiersScreen from './qualifiers';

// The viewer page while a tournament is open. Each screen is a full layer;
// switching crossfades them while covers with the same show morph from one
// screen to the next (bracket card → VS intro → voting and back).


const EASE = [0.22, 1, 0.36, 1] as const;

export default function TournamentView({
  snap,
  t,
  connected,
  transparent,
}: {
  snap: PublicSnapshot;
  t: PublicTournament;
  connected: boolean;
  transparent: boolean;
}) {
  const all = [...t.rounds.flat(), ...(t.third ? [t.third] : [])];
  const focus = t.focus ? all.find((m) => m.key === t.focus) ?? null : null;
  const liveHere = !!t.live && t.live.key === t.focus;
  const voting = liveHere && t.live!.stage === 'voting';
  const counting = (t.screen === 'open' && snap.state === 'running') || (t.screen === 'match' && voting);
  const time = useLiveTime(counting ? snap.startedAt : null, null);

  // a show's colour washes the background where one show matters most
  const backdrop =
    t.screen === 'open'
      ? (snap.ranking[0] ?? null)
      : t.screen === 'open-results'
        ? (t.standings[0] ?? null)
        : t.screen === 'champion'
          ? t.champion
          : null;

  const subtitle = {
    open: `Open round · back as many shows as you like – the top ${t.qualifySpots} go through`,
    'open-results': t.carried.length ? `Qualifiers · ${t.carried.length} returning + the top ${t.qualifySpots}` : `Qualifiers · the top ${t.qualifySpots} go through`,
    bracket: `${t.size}-show bracket`,
    intro: focus ? matchLabel(focus.key, t.rounds.length) : '',
    match: focus
      ? `${matchLabel(focus.key, t.rounds.length)} · ${voting ? 'type 1 or 2 (or the title) – one vote each' : 'result'}`
      : '',
    champion: 'Champion',
    draw: 'Tie on the qualifying line · settled by a draw',
    coin: t.coin?.key === 'cut' ? 'Two level for the last spot · settled by a coin flip' : 'Tied 1v1 · settled by a coin flip',
  }[t.screen];

  // key per screen and, for match screens, per match: switching matches replays the entrance
  const layer =
    t.screen === 'intro' || t.screen === 'match'
      ? `${t.screen}-${t.focus}`
      : t.screen === 'coin'
        ? `coin-${t.coin?.at}`
        : t.screen === 'draw'
          ? `draw-${t.cut?.at}`
          : t.screen;
  const morph = t.screen === 'bracket' || t.screen === 'intro' || t.screen === 'match';

  return (
    <div className="live-root relative h-screen w-full overflow-hidden text-white select-none">
      {!transparent && <Backdrop entry={backdrop} />}

      <header className="fixed inset-x-0 top-0 z-30 flex items-center gap-[1vw] border-b border-white/[0.06] bg-[#07060d]/40 px-[2.4vw] py-[1.1vw] backdrop-blur-xl backdrop-saturate-150">
        <div className="h-[3.4vw] w-[3.4vw] bg-[url(/icon.png)] bg-cover bg-center bg-no-repeat drop-shadow-xl" />
        <div className="flex min-w-0 flex-col">
          <span className="truncate text-[1.6vw] leading-tight font-black tracking-tight">{t.title}</span>
          <AnimatePresence mode="wait">
            <motion.span
              key={subtitle}
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -6 }}
              transition={{ duration: 0.25 }}
              className="truncate text-[0.85vw] text-white/50"
            >
              {subtitle}
            </motion.span>
          </AnimatePresence>
        </div>
        <div className="grow" />
        <RoundTrail t={t} />
        {counting && (
          <div className="flex items-center gap-[1.6vw] text-[0.95vw]">
            <Stat label="votes" value={snap.totalVotes} />
            <Stat label="viewers" value={snap.totalVoters} />
            {time && <span className="font-mono text-[1.1vw] text-white/70 tabular-nums">{time}</span>}
            <StatePill state="running" />
          </div>
        )}
        {!connected && <span className="rounded-full bg-amber-500/20 px-3 py-1 text-[0.8vw] text-amber-300">reconnecting…</span>}
      </header>

      <LayoutGroup>
        <AnimatePresence initial={false}>
          <motion.main
            key={layer}
            className="absolute inset-0 z-10"
            // bracket ⇄ VS ⇄ voting: a plain crossfade, the covers morph across.
            // Anything else: a deeper blur-and-zoom change of scene.
            initial={morph ? { opacity: 0 } : { opacity: 0, scale: 1.04, filter: 'blur(14px)' }}
            animate={{ opacity: 1, scale: 1, filter: 'blur(0px)', transition: { duration: 0.7, ease: EASE, delay: morph ? 0 : 0.15 } }}
            exit={morph ? { opacity: 0, transition: { duration: 0.5 } } : { opacity: 0, scale: 0.96, filter: 'blur(14px)', transition: { duration: 0.55, ease: EASE } }}
          >
            {t.screen === 'open' && (
              <div className="flex h-full flex-col px-[2.4vw] pt-[7.4vw] pb-[1.6vw]">
                <Carried t={t} />
                {snap.ranking.length ? (
                  <Leaderboard snap={snap} qualify={t.qualifySpots} />
                ) : (
                  <Waiting text="Waiting for the first vote…" />
                )}
              </div>
            )}
            {t.screen === 'open-results' && <QualifiersScreen t={t} />}
            {t.screen === 'bracket' && <BracketScreen t={t} channels={snap.channels} />}
            {t.screen === 'intro' && focus && <IntroScreen t={t} m={focus} />}
            {t.screen === 'match' && focus && <MatchScreen snap={snap} t={t} m={focus} />}
            {t.screen === 'champion' && <ChampionScreen t={t} />}
            {t.screen === 'draw' && t.cut?.picked && <DrawScreen t={t} />}
            {t.screen === 'coin' && t.coin && <CoinScreen t={t} />}
          </motion.main>
        </AnimatePresence>
      </LayoutGroup>
    </div>
  );
}

/** The live vote (from the poll feed), or a finished match replayed from its result. */
function MatchScreen({ snap, t, m }: { snap: PublicSnapshot; t: PublicTournament; m: PublicMatch }) {
  const live = t.live?.key === m.key ? t.live : null;
  if (live && live.stage !== 'intro' && snap.mode === 'shortlist' && snap.ranking.length === 2) {
    return <Versus snap={snap} final={live.stage === 'result'} layoutPrefix={T_COVER} />;
  }
  if (!m.a || !m.b) return null;
  const ranking: PublicEntry[] = [
    { ...m.a, count: m.votes?.[0] ?? 0, option: 1, breakdown: m.breakdown?.[0] },
    { ...m.b, count: m.votes?.[1] ?? 0, option: 2, breakdown: m.breakdown?.[1] },
  ];
  return <Versus snap={{ ranking, endedAt: 1, channels: snap.channels }} final layoutPrefix={T_COVER} />;
}

function Carried({ t }: { t: PublicTournament }) {
  if (!t.carried.length) return null;
  return (
    <div className="mb-[1.2vw] flex items-center gap-[0.8vw]">
      <span className="text-[0.8vw] font-bold tracking-[0.25em] text-amber-300/80 uppercase">Already in</span>
      {t.carried.map((e, i) => (
        <motion.span
          key={e.id}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3 + i * 0.08 }}
          className="flex items-center gap-[0.5vw] rounded-full bg-amber-400/10 py-[0.25vw] pr-[0.9vw] pl-[0.25vw] text-[0.9vw] font-semibold ring-1 ring-amber-300/30"
        >
          {e.cover ? (
            <img src={e.cover} alt="" className="h-[1.8vw] w-[1.8vw] rounded-full object-cover" />
          ) : (
            <span className="h-[1.8vw] w-[1.8vw] rounded-full bg-white/10" />
          )}
          {e.title}
        </motion.span>
      ))}
    </div>
  );
}

/** Where we are: Open › Qualifiers › R16 › QF › SF › Final */
function RoundTrail({ t }: { t: PublicTournament }) {
  const n = t.rounds.length;
  const short = (r: number) => {
    const fromEnd = n - 1 - r;
    return fromEnd === 0 ? 'Final' : fromEnd === 1 ? 'SF' : fromEnd === 2 ? 'QF' : `R${2 ** (fromEnd + 1)}`;
  };
  const current = (() => {
    if (t.phase === 'open') return 0;
    if (t.phase === 'open-results') return 1;
    if (t.phase === 'done') return 2 + n;
    const r = t.rounds.findIndex((row) => row.some((m) => m.status === 'ready' || m.status === 'live' || m.status === 'tie' || m.status === 'waiting'));
    return 2 + Math.max(0, r);
  })();
  const steps = ['Open', 'Qualifiers', ...t.rounds.map((_, r) => short(r)), '👑'];
  return (
    <div className="mr-[1vw] hidden items-center gap-[0.35vw] text-[0.75vw] font-bold tracking-wider uppercase md:flex">
      {steps.map((s, i) => (
        <span key={s + i} className="flex items-center gap-[0.35vw]">
          {i > 0 && <span className={i <= current ? 'text-white/40' : 'text-white/15'}>›</span>}
          <span
            className={
              i === current
                ? 'rounded-full bg-white px-[0.6vw] py-[0.15vw] text-black'
                : i < current
                  ? 'text-white/55'
                  : 'text-white/20'
            }
          >
            {s}
          </span>
        </span>
      ))}
    </div>
  );
}

function Waiting({ text }: { text: string }) {
  const [dots, setDots] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setDots((d) => (d + 1) % 4), 500);
    return () => clearInterval(i);
  }, []);
  return (
    <div className="flex flex-1 items-center justify-center">
      <motion.div className="text-[3vw] font-black" animate={{ opacity: [0.6, 1, 0.6] }} transition={{ repeat: Infinity, duration: 2 }}>
        {text.replace(/…$/, '')}
        <span className="inline-block w-[2vw] text-left">{'.'.repeat(dots)}</span>
      </motion.div>
    </div>
  );
}
