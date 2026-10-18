import { Check, Trophy } from 'lucide-react';
import { useEffect, useState } from 'react';
import { PLATFORMS, PlatformIcon } from '~/components/channels/platforms';
import { cn } from '~/lib/utils';

// Small pieces shared by the poll and tournament screens.

export function Source({ channel }: { channel: ChannelState }) {
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

export function StateBadge({ state }: { state: PollState }) {
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

export function Stat({ value, label }: { value: number; label: string }) {
  return (
    <span className="tabular-nums">
      <b className="text-foreground text-sm">{value.toLocaleString()}</b> {label}
    </span>
  );
}

export function FilterGroup({ label, note, children }: { label: string; note?: React.ReactNode; children: React.ReactNode }) {
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
export function FilterChip({
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

export function EmptyState({ icon: Icon, title, text }: { icon: typeof Trophy; title: string; text: string }) {
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
