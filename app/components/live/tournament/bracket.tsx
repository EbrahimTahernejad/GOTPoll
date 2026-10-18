import { AnimatePresence, motion } from 'motion/react';
import { Crown, Trophy } from 'lucide-react';
import { matchLabel, roundName } from '~/lib/tournament';
import { cn } from '~/lib/utils';
import ChatSplit from '../chat-split';
import Cover from '../cover';
import { T_COVER } from './ids';

// The bracket as a broadcast graphic: two halves facing each other with the
// final in the middle. Everything is sized in em off one font size picked
// from the bracket's depth, so 2 to 32 shows all fit one 16:9 screen.

const FONT: Record<number, string> = { 1: '2.2vw', 2: '1.8vw', 3: '1.35vw', 4: '0.95vw', 5: '0.76vw' };

export default function BracketScreen({ t, channels }: { t: PublicTournament; channels: PublicChannel[] }) {
  const R = t.rounds.length;
  if (!R) return null;
  const final = t.rounds[R - 1][0];
  const half = (r: number, side: 0 | 1) => {
    const row = t.rounds[r];
    return side === 0 ? row.slice(0, row.length / 2) : row.slice(row.length / 2);
  };
  const leftRounds = Array.from({ length: R - 1 }, (_, r) => r);
  const focus = t.focus ? [...t.rounds.flat(), t.third].find((m) => m?.key === t.focus) : null;

  return (
    <div className="flex h-full flex-col px-[2vw] pt-[8.6vw] pb-[1.4vw]" style={{ fontSize: FONT[Math.min(R, 5)] }}>
      <div className="flex min-h-0 flex-1 items-stretch justify-center">
        {leftRounds.map((r) => (
          <Column key={`l${r}`} t={t} r={r} matches={half(r, 0)} side="l" channels={channels} connector />
        ))}
        <div className="relative flex w-[13em] shrink-0 flex-col items-center justify-center">
          <motion.div
            className="mb-[0.8em] flex flex-col items-center gap-[0.2em]"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.4 }}
          >
            <Trophy className="h-[2.4em] w-[2.4em] text-amber-300 drop-shadow-[0_0_1em_rgba(245,197,66,.6)]" />
            <span className="live-gold text-[1.2em] font-black tracking-[0.3em]">FINAL</span>
          </motion.div>
          <Cell t={t} m={final} side="final" channels={channels} />
          {t.third ? (
            <motion.div
              className="mt-[1.6em] flex w-[11em] flex-col items-center gap-[0.4em]"
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.6 }}
            >
              <span className="text-[0.85em] font-bold tracking-[0.3em] text-[#e0a370]">3RD PLACE</span>
              <Cell t={t} m={t.third} side="third" channels={channels} />
            </motion.div>
          ) : (
            <div className="h-[4.4em]" />
          )}
        </div>
        {[...leftRounds].reverse().map((r) => (
          <Column key={`r${r}`} t={t} r={r} matches={half(r, 1)} side="r" channels={channels} connector />
        ))}
      </div>

      <AnimatePresence>
        {focus && focus.status === 'ready' && focus.a && focus.b && (
          <motion.div
            key={focus.key}
            className="mx-auto mt-[0.8vw] flex items-center gap-[1vw] rounded-full bg-white/[0.07] py-[0.4vw] pr-[1.4vw] pl-[0.4vw] text-[1vw] ring-1 ring-white/15 backdrop-blur-xl"
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 20 }}
            transition={{ delay: 0.6 }}
          >
            <span className="rounded-full bg-white px-[0.8vw] py-[0.15vw] text-[0.8vw] font-black tracking-[0.2em] text-black">UP NEXT</span>
            <span className="font-bold text-white/60">{matchLabel(focus.key, R)}</span>
            <span className="font-bold">{focus.a.title}</span>
            <span className="font-black text-white/40 italic">vs</span>
            <span className="font-bold">{focus.b.title}</span>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function Column({
  t,
  r,
  matches,
  side,
  channels,
  connector,
}: {
  t: PublicTournament;
  r: number;
  matches: PublicMatch[];
  side: 'l' | 'r';
  channels: PublicChannel[];
  connector: boolean;
}) {
  const R = t.rounds.length;
  const pairs = matches.length / 2;
  const col = (
    <div className="relative flex w-[11em] shrink-0 flex-col">
      <span className="absolute -top-[2em] inset-x-0 text-center text-[0.85em] font-bold tracking-[0.2em] whitespace-nowrap text-white/40 uppercase">
        {roundName(r, R)}
      </span>
      {matches.map((m, i) => (
        <motion.div
          key={m.key}
          className="flex flex-1 items-center"
          initial={{ opacity: 0, x: side === 'l' ? -30 : 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.15 + r * 0.12 + i * 0.03, type: 'spring', stiffness: 200, damping: 24 }}
        >
          <Cell t={t} m={m} side={side} channels={channels} />
        </motion.div>
      ))}
    </div>
  );
  // lines joining each pair into the next round (or straight into the final)
  const lines = connector && (
    <div className="flex w-[2em] shrink-0 flex-col">
      {pairs >= 1
        ? Array.from({ length: pairs }, (_, j) => <Bracket key={j} side={side} lit={isLit(matches[2 * j]) || isLit(matches[2 * j + 1])} />)
        : <Straight lit={isLit(matches[0])} />}
    </div>
  );
  return side === 'l' ? (
    <>
      {col}
      {lines}
    </>
  ) : (
    <>
      {lines}
      {col}
    </>
  );
}

