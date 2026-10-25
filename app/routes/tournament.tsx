import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowRight,
  Archive,
  Eye,
  EyeOff,
  ExternalLink,
  MessageSquareText,
  Check,
  Coins,
  Dices,
  Hand,
  Scale,
  Crown,
  FastForward,
  History as HistoryIcon,
  Loader2,
  Monitor,
  Play,
  RotateCcw,
  Square,
  Swords,
  Trash2,
  Trophy,
  Undo2,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import AppHeader from '~/components/app/app-header';
import AssignDialog from '~/components/poll/assign-dialog';
import PhrasesDialog from '~/components/poll/phrases-dialog';
import { EmptyState, FilterChip, FilterGroup, Source, Stat, StateBadge } from '~/components/poll/bits';
import ShortlistEditor from '~/components/poll/shortlist-editor';
import UnmatchedPanel from '~/components/poll/unmatched-panel';
import BracketEditor from '~/components/tournament/bracket-editor';
import { BreakdownChips } from '~/components/tournament/breakdown';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Input } from '~/components/ui/input';
import useLiveTime from '~/hooks/useLiveTime';
import useCatalog from '~/hooks/useCatalog';
import useLibrary from '~/hooks/useLibrary';
import usePoll from '~/hooks/usePoll';
import useTournament from '~/hooks/useTournament';
import { channelsOf, matchLabel, sourceUrl } from '~/lib/tournament';
import { cn } from '~/lib/utils';

const FORMATS: { id: ShowFormat; label: string }[] = [
  { id: 'TV', label: 'TV' },
  { id: 'MOVIE', label: 'Movie' },
  { id: 'TV_SHORT', label: 'Short' },
];
const RELEASES: { id: ShowRelease; label: string }[] = [
  { id: 'released', label: 'Released' },
  { id: 'airing', label: 'Airing' },
  { id: 'upcoming', label: 'Upcoming' },
];
const STEPS: { phase: TournamentPhase[]; label: string }[] = [
  { phase: ['open'], label: 'Open round' },
  { phase: ['open-results'], label: 'Qualifiers' },
  { phase: ['bracket'], label: '1v1s' },
  { phase: ['done'], label: 'Champion' },
];

