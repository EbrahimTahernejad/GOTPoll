import { AnimatePresence, motion } from 'motion/react';
import { PlatformIcon } from '~/components/channels/platforms';
import { breakdownRows, PLATFORM_COLOR } from '~/lib/tournament';
import { cn } from '~/lib/utils';
import AnimatedNumber from './animated-number';

/**
 * Votes per chat for one side of a 1v1. Platform icons only, unless the
 * streamer listens to several chats on one platform – then names too.
 */
export default function ChatSplit({
  breakdown,
  channels,
  className,
}: {
  breakdown: Record<string, number> | undefined | null;
  channels: PublicChannel[];
  className?: string;
}) {
  const rows = breakdownRows(breakdown, channels);
  return (
    <div className={cn('flex flex-wrap items-center justify-center gap-[0.5vw]', className)}>
      <AnimatePresence initial={false}>
        {rows.map((r) => (
          <motion.span
            key={r.key}
            layout
            initial={{ opacity: 0, scale: 0.7 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.7 }}
            className="flex items-center gap-[0.4em] rounded-full bg-black/35 py-[0.25em] pr-[0.7em] pl-[0.25em] text-[1em] font-bold whitespace-nowrap text-white ring-1 ring-white/10 backdrop-blur"
          >
            <span className="grid h-[1.5em] w-[1.5em] place-items-center rounded-full" style={{ background: PLATFORM_COLOR[r.platform] }}>
              <PlatformIcon platform={r.platform} className="h-[0.9em] w-[0.9em]" />
            </span>
            {r.name && <span className="max-w-[9em] truncate font-medium text-white/70">{r.name}</span>}
            <AnimatedNumber value={r.count} className="tabular-nums" />
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}
