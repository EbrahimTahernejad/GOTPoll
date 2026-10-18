import { Loader2, Search } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '~/components/ui/dialog';
import { Input } from '~/components/ui/input';
import { cn } from '~/lib/utils';

/** Search the library and pick one show. */
export default function ShowPicker({
  open,
  title,
  description,
  current,
  taken = [],
  onPick,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  current?: number | null;
  /** already in the bracket – picking one swaps it in */
  taken?: number[];
  onPick: (show: Show) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  useEffect(() => {
    if (!open || !query.trim()) {
      setHits([]);
      return;
    }
    let alive = true;
    setLoading(true);
    const t = setTimeout(async () => {
      const res = await window.GOTPoll.catalog.search(query, 12);
      if (alive) {
        setHits(res);
        setLoading(false);
      }
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, open]);

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl gap-3">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2" />
          <Input autoFocus placeholder="Search the library…" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-8" />
          {loading && <Loader2 className="absolute top-1/2 right-2.5 h-4 w-4 -translate-y-1/2 animate-spin opacity-50" />}
        </div>
        <ul className="-mx-2 max-h-[55vh] min-h-24 overflow-y-auto">
          {hits.map(({ show }) => (
            <li key={show.id}>
              <button
                onClick={() => onPick(show)}
                className={cn(
                  'hover:bg-accent flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors',
                  show.id === current && 'bg-accent/60'
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
                {show.id === current ? (
                  <span className="text-muted-foreground text-xs">here now</span>
                ) : (
                  taken.includes(show.id) && <span className="text-muted-foreground text-xs">in bracket · swaps</span>
                )}
              </button>
            </li>
          ))}
          {!loading && query.trim() && hits.length === 0 && (
            <li className="text-muted-foreground px-2 py-6 text-center text-sm">No shows found</li>
          )}
        </ul>
      </DialogContent>
    </Dialog>
  );
}
