import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import { ExternalLink, Info, Loader2, MessageSquareText, Play, RotateCcw, Radio, Swords, Trophy, Square, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import AssignDialog from '~/components/poll/assign-dialog';
import PhrasesDialog from '~/components/poll/phrases-dialog';
import UnmatchedPanel from '~/components/poll/unmatched-panel';
import AppHeader from '~/components/app/app-header';
import { EmptyState, FilterChip, FilterGroup, Source, StateBadge, Stat } from '~/components/poll/bits';
import ShortlistEditor from '~/components/poll/shortlist-editor';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import useLiveTime from '~/hooks/useLiveTime';
import useCatalog from '~/hooks/useCatalog';
import useCatalogs from '~/hooks/useCatalogs';
import useLibrary from '~/hooks/useLibrary';
import usePoll from '~/hooks/usePoll';
import { cn } from '~/lib/utils';

const FORMATS: { id: ShowFormat; label: string }[] = [
  { id: 'TV', label: 'TV' },
  { id: 'MOVIE', label: 'Movie' },
  { id: 'TV_SHORT', label: 'Short' },
];

const RELEASES: { id: ShowRelease; label: string; hint: string }[] = [
  { id: 'released', label: 'Released', hint: 'At least one full season out (sequels may still be airing)' },
  { id: 'airing', label: 'Airing', hint: 'First season still airing' },
  { id: 'upcoming', label: 'Upcoming', hint: 'Not aired yet' },
];

export default function Home() {
  const snap = usePoll();
  const time = useLiveTime(snap.startedAt, snap.endedAt);
  const [filters, setFilters] = useState<PollFilters | null>(null);
  const [mode, setMode] = useState<PollMode>('open');
  const [shortlist, setShortlist] = useState<number[]>([]);
  const library = useLibrary();
  const catalogs = useCatalogs();
  const { info: catalogInfo } = useCatalog();
  useEffect(() => {
    window.GOTPoll.settings.get().then((s) => {
      setFilters(s.pollFilters);
      setMode(s.pollMode);
      setShortlist(s.pollShortlist);
    });
  }, []);
  // remember edits right away, not only when a poll starts
  const saveShortlist = (ids: number[]) => {
    setShortlist(ids);
    void window.GOTPoll.settings.set({ pollShortlist: ids });
  };
  const chooseMode = (m: PollMode) => {
    setMode(m);
    void window.GOTPoll.settings.set({ pollMode: m });
  };
  // options saved for another catalog don't belong in this one
  const options = library.size ? shortlist.filter((id) => library.has(id)) : shortlist;
  const shortlistTooShort = mode === 'shortlist' && options.length < 2;
  const [busy, setBusy] = useState(false);
  const [assigning, setAssigning] = useState<{ phrase: PollPhrase; current: number | null } | null>(null);
  const [inspecting, setInspecting] = useState<RankedShow | null>(null);
  const [ignoring, setIgnoring] = useState<RankedShow | null>(null);
  const [preview, setPreview] = useState<RankedShow | null>(null);

  const running = snap.state === 'running';
  // while live, show what the poll really runs (a shortlist with none of its
  // options in this catalog runs as an open poll)
  const shownMode = running ? snap.mode : mode;
  const formatLabel = (f: ShowFormat) => catalogInfo?.formats.find((x) => x.id === f)?.label ?? f;
  const [tournamentOpen, setTournamentOpen] = useState(false);
  useEffect(() => {
    window.GOTPoll.tournament.snapshot().then((t) => setTournamentOpen(!!t.tournament));
    return window.GOTPoll.tournament.onUpdate((t) => setTournamentOpen(!!t.tournament));
  }, []);
  const leader = snap.ranking[0]?.count ?? 0;

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  // a group can't be emptied: no shows would count
  const toggle = <K extends keyof PollFilters>(key: K, value: PollFilters[K][number]) => {
    if (!filters) return;
    const list = filters[key] as string[];
    const next = list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
    if (next.length) setFilters({ ...filters, [key]: next });
  };

  return (
    <>
      <AppHeader />

      <div className="flex h-[calc(100vh-56px)] min-h-0 gap-3 px-3 pb-3">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
          {tournamentOpen && (
            <Link
              to="/tournament"
              className="flex items-center gap-2 rounded-xl border border-violet-500/30 bg-violet-500/10 px-3 py-2 text-xs text-violet-700 hover:bg-violet-500/15 dark:text-violet-300"
            >
              <Swords className="h-4 w-4" />
              A tournament is open – chat is counted there. Close it to run a normal poll.
            </Link>
          )}
          {/* ---------------- poll card */}
          <section className="bg-card/60 rounded-xl border">
            <div className="flex items-center gap-4 p-4">
              <StateBadge state={snap.state} />
              <div className="font-mono text-2xl font-semibold tabular-nums">{time ?? '00:00:00'}</div>
              <div className="text-muted-foreground flex items-center gap-4 text-xs">
                <Stat value={snap.totalVotes} label="votes" />
                <Stat value={snap.totalVoters} label="viewers" />
                <Stat value={snap.messages} label="messages" />
                {snap.filteredVotes > 0 && (
                  <span title="Votes for shows the filters leave out – not counted">
                    <Stat value={snap.filteredVotes} label="filtered" />
                  </span>
                )}
              </div>
              <div className="grow" />
              {tournamentOpen ? null : running ? (
                <Button variant="destructive" disabled={busy} onClick={() => act(() => window.GOTPoll.poll.stop())}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-3.5 w-3.5 fill-current" />}
                  End poll
                </Button>
              ) : (
                <div className="flex gap-2">
                  {snap.state === 'ended' && (
                    <Button variant="outline" disabled={busy} onClick={() => act(() => window.GOTPoll.poll.reset())}>
                      <RotateCcw className="h-3.5 w-3.5" />
                      Clear
                    </Button>
                  )}
                  <Button
                    disabled={busy || !filters || shortlistTooShort}
                    title={shortlistTooShort ? 'Add at least two options' : undefined}
                    onClick={() => filters && act(() => window.GOTPoll.poll.start({ mode, filters, shortlist: options }))}
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                    {snap.state === 'ended' ? 'New poll' : 'Start poll'}
                  </Button>
                </div>
              )}
            </div>

            {filters && (
              <div className="flex flex-wrap items-start gap-x-8 gap-y-3 border-t px-4 py-3">
                <FilterGroup label="Catalog">
                  {catalogs
                    .filter((c) => c.installed && (c.kind !== 'custom' || c.count > 0))
                    .map((c) => (
                      <FilterChip
                        key={c.id}
                        on={c.selected}
                        disabled={running || tournamentOpen}
                        title={running || tournamentOpen ? 'Switch catalogs between polls' : `Vote from ${c.name}`}
                        onClick={() => !c.selected && window.GOTPoll.catalogs.select(c.id).catch(() => {})}
                      >
                        {c.name}
                      </FilterChip>
                    ))}
                </FilterGroup>
                <FilterGroup label="Poll">
                  <FilterChip on={shownMode === 'open'} disabled={running} onClick={() => chooseMode('open')} title="Any show in the library">
                    Open
                  </FilterChip>
                  <FilterChip
                    on={shownMode === 'shortlist'}
                    disabled={running}
                    onClick={() => chooseMode('shortlist')}
                    title="Only shows you pick – chat can vote by number"
                  >
                    Shortlist
                  </FilterChip>
                </FilterGroup>
                {shownMode === 'shortlist' ? (
                  <div className="min-w-0 basis-full">
                    <FilterGroup label={`Options · ${options.length}`}>
                      <ShortlistEditor ids={options} shows={library} disabled={running} onChange={saveShortlist} />
                    </FilterGroup>
                  </div>
                ) : (
                <>
                <FilterGroup label="Format">
                  {(catalogInfo?.formats ?? FORMATS).map((f) => (
                    <FilterChip
                      key={f.id}
                      on={filters.formats.includes(f.id)}
                      disabled={running}
                      onClick={() => toggle('formats', f.id)}
                    >
                      {f.label}
                    </FilterChip>
                  ))}
                </FilterGroup>
                {catalogInfo?.releases !== false && (
                <FilterGroup
                  label="Release"
                  note={
                    !snap.releaseKnown ? (
                      <Link to="/settings" className="text-amber-600 hover:underline dark:text-amber-400">
                        Update the catalog to use this
                      </Link>
                    ) : undefined
                  }
                >
                  {RELEASES.map((r) => (
                    <FilterChip
                      key={r.id}
                      title={r.hint}
                      on={filters.release.includes(r.id)}
                      disabled={running || !snap.releaseKnown}
                      onClick={() => toggle('release', r.id)}
                    >
                      {r.label}
                    </FilterChip>
                  ))}
                </FilterGroup>
                )}
                </>
                )}
                <FilterGroup label="Chat">
                  {snap.sources.filter((c) => c.enabled).length ? (
                    snap.sources.filter((c) => c.enabled).map((c) => <Source key={c.id} channel={c} />)
                  ) : (
                    <Link to="/settings" className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline">
                      No channels yet – add one in Settings
                    </Link>
                  )}
                </FilterGroup>
                {running && <span className="text-muted-foreground self-end text-[11px]">Filters are locked while the poll is live</span>}
              </div>
            )}
          </section>

          <AnimatePresence>
            {snap.catalogPending && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-2 rounded-xl border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-700 dark:text-sky-300"
              >
                <Info className="h-4 w-4" />
                The catalog was updated. This poll keeps counting with the list it started with – the new one applies to
                the next poll.
              </motion.div>
            )}
          </AnimatePresence>

          {/* ---------------- ranking */}
          <section className="bg-card/60 flex min-h-0 flex-1 flex-col rounded-xl border">
            <div className="flex items-center gap-2 border-b px-4 py-2.5">
              <Trophy className="h-4 w-4 opacity-70" />
              <h2 className="text-sm font-semibold">Ranking</h2>
              {snap.ranking.length > 0 && <span className="text-muted-foreground text-xs">{snap.ranking.length} shows</span>}
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-1.5">
            {snap.ranking.length === 0 ? (
              <EmptyState
                icon={running ? Radio : Trophy}
                title={running ? 'Listening to chat…' : snap.state === 'ended' ? 'No votes this time' : 'Ready when you are'}
                text={
                  running
                    ? 'Votes appear here as viewers type anime titles.'
                    : 'Pick what counts above, then start the poll. Votes show up here live.'
                }
              />
            ) : (
              <LayoutGroup>
                <ol>
                  <AnimatePresence initial={false}>
                    {snap.ranking.map((s, i) => (
                      <motion.li
                        key={s.id}
                        layout
                        initial={{ opacity: 0, y: -8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0 }}
                        transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                        className="group hover:bg-accent/50 relative flex items-center gap-3 overflow-hidden rounded-md px-2 py-1.5"
                      >
                        <motion.div
                          className="bg-primary/[0.07] absolute inset-y-0 left-0"
                          animate={{ width: `${leader ? (s.count / leader) * 100 : 0}%` }}
                          transition={{ type: 'spring', stiffness: 120, damping: 24 }}
                        />
                        <span
                          className={cn(
                            'relative w-6 text-center text-sm font-bold tabular-nums',
                            i === 0 ? 'text-amber-500' : i === 1 ? 'text-slate-400' : i === 2 ? 'text-orange-400' : 'text-muted-foreground'
                          )}
                        >
                          {i + 1}
                        </span>
                        {s.option !== undefined && (
                          <span className="bg-foreground text-background relative grid h-5 min-w-5 place-items-center rounded px-1 text-[10px] font-bold tabular-nums" title={`Chat types ${s.option}`}>
                            #{s.option}
                          </span>
                        )}
                        {s.coverImage ? (
                          <img src={s.coverImage} alt="" className="relative h-11 w-8 shrink-0 rounded object-cover" />
                        ) : (
                          <div className="bg-muted relative h-11 w-8 shrink-0 rounded" />
                        )}
                        <div className="relative min-w-0 flex-1">
                          <div className="truncate text-sm font-medium">{s.titleRomaji}</div>
                          <div className="text-muted-foreground truncate text-xs">
                            {[s.titleEnglish, s.startYear].filter(Boolean).join(' · ')}
                          </div>
                        </div>
                        <Badge variant="outline" className="relative text-[10px]">
                          {formatLabel(s.format)}
                        </Badge>
                        <span className="relative w-12 text-right text-base font-bold tabular-nums">{s.count}</span>
                        <div className="relative flex opacity-0 transition-opacity group-hover:opacity-100">
                          <Button size="icon" variant="ghost" className="h-7 w-7" title="What chat typed" onClick={() => setInspecting(s)}>
                            <MessageSquareText className="h-3.5 w-3.5" />
                          </Button>
                          {s.id > 0 && (
                            <Button size="icon" variant="ghost" className="h-7 w-7" title="Open on AniList" onClick={() => setPreview(s)}>
                              <ExternalLink className="h-3.5 w-3.5" />
                            </Button>
                          )}
                          <Button size="icon" variant="ghost" className="h-7 w-7" title="Ignore this show" onClick={() => setIgnoring(s)}>
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </div>
                      </motion.li>
                    ))}
                  </AnimatePresence>
                </ol>
              </LayoutGroup>
            )}
            </div>
          </section>
        </div>

        <aside className="flex w-[300px] shrink-0 flex-col">
          <UnmatchedPanel phrases={snap.unmatched} onAssign={(p) => setAssigning({ phrase: p, current: null })} />
        </aside>
      </div>

      <AssignDialog
        phrase={assigning?.phrase ?? null}
        currentShowId={assigning?.current}
        onClose={() => setAssigning(null)}
      />
      <PhrasesDialog
        show={inspecting}
        version={snap.version}
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
              It disappears from this and future polls. Its votes are re-matched to the next best show (or land in
              Unmatched). You can undo this in Settings → Shows.
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

      <Dialog open={preview !== null} onOpenChange={(o) => !o && setPreview(null)}>
        <DialogContent className="mt-[24px] h-fit w-fit !max-w-none overflow-hidden p-0">
          <webview className="h-[calc(100vh-64px)] w-[calc(100vw-24px)]" src={`https://anilist.co/anime/${preview?.id}`} />
        </DialogContent>
      </Dialog>
    </>
  );
}


