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
    <div className="bg-card/60 flex min-h-0 flex-1 flex-col rounded-xl border">
      <div className="flex items-center gap-2 border-b px-4 py-2.5">
        <MessageSquareDashed className="h-4 w-4 opacity-60" />
        <h3 className="text-sm font-semibold">Unmatched chat</h3>
        <span className="text-muted-foreground ml-auto text-xs">{phrases.length}</span>
      </div>
      <ul className="flex min-h-0 flex-1 flex-col overflow-y-auto p-1.5">
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
                  title="Not a vote – undo in Settings → Matching"
                  onClick={() => window.GOTPoll.poll.dismiss(p.phrase)}
                >
                  <Ban className="h-3.5 w-3.5" />
                </Button>
              </div>
            </motion.li>
          ))}
        </AnimatePresence>
        {phrases.length === 0 && (
          <li className="flex h-full flex-col items-center justify-center gap-3 px-6 py-12 text-center">
            <div className="bg-foreground/5 grid h-12 w-12 place-items-center rounded-2xl">
              <MessageSquareDashed className="text-muted-foreground h-5 w-5" />
            </div>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Chat the matcher isn’t sure about lands here. Assign a phrase once and everyone who typed it is counted.
            </p>
          </li>
        )}
      </ul>
    </div>
  );
}
