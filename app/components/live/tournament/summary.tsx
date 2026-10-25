import { motion } from 'motion/react';
import { Coins, Crown, Dices, Hand, Medal, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { roundName } from '~/lib/tournament';
import { cn } from '~/lib/utils';
import ChatSplit from '../chat-split';
import Cover from '../cover';

// Everything that happened in the tournament, for people following on the
// public link: the open round (every show with votes), the tiebreak on the
// qualifying line, every 1v1 round by round, and the podium. A scrollable
// page over the live view – sized for phones as well as desktops.

const PHASE: Record<TournamentPhase, string> = {
  open: 'Open round – live',
  'open-results': 'Qualifiers',
  bracket: '1v1s',
  done: 'Finished',
};

export default function Summary({
  t,
  channels,
  focus,
  onClose,
}: {
  t: PublicTournament;
  channels: PublicChannel[];
  /** jump straight to a section */
  focus?: 'open';
  onClose: () => void;
}) {
  const openRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (focus === 'open') openRef.current?.scrollIntoView({ block: 'start' });
  }, [focus]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const R = t.rounds.length;
  const standings = t.allStandings.length ? t.allStandings : t.standings;
  const roundsPlayed = t.rounds
    // matches nobody is in yet ("TBD vs TBD") are just noise here
    .map((row, r) => ({ r, matches: row.filter((m) => m.status !== 'empty' && (m.a || m.b)) }))
    .filter((x) => x.matches.some((m) => m.a || m.b));

  return (
    <motion.div
      className="fixed inset-0 z-50 flex justify-center bg-black/60 backdrop-blur-md"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
    >
      <motion.div
        className="relative my-4 flex max-h-[calc(100dvh-2rem)] w-full max-w-3xl flex-col overflow-hidden rounded-2xl bg-[#0d0b18]/95 text-white ring-1 ring-white/10 sm:my-8 sm:max-h-[calc(100dvh-4rem)]"
        initial={{ y: 30, scale: 0.98 }}
        animate={{ y: 0, scale: 1 }}
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center gap-3 border-b border-white/10 px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="truncate text-xl font-black">{t.title}</div>
            <div className="text-sm text-white/50">
              {PHASE[t.phase]}
              {t.finishedAt ? ` · ${new Date(t.finishedAt).toLocaleDateString()}` : ''}
            </div>
          </div>
          <button onClick={onClose} className="grid h-9 w-9 place-items-center rounded-full bg-white/10 hover:bg-white/20" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="min-h-0 flex-1 space-y-8 overflow-y-auto overscroll-contain px-5 py-6">
          {/* the podium */}
          {t.champion && (
            <section className="flex flex-wrap items-center gap-4 rounded-xl bg-gradient-to-br from-amber-300/20 to-transparent p-4 ring-1 ring-amber-300/40">
              <Cover entry={t.champion} className="aspect-[3/4] w-20 shrink-0 rounded-lg ring-2 ring-amber-300" />
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1 text-xs font-black tracking-[0.25em] text-amber-300">
                  <Crown className="h-4 w-4" /> CHAMPION
                </div>
                <div className="text-2xl leading-tight font-black">{t.champion.title}</div>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm text-white/70">
                  {t.runnerUp && (
                    <span>
                      <b className="text-slate-200">2nd</b> {t.runnerUp.title}
                    </span>
                  )}
                  {t.thirdPlace && (
                    <span>
                      <b className="text-[#f0c09a]">3rd</b> {t.thirdPlace.title}
                    </span>
                  )}
                </div>
              </div>
            </section>
          )}

          {/* the bracket, round by round (the final last) */}
          {[...roundsPlayed].reverse().map(({ r, matches }) => (
            <Section key={r} title={roundName(r, R)}>
              {r === R - 1 && t.third && <MatchRow m={t.third} label="Third place" channels={channels} />}
              {matches.map((m) => (
                <MatchRow key={m.key} m={m} label={r < R - 2 ? `#${m.index + 1}` : undefined} channels={channels} />
              ))}
            </Section>
          ))}

          {/* the tie on the qualifying line */}
          {t.cut && (
            <Section title="Tiebreak on the qualifying line">
              <p className="mb-2 text-sm text-white/60">
                {t.cut.candidates.length} shows level on {t.cut.votes} votes for the last {t.cut.slots} spot{t.cut.slots === 1 ? '' : 's'}
                {t.cut.method && (
                  <>
                    {' – settled '}
                    {t.cut.method === 'draw' ? (
                      <>
                        <Dices className="inline h-3.5 w-3.5" /> in the cage
                      </>
                    ) : t.cut.method === 'coin' ? (
                      <>
                        <Coins className="inline h-3.5 w-3.5" /> by a coin flip
                      </>
                    ) : (
                      <>
                        <Hand className="inline h-3.5 w-3.5" /> by the host
                      </>
                    )}
                  </>
                )}
              </p>
              <div className="grid gap-1.5 sm:grid-cols-2">
                {t.cut.candidates.map((e) => {
                  const state = !t.cut!.picked ? 'tie' : t.cut!.picked.includes(e.id) ? 'in' : 'out';
                  return <EntryRow key={e.id} e={e} tag={state === 'in' ? 'IN' : state === 'out' ? 'OUT' : 'TIE'} />;
                })}
              </div>
            </Section>
          )}

          {/* the open round */}
          <section ref={openRef} className="scroll-mt-4">
            <Section title={`Open round · ${standings.length} shows with votes`}>
              {t.carried.length > 0 && (
                <div className="mb-3 flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-xs font-bold tracking-[0.2em] text-amber-300/80 uppercase">Returning</span>
                  {t.carried.map((e) => (
                    <span key={e.id} className="flex items-center gap-1.5 rounded-full bg-amber-400/10 py-0.5 pr-3 pl-0.5 ring-1 ring-amber-300/30">
                      <Medal className="ml-1 h-3.5 w-3.5 text-amber-300" />
                      {e.title}
                    </span>
                  ))}
                </div>
              )}
              <div className="space-y-1">
                {standings.map((e, i) => {
                  const tag = t.phase === 'open' ? undefined : t.qualified.includes(e.id) ? 'IN' : t.tied.includes(e.id) ? 'TIE' : 'OUT';
                  return <EntryRow key={e.id} e={e} rank={i + 1} tag={tag} />;
                })}
                {standings.length === 0 && <div className="text-sm text-white/40">No votes yet.</div>}
              </div>
              {t.removed.length > 0 && (
                <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-white/50">
                  <span className="text-xs font-bold tracking-[0.2em] uppercase">Removed by the host</span>
                  {t.removed.map((e) => (
                    <span key={e.id} className="line-through">
                      {e.title}
                    </span>
                  ))}
                </div>
              )}
            </Section>
          </section>
        </div>
      </motion.div>
    </motion.div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-3 text-xs font-bold tracking-[0.25em] text-white/45 uppercase">{title}</h3>
      {children}
    </section>
  );
}

