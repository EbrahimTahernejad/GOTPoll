import { AnimatePresence, LayoutGroup, motion } from 'motion/react';
import {
  ExternalLink,
  Info,
  Loader2,
  MessageSquareText,
  Play,
  RotateCcw,
  Settings2,
  Square,
  X,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { CatalogPill } from '~/components/app/catalog-status';
import { TitleBarContent } from '~/components/app/title-bar';
import AssignDialog from '~/components/poll/assign-dialog';
import PhrasesDialog from '~/components/poll/phrases-dialog';
import UnmatchedPanel from '~/components/poll/unmatched-panel';
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
  { id: 'TV_SHORT', label: 'TV Short' },
];

export default function Home() {
  const snap = usePoll();
  const [title, setTitle] = useState('Anime Poll');
  useEffect(() => {
    window.GOTPoll.settings.get().then((s) => setTitle(s.pollTitle));
  }, []);
  const time = useLiveTime(snap.startedAt, snap.endedAt);
  const port = useServerPort();
  const [formats, setFormats] = useState<Set<ShowFormat>>(new Set(['TV', 'MOVIE', 'TV_SHORT']));
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

  const toggleFormat = (f: ShowFormat, on: boolean) => {
    const next = new Set(formats);
    if (on) next.add(f);
    else next.delete(f);
    if (next.size) setFormats(next);
  };

  return (
    <>
      <TitleBarContent>
        <div className="flex items-center gap-2 select-none">
          <div className="h-9 w-9 bg-[url(/icon.png)] bg-cover bg-center bg-no-repeat" />
          <div className="text-xl font-semibold">{title}</div>
          {time && <div className="text-muted-foreground font-mono text-sm tabular-nums">{time}</div>}
        </div>
        <div className="grow" />
        <div className="mr-2 flex items-center gap-2">
          <CatalogPill />
          {port && (
            <Button
              variant="ghost"
              size="sm"
              className="pointer-events-auto [app-region:no-drag]"
              onClick={() => window.GOTPoll.openExternal(`http://localhost:${port}`)}
              title={`http://localhost:${port} – add as an OBS browser source`}
            >
              <ExternalLink className="h-4 w-4" />
              Viewer page
            </Button>
          )}
          <Button variant="ghost" size="icon" asChild className="pointer-events-auto [app-region:no-drag]">
            <Link to="/settings">
              <Settings2 className="h-4 w-4" />
            </Link>
          </Button>
        </div>
      </TitleBarContent>

      <div className="grid h-[calc(100vh-56px)] min-h-0 grid-cols-[1fr_300px] gap-3 px-3 pb-3">
        <div className="flex min-h-0 flex-col gap-3">
          {/* control bar */}
          <div className="bg-card/40 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-lg border px-3 py-2">
            <StateChip state={snap.state} />
            {snap.sources
              .filter((c) => c.enabled)
              .map((c) => (
                <Source key={c.id} channel={c} />
              ))}
            <div className="text-muted-foreground flex items-center gap-4 text-xs tabular-nums">
              <span>
                <b className="text-foreground">{snap.totalVoters.toLocaleString()}</b> voters
              </span>
              <span>
                <b className="text-foreground">{snap.messages.toLocaleString()}</b> messages
              </span>
            </div>
            <div className="grow" />
            <div className="flex items-center gap-4">
              {FORMATS.map((f) => (
                <div key={f.id} className="flex items-center gap-1.5">
                  <Switch
                    id={f.id}
                    checked={formats.has(f.id)}
                    disabled={running}
                    onCheckedChange={(on) => toggleFormat(f.id, on)}
                  />
                  <Label htmlFor={f.id} className="text-xs">
                    {f.label}
                  </Label>
                </div>
              ))}
            </div>
            {running ? (
              <Button variant="destructive" size="sm" disabled={busy} onClick={() => act(() => window.GOTPoll.poll.stop())}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Square className="h-3.5 w-3.5 fill-current" />}
                End poll
              </Button>
            ) : (
              <div className="flex gap-2">
                {snap.state === 'ended' && (
                  <Button variant="outline" size="sm" disabled={busy} onClick={() => act(() => window.GOTPoll.poll.reset())}>
                    <RotateCcw className="h-3.5 w-3.5" />
                    Clear
                  </Button>
                )}
                <Button size="sm" disabled={busy} onClick={() => act(() => window.GOTPoll.poll.start([...formats]))}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-3.5 w-3.5 fill-current" />}
                  {snap.state === 'ended' ? 'New poll' : 'Start poll'}
                </Button>
              </div>
            )}
          </div>

          <AnimatePresence>
            {snap.catalogPending && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="flex items-center gap-2 rounded-lg border border-sky-500/30 bg-sky-500/10 px-3 py-2 text-xs text-sky-700 dark:text-sky-300"
              >
                <Info className="h-4 w-4" />
                The catalog was updated. This poll keeps counting with the list it started with – the new one applies to
                the next poll.
              </motion.div>
            )}
          </AnimatePresence>

          {/* ranking */}
          <div className="bg-card/40 min-h-0 flex-1 overflow-y-auto rounded-lg border p-1">
            {snap.ranking.length === 0 ? (
              <div className="text-muted-foreground grid h-full place-items-center text-sm">
                {running ? 'Waiting for votes…' : 'Start a poll to count chat votes.'}
              </div>
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
        </div>

        <UnmatchedPanel phrases={snap.unmatched} onAssign={(p) => setAssigning({ phrase: p, current: null })} />
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

function StateChip({ state }: { state: PollState }) {
  const map = {
    idle: { label: 'Idle', cls: 'bg-muted text-muted-foreground' },
    running: { label: 'Live', cls: 'bg-rose-500/15 text-rose-600 dark:text-rose-400' },
    ended: { label: 'Ended', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
  }[state];
  return (
    <span className={cn('flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold', map.cls)}>
      {state === 'running' && <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />}
      {map.label}
    </span>
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
  if (status.state === 'off') return null;
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
