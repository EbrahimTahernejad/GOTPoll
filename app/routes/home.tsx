import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import {
  ExternalLink,
  Info,
  Loader2,
  MessageSquareText,
  Play,
  RotateCcw,
  Radio,
  Settings2,
  Share2,
  Trophy,
  Check,
  Square,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { CatalogPill } from '~/components/app/catalog-status';
import { ShareLinks, useShare } from '~/components/share/share-panel';
import { TitleBarContent } from '~/components/app/title-bar';
import AssignDialog from '~/components/poll/assign-dialog';
import PhrasesDialog from '~/components/poll/phrases-dialog';
import UnmatchedPanel from '~/components/poll/unmatched-panel';
import ShortlistEditor from '~/components/poll/shortlist-editor';
import { PLATFORMS, PlatformIcon } from '~/components/channels/platforms';
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
import { Label } from '~/components/ui/label';
import { Switch } from '~/components/ui/switch';
import useLiveTime from '~/hooks/useLiveTime';
import usePoll from '~/hooks/usePoll';
import useServerPort from '~/hooks/useServerPort';
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
  const [title, setTitle] = useState('Anime Poll');
  useEffect(() => {
    window.GOTPoll.settings.get().then((s) => setTitle(s.pollTitle));
  }, []);
  const time = useLiveTime(snap.startedAt, snap.endedAt);
  const port = useServerPort();
  const [filters, setFilters] = useState<PollFilters | null>(null);
  const [mode, setMode] = useState<PollMode>('open');
  const [shortlist, setShortlist] = useState<number[]>([]);
  const [library, setLibrary] = useState<Map<number, Show>>(new Map());
  useEffect(() => {
    window.GOTPoll.settings.get().then((s) => {
      setFilters(s.pollFilters);
      setMode(s.pollMode);
      setShortlist(s.pollShortlist);
    });
    window.GOTPoll.catalog.shows().then((list) => setLibrary(new Map(list.map((x) => [x.id, x]))));
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
  const shortlistTooShort = mode === 'shortlist' && shortlist.length < 2;
  const [busy, setBusy] = useState(false);
  const [assigning, setAssigning] = useState<{ phrase: PollPhrase; current: number | null } | null>(null);
  const [inspecting, setInspecting] = useState<RankedShow | null>(null);
  const [ignoring, setIgnoring] = useState<RankedShow | null>(null);
  const [preview, setPreview] = useState<RankedShow | null>(null);

  const running = snap.state === 'running';
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
      <TitleBarContent>
        <div className="flex items-center gap-2 select-none">
          <div className="h-9 w-9 bg-[url(/icon.png)] bg-cover bg-center bg-no-repeat" />
          <div className="text-xl font-semibold">{title}</div>
        </div>
        <div className="grow" />
        <div className="mr-2 flex items-center gap-2">
          <CatalogPill />
          <ShareButton />
          <Button variant="ghost" size="icon" asChild className="pointer-events-auto [app-region:no-drag]">
            <Link to="/settings">
              <Settings2 className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </TitleBarContent>

      <div className="flex h-[calc(100vh-56px)] min-h-0 gap-3 px-3 pb-3">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-3">
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
              {running ? (
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
                    onClick={() => filters && act(() => window.GOTPoll.poll.start({ mode, filters, shortlist }))}
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                    {snap.state === 'ended' ? 'New poll' : 'Start poll'}
                  </Button>
                </div>
              )}
            </div>

            {filters && (
              <div className="flex flex-wrap items-start gap-x-8 gap-y-3 border-t px-4 py-3">
                <FilterGroup label="Poll">
                  <FilterChip on={mode === 'open'} disabled={running} onClick={() => chooseMode('open')} title="Any show in the library">
                    Open
                  </FilterChip>
                  <FilterChip
                    on={mode === 'shortlist'}
                    disabled={running}
                    onClick={() => chooseMode('shortlist')}
                    title="Only shows you pick – chat can vote by number"
                  >
                    Shortlist
                  </FilterChip>
                </FilterGroup>
                {mode === 'shortlist' ? (
                  <div className="min-w-0 basis-full">
                    <FilterGroup label={`Options · ${shortlist.length}`}>
                      <ShortlistEditor ids={shortlist} shows={library} disabled={running} onChange={saveShortlist} />
                    </FilterGroup>
                  </div>
                ) : (
                <>
                <FilterGroup label="Format">
                  {FORMATS.map((f) => (
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
                          {s.format}
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


function Source({ channel }: { channel: ChannelState }) {
  const { status } = channel;
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!status.retryAt) return;
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, [status.retryAt]);
  const dot = {
    off: 'bg-muted-foreground/40',
    connecting: 'bg-amber-400 animate-pulse',
    live: 'bg-emerald-500',
    waiting: 'bg-sky-400 animate-pulse',
    error: 'bg-rose-500',
  }[status.state];
  // live countdown instead of the frozen "retrying in 8s"
  const detail =
    status.retryAt && status.detail
      ? status.detail.replace(/retrying in \d+s/, now >= status.retryAt ? 'retrying…' : `retrying in ${Math.ceil((status.retryAt - now) / 1000)}s`)
      : status.detail;
  const name =
    channel.label ||
    (channel.platform === 'twitch' ? channel.target : channel.target.replace(/^https?:\/\/(www\.)?(rumble\.com\/(c|user)\/)?/, ''));
  return (
    <span
      className="bg-background/60 flex items-center gap-1.5 rounded-full border py-0.5 pr-2 pl-1 text-xs"
      title={`${PLATFORMS[channel.platform].name} · ${channel.target}${detail ? `\n${detail}` : ''}`}
    >
      <span className="grid h-4 w-4 place-items-center rounded-full text-white" style={{ background: PLATFORMS[channel.platform].color }}>
        <PlatformIcon platform={channel.platform} className="h-2.5 w-2.5" />
      </span>
      <span className="max-w-28 truncate">{name}</span>
      <span className={cn('h-1.5 w-1.5 rounded-full', dot)} />
      {status.state !== 'live' && detail && <span className="text-muted-foreground max-w-36 truncate">{detail}</span>}
    </span>
  );
}

/** Title-bar "Share" button: viewer page links + the public link toggle. */
function ShareButton() {
  const info = useShare();
  const [open, setOpen] = useState(false);
  const online = info?.tunnel.state === 'online';
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="pointer-events-auto [app-region:no-drag]"
        onClick={() => setOpen(true)}
        title="Viewer page links"
      >
        <span className="relative">
          <Share2 className="h-4 w-4" />
          {online && <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />}
        </span>
        Share
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Share the viewer page</DialogTitle>
            <DialogDescription>The live ranking and final reveal – read-only, nothing else in the app.</DialogDescription>
          </DialogHeader>
          {info && <ShareLinks info={info} />}
        </DialogContent>
      </Dialog>
    </>
  );
}


function StateBadge({ state }: { state: PollState }) {
  const map = {
    idle: { label: 'Ready', dot: 'bg-muted-foreground/50', cls: 'text-muted-foreground' },
    running: { label: 'Live', dot: 'bg-rose-500 animate-pulse', cls: 'text-rose-600 dark:text-rose-400' },
    ended: { label: 'Ended', dot: 'bg-emerald-500', cls: 'text-emerald-600 dark:text-emerald-400' },
  }[state];
  return (
    <span className={cn('bg-foreground/5 flex items-center gap-2 rounded-full px-3 py-1 text-sm font-semibold', map.cls)}>
      <span className={cn('h-2 w-2 rounded-full', map.dot)} />
      {map.label}
    </span>
  );
}

function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span className="tabular-nums">
      <b className="text-foreground text-sm">{value.toLocaleString()}</b> {label}
    </span>
  );
}

function FilterGroup({ label, note, children }: { label: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <div className="text-muted-foreground flex items-center gap-2 text-[11px] font-medium tracking-wide uppercase">
        {label}
        {note && <span className="text-[11px] font-normal tracking-normal normal-case">· {note}</span>}
      </div>
      <div className="flex flex-wrap items-center gap-1.5">{children}</div>
    </div>
  );
}

/** Toggle chip: clearly filled when on, outlined when off. */
function FilterChip({
  on,
  disabled,
  onClick,
  title,
  children,
}: {
  on: boolean;
  disabled?: boolean;
  onClick: () => void;
  title?: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      onClick={onClick}
      aria-pressed={on}
      className={cn(
        'flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-all',
        on
          ? 'border-foreground bg-foreground text-background'
          : 'border-foreground/15 text-muted-foreground hover:border-foreground/40 hover:text-foreground',
        disabled && 'cursor-not-allowed opacity-50'
      )}
    >
      {on && <Check className="h-3 w-3" />}
      {children}
    </button>
  );
}

function EmptyState({ icon: Icon, title, text }: { icon: typeof Trophy; title: string; text: string }) {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="bg-foreground/5 grid h-14 w-14 place-items-center rounded-2xl">
        <Icon className="text-muted-foreground h-6 w-6" />
      </div>
      <div>
        <div className="font-semibold">{title}</div>
        <p className="text-muted-foreground mt-1 max-w-xs text-sm">{text}</p>
      </div>
    </div>
  );
}
