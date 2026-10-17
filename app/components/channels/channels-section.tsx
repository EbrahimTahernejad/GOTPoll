import { AnimatePresence, motion } from 'motion/react';
import { MoreHorizontal, Pencil, Plus, Power, Repeat, Search, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '~/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { Switch } from '~/components/ui/switch';
import { cn } from '~/lib/utils';
import ChannelDialog from './channel-dialog';
import { PLATFORM_ORDER, PLATFORMS, PlatformIcon, PlatformTile, StatusPill } from './platforms';

/** Every chat channel, grouped by platform, as cards. Changes apply instantly – even mid-poll. */
export default function ChannelsSection({ poll }: { poll: PollSnapshot }) {
  const [channels, setChannels] = useState<ChannelConfig[] | null>(null);
  const [editing, setEditing] = useState<{ channel: ChannelConfig | null; platform?: ChatPlatform } | null>(null);
  const [deleting, setDeleting] = useState<ChannelConfig | null>(null);
  const [testing, setTesting] = useState<Record<string, ChannelTestResult | 'running'>>({});

  useEffect(() => {
    window.GOTPoll.settings.get().then((s) => setChannels(s.channels));
    // deep link: #add-twitch / #add-youtube / #add-rumble opens the dialog
    const m = /^#add-(twitch|youtube|rumble)$/.exec(location.hash);
    if (m) setEditing({ channel: null, platform: m[1] as ChatPlatform });
  }, []);

  const save = async (next: ChannelConfig[]) => {
    setChannels(next); // optimistic
    const s = await window.GOTPoll.settings.set({ channels: next });
    setChannels(s.channels);
  };

  const upsert = (c: ChannelConfig) => {
    const list = channels ?? [];
    save(list.some((x) => x.id === c.id) ? list.map((x) => (x.id === c.id ? c : x)) : [...list, c]);
    setEditing(null);
  };

  const quickTest = async (c: ChannelConfig) => {
    setTesting((t) => ({ ...t, [c.id]: 'running' }));
    const r = await window.GOTPoll.channels.test(c);
    setTesting((t) => ({ ...t, [c.id]: r }));
  };

  if (!channels) return null;
  const status = new Map(poll.sources.map((s) => [s.id, s.status]));
  const polling = poll.state === 'running';
  const liveCount = channels.filter((c) => c.enabled && status.get(c.id)?.state === 'live').length;
  const enabledCount = channels.filter((c) => c.enabled).length;

  return (
    <div className="space-y-6">
      {/* header */}
      <div className="flex items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Chat channels</h2>
          <p className="text-muted-foreground text-sm">
            {enabledCount} of {channels.length} enabled
            {polling && ` · ${liveCount} live now`} · changes apply instantly, even during a poll
          </p>
        </div>
        <Button onClick={() => setEditing({ channel: null })}>
          <Plus className="h-4 w-4" />
          Add channel
        </Button>
      </div>

      {PLATFORM_ORDER.map((platform) => {
        const list = channels.filter((c) => c.platform === platform);
        const meta = PLATFORMS[platform];
        return (
          <section key={platform} className="space-y-3">
            <div className="flex items-center gap-2">
              <PlatformIcon platform={platform} className="h-4 w-4" />
              <h3 className="text-sm font-semibold">{meta.name}</h3>
              <span className="text-muted-foreground bg-muted rounded-full px-2 text-xs tabular-nums">{list.length}</span>
              <div className="bg-border h-px flex-1" />
            </div>
            <div className="grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3">
              <AnimatePresence initial={false}>
                {list.map((c) => (
                  <ChannelCard
                    key={c.id}
                    channel={c}
                    status={status.get(c.id)}
                    polling={polling}
                    test={testing[c.id]}
                    onToggle={(enabled) => save(channels.map((x) => (x.id === c.id ? { ...x, enabled } : x)))}
                    onEdit={() => setEditing({ channel: c })}
                    onTest={() => quickTest(c)}
                    onDelete={() => setDeleting(c)}
                  />
                ))}
              </AnimatePresence>
              <motion.button
                layout
                onClick={() => setEditing({ channel: null, platform })}
                className="group text-muted-foreground hover:text-foreground flex min-h-[124px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed transition-colors"
                style={{ ['--brand' as string]: meta.color }}
              >
                <span className="grid h-9 w-9 place-items-center rounded-full border border-dashed transition-all group-hover:scale-110 group-hover:border-solid group-hover:border-[var(--brand)] group-hover:text-[var(--brand)]">
                  <Plus className="h-4 w-4" />
                </span>
                <span className="text-xs font-medium">Add {meta.name} channel</span>
              </motion.button>
            </div>
          </section>
        );
      })}

      <ChannelDialog
        open={editing !== null}
        initial={editing?.channel?.id ? editing.channel : null}
        presetPlatform={editing?.channel?.platform ?? editing?.platform}
        existing={channels}
        onClose={() => setEditing(null)}
        onSave={upsert}
      />

      <Dialog open={deleting !== null} onOpenChange={(o) => !o && setDeleting(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Remove {deleting?.label || deleting?.target}?</DialogTitle>
            <DialogDescription>
              {polling ? 'It disconnects right away. Votes it already counted stay.' : 'You can add it again any time.'}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (deleting) save(channels.filter((c) => c.id !== deleting.id));
                setDeleting(null);
              }}
            >
              Remove
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function ChannelCard({
  channel: c,
  status,
  polling,
  test,
  onToggle,
  onEdit,
  onTest,
  onDelete,
}: {
  channel: ChannelConfig;
  status: SourceStatus | undefined;
  polling: boolean;
  test: ChannelTestResult | 'running' | undefined;
  onToggle: (enabled: boolean) => void;
  onEdit: () => void;
  onTest: () => void;
  onDelete: () => void;
}) {
  const meta = PLATFORMS[c.platform];
  const live = c.enabled && polling && status?.state === 'live';
  const title = c.label || (c.platform === 'twitch' ? `#${c.target}` : c.target.replace(/^https?:\/\/(www\.)?/, ''));
  const subtitle = c.label ? c.target.replace(/^https?:\/\/(www\.)?/, '') : null;
  const follows = !/watch\?v=|youtu\.be|\/live\/|rumble\.com\/v[a-z0-9]+-|embed\/v/i.test(c.target);
  const detail =
    test === 'running'
      ? 'Testing…'
      : test
        ? test.result === 'live'
          ? `Test: live · ${test.messages} msgs in 5s`
          : test.result === 'offline'
            ? 'Test: found, not live right now'
            : `Test: ${test.detail}`
        : polling && c.enabled
          ? status?.detail
          : null;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.9 }}
      transition={{ type: 'spring', stiffness: 400, damping: 32 }}
      className={cn(
        'group bg-card/60 relative flex flex-col gap-3 overflow-hidden rounded-xl border p-3.5 transition-shadow hover:shadow-md',
        !c.enabled && 'opacity-60'
      )}
    >
      {/* brand glow, stronger while live */}
      <div
        className="pointer-events-none absolute -top-16 -right-16 h-40 w-40 rounded-full blur-3xl transition-opacity duration-700"
        style={{ background: meta.color, opacity: live ? 0.35 : 0.12 }}
      />
      <div className="relative flex items-start gap-3">
        <PlatformTile platform={c.platform} />
        <div className="min-w-0 flex-1">
          <div className="truncate font-semibold" title={title}>
            {title}
          </div>
          <div className="text-muted-foreground flex items-center gap-1.5 truncate text-xs">
            {subtitle && <span className="truncate">{subtitle}</span>}
            {!subtitle && (follows ? <><Repeat className="h-3 w-3" /> follows every stream</> : 'single stream')}
          </div>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="icon" variant="ghost" className="-mt-1 -mr-1 h-7 w-7 opacity-60 group-hover:opacity-100">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={onEdit}>
              <Pencil className="h-4 w-4" /> Edit
            </DropdownMenuItem>
            <DropdownMenuItem onClick={onTest}>
              <Search className="h-4 w-4" /> Test connection
            </DropdownMenuItem>
            <DropdownMenuItem onClick={() => onToggle(!c.enabled)}>
              <Power className="h-4 w-4" /> {c.enabled ? 'Disable' : 'Enable'}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem variant="destructive" onClick={onDelete}>
              <Trash2 className="h-4 w-4" /> Remove
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="relative mt-auto flex items-center justify-between gap-2">
        <div className="min-w-0">
          <StatusPill status={status} enabled={c.enabled} polling={polling} />
          {detail && (
            <div className="text-muted-foreground mt-0.5 truncate text-[11px]" title={detail}>
              {detail}
            </div>
          )}
        </div>
        <Switch checked={c.enabled} onCheckedChange={onToggle} />
      </div>
    </motion.div>
  );
}
