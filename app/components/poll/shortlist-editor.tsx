import { AnimatePresence, motion, Reorder } from 'motion/react';
import { GripVertical, Plus, Search, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Input } from '~/components/ui/input';
import { cn } from '~/lib/utils';

const MAX = 20;

/**
 * Pick the shows a shortlist poll is between. Order = the number chat types,
 * drag to reorder.
 */
export default function ShortlistEditor({
  ids,
  shows,
  disabled,
  onChange,
}: {
  ids: number[];
  shows: Map<number, Show>;
  disabled?: boolean;
  onChange: (ids: number[]) => void;
}) {
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!query.trim()) {
      setHits([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      window.GOTPoll.catalog.search(query, 8).then((h) => {
        if (!alive) return;
        setHits(h.filter((x) => !ids.includes(x.show.id)));
        setActive(0);
      });
    }, 100);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, ids]);

  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!box.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, []);

  const add = (id: number) => {
    if (ids.length >= MAX || ids.includes(id)) return;
    onChange([...ids, id]);
    setQuery('');
    setHits([]);
  };

  return (
    <div className="space-y-2">
      <Reorder.Group axis="x" values={ids} onReorder={onChange} className="flex flex-wrap gap-2">
        <AnimatePresence initial={false}>
          {ids.map((id, i) => {
            const s = shows.get(id);
            return (
              <Reorder.Item
                key={id}
                value={id}
                dragListener={!disabled}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className={cn(
                  'bg-background/60 group relative flex w-56 items-center gap-2 rounded-lg border p-1.5 pr-2',
                  !disabled && 'cursor-grab active:cursor-grabbing'
                )}
              >
                <span className="bg-foreground text-background grid h-6 w-6 shrink-0 place-items-center rounded-md text-xs font-bold tabular-nums">
                  {i + 1}
                </span>
                {s?.coverImage ? (
                  <img src={s.coverImage} alt="" draggable={false} className="h-9 w-7 shrink-0 rounded object-cover" />
                ) : (
                  <div className="bg-muted h-9 w-7 shrink-0 rounded" />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs font-medium">{s?.titleRomaji ?? `#${id}`}</div>
                  <div className="text-muted-foreground truncate text-[10px]">{s?.titleEnglish ?? s?.startYear ?? ''}</div>
                </div>
                {!disabled && (
                  <>
                    <GripVertical className="text-muted-foreground h-3.5 w-3.5 shrink-0 opacity-0 group-hover:opacity-100" />
                    <button
                      type="button"
                      onClick={() => onChange(ids.filter((x) => x !== id))}
                      className="text-muted-foreground hover:text-foreground"
                      title="Remove option"
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </Reorder.Item>
            );
          })}
        </AnimatePresence>
      </Reorder.Group>

      {!disabled && ids.length < MAX && (
        <div ref={box} className="relative w-72">
          <Plus className="text-muted-foreground absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
          <Input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') setActive((a) => Math.min(a + 1, hits.length - 1));
              if (e.key === 'ArrowUp') setActive((a) => Math.max(a - 1, 0));
              if (e.key === 'Enter' && hits[active]) add(hits[active].show.id);
              if (e.key === 'Escape') setOpen(false);
            }}
            placeholder={ids.length ? 'Add another option…' : 'Add the first option…'}
            className="h-8 pl-8 text-xs"
          />
          <AnimatePresence>
            {open && hits.length > 0 && (
              <motion.ul
                initial={{ opacity: 0, y: -4 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -4 }}
                className="bg-popover absolute top-full z-30 mt-1 w-[26rem] overflow-hidden rounded-lg border p-1 shadow-xl"
              >
                {hits.map((h, i) => (
                  <li key={h.show.id}>
                    <button
                      type="button"
                      onMouseEnter={() => setActive(i)}
                      onClick={() => add(h.show.id)}
                      className={cn('flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left', i === active && 'bg-accent')}
                    >
                      {h.show.coverImage ? (
                        <img src={h.show.coverImage} alt="" className="h-9 w-7 shrink-0 rounded object-cover" />
                      ) : (
                        <div className="bg-muted h-9 w-7 shrink-0 rounded" />
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium">{h.show.titleRomaji}</div>
                        <div className="text-muted-foreground truncate text-[10px]">
                          {[h.show.titleEnglish, h.show.startYear, h.show.format].filter(Boolean).join(' · ')}
                        </div>
                      </div>
                    </button>
                  </li>
                ))}
              </motion.ul>
            )}
          </AnimatePresence>
          {!query && (
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 right-2.5 h-3.5 w-3.5 -translate-y-1/2 opacity-50" />
          )}
        </div>
      )}
      {ids.length > 0 && (
        <p className="text-muted-foreground text-[11px]">
          Chat votes with the title or the number – <code>1</code>, <code>#1</code>, <code>vote 1</code>,{' '}
          <code>!vote 1</code>. Drag to reorder.
        </p>
      )}
    </div>
  );
}
