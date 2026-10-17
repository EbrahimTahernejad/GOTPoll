import { Loader2, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Badge } from '~/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '~/components/ui/dialog';
import { Input } from '~/components/ui/input';
import { cn } from '~/lib/utils';

/** Pick the show a chat phrase should count for. */
export default function AssignDialog({
  phrase,
  currentShowId,
  onClose,
}: {
  phrase: PollPhrase | null;
  currentShowId?: number | null;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState<number | null>(null);

  useEffect(() => {
    if (phrase) setQuery(phrase.phrase);
  }, [phrase]);

  useEffect(() => {
    if (!phrase || !query.trim()) {
      setHits([]);
      return;
    }
    let alive = true;
    setLoading(true);
    const t = setTimeout(async () => {
      const res = await window.GOTPoll.catalog.search(query, 10);
      if (alive) {
        setHits(res);
        setLoading(false);
      }
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, phrase]);

  const assign = async (showId: number) => {
    if (!phrase) return;
    setSaving(showId);
    try {
      await window.GOTPoll.poll.assign(phrase.phrase, showId);
      onClose();
    } finally {
      setSaving(null);
    }
  };

  return (
    <Dialog open={phrase !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl gap-3">
        <DialogHeader>
          <DialogTitle>
            Count “<span className="text-primary">{phrase?.sample}</span>” as…
          </DialogTitle>
          <DialogDescription>
            {phrase?.voters ?? 0} viewer{phrase?.voters === 1 ? '' : 's'} typed this. Picking a show recounts all of
            them now and teaches the matcher for future polls.
          </DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2" />
          <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
          {loading && <Loader2 className="absolute top-1/2 right-2.5 h-4 w-4 -translate-y-1/2 animate-spin opacity-50" />}
        </div>
        <ul className="-mx-2 max-h-[55vh] overflow-y-auto">
          {hits.map(({ show, score }) => (
            <li key={show.id}>
              <button
                disabled={saving !== null}
                onClick={() => assign(show.id)}
                className={cn(
                  'hover:bg-accent flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors',
                  show.id === currentShowId && 'bg-accent/60'
                )}
              >
                {show.coverImage ? (
                  <img src={show.coverImage} alt="" className="h-12 w-9 shrink-0 rounded object-cover" />
                ) : (
                  <div className="bg-muted h-12 w-9 shrink-0 rounded" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{show.titleRomaji}</div>
                  <div className="text-muted-foreground truncate text-xs">
                    {[show.titleEnglish, show.startYear, show.format].filter(Boolean).join(' · ')}
                  </div>
                </div>
                {show.id === currentShowId && <Badge variant="secondary">current</Badge>}
                <span className="text-muted-foreground w-10 text-right text-xs tabular-nums">
                  {Math.round(score * 100)}
                </span>
                {saving === show.id && <Loader2 className="h-4 w-4 animate-spin" />}
              </button>
            </li>
          ))}
          {!loading && hits.length === 0 && (
            <li className="text-muted-foreground px-2 py-6 text-center text-sm">No shows found</li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
