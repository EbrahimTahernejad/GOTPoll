import { AnimatePresence, motion } from 'motion/react';
import { Ban, Link2, MessageSquareDashed } from 'lucide-react';
import { Button } from '~/components/ui/button';

/**
 * Chat messages the matcher wasn't confident about, grouped by phrase and
 * sorted by how many viewers typed them. One click fixes a whole group.
 */
export default function UnmatchedPanel({
  phrases,
  onAssign,
}: {
  phrases: PollPhrase[];
  onAssign: (p: PollPhrase) => void;
}) {
  const multi = phrases.filter((p) => p.voters > 1);
  const list = multi.length >= 6 ? multi : phrases;
  return (
    <div className="bg-card/40 flex min-h-0 flex-col rounded-lg border">
      <div className="flex items-center gap-2 border-b px-3 py-2">
        <MessageSquareDashed className="h-4 w-4 opacity-60" />
        <h3 className="text-sm font-semibold">Unmatched chat</h3>
        <span className="text-muted-foreground ml-auto text-xs">{phrases.length}</span>
      </div>
      <ul className="min-h-0 flex-1 overflow-y-auto p-1">
        <AnimatePresence initial={false}>
          {list.map((p) => (
            <motion.li
              key={p.phrase}
              layout
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="group hover:bg-accent/60 flex items-center gap-2 rounded-md px-2 py-1"
            >
              <span className="bg-muted text-muted-foreground min-w-6 rounded px-1 text-center text-xs font-semibold tabular-nums">
                {p.voters}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm" title={p.sample}>
                {p.sample}
              </span>
              <div className="flex opacity-0 transition-opacity group-hover:opacity-100">
                <Button size="icon" variant="ghost" className="h-7 w-7" title="Count as…" onClick={() => onAssign(p)}>
                  <Link2 className="h-3.5 w-3.5" />
                </Button>
                <Button
                  size="icon"
                  variant="ghost"
                  className="h-7 w-7"
                  title="Not a vote"
                  onClick={() => window.GOTPoll.poll.dismiss(p.phrase)}
                >
                  <Ban className="h-3.5 w-3.5" />
                </Button>
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
        {phrases.length === 0 && (
          <li className="text-muted-foreground px-3 py-8 text-center text-xs">
            Messages the matcher isn’t sure about show up here. Assign one and everyone who typed it is counted.
          </li>
        )}
      </ul>
    </div>
  );
}