function EntryRow({ e, rank, tag }: { e: PublicEntry; rank?: number; tag?: 'IN' | 'OUT' | 'TIE' }) {
  return (
    <div className={cn('flex items-center gap-3 rounded-lg bg-white/[0.04] px-2 py-1.5', tag === 'OUT' && 'opacity-50')}>
      {rank !== undefined && <span className="w-6 text-right text-sm font-black text-white/40 tabular-nums">{rank}</span>}
      <Cover entry={e} className="aspect-[3/4] w-7 shrink-0 rounded" />
      <span className="min-w-0 flex-1 truncate text-sm font-semibold">{e.title}</span>
      <span className="text-sm font-bold tabular-nums">{e.count}</span>
      {tag && (
        <span
          className={cn(
            'w-10 rounded text-center text-[10px] font-black tracking-widest',
            tag === 'IN' ? 'bg-emerald-400 text-emerald-950' : tag === 'TIE' ? 'bg-amber-300 text-amber-950' : 'bg-white/10 text-white/50'
          )}
        >
          {tag}
        </span>
      )}
    </div>
  );
}

function MatchRow({ m, label, channels }: { m: PublicMatch; label?: string; channels: PublicChannel[] }) {
  const decided = m.status === 'done' || m.status === 'bye';
  const side = (e: PublicEntry | null, i: 0 | 1) => {
    const won = decided && !!e && m.winner === e.id;
    return (
      <div className={cn('flex min-w-0 flex-1 items-center gap-2', i === 1 && 'flex-row-reverse text-right', decided && !won && 'opacity-50')}>
        {e ? <Cover entry={e} className="aspect-[3/4] w-8 shrink-0 rounded" /> : <span className="aspect-[3/4] w-8 shrink-0 rounded bg-white/5" />}
        <div className="min-w-0">
          <div className={cn('truncate text-sm', won ? 'font-black' : 'font-semibold')}>
            {won && <Crown className="mr-1 inline h-3.5 w-3.5 text-amber-300" />}
            {e?.title ?? (m.status === 'bye' ? 'Bye' : 'TBD')}
          </div>
          {m.breakdown && Object.keys(m.breakdown[i]).length > 0 && (
            <ChatSplit breakdown={m.breakdown[i]} channels={channels} className={cn('mt-0.5 text-[11px]', i === 0 ? 'justify-start' : 'justify-end')} />
          )}
        </div>
      </div>
    );
  };
  return (
    <div className="mb-2 rounded-xl bg-white/[0.04] p-2.5 ring-1 ring-white/5">
      <div className="mb-1 flex items-center gap-2 text-[11px] font-bold tracking-wider text-white/40 uppercase">
        {label}
        {m.coin && (
          <span className="flex items-center gap-1 rounded-full bg-white/10 px-2 text-white/70 normal-case">
            <Coins className="h-3 w-3" /> tied – coin flip
          </span>
        )}
        {m.manual && !m.coin && (
          <span className="flex items-center gap-1 rounded-full bg-white/10 px-2 text-white/70 normal-case">
            <Hand className="h-3 w-3" /> picked by the host
          </span>
        )}
        {m.status === 'live' && <span className="rounded-full bg-rose-500 px-2 text-white">LIVE</span>}
        {m.status === 'tie' && <span className="rounded-full bg-amber-300 px-2 text-amber-950">TIE</span>}
      </div>
      <div className="flex items-center gap-3">
        {side(m.a, 0)}
        <span className="shrink-0 text-lg font-black tabular-nums">{m.votes ? `${m.votes[0]}–${m.votes[1]}` : 'vs'}</span>
        {side(m.b, 1)}
      </div>
    </div>
  );
}
