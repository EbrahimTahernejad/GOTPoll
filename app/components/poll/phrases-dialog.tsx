import { Ban, Link2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '~/components/ui/dialog';

const STAGE_LABEL: Record<MatchStage, string> = {
  exact: 'exact',
  token: 'keyword',
  fuzzy: 'fuzzy',
  learned: 'taught',
};

/** What chat typed to land on a show – and a way to correct it. */
export default function PhrasesDialog({
  show,
  version,
  onClose,
  onReassign,
}: {
  show: RankedShow | null;
  version: number;
  onClose: () => void;
  onReassign: (p: PollPhrase) => void;
}) {
  const [phrases, setPhrases] = useState<PollPhrase[]>([]);
  useEffect(() => {
    if (show) window.GOTPoll.poll.phrasesFor(show.id).then(setPhrases);
  }, [show, version]);

  return (
    <Dialog open={show !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="truncate pr-6">{show?.titleRomaji}</DialogTitle>
          <DialogDescription>What chat typed to vote for this. Wrong? Move it or mark it as not a vote.</DialogDescription>
        </DialogHeader>
        <ul className="-mx-2 max-h-[55vh] overflow-y-auto">
          {phrases.map((p) => (
            <li key={p.phrase} className="hover:bg-accent/60 flex items-center gap-2 rounded-md px-2 py-1.5">
              <span className="bg-muted min-w-6 rounded px-1 text-center text-xs font-semibold tabular-nums">{p.voters}</span>
              <span className="min-w-0 flex-1 truncate text-sm">{p.sample}</span>
              {p.stage && (
                <Badge variant={p.stage === 'fuzzy' ? 'outline' : 'secondary'} className="text-[10px]">
                  {STAGE_LABEL[p.stage]}
                  {p.stage === 'fuzzy' && p.score !== null ? ` ${Math.round(p.score * 100)}` : ''}
                </Badge>
              )}
              <Button size="icon" variant="ghost" className="h-7 w-7" title="Count as another show" onClick={() => onReassign(p)}>
                <Link2 className="h-3.5 w-3.5" />
              </Button>
              <Button size="icon" variant="ghost" className="h-7 w-7" title="Not a vote – undo in Settings → Matching" onClick={() => window.GOTPoll.poll.dismiss(p.phrase)}>
                <Ban className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