export default function TournamentPage() {
  const snap = useTournament();
  const poll = usePoll();
  const library = useLibrary();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<TournamentAction['type'] | null>(null);
  const [assigning, setAssigning] = useState<{ phrase: PollPhrase; current: number | null } | null>(null);
  const [closing, setClosing] = useState(false);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);

  const act = async (a: TournamentAction) => {
    setPending(a.type);
    try {
      await window.GOTPoll.tournament.act(a);
      setError(null);
    } catch (err) {
      // Electron wraps the message: "Error invoking remote method '…': Error: <ours>"
      setError(String(err instanceof Error ? err.message : err).replace(/^.*Error: /, ''));
    } finally {
      setPending(null);
    }
  };

  const channels = useMemo(() => channelsOf(poll.sources), [poll.sources]);
  const t = snap?.tournament ?? null;
  const counting = poll.owner === 'tournament' && poll.state === 'running';
  // after the open round its votes are still there to fix (teach, reassign, ignore)
  const fixable = counting || (t?.phase === 'open-results' && poll.owner === 'tournament' && poll.state === 'ended');
  const [inspecting, setInspecting] = useState<RankedShow | null>(null);
  const [ignoring, setIgnoring] = useState<Show | null>(null);

  return (
    <>
      <AppHeader />
      <div className="flex h-[calc(100vh-56px)] min-h-0 gap-3 px-3 pb-3">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          {/* ---------------- steps + undo */}
          <section className="bg-card/60 flex items-center gap-3 rounded-xl border px-4 py-2.5">
            <Swords className="h-4 w-4 opacity-70" />
            <span className="max-w-56 truncate text-sm font-semibold">{t ? t.config.title : 'New tournament'}</span>
            <ol className="ml-2 flex items-center gap-1">
              {STEPS.map((s, i) => {
                const at = t ? STEPS.findIndex((x) => x.phase.includes(t.phase)) : -1;
                const state = !t ? 'todo' : i < at ? 'done' : i === at ? 'now' : 'todo';
                return (
                  <li key={s.label} className="flex items-center gap-1">
                    {i > 0 && <span className="bg-foreground/15 h-px w-4" />}
                    <span
                      className={cn(
                        'flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap',
                        state === 'now' && 'bg-foreground text-background',
                        state === 'done' && 'text-emerald-600 dark:text-emerald-400',
                        state === 'todo' && 'text-muted-foreground'
                      )}
                    >
                      {state === 'done' && <Check className="h-3 w-3" />}
                      {s.label}
                    </span>
                  </li>
                );
              })}
            </ol>
            <div className="grow" />
            <Button
              size="sm"
              variant="outline"
              disabled={!snap?.canUndo || pending !== null}
              title={snap?.undoLabel ? `Undo: ${snap.undoLabel}` : 'Nothing to undo'}
              onClick={() => act({ type: 'undo' })}
            >
              {pending === 'undo' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Undo2 className="h-3.5 w-3.5" />}
              Undo
              {snap?.undoLabel && <span className="text-muted-foreground hidden max-w-40 truncate font-normal xl:inline">· {snap.undoLabel}</span>}
            </Button>
            {t && (
              <Button size="sm" variant="ghost" onClick={() => setClosing(true)} title="Close the tournament">
                <X className="h-3.5 w-3.5" /> Close
              </Button>
            )}
          </section>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300"
              >
                <AlertTriangle className="h-4 w-4" /> {error}
              </motion.div>
            )}
          </AnimatePresence>

          {snap?.viewing && <Viewing snap={snap} library={library} act={act} />}

          {!snap ? null : !t ? (
            <Setup snap={snap} library={library} act={act} pending={pending} pollBusy={poll.state === 'running'} />
          ) : t.phase === 'open' || t.phase === 'open-results' ? (
            <OpenRound
              snap={snap}
              t={t}
              poll={poll}
              library={library}
              act={act}
              pending={pending}
              onInspect={setInspecting}
              onIgnore={setIgnoring}
            />
          ) : (
            <>
              <LiveMatch snap={snap} poll={poll} library={library} channels={channels} act={act} pending={pending} />
              <section className="bg-card/60 flex min-h-0 flex-1 flex-col rounded-xl border">
                <BracketEditor snap={snap} library={library} channels={channels} act={act} />
              </section>
            </>
          )}
        </div>

        <aside className="flex w-[300px] shrink-0 flex-col gap-3">
          {t && <ScreenPicker snap={snap!} act={act} />}
          {t && (
            <div className="bg-card/60 rounded-xl border px-3 py-2.5">
              <div className="text-muted-foreground mb-1.5 text-[11px] font-medium tracking-wide uppercase">Chat</div>
              <div className="flex flex-wrap gap-1.5">
                {poll.sources.filter((c) => c.enabled).length ? (
                  poll.sources.filter((c) => c.enabled).map((c) => <Source key={c.id} channel={c} />)
                ) : (
                  <Link to="/settings" className="text-muted-foreground text-xs hover:underline">
                    No channels yet – add one in Settings
                  </Link>
                )}
              </div>
            </div>
          )}
          {fixable ? (
            <UnmatchedPanel phrases={poll.unmatched} onAssign={(p) => setAssigning({ phrase: p, current: null })} />
          ) : (
            <History snap={snap} library={library} act={act} />
          )}
        </aside>
      </div>

      <AssignDialog phrase={assigning?.phrase ?? null} currentShowId={assigning?.current} onClose={() => setAssigning(null)} />
      <PhrasesDialog
        show={inspecting}
        version={poll.version}
        onClose={() => setInspecting(null)}
        onReassign={(p) => {
          setAssigning({ phrase: p, current: inspecting?.id ?? null });
          setInspecting(null);
        }}
      />
      <Dialog open={ignoring !== null} onOpenChange={(o) => !o && setIgnoring(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ignore {ignoring?.titleRomaji}?</DialogTitle>
            <DialogDescription>
              It disappears from this and every future poll; its votes are re-matched to the next best show (or land in
              Unmatched). Undo it in Settings → Library. To only take it out of this tournament, use Remove instead.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setIgnoring(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                if (ignoring) await window.GOTPoll.ignores.set(ignoring.id, true);
                setIgnoring(null);
              }}
            >
              Ignore
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={closing} onOpenChange={setClosing}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Close {t?.config.title}?</DialogTitle>
            <DialogDescription>
              {t?.phase === 'done'
                ? 'It stays in the history – its runner-up can come back next time.'
                : 'It isn’t finished, so it won’t be kept. This can’t be undone.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setClosing(false)}>
              Keep it open
            </Button>
            <Button
              variant={t?.phase === 'done' ? 'default' : 'destructive'}
              onClick={async () => {
                setClosing(false);
                await act({ type: 'close' });
              }}
            >
              Close tournament
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

// ------------------------------------------------------------ setup

function Setup({
  snap,
  library,
  act,
  pending,
  pollBusy,
}: {
  snap: TournamentSnapshot;
  library: Map<number, Show>;
  act: (a: TournamentAction) => Promise<void>;
  pending: string | null;
  pollBusy: boolean;
}) {
  const d = snap.draft;
  const { info: catalogInfo } = useCatalog();
  const [title, setTitle] = useState(d.title);
  useEffect(() => setTitle(d.title), [d.title]);
  const set = (patch: Partial<TournamentConfig>) => act({ type: 'draft', patch });
  const spots = d.size - d.carried.length;
  const toggle = <K extends keyof PollFilters>(key: K, value: PollFilters[K][number]) => {
    const list = d.filters[key] as string[];
    const next = list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
    if (next.length) void set({ filters: { ...d.filters, [key]: next } });
  };
  const runnersUp = (n: number) => [...new Set(snap.history.slice(0, n).map((h) => h.runnerUp))].filter((id) => library.has(id));

  return (
    <section className="bg-card/60 min-h-0 flex-1 overflow-y-auto rounded-xl border">
      <div className="grid gap-5 p-5 lg:grid-cols-2">
        <div className="space-y-4">
          <FilterGroup label="Name">
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={() => title !== d.title && set({ title })}
              className="h-8 w-72"
            />
          </FilterGroup>
          <FilterGroup label={`Bracket · ${d.size} shows`}>
            {[4, 8, 16, 32].map((n) => (
              <FilterChip key={n} on={d.size === n} onClick={() => set({ size: n })}>
                {n}
              </FilterChip>
            ))}
            <Input
              type="number"
              min={2}
              max={32}
              value={d.size}
              onChange={(e) => set({ size: Number(e.target.value) })}
              className="h-7 w-16 text-xs"
              title="Any size from 2 to 32 – top seeds get byes"
            />
          </FilterGroup>
          <FilterGroup label={`Qualifiers screen · top ${d.showTop}`}>
            {[5, 8, 10, 16].map((n) => (
              <FilterChip key={n} on={d.showTop === n} onClick={() => set({ showTop: n })}>
                {n}
              </FilterChip>
            ))}
            <Input
              type="number"
              min={1}
              max={30}
              value={d.showTop}
              onChange={(e) => set({ showTop: Number(e.target.value) })}
              className="h-7 w-16 text-xs"
            />
          </FilterGroup>
          <FilterGroup label="Third place">
            <FilterChip on={d.thirdPlace} onClick={() => set({ thirdPlace: !d.thirdPlace })} title="The semi-final losers play for third – before or after the final, your call">
              Play for third
            </FilterChip>
          </FilterGroup>
          <FilterGroup label={`Open round counts · ${catalogInfo?.name ?? ''}`}>
            {(catalogInfo?.formats ?? FORMATS).map((f) => (
              <FilterChip key={f.id} on={d.filters.formats.includes(f.id)} onClick={() => toggle('formats', f.id)}>
                {f.label}
              </FilterChip>
            ))}
            {catalogInfo?.releases !== false && <span className="bg-foreground/10 mx-1 h-4 w-px" />}
            {(catalogInfo?.releases !== false ? RELEASES : []).map((r) => (
              <FilterChip key={r.id} on={d.filters.release.includes(r.id)} onClick={() => toggle('release', r.id)}>
                {r.label}
              </FilterChip>
            ))}
          </FilterGroup>
        </div>

        <div className="space-y-2">
          <FilterGroup
            label={`Returning shows · ${d.carried.length}`}
            note={
              snap.history.length > 0 ? (
                <span className="flex gap-2">
                  {[2, 3].map((n) => (
                    <button key={n} className="text-sky-600 hover:underline dark:text-sky-400" onClick={() => set({ carried: runnersUp(n) })}>
                      runners-up of the last {n}
                    </button>
                  ))}
                </span>
              ) : undefined
            }
          >
            <ShortlistEditor
              ids={d.carried}
              shows={library}
              numbered={false}
              placeholder="Add a returning show…"
              max={Math.max(0, d.size - 1)}
              onChange={(ids) => set({ carried: ids })}
              hint="They skip the open round and go straight into the bracket as top seeds."
            />
          </FilterGroup>
        </div>
      </div>

      <div className="flex items-center gap-4 border-t px-5 py-4">
        <div className="text-sm">
          <b>{spots}</b> <span className="text-muted-foreground">spot{spots === 1 ? '' : 's'} from the open round</span>
          {d.carried.length > 0 && (
            <>
              {' '}
              + <b>{d.carried.length}</b> <span className="text-muted-foreground">returning</span>
            </>
          )}
          <span className="text-muted-foreground"> = {d.size} in the bracket</span>
        </div>
        <div className="grow" />
        {pollBusy && <span className="text-muted-foreground text-xs">End the running poll first</span>}
        <Button disabled={pollBusy || spots < 1 || pending !== null} onClick={() => act({ type: 'start-open' })}>
          {pending === 'start-open' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-current" />}
          Start the open round
        </Button>
      </div>
    </section>
  );
}

function History({
  snap,
  library,
  act,
}: {
  snap: TournamentSnapshot | null;
  library: Map<number, Show>;
  act: (a: TournamentAction) => Promise<void>;
}) {
  const list = snap?.history ?? [];
  return (
    <div className="bg-card/60 flex min-h-0 flex-1 flex-col rounded-xl border">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <HistoryIcon className="h-4 w-4 opacity-60" />
        <h3 className="text-sm font-semibold">Past tournaments</h3>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {list.length === 0 && <li className="text-muted-foreground p-6 text-center text-xs">Finished tournaments land here.</li>}
        {list.map((h) => (
          <li key={h.id} className="group hover:bg-accent/50 flex items-center gap-2 rounded-md px-2 py-1.5">
            <Cover show={library.get(h.champion)} className="h-10 w-7" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-medium">{h.title}</div>
              <div className="text-muted-foreground truncate text-[11px]">
                <Crown className="mr-0.5 inline h-3 w-3 text-amber-500" />
                {library.get(h.champion)?.titleRomaji ?? '?'}
              </div>
              <div className="text-muted-foreground truncate text-[11px]">2nd · {library.get(h.runnerUp)?.titleRomaji ?? '?'}</div>
              {h.third !== undefined && (
                <div className="text-muted-foreground truncate text-[11px]">3rd · {library.get(h.third)?.titleRomaji ?? '?'}</div>
              )}
            </div>
            <span className="text-muted-foreground text-[10px]">{new Date(h.finishedAt).toLocaleDateString()}</span>
            {h.viewable && (
              <Button
                size="sm"
                variant={snap?.viewing?.record.id === h.id ? 'default' : 'outline'}
                className="h-7 px-2 text-xs"
                title="Show its bracket and report on the viewer page"
                onClick={() => act(snap?.viewing?.record.id === h.id ? { type: 'stop-viewing' } : { type: 'view-archive', id: h.id })}
              >
                <Eye className="h-3.5 w-3.5" /> {snap?.viewing?.record.id === h.id ? 'Viewing' : 'View'}
              </Button>
            )}
            <button
              className="text-muted-foreground hover:text-foreground opacity-0 group-hover:opacity-100"
              title="Forget it"
              onClick={() => act({ type: 'forget-history', id: h.id })}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ------------------------------------------------------------ open round

function OpenRound({
  snap,
  t,
  poll,
  library,
  act,
  pending,
  onInspect,
  onIgnore,
}: {
  snap: TournamentSnapshot;
  t: Tournament;
  poll: PollSnapshot;
  library: Map<number, Show>;
  act: (a: TournamentAction) => Promise<void>;
  pending: string | null;
  /** the Poll screen's per-show tools: what chat typed, ignore everywhere */
  onInspect: (s: RankedShow) => void;
  onIgnore: (s: Show) => void;
}) {
  const live = t.phase === 'open';
  const cut = live ? null : t.cut;
  const unsettled = !!cut && !cut.picked;
  // picking the tied places by hand
  const [picking, setPicking] = useState<number[] | null>(null);
  useEffect(() => {
    if (!unsettled) setPicking(null);
  }, [unsettled]);
  const time = useLiveTime(t.open.startedAt, t.open.endedAt);
  const removed = t.removed ?? [];
  const carried = t.config.carried.filter((id) => !removed.includes(id));
  const spots = t.config.size - carried.length;
  // struck-out shows: the live count already leaves them out
  const ranking = (live ? poll.ranking.map((r) => ({ id: r.id, count: r.count })) : t.open.ranking).filter((r) => !removed.includes(r.id));
  const remove = (showId: number) => act({ type: 'remove-nominee', showId });
  const voted = ranking.filter((r) => r.count > 0);
  const leader = voted[0]?.count ?? 0;

  return (
    <section className="bg-card/60 flex min-h-0 flex-1 flex-col rounded-xl border">
      <div className="flex items-center gap-4 border-b p-4">
        <StateBadge state={live ? 'running' : 'ended'} />
        <div className="font-mono text-2xl font-semibold tabular-nums">{time ?? '00:00:00'}</div>
        {live && (
          <div className="text-muted-foreground flex items-center gap-4 text-xs">
            <Stat value={poll.totalVotes} label="votes" />
            <Stat value={poll.totalVoters} label="viewers" />
          </div>
        )}
        <div className="grow" />
        {live ? (
          <>
            <Button variant="outline" disabled={pending !== null} onClick={() => act({ type: 'retry-open' })} title="Throw away the votes and start again">
              <RotateCcw className="h-3.5 w-3.5" /> Restart
            </Button>
            <Button variant="destructive" disabled={pending !== null} onClick={() => act({ type: 'stop-open' })}>
              {pending === 'stop-open' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-3.5 w-3.5 fill-current" />}
              End open round
            </Button>
          </>
        ) : (
          <>
            <Button variant="outline" disabled={pending !== null} onClick={() => act({ type: 'retry-open' })}>
              <RotateCcw className="h-3.5 w-3.5" /> Run it again
            </Button>
            <Button
              disabled={pending !== null || unsettled || voted.length + t.config.carried.length < 2}
              title={unsettled ? 'Settle the tie on the qualifying line first' : undefined}
              onClick={() => act({ type: 'build-bracket' })}
            >
              {pending === 'build-bracket' ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-3.5 w-3.5" />}
              Build the bracket
            </Button>
          </>
        )}
      </div>

      {cut && (
        <div
          className={cn(
            'flex items-center gap-3 border-b px-4 py-2.5 text-sm',
            unsettled ? 'bg-amber-500/10 text-amber-800 dark:text-amber-300' : 'text-muted-foreground'
          )}
        >
          <Scale className="h-4 w-4 shrink-0" />
          {unsettled ? (
            picking ? (
              <span className="min-w-0 flex-1">
                Tick <b>{cut.slots}</b> of the tied shows below · {picking.length}/{cut.slots}
              </span>
            ) : (
              <span className="min-w-0 flex-1">
                <b>{cut.candidates.length}</b> shows are level on <b>{cut.votes}</b> votes for the last{' '}
                {cut.slots === 1 ? 'spot' : <b>{cut.slots} spots</b>}:
                <span className="mt-1.5 flex flex-wrap gap-1.5">
                  {cut.candidates.map((id) => (
                    <span key={id} className="bg-background/70 text-foreground flex items-center gap-1.5 rounded-full border py-0.5 pr-2.5 pl-0.5 text-xs whitespace-nowrap">
                      <Cover show={library.get(id)} className="h-5 w-5 rounded-full" />
                      {library.get(id)?.titleRomaji ?? `#${id}`}
                    </span>
                  ))}
                </span>
              </span>
            )
          ) : (
            <span className="min-w-0 flex-1">
              The tie on {cut.votes} votes was settled {cut.method === 'draw' ? 'by a draw' : cut.method === 'coin' ? 'by a coin flip' : 'by hand'}:{' '}
              {cut.candidates.map((id, i) => (
                <span key={id}>
                  {i > 0 && ', '}
                  <span className={cut.picked?.includes(id) ? 'text-foreground font-semibold' : 'line-through'}>{library.get(id)?.titleRomaji ?? `#${id}`}</span>
                </span>
              ))}
              .
            </span>
          )}
          {unsettled && !picking && (
            <>
              <Button size="sm" variant="outline" disabled={pending !== null} onClick={() => setPicking([])}>
                <Hand className="h-3.5 w-3.5" /> Pick them myself
              </Button>
              <Button size="sm" disabled={pending !== null} onClick={() => act({ type: 'cut-draw' })}>
                {cut.candidates.length === 2 ? (
                  <>
                    <Coins className="h-3.5 w-3.5" /> Flip a coin
                  </>
                ) : (
                  <>
                    <Dices className="h-3.5 w-3.5" /> Draw at random
                  </>
                )}
              </Button>
            </>
          )}
          {unsettled && picking && (
            <>
              <Button size="sm" variant="ghost" onClick={() => setPicking(null)}>
                Cancel
              </Button>
              <Button size="sm" disabled={picking.length !== cut.slots || pending !== null} onClick={() => act({ type: 'cut-pick', ids: picking })}>
                <Check className="h-3.5 w-3.5" /> Confirm
              </Button>
            </>
          )}
          {!unsettled && (t.screen === 'draw' || t.screen === 'coin') && (
            <Button size="sm" variant="outline" onClick={() => act({ type: 'continue' })}>
              <ArrowRight className="h-3.5 w-3.5" /> Back to the qualifiers
            </Button>
          )}
        </div>
      )}

      {carried.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
          <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">Already in</span>
          {carried.map((id) => (
            <span key={id} className="bg-background/60 flex items-center gap-1.5 rounded-full border py-0.5 pr-1 pl-0.5 text-xs">
              <Cover show={library.get(id)} className="h-5 w-5 rounded-full" />
              {library.get(id)?.titleRomaji ?? `#${id}`}
              <button
                className="text-muted-foreground hover:text-foreground grid h-5 w-5 place-items-center rounded-full hover:bg-rose-500/15"
                title="Remove it from the tournament – its spot goes to the open round"
                disabled={pending !== null}
                onClick={() => remove(id)}
              >
                <X className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* struck out by the rules (too many episodes, already watched, …) – one click brings one back */}
      {removed.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2">
          <span className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">Removed</span>
          {removed.map((id) => (
            <span key={id} className="flex items-center gap-1.5 rounded-full border border-dashed py-0.5 pr-1 pl-0.5 text-xs opacity-70">
              <Cover show={library.get(id)} className="h-5 w-5 rounded-full grayscale" />
              <span className="line-through">{library.get(id)?.titleRomaji ?? `#${id}`}</span>
              <button
                className="text-muted-foreground hover:text-foreground grid h-5 w-5 place-items-center rounded-full hover:bg-emerald-500/15"
                title="Bring it back"
                disabled={pending !== null}
                onClick={() => act({ type: 'restore-nominee', showId: id })}
              >
                <RotateCcw className="h-3 w-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
        {voted.length === 0 ? (
          <EmptyState
            icon={live ? Swords : Trophy}
            title={live ? 'Listening to chat…' : 'Nobody voted'}
            text={live ? 'Chat can back as many shows as they like. The top ' + spots + ' go through.' : 'Run the open round again, or undo.'}
          />
        ) : (
          <LayoutGroup>
            <ol>
              <AnimatePresence initial={false}>
                {voted.slice(0, 60).map((r, i) => {
                  const s = library.get(r.id);
                  const tied = !live && snap.tied.includes(r.id);
                  const inside = live ? i < spots : snap.qualified.includes(r.id);
                  const ticked = !!picking?.includes(r.id);
                  return (
                    <motion.li
                      key={r.id}
                      layout
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                      className={cn('relative', i === spots && 'mt-3 border-t border-dashed border-rose-500/50 pt-1')}
                    >
                      {i === spots && (
                        <span className="bg-card absolute -top-2 left-3 px-1 text-[10px] font-semibold text-rose-600 dark:text-rose-400">
                          CUT-OFF
                        </span>
                      )}
                      <div
                        className={cn(
                          'group relative flex items-center gap-3 overflow-hidden rounded-md px-2 py-1.5',
                          !inside && !tied && 'opacity-55',
                          picking && tied && 'hover:bg-accent cursor-pointer'
                        )}
                        onClick={() => {
                          if (!picking || !tied) return;
                          setPicking(ticked ? picking.filter((x) => x !== r.id) : picking.length < (cut?.slots ?? 0) ? [...picking, r.id] : picking);
                        }}
                      >
                        {picking && tied && (
                          <span
                            className={cn(
                              'relative grid h-4 w-4 shrink-0 place-items-center rounded border',
                              ticked ? 'bg-foreground text-background border-foreground' : 'border-foreground/30'
                            )}
                          >
                            {ticked && <Check className="h-3 w-3" />}
                          </span>
                        )}
                        <motion.div
                          className={cn('absolute inset-y-0 left-0', inside ? 'bg-emerald-500/[0.08]' : 'bg-primary/[0.05]')}
                          animate={{ width: `${leader ? (r.count / leader) * 100 : 0}%` }}
                        />
                        <span className="relative w-6 text-center text-sm font-bold tabular-nums">{i + 1}</span>
                        <Cover show={s} className="relative h-11 w-8" />
                        <div className="relative min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{s?.titleRomaji ?? `#${r.id}`}</div>
                          <div className="text-muted-foreground truncate text-xs">{[s?.titleEnglish, s?.startYear].filter(Boolean).join(' · ')}</div>
                        </div>
                        {tied && (
                          <span className="relative rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-400">
                            TIE
                          </span>
                        )}
                        {inside && (
                          <span className="relative rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-400">
                            {live ? 'IN' : 'QUALIFIED'}
                          </span>
                        )}
                        <span className="relative w-12 text-right text-base font-bold tabular-nums">{r.count}</span>
                        {!picking && (
                          <div className="relative flex opacity-0 transition-opacity group-hover:opacity-100" onClick={(e) => e.stopPropagation()}>
                            {s && (
                              <Button
                                size="icon"
                                variant="ghost"
                                className="h-7 w-7"
                                title="What chat typed – move phrases to another show"
                                onClick={() => onInspect({ ...s, count: r.count })}
                              >
                                <MessageSquareText className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {sourceUrl(r.id) && (
                              <Button size="icon" variant="ghost" className="h-7 w-7" title="Open its page" onClick={() => window.GOTPoll.openExternal(sourceUrl(r.id)!)}>
                                <ExternalLink className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            {s && (
                              <Button size="icon" variant="ghost" className="h-7 w-7" title="Ignore it in every poll – its votes go to the next best match" onClick={() => onIgnore(s)}>
                                <EyeOff className="h-3.5 w-3.5" />
                              </Button>
                            )}
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 hover:bg-rose-500/15 hover:text-rose-600 dark:hover:text-rose-400"
                              title="Remove it from this tournament (breaks the rules) – the next show moves up"
                              disabled={pending !== null}
                              onClick={() => void remove(r.id)}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </div>
                        )}
                      </div>
                    </motion.li>
                  );
                })}
              </AnimatePresence>
            </ol>
          </LayoutGroup>
        )}
      </div>
    </section>
  );
}

// ------------------------------------------------------------ live match

function LiveMatch({
  snap,
  poll,
  library,
  channels,
  act,
  pending,
}: {
  snap: TournamentSnapshot;
  poll: PollSnapshot;
  library: Map<number, Show>;
  channels: PublicChannel[];
  act: (a: TournamentAction) => Promise<void>;
  pending: string | null;
}) {
  const t = snap.tournament!;
  const all = [...snap.rounds.flat(), ...(snap.third ? [snap.third] : [])];
  const live = t.live;
  const m = live ? all.find((x) => x.key === live.key) : null;
  const next = all.find((x) => x.status === 'ready');
  // the third-place match can go before or after the final
  const thirdReady = snap.third?.status === 'ready' && next?.key !== snap.third.key ? snap.third : null;
  const time = useLiveTime(live?.stage === 'voting' ? live.at : null, null);

  if (!live || !m) {
    if (t.phase === 'done' && !next) {
      const final = snap.rounds.at(-1)?.[0];
      const champ = typeof final?.winner === 'number' ? library.get(final.winner) : undefined;
      return (
        <section className="flex items-center gap-4 rounded-xl border border-amber-500/40 bg-gradient-to-r from-amber-500/15 to-transparent p-4">
          <Cover show={champ} className="h-16 w-12" />
          <div>
            <div className="text-[11px] font-semibold tracking-widest text-amber-600 uppercase dark:text-amber-400">Champion</div>
            <div className="text-lg font-bold">{champ?.titleRomaji}</div>
          </div>
          <div className="grow" />
          <Button variant="outline" onClick={() => act({ type: 'show', screen: 'champion' })}>
            <Monitor className="h-3.5 w-3.5" /> Show the champion
          </Button>
        </section>
      );
    }
    const pendingTies = all.filter((x) => x.status === 'tie');
    return (
      <section className="bg-card/60 flex items-center gap-3 rounded-xl border p-3">
        {t.screen === 'coin' && (
          <Button size="sm" variant="outline" onClick={() => act({ type: 'continue' })}>
            <ArrowRight className="h-3.5 w-3.5" /> Back to the bracket
          </Button>
        )}
        {pendingTies.length > 0 ? (
          <span className="flex items-center gap-2 text-sm text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4" /> {matchLabel(pendingTies[0].key, snap.rounds.length)} ended in a tie – flip a coin, pick a
            winner or rematch it from its menu.
          </span>
        ) : next ? (
          <>
            <span className="text-muted-foreground text-xs whitespace-nowrap">Up next · {matchLabel(next.key, snap.rounds.length)}</span>
            <Pair a={library.get(next.a as number)} b={library.get(next.b as number)} />
          </>
        ) : (
          <span className="text-muted-foreground text-sm">Waiting on earlier matches.</span>
        )}
        <div className="grow" />
        {thirdReady && (
          <Button variant="outline" disabled={pending !== null} onClick={() => act({ type: 'start-match', key: thirdReady.key })}>
            <Play className="h-3.5 w-3.5" /> Third place first
          </Button>
        )}
        {next && (
          <Button disabled={pending !== null} onClick={() => act({ type: 'start-match', key: next.key })}>
            {pending === 'start-match' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-current" />}
            Start match
          </Button>
        )}
      </section>
    );
  }

  const sides = [m.a, m.b] as number[];
  const liveCounts = live.stage === 'voting' && poll.owner === 'tournament';
  const count = (id: number, i: number) =>
    liveCounts ? (poll.ranking.find((r) => r.id === id)?.count ?? 0) : (m.result?.votes[i] ?? 0);
  const breakdown = (id: number, i: number) =>
    liveCounts ? poll.ranking.find((r) => r.id === id)?.breakdown : m.result?.breakdown[i];
  const total = count(sides[0], 0) + count(sides[1], 1);

  return (
    <section className="bg-card/60 rounded-xl border">
      <div className="flex items-center gap-3 border-b px-4 py-2.5">
        <span
          className={cn(
            'flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold',
            live.stage === 'voting' ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400' : 'bg-foreground/5 text-muted-foreground'
          )}
        >
          {live.stage === 'voting' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-rose-500" />}
          {live.stage === 'intro' ? 'VS screen' : live.stage === 'voting' ? 'Voting' : 'Result'}
        </span>
        <span className="text-sm font-semibold">{matchLabel(m.key, snap.rounds.length)}</span>
        {time && <span className="text-muted-foreground font-mono text-xs tabular-nums">{time}</span>}
        <div className="grow" />
        {live.stage === 'intro' && (
          <Button size="sm" variant="outline" onClick={() => act({ type: 'begin-voting' })}>
            <FastForward className="h-3.5 w-3.5" /> Open voting now
          </Button>
        )}
        {live.stage !== 'result' && (
          <Button size="sm" variant="ghost" disabled={pending !== null} onClick={() => act({ type: 'cancel-match' })}>
            Cancel
          </Button>
        )}
        {live.stage === 'voting' && (
          <Button size="sm" variant="destructive" disabled={pending !== null} onClick={() => act({ type: 'stop-match' })}>
            {pending === 'stop-match' ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-3.5 w-3.5 fill-current" />}
            End vote
          </Button>
        )}
        {live.stage === 'result' && (
          <>
            {m.status === 'tie' && (
              <Button size="sm" disabled={pending !== null} onClick={() => act({ type: 'coin-flip', key: m.key })}>
                <Coins className="h-3.5 w-3.5" /> Flip a coin
              </Button>
            )}
            {t.screen === 'coin' && <span className="text-muted-foreground text-xs">Coin flip on screen</span>}
            <Button size="sm" variant="outline" disabled={pending !== null} onClick={() => act({ type: 'retry-match', key: m.key })}>
              <RotateCcw className="h-3.5 w-3.5" /> Rematch
            </Button>
            <Button size="sm" disabled={pending !== null || m.status === 'tie'} onClick={() => act({ type: 'continue' })} title={m.status === 'tie' ? 'Pick a winner first' : undefined}>
              <ArrowRight className="h-3.5 w-3.5" /> {t.phase === 'done' ? 'Crown the champion' : 'Back to the bracket'}
            </Button>
          </>
        )}
      </div>
      <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-4 p-4">
        {sides.map((id, i) => {
          const s = library.get(id);
          const c = count(id, i);
          const won = m.status === 'done' && m.winner === id;
          const side = (
            <div key={id} className={cn('flex items-center gap-3', i === 1 && 'flex-row-reverse text-right')}>
              <div className="relative">
                <Cover show={s} className={cn('h-20 w-14', won && 'ring-2 ring-amber-400')} />
                <span className="bg-foreground text-background absolute -top-1.5 -left-1.5 grid h-5 w-5 place-items-center rounded-full text-[11px] font-black">
                  {i + 1}
                </span>
              </div>
              <div className={cn('min-w-0 flex-1 space-y-1', i === 1 && 'flex flex-col items-end')}>
                <div className="truncate text-sm font-semibold">
                  {won && <Crown className="mr-1 inline h-3.5 w-3.5 text-amber-500" />}
                  {s?.titleRomaji}
                </div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-3xl font-black tabular-nums">{c}</span>
                  <span className="text-muted-foreground text-xs tabular-nums">{total ? Math.round((c / total) * 100) : 0}%</span>
                </div>
                <BreakdownChips breakdown={breakdown(id, i)} channels={channels} />
                {live.stage === 'result' && m.status === 'tie' && (
                  <Button size="sm" variant="outline" className="h-7" onClick={() => act({ type: 'set-winner', key: m.key, showId: id })}>
                    <Crown className="h-3 w-3" /> Make it win
                  </Button>
                )}
              </div>
            </div>
          );
          return i === 0 ? (
            side
          ) : (
            <>
              <span key="vs" className="text-muted-foreground text-lg font-black italic">
                VS
              </span>
              {side}
            </>
          );
        })}
      </div>
    </section>
  );
}

// ------------------------------------------------------------ a past tournament, re-opened

function Viewing({
  snap,
  library,
  act,
}: {
  snap: TournamentSnapshot;
  library: Map<number, Show>;
  act: (a: TournamentAction) => Promise<void>;
}) {
  const v = snap.viewing!;
  const t = v.tournament;
  const matches = [...v.rounds.flat(), ...(v.third ? [v.third] : [])].filter((m) => m.result);
  const screens: { screen: TournamentScreen; label: string; ok: boolean }[] = [
    { screen: 'report', label: 'Report', ok: true },
    { screen: 'open-results', label: 'Qualifiers', ok: true },
    { screen: 'draw', label: 'Draw', ok: t.cut?.method === 'draw' },
    { screen: 'bracket', label: 'Bracket', ok: v.rounds.length > 0 },
    { screen: 'coin', label: 'Coin flip', ok: !!t.coin },
    { screen: 'champion', label: 'Champion', ok: true },
  ];
  return (
    <section className="bg-card/60 rounded-xl border border-sky-500/40">
      <div className="flex items-center gap-3 px-4 py-2.5">
        <Archive className="h-4 w-4 text-sky-600 dark:text-sky-400" />
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold">
            Viewing {v.record.title}
            <span className="text-muted-foreground ml-2 text-xs font-normal">
              finished {new Date(v.record.finishedAt).toLocaleDateString()} · read-only
            </span>
          </div>
          <div className="text-muted-foreground text-[11px]">The viewer page shows it until you stop viewing or start a new tournament.</div>
        </div>
        <div className="grow" />
        <Button size="sm" variant="outline" onClick={() => act({ type: 'stop-viewing' })}>
          <X className="h-3.5 w-3.5" /> Stop viewing
        </Button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-t border-sky-500/20 px-4 py-2">
        <span className="text-muted-foreground mr-1 text-[11px] font-medium tracking-wide uppercase">On screen</span>
        {screens
          .filter((o) => o.ok)
          .map((o) => (
            <FilterChip key={o.screen} on={t.screen === o.screen} onClick={() => act({ type: 'show', screen: o.screen })}>
              {o.label}
            </FilterChip>
          ))}
      </div>
      {matches.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-sky-500/20 px-4 py-2">
          <span className="text-muted-foreground mr-1 text-[11px] font-medium tracking-wide uppercase">Replay a match</span>
          {matches.map((m) => (
            <FilterChip
              key={m.key}
              on={t.screen === 'match' && t.focus === m.key}
              onClick={() => act({ type: 'show', screen: 'match', focus: m.key })}
              title={`${library.get(m.a as number)?.titleRomaji} vs ${library.get(m.b as number)?.titleRomaji}`}
            >
              {matchLabel(m.key, v.rounds.length)}
            </FilterChip>
          ))}
        </div>
      )}
    </section>
  );
}

// ------------------------------------------------------------ viewer page control

function ScreenPicker({ snap, act }: { snap: TournamentSnapshot; act: (a: TournamentAction) => Promise<void> }) {
  const t = snap.tournament!;
  const bracket = t.phase === 'bracket' || t.phase === 'done';
  const focus = t.focus ? [...snap.rounds.flat(), snap.third].find((m) => m?.key === t.focus) : null;
  const pair = focus && typeof focus.a === 'number' && typeof focus.b === 'number';
  const options: { screen: TournamentScreen; label: string; ok: boolean }[] = [
    { screen: 'open', label: 'Open round', ok: t.phase === 'open' },
    { screen: 'open-results', label: 'Qualifiers', ok: t.phase !== 'open' },
    { screen: 'draw', label: 'Draw', ok: t.cut?.method === 'draw' },
    { screen: 'bracket', label: 'Bracket', ok: bracket },
    { screen: 'intro', label: 'VS', ok: bracket && !!pair },
    { screen: 'match', label: 'Match', ok: bracket && !!focus && (t.live?.key === focus.key || !!focus.result) },
    { screen: 'coin', label: 'Coin flip', ok: !!t.coin && (t.coin.key !== 'cut' || t.cut?.method === 'coin') },
    { screen: 'champion', label: 'Champion', ok: t.phase === 'done' },
    { screen: 'report', label: 'Report', ok: bracket },
  ];
  return (
    <div className="bg-card/60 rounded-xl border px-3 py-2.5">
      <div className="text-muted-foreground mb-1.5 flex items-center gap-1.5 text-[11px] font-medium tracking-wide uppercase">
        <Monitor className="h-3 w-3" /> Viewer page shows
      </div>
      <div className="flex flex-wrap gap-1.5">
        {options
          .filter((o) => o.ok || o.screen === t.screen)
          .map((o) => (
            <FilterChip key={o.screen} on={t.screen === o.screen} onClick={() => act({ type: 'show', screen: o.screen })}>
              {o.label}
            </FilterChip>
          ))}
      </div>
      {focus && bracket && (
        <div className="text-muted-foreground mt-1.5 text-[11px]">VS / Match screens use {matchLabel(focus.key, snap.rounds.length)}</div>
      )}
    </div>
  );
}

// ------------------------------------------------------------ bits

function Cover({ show, className }: { show: Show | undefined; className?: string }) {
  return show?.coverImage ? (
    <img src={show.coverImage} alt="" className={cn('shrink-0 rounded object-cover', className)} />
  ) : (
    <div className={cn('bg-muted shrink-0 rounded', className)} />
  );
}

function Pair({ a, b }: { a: Show | undefined; b: Show | undefined }) {
  return (
    <span className="flex min-w-0 items-center gap-2 text-sm font-medium">
      <Cover show={a} className="h-8 w-6" />
      <span className="truncate">{a?.titleRomaji}</span>
      <span className="text-muted-foreground text-xs font-black italic">VS</span>
      <span className="truncate">{b?.titleRomaji}</span>
      <Cover show={b} className="h-8 w-6" />
    </span>
  );
}
