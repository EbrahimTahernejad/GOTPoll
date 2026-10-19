import { motion } from 'motion/react';
import { Coins, Crown, Dices, Hand, Medal, Swords, Trophy, Vote } from 'lucide-react';
import { matchLabel, roundName } from '~/lib/tournament';
import { cn } from '~/lib/utils';
import ChatSplit from '../chat-split';
import Cover from '../cover';

// The whole tournament on one screen: the podium and a few highlights, every
// match played (scores, how ties were settled, who voted where on hover) and
// the open round's standings.

const A = '#7c5cff';
const B = '#ff4d6d';

export default function ReportScreen({ t, channels }: { t: PublicTournament; channels: PublicChannel[] }) {
  const R = t.rounds.length;
  const played = [...t.rounds.flat(), ...(t.third ? [t.third] : [])].filter((m) => m.status === 'done' || m.status === 'tie');
  // the final reads best last, third place just before it
  const ordered = [...played].sort((x, y) => order(x, R) - order(y, R));
  const voted = played.filter((m) => m.votes && !m.manual && m.votes[0] + m.votes[1] > 0);
  const duelVotes = voted.reduce((n, m) => n + m.votes![0] + m.votes![1], 0);
  const margin = (m: PublicMatch) => Math.abs(m.votes![0] - m.votes![1]);
  const closest = [...voted].filter((m) => m.status === 'done').sort((x, y) => margin(x) - margin(y))[0];
  const biggest = [...voted].sort((x, y) => margin(y) - margin(x))[0];
  const busiest = [...voted].sort((x, y) => y.votes![0] + y.votes![1] - (x.votes![0] + x.votes![1]))[0];
  const settled = played.filter((m) => m.coin || m.manual).length + (t.cut?.picked ? 1 : 0);
  const twoCols = ordered.length > 9;

  return (
    <div className="flex h-full flex-col px-[2.4vw] pt-[7.4vw] pb-[1.4vw]">
      <motion.div
        className="mb-[1vw] flex flex-wrap items-end gap-x-[1.4vw] gap-y-[0.4vw]"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <span className="live-shine text-[2.6vw] leading-none font-black tracking-tight">Tournament report</span>
        <Fact icon={Swords} text={`${t.size}-show bracket`} />
        <Fact icon={Vote} text={`${t.openVotes.toLocaleString()} open-round votes`} />
        <Fact icon={Trophy} text={`${played.length} matches · ${duelVotes.toLocaleString()} votes in the 1v1s`} />
        {settled > 0 && <Fact icon={Dices} text={`${settled} tie${settled === 1 ? '' : 's'} settled`} />}
      </motion.div>

      <div className="flex min-h-0 flex-1 gap-[1.6vw]">
        {/* podium + highlights */}
        <div className="flex w-[22vw] shrink-0 flex-col gap-[1vw]">
          {t.champion ? (
            <motion.div
              className="relative flex items-center gap-[1vw] overflow-hidden rounded-[1.2vw] bg-gradient-to-br from-amber-300/20 to-transparent p-[0.9vw] ring-1 ring-amber-300/40"
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: 0.15 }}
            >
              <Cover entry={t.champion} className="aspect-[3/4] w-[7vw] shrink-0 rounded-[0.7vw] ring-[0.2vw] ring-amber-300" />
              <div className="min-w-0">
                <div className="flex items-center gap-[0.3vw] text-[0.75vw] font-black tracking-[0.25em] text-amber-300">
                  <Crown className="h-[1vw] w-[1vw]" /> CHAMPION
                </div>
                <div className="line-clamp-3 text-[1.4vw] leading-tight font-black">{t.champion.title}</div>
              </div>
            </motion.div>
          ) : (
            <div className="rounded-[1.2vw] bg-white/[0.04] p-[1vw] text-[1vw] text-white/50 ring-1 ring-white/10">No champion yet</div>
          )}
          {[
            { e: t.runnerUp, label: '2ND', cls: 'text-slate-200 bg-slate-300/15' },
            { e: t.thirdPlace, label: '3RD', cls: 'text-[#f0c09a] bg-[#d4935a]/20' },
          ].map(
            ({ e, label, cls }, i) =>
              e && (
                <motion.div
                  key={label}
                  className="flex items-center gap-[0.7vw]"
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.3 + i * 0.1 }}
                >
                  <span className={cn('rounded-full px-[0.6vw] py-[0.1vw] text-[0.75vw] font-black tracking-widest', cls)}>{label}</span>
                  <Cover entry={e} className="aspect-[3/4] w-[2.4vw] shrink-0 rounded-[0.3vw]" />
                  <span className="truncate text-[1vw] font-bold">{e.title}</span>
                </motion.div>
              )
          )}

          <div className="mt-[0.4vw] flex flex-col gap-[0.6vw]">
            {closest && <Highlight label="Closest call" m={closest} R={R} delay={0.5} />}
            {biggest && biggest !== closest && <Highlight label="Biggest win" m={biggest} R={R} delay={0.6} />}
            {busiest && busiest !== biggest && busiest !== closest && <Highlight label="Most votes" m={busiest} R={R} delay={0.7} />}
            {t.cut?.picked && (
              <motion.div
                className="rounded-[0.8vw] bg-white/[0.04] px-[0.8vw] py-[0.5vw] text-[0.85vw] text-white/70 ring-1 ring-white/10"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ delay: 0.8 }}
              >
                <span className="font-bold text-white">{t.cut.candidates.length} level</span> on {t.cut.votes} for the last{' '}
                {t.cut.slots} spot{t.cut.slots === 1 ? '' : 's'} –{' '}
                {t.cut.method === 'draw' ? 'settled by the cage' : t.cut.method === 'coin' ? 'settled by a coin flip' : 'picked by hand'}
              </motion.div>
            )}
          </div>
        </div>

        {/* every match */}
        <div className={cn('min-h-0 min-w-0 flex-1 gap-x-[1.4vw]', twoCols ? 'columns-2' : '')}>
          {ordered.map((m, i) => (
            <MatchRow key={m.key} m={m} R={R} channels={channels} delay={0.2 + i * 0.04} />
          ))}
          {ordered.length === 0 && <div className="text-[1.1vw] text-white/40">No matches played yet.</div>}
        </div>

        {/* open round */}
        <div className="flex w-[19vw] shrink-0 flex-col gap-[0.35vw]">
          <div className="mb-[0.2vw] text-[0.8vw] font-bold tracking-[0.25em] text-white/45 uppercase">Open round</div>
          {t.carried.map((e) => (
            <div key={e.id} className="flex items-center gap-[0.5vw] text-[0.85vw]">
              <span className="w-[1.6vw] text-center text-amber-300">
                <Medal className="mx-auto h-[0.9vw] w-[0.9vw]" />
              </span>
              <span className="min-w-0 flex-1 truncate font-semibold">{e.title}</span>
              <span className="text-[0.7vw] font-bold tracking-widest text-amber-300/80">RETURNING</span>
            </div>
          ))}
          {t.standings.map((e, i) => {
            const inside = t.qualified.includes(e.id);
            return (
              <motion.div
                key={e.id}
                className={cn('flex items-center gap-[0.5vw] text-[0.85vw]', !inside && 'opacity-45')}
                initial={{ opacity: 0, x: 16 }}
                animate={{ opacity: inside ? 1 : 0.45, x: 0 }}
                transition={{ delay: 0.3 + i * 0.03 }}
              >
                <span className="w-[1.6vw] text-center font-black text-white/45 tabular-nums">{i + 1}</span>
                <span className="min-w-0 flex-1 truncate font-semibold">{e.title}</span>
                <span className="font-bold tabular-nums">{e.count}</span>
                <span
                  className={cn(
                    'w-[2.4vw] rounded-[0.25vw] text-center text-[0.65vw] font-black tracking-widest',
                    inside ? 'bg-emerald-400/90 text-emerald-950' : 'bg-white/10 text-white/50'
                  )}
                >
                  {inside ? 'IN' : 'OUT'}
                </span>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

const order = (m: PublicMatch, R: number) => (m.key === '3p' ? R - 0.5 : m.round) * 100 + m.index;

function Fact({ icon: Icon, text }: { icon: typeof Vote; text: string }) {
  return (
    <span className="mb-[0.15vw] flex items-center gap-[0.4vw] rounded-full bg-white/[0.06] px-[0.8vw] py-[0.25vw] text-[0.85vw] font-semibold text-white/75 ring-1 ring-white/10">
      <Icon className="h-[0.9vw] w-[0.9vw]" />
      {text}
    </span>
  );
}

function Highlight({ label, m, R, delay }: { label: string; m: PublicMatch; R: number; delay: number }) {
  const w = m.winner === m.a?.id ? 0 : 1;
  const win = w === 0 ? m.a : m.b;
  return (
    <motion.div
      className="rounded-[0.8vw] bg-white/[0.04] px-[0.8vw] py-[0.5vw] ring-1 ring-white/10"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
    >
      <div className="text-[0.7vw] font-bold tracking-[0.25em] text-white/45 uppercase">
        {label} · {matchLabel(m.key, R)}
      </div>
      <div className="truncate text-[0.95vw]">
        <span className="font-bold">{win?.title}</span>{' '}
        <span className="font-black tabular-nums">
          {m.votes![w]}–{m.votes![1 - w]}
        </span>
      </div>
    </motion.div>
  );
}

function MatchRow({ m, R, channels, delay }: { m: PublicMatch; R: number; channels: PublicChannel[]; delay: number }) {
  const total = (m.votes?.[0] ?? 0) + (m.votes?.[1] ?? 0);
  const share = total ? ((m.votes?.[0] ?? 0) / total) * 100 : 50;
  const isFinal = m.key === `${R - 1}-0`;
  const tag = m.coin ? { icon: Coins, text: 'coin' } : m.manual ? { icon: Hand, text: 'picked' } : null;
  return (
    <motion.div
      className={cn(
        'group/match relative mb-[0.5vw] break-inside-avoid rounded-[0.7vw] bg-white/[0.04] px-[0.7vw] py-[0.45vw] ring-1 ring-white/10',
        isFinal && 'bg-amber-300/[0.08] ring-amber-300/40'
      )}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay }}
    >
      <div className="flex items-center gap-[0.5vw] text-[0.65vw] font-bold tracking-[0.2em] text-white/40 uppercase">
        {m.key === '3p' ? 'Third place' : roundName(m.round, R)}
        {m.key !== '3p' && !isFinal && <span className="text-white/25">#{m.index + 1}</span>}
        {tag && (
          <span className="ml-auto flex items-center gap-[0.2vw] rounded-full bg-white/10 px-[0.4vw] tracking-wider text-white/70 normal-case">
            <tag.icon className="h-[0.7vw] w-[0.7vw]" />
            {tag.text}
          </span>
        )}
      </div>
      <div className="mt-[0.2vw] flex items-center gap-[0.5vw] text-[0.9vw]">
        <Side e={m.a} won={m.winner === m.a?.id} />
        <span className="shrink-0 font-black tabular-nums">
          {m.votes ? `${m.votes[0]}–${m.votes[1]}` : '–'}
        </span>
        <Side e={m.b} won={m.winner === m.b?.id} right />
      </div>
      {total > 0 && (
        <div className="mt-[0.3vw] flex h-[0.25vw] overflow-hidden rounded-full bg-white/10">
          <div style={{ width: `${share}%`, background: A }} />
          <div style={{ width: `${100 - share}%`, background: B }} />
        </div>
      )}
      {/* who voted where, for viewers following in a browser */}
      {m.breakdown && total > 0 && (
        <div className="pointer-events-none absolute top-full left-0 z-30 mt-[0.3vw] hidden w-full rounded-[0.6vw] bg-[#0d0b18]/95 p-[0.5vw] ring-1 ring-white/15 group-hover/match:block">
          <div className="flex items-start justify-between gap-[0.5vw] text-[0.8vw]">
            <ChatSplit breakdown={m.breakdown[0]} channels={channels} className="justify-start" />
            <ChatSplit breakdown={m.breakdown[1]} channels={channels} className="justify-end" />
          </div>
        </div>
      )}
    </motion.div>
  );
}

function Side({ e, won, right }: { e: PublicEntry | null; won: boolean; right?: boolean }) {
  return (
    <span className={cn('flex min-w-0 flex-1 items-center gap-[0.4vw]', right && 'flex-row-reverse text-right', !won && 'opacity-50')}>
      {e ? <Cover entry={e} className="aspect-[3/4] w-[1.5vw] shrink-0 rounded-[0.2vw]" /> : null}
      <span className={cn('truncate', won && 'font-black')}>{e?.title ?? 'Bye'}</span>
      {won && <Crown className="h-[0.8vw] w-[0.8vw] shrink-0 text-amber-300" />}
    </span>
  );
}
