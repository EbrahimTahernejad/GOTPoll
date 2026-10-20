import { motion } from 'motion/react';
import { useState } from 'react';
import { cn } from '~/lib/utils';

/** Cover art with a graceful fallback, shared-layout aware. */
export default function Cover({
  entry,
  className,
  layoutId,
}: {
  entry: Pick<PublicEntry, 'id' | 'cover' | 'title' | 'color'>;
  className?: string;
  layoutId?: string;
}) {
  const [failed, setFailed] = useState<string | null>(null);
  const initials = entry.title
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0])
    .join('')
    .toUpperCase();
  return (
    <motion.div
      layoutId={layoutId}
      className={cn('relative overflow-hidden bg-white/5', className)}
      style={{ backgroundColor: entry.color ?? undefined }}
      transition={{ type: 'spring', stiffness: 260, damping: 32 }}
    >
      {entry.cover && failed !== entry.cover ? (
        <img
          src={entry.cover}
          alt=""
          className="h-full w-full object-cover"
          draggable={false}
          // a cover that won't load (moved, blocked) falls back to the initials tile
          onError={() => setFailed(entry.cover)}
        />
      ) : (
        <div className="grid h-full w-full place-items-center text-[1.6em] font-black text-white/70">
          {initials}
        </div>
      )}
      <div className="pointer-events-none absolute inset-0 inset-ring inset-ring-white/10" />
    </motion.div>
  );
}
