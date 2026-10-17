import { Twitch, Youtube } from 'lucide-react';
import { cn } from '~/lib/utils';

function RumbleGlyph({ className }: { className?: string }) {
  // simplified Rumble mark: a rounded play shape inside a soft ring
  return (
    <svg viewBox="0 0 24 24" className={className} fill="currentColor" aria-hidden>
      <path d="M14.9 3.6c-2.1-1.5-5-1.6-7.2-.3C5 4.9 3.6 7.9 3.8 11.2c.1 1.6.6 3.2 1.4 4.6.4.7 1.3.9 2 .5l.3-.2c.6-.4.8-1.2.5-1.9-.6-1.1-.9-2.3-.9-3.5 0-2.3 1.3-4.4 3.3-5.4 1.5-.8 3.3-.7 4.7.2l.2.1c.6.5.6 1.4 0 1.9L10 11.7c-.8.6-.8 1.8 0 2.4l5.4 4.1c.6.4.6 1.3 0 1.8-.1.1-.3.2-.4.3-.7.4-.9 1.3-.5 2 .4.7 1.3.9 2 .5.3-.2.6-.4.9-.6 2.1-1.6 2.3-4.7.4-6.6l-2.7-2.1 2.7-2c2.2-1.7 2-5.1-.4-6.6z" />
    </svg>
  );
}

export const PLATFORMS: Record<
  ChatPlatform,
  {
    name: string;
    color: string;
    placeholder: string;
    help: string;
    examples: string[];
  }
> = {
  twitch: {
    name: 'Twitch',
    color: '#9146FF',
    placeholder: 'yourchannel or twitch.tv/yourchannel',
    help: 'Any public channel. Joins anonymously – no login.',
    examples: ['yourchannel', 'twitch.tv/yourchannel'],
  },
  youtube: {
    name: 'YouTube',
    color: '#FF0033',
    placeholder: '@handle, UC… channel id or a stream link',
    help: 'A channel follows every stream it starts. A stream link watches just that one.',
    examples: ['@yourchannel', 'youtube.com/@yourchannel', 'youtu.be/…'],
  },
  rumble: {
    name: 'Rumble',
    color: '#85C742',
    placeholder: 'rumble.com/c/YourChannel or a live video link',
    help: 'A channel link follows every stream automatically. No key needed.',
    examples: ['rumble.com/c/YourChannel', 'rumble.com/v…-stream.html'],
  },
};

export const PLATFORM_ORDER: ChatPlatform[] = ['twitch', 'youtube', 'rumble'];

export function PlatformIcon({
  platform,
  className,
  style,
}: {
  platform: ChatPlatform;
  className?: string;
  style?: React.CSSProperties;
}) {
  if (platform === 'rumble') {
    return (
      <span className={cn('inline-flex h-4 w-4', className)} style={style}>
        <RumbleGlyph className="h-full w-full" />
      </span>
    );
  }
  const Icon = platform === 'twitch' ? Twitch : Youtube;
  return <Icon className={cn('h-4 w-4', className)} style={style} />;
}

/** Brand-coloured rounded tile with the platform glyph. */
export function PlatformTile({ platform, size = 'md' }: { platform: ChatPlatform; size?: 'sm' | 'md' | 'lg' }) {
  const color = PLATFORMS[platform].color;
  const dims = { sm: 'h-7 w-7 rounded-md', md: 'h-10 w-10 rounded-xl', lg: 'h-14 w-14 rounded-2xl' }[size];
  const icon = { sm: 'h-3.5 w-3.5', md: 'h-5 w-5', lg: 'h-7 w-7' }[size];
  return (
    <div
      className={cn('grid shrink-0 place-items-center text-white shadow-sm', dims)}
      style={{ background: `linear-gradient(135deg, ${color}, color-mix(in oklab, ${color} 70%, black))`, boxShadow: `0 4px 14px -4px ${color}88` }}
    >
      <PlatformIcon platform={platform} className={icon} />
    </div>
  );
}

const STATE_STYLE: Record<SourceState | 'idle' | 'disabled', { label: string; dot: string; text: string }> = {
  live: { label: 'Live', dot: 'bg-emerald-500', text: 'text-emerald-600 dark:text-emerald-400' },
  connecting: { label: 'Connecting', dot: 'bg-amber-400 animate-pulse', text: 'text-amber-600 dark:text-amber-400' },
  waiting: { label: 'Waiting for stream', dot: 'bg-sky-400 animate-pulse', text: 'text-sky-600 dark:text-sky-400' },
  error: { label: 'Problem', dot: 'bg-rose-500', text: 'text-rose-600 dark:text-rose-400' },
  off: { label: 'Off', dot: 'bg-muted-foreground/40', text: 'text-muted-foreground' },
  idle: { label: 'Ready', dot: 'bg-muted-foreground/50', text: 'text-muted-foreground' },
  disabled: { label: 'Disabled', dot: 'bg-muted-foreground/25', text: 'text-muted-foreground' },
};

export function StatusPill({
  status,
  enabled,
  polling,
}: {
  status: SourceStatus | undefined;
  enabled: boolean;
  polling: boolean;
}) {
  const key = !enabled ? 'disabled' : !polling || !status || status.state === 'off' ? 'idle' : status.state;
  const st = STATE_STYLE[key];
  return (
    <span className={cn('inline-flex items-center gap-1.5 text-xs font-medium', st.text)}>
      <span className={cn('h-2 w-2 rounded-full', st.dot)} />
      {st.label}
    </span>
  );
}