const isLit = (m?: PublicMatch) => !!m && (m.status === 'done' || m.status === 'bye');

function Bracket({ side, lit }: { side: 'l' | 'r'; lit: boolean }) {
  const line = lit ? 'border-white/55' : 'border-white/15';
  return (
    <div className="relative flex-1">
      <div
        className={cn(
          'absolute top-1/4 bottom-1/4 w-1/2 border-y-[0.12em]',
          side === 'l' ? 'left-0 rounded-r-[0.4em] border-r-[0.12em]' : 'right-0 rounded-l-[0.4em] border-l-[0.12em]',
          line
        )}
      />
      <div className={cn('absolute top-1/2 w-1/2 border-t-[0.12em]', side === 'l' ? 'right-0' : 'left-0', line)} />
    </div>
  );
}

function Straight({ lit }: { lit: boolean }) {
  return (
    <div className="relative flex-1">
      <div className={cn('absolute inset-x-0 top-1/2 border-t-[0.12em]', lit ? 'border-white/55' : 'border-white/15')} />
    </div>
  );
}

function Cell({ t, m, side, channels }: { t: PublicTournament; m: PublicMatch; side: 'l' | 'r' | 'final' | 'third'; channels: PublicChannel[] }) {
  const focused = t.focus === m.key;
  const live = m.status === 'live';
  const isFinal = side === 'final';
  return (
    <div
      className={cn(
        'relative w-full rounded-[0.6em] bg-[#0d0b18]/70 p-[0.25em] ring-1 ring-white/10 backdrop-blur-md transition-shadow duration-500',
        isFinal && 'text-[1.2em] ring-amber-300/40',
        side === 'third' && 'ring-[#d4935a]/40',
        focused && 'ring-2 ring-white shadow-[0_0_1.6em_0.2em_rgba(255,255,255,.35)]',
        live && 'ring-2 ring-rose-400 shadow-[0_0_1.6em_0.3em_rgba(251,113,133,.45)]'
      )}
    >
      {live && (
        <span className="absolute -top-[0.7em] left-1/2 z-10 flex -translate-x-1/2 items-center gap-[0.3em] rounded-full bg-rose-500 px-[0.6em] text-[0.7em] font-black tracking-widest">
          <span className="h-[0.5em] w-[0.5em] animate-ping rounded-full bg-white" /> LIVE
        </span>
      )}
      {(['a', 'b'] as const).map((k, i) => (
        <Slot key={k} m={m} i={i as 0 | 1} focused={focused} channels={channels} />
      ))}
    </div>
  );
}

function Slot({ m, i, focused, channels }: { m: PublicMatch; i: 0 | 1; focused: boolean; channels: PublicChannel[] }) {
  const e = i === 0 ? m.a : m.b;
  const won = !!e && m.status === 'done' && m.winner === e.id;
  const lost = !!e && m.status === 'done' && m.winner !== e.id;
  const votes = m.votes?.[i];
  const label = e ? e.title : m.status === 'bye' || m.status === 'empty' ? 'Bye' : 'TBD';
  return (
    <div className={cn('group/slot relative flex h-[2.3em] items-center gap-[0.45em] rounded-[0.4em] px-[0.25em]', won && 'bg-white/[0.09]', lost && 'opacity-40')}>
      <AnimatePresence mode="popLayout" initial={false}>
        <motion.div
          key={e?.id ?? 'none'}
          className="flex min-w-0 flex-1 items-center gap-[0.45em]"
          initial={{ opacity: 0, x: -12, filter: 'blur(4px)' }}
          animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.45 }}
        >
          {e ? (
            <Cover
              entry={e}
              layoutId={focused ? `${T_COVER}${e.id}` : undefined}
              className="aspect-[3/4] h-[1.9em] shrink-0 rounded-[0.25em]"
            />
          ) : (
            <span className="h-[1.9em] w-[1.42em] shrink-0 rounded-[0.25em] bg-white/[0.06]" />
          )}
          <span className={cn('min-w-0 flex-1 truncate text-[0.95em]', e ? 'font-semibold' : 'text-white/30 italic', won && 'font-black')}>{label}</span>
        </motion.div>
      </AnimatePresence>
      {won && <Crown className="h-[0.9em] w-[0.9em] shrink-0 text-amber-300" />}
      {votes !== undefined && (
        <span className="relative shrink-0 cursor-default text-[0.95em] font-black tabular-nums">
          {votes}
          {/* who voted where – on hover, for viewers following in a browser */}
          {m.breakdown && Object.keys(m.breakdown[i]).length > 0 && (
            <span className="pointer-events-none absolute right-0 bottom-full z-30 mb-[0.4em] hidden rounded-[0.6em] bg-[#0d0b18]/95 p-[0.5em] ring-1 ring-white/15 group-hover/slot:block">
              <ChatSplit breakdown={m.breakdown[i]} channels={channels} className="flex-nowrap text-[0.85em]" />
            </span>
          )}
        </span>
      )}
    </div>
  );
}
