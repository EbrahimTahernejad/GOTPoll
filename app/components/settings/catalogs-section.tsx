import { AnimatePresence, motion } from 'motion/react';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Clapperboard,
  CloudDownload,
  Copy,
  Gamepad2,
  History,
  ImageUp,
  Library,
  Loader2,
  Pencil,
  Plus,
  Search,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { percent, relativeTime, statusLine, useNow } from '~/components/app/catalog-status';
import { Button } from '~/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '~/components/ui/dialog';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import useCatalogs from '~/hooks/useCatalogs';
import { cn } from '~/lib/utils';

// Settings → Catalogs: what chat votes from. The anime catalog (AniList),
// movies & series (IMDb), and any number of custom catalogs built here.

const KIND_ICON = { anilist: Sparkles, imdb: Clapperboard, games: Gamepad2, custom: Library } as const;
const SOURCE = { anilist: 'AniList', imdb: 'IMDb', games: 'Wikidata', custom: '' } as const;
const SIZE = { anilist: '', imdb: ' (~240 MB)', games: ' (about a minute)', custom: '' } as const;
const BUSY = ['running', 'validating', 'applying'];

/** Run an IPC call; Electron wraps thrown messages, unwrap them for people. */
async function attempt<T>(fn: () => Promise<T>, onError: (msg: string) => void): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    onError(String(err instanceof Error ? err.message : err).replace(/^.*Error: /, ''));
    return undefined;
  }
}

export default function CatalogsSection({ locked = false }: { locked?: boolean }) {
  const list = useCatalogs();
  // the open editor survives leaving and coming back to Settings
  const [editing, setEditingState] = useState<string | null>(() => {
    try {
      return localStorage.getItem('catalogs-editing');
    } catch {
      return null;
    }
  });
  const setEditing = (id: string | null) => {
    setEditingState(id);
    try {
      if (id) localStorage.setItem('catalogs-editing', id);
      else localStorage.removeItem('catalogs-editing');
    } catch {
      // storage unavailable – fine
    }
  };
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (!error) return;
    const t = setTimeout(() => setError(null), 6000);
    return () => clearTimeout(t);
  }, [error]);
  const editingCatalog = list.find((c) => c.id === editing && c.kind === 'custom');

  return (
    <div className="space-y-4">
      <AnimatePresence>
        {error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300"
          >
            <AlertTriangle className="h-4 w-4" /> {error}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid gap-3 xl:grid-cols-2">
        {list.map((c) => (
          <Fragment key={c.id}>
            <CatalogCard c={c} locked={locked} onError={setError} onEdit={() => setEditing(editing === c.id ? null : c.id)} editing={editing === c.id} />
            {/* the editor opens right under the catalog it edits */}
            {editingCatalog?.id === c.id && (
              <motion.div className="xl:col-span-2" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                <CustomEditor c={editingCatalog} catalogs={list} onError={setError} onClose={() => setEditing(null)} />
              </motion.div>
            )}
          </Fragment>
        ))}
        <button
          onClick={() => setCreating(true)}
          className="text-muted-foreground hover:text-foreground hover:border-foreground/30 flex min-h-28 flex-col items-center justify-center gap-2 rounded-xl border border-dashed transition-colors"
        >
          <Plus className="h-5 w-5" />
          <span className="text-sm font-medium">New catalog</span>
          <span className="text-xs">Games, characters, songs – anything chat can name</span>
        </button>
      </div>

      <NameDialog
        open={creating}
        title="New catalog"
        description="Start empty, then add titles by hand or copy them from the other catalogs."
        confirm="Create"
        onClose={() => setCreating(false)}
        onSave={async (name) => {
          const id = await attempt(() => window.GOTPoll.catalogs.create(name), setError);
          setCreating(false);
          if (id) setEditing(id);
        }}
      />
    </div>
  );
}

// ------------------------------------------------------------ one catalog

function CatalogCard({
  c,
  locked,
  onError,
  onEdit,
  editing,
}: {
  c: CatalogSummary;
  locked: boolean;
  onError: (m: string) => void;
  onEdit: () => void;
  editing: boolean;
}) {
  const Icon = KIND_ICON[c.kind];
  const busy = BUSY.includes(c.status.state);
  const now = useNow(busy);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const source = SOURCE[c.kind];
  const showProgress = busy || ((c.status.state === 'error' || c.status.state === 'done') && c.kind !== 'custom');
  const meta =
    c.kind === 'custom'
      ? `${c.count.toLocaleString()} ${c.count === 1 ? 'entry' : 'entries'} · edited ${relativeTime(c.syncedAt)}`
      : !c.installed
        ? 'Not downloaded yet'
        : `${c.eligible.toLocaleString()} titles · updated ${relativeTime(c.syncedAt)}`;
  const blurb =
    c.kind === 'anilist'
      ? 'Every anime from AniList; sequels count as their first season.'
      : c.kind === 'imdb'
        ? 'Movies, series and mini-series from IMDb’s free data – the ones with at least 2,500 votes.'
        : c.kind === 'games'
          ? 'Video games from Wikidata – the ones with articles in 8+ Wikipedias. Covers from Steam where there is one.'
          : 'Your own list, edited here.';

  return (
    <div className={cn('bg-card/60 relative overflow-hidden rounded-xl border p-4 transition-shadow', c.selected && 'border-foreground/40 shadow-md', editing && 'ring-foreground/20 ring-2')}>
      {c.selected && <span className="bg-foreground text-background absolute top-3 right-3 rounded-full px-2 py-0.5 text-[10px] font-bold">IN USE</span>}
      <div className="flex items-start gap-3">
        <div className="bg-primary/10 text-primary grid h-10 w-10 shrink-0 place-items-center rounded-lg">
          <Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1 pr-14">
          <h3 className="truncate font-semibold">{c.name}</h3>
          <p className="text-muted-foreground text-xs">{meta}</p>
          <p className="text-muted-foreground mt-1 text-xs">{blurb}</p>
        </div>
      </div>

      {showProgress && (
        <div className="mt-3 space-y-1.5">
          <div className="bg-foreground/10 h-1.5 overflow-hidden rounded-full">
            <motion.div
              className={cn('h-full rounded-full', c.status.state === 'error' ? 'bg-destructive' : 'bg-gradient-to-r from-violet-500 via-fuchsia-500 to-amber-400')}
              animate={{ width: `${c.status.state === 'error' ? 100 : percent(c.status)}%` }}
            />
          </div>
          <div className="text-muted-foreground flex items-center gap-1.5 text-[11px]">
            {busy && <Loader2 className="h-3 w-3 animate-spin" />}
            {c.status.state === 'done' && <CheckCircle2 className="h-3 w-3 text-emerald-500" />}
            {c.status.state === 'error' && <AlertTriangle className="text-destructive h-3 w-3" />}
            <span className={cn(c.status.state === 'error' && 'text-destructive')}>{statusLine(c.status, now, source)}</span>
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {!c.selected && (
          <Button
            size="sm"
            disabled={locked || !c.installed || (c.kind === 'custom' && c.count === 0)}
            title={
              locked
                ? 'Switch catalogs between polls'
                : !c.installed
                  ? 'Download it first'
                  : c.kind === 'custom' && c.count === 0
                    ? 'Add some entries first'
                    : undefined
            }
            onClick={() => attempt(() => window.GOTPoll.catalogs.select(c.id), onError)}
          >
            <Check className="h-3.5 w-3.5" /> Use this catalog
          </Button>
        )}
        {c.kind !== 'custom' &&
          (busy ? (
            <Button size="sm" variant="outline" disabled={c.status.state !== 'running'} onClick={() => window.GOTPoll.catalogs.cancel(c.id)}>
              <X className="h-3.5 w-3.5" /> Cancel
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => attempt(() => window.GOTPoll.catalogs.update(c.id), onError)}>
              <CloudDownload className="h-3.5 w-3.5" />
              {c.installed ? `Update from ${source}` : `Download from ${source}${SIZE[c.kind]}`}
            </Button>
          ))}
        {c.kind !== 'custom' && c.canRevert && !busy && (
          <Button size="sm" variant="ghost" onClick={() => window.GOTPoll.catalogs.revert(c.id)} title="Go back to the previous copy">
            <History className="h-3.5 w-3.5" /> Revert
          </Button>
        )}
        {c.kind === 'custom' && (
          <>
            <Button size="sm" variant={editing ? 'default' : 'outline'} onClick={onEdit}>
              <Pencil className="h-3.5 w-3.5" /> {editing ? 'Editing' : 'Edit'}
            </Button>
            <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setConfirmDelete(true)} title="Delete this catalog">
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </>
        )}
      </div>

      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {c.name}?</DialogTitle>
            <DialogDescription>
              Its {c.count} {c.count === 1 ? 'entry' : 'entries'} go with it. Past tournaments run on it can no longer show their titles. This can’t
              be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmDelete(false)}>
              Keep it
            </Button>
            <Button
              variant="destructive"
              onClick={async () => {
                setConfirmDelete(false);
                await attempt(() => window.GOTPoll.catalogs.remove(c.id), onError);
              }}
            >
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ------------------------------------------------------------ custom catalog editor

function CustomEditor({ c, catalogs, onError, onClose }: { c: CatalogSummary; catalogs: CatalogSummary[]; onError: (m: string) => void; onClose: () => void }) {
  const [entries, setEntries] = useState<Show[]>([]);
  const [labels, setLabels] = useState<Record<ShowFormat, string>>({ TV: 'Series', MOVIE: 'Movie', TV_SHORT: 'Short' });
  const [name, setName] = useState(c.name);
  const [filter, setFilter] = useState('');
  const [editingEntry, setEditingEntry] = useState<Show | 'new' | null>(null);
  const [copying, setCopying] = useState(false);

  const reload = () => {
    void window.GOTPoll.catalogs.entries(c.id).then(setEntries);
    void window.GOTPoll.catalogs.labels(c.id).then(setLabels);
  };
  useEffect(reload, [c.id, c.syncedAt]);
  useEffect(() => setName(c.name), [c.name]);

  const shown = useMemo(() => {
    const q = filter.trim().toLowerCase();
    return q ? entries.filter((e) => [e.titleRomaji, e.titleEnglish, ...e.synonyms].some((t) => t?.toLowerCase().includes(q))) : entries;
  }, [entries, filter]);

  return (
    <section className="bg-card/60 rounded-xl border">
      <div className="flex flex-wrap items-center gap-3 border-b px-4 py-3">
        <Library className="h-4 w-4 opacity-70" />
        <Input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => name.trim() && name !== c.name && attempt(() => window.GOTPoll.catalogs.rename(c.id, name), onError)}
          className="h-8 w-60 font-semibold"
        />
        <span className="text-muted-foreground text-xs">{entries.length} entries</span>
        <div className="grow" />
        <Button size="sm" variant="outline" onClick={() => setCopying(true)}>
          <Copy className="h-3.5 w-3.5" /> Copy from another catalog
        </Button>
        <Button size="sm" onClick={() => setEditingEntry('new')}>
          <Plus className="h-3.5 w-3.5" /> Add entry
        </Button>
        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={onClose} title="Close the editor">
          <X className="h-4 w-4" />
        </Button>
      </div>

      {/* what the three kinds are called – these become the poll's chips */}
      <div className="flex flex-wrap items-center gap-2 border-b px-4 py-2.5">
        <span className="text-muted-foreground mr-1 text-[11px] font-medium tracking-wide uppercase">Kinds of entry</span>
        {(['TV', 'MOVIE', 'TV_SHORT'] as ShowFormat[]).map((f) => (
          <Input
            key={f}
            value={labels[f]}
            onChange={(e) => setLabels({ ...labels, [f]: e.target.value })}
            onBlur={() => attempt(() => window.GOTPoll.catalogs.setLabels(c.id, { [f]: labels[f] }), onError)}
            className="h-7 w-32 text-xs"
            title="Shown on the poll's filter chips"
          />
        ))}
        <span className="text-muted-foreground text-[11px]">Only the kinds you use get a chip.</span>
      </div>

      <div className="p-3">
        {entries.length > 8 && (
          <div className="relative mb-2 w-72">
            <Search className="text-muted-foreground absolute top-1/2 left-2.5 h-3.5 w-3.5 -translate-y-1/2" />
            <Input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Find an entry…" className="h-8 pl-8 text-xs" />
          </div>
        )}
        {entries.length === 0 ? (
          <div className="text-muted-foreground p-8 text-center text-sm">No entries yet – add one, or copy titles from the anime or movies & series catalogs.</div>
        ) : (
          <ul className="grid gap-1.5 md:grid-cols-2">
            {shown.map((e) => (
              <li key={e.id} className="group hover:bg-accent/50 flex items-center gap-3 rounded-lg border px-2 py-1.5">
                <Thumb src={e.coverImage} className="h-12 w-9" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{e.titleRomaji}</div>
                  <div className="text-muted-foreground truncate text-[11px]">
                    {[labels[e.format], e.startYear, [e.titleEnglish, ...e.synonyms].filter(Boolean).join(', ')].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <div className="flex opacity-0 transition-opacity group-hover:opacity-100">
                  <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setEditingEntry(e)} title="Edit">
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    title="Remove"
                    onClick={() => attempt(() => window.GOTPoll.catalogs.removeEntry(c.id, e.id), onError).then(reload)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <EntryDialog
        entry={editingEntry}
        labels={labels}
        onClose={() => setEditingEntry(null)}
        onSave={async (input) => {
          await attempt(
            () =>
              editingEntry === 'new' || editingEntry === null
                ? window.GOTPoll.catalogs.addEntry(c.id, input).then(() => undefined)
                : window.GOTPoll.catalogs.updateEntry(c.id, editingEntry.id, input),
            onError
          );
          reload();
          setEditingEntry(null);
        }}
        onError={onError}
      />
      <CopyDialog
        open={copying}
        into={c}
        catalogs={catalogs}
        existing={entries}
        onClose={() => setCopying(false)}
        onCopy={async (s) => {
          await attempt(
            () =>
              window.GOTPoll.catalogs.addEntry(c.id, {
                title: s.titleRomaji,
                altTitles: [s.titleEnglish, ...s.synonyms].filter((x): x is string => !!x),
                year: s.startYear,
                format: s.format,
                cover: s.coverImage,
                release: s.release,
              }),
            onError
          );
          reload();
        }}
      />
    </section>
  );
}

function EntryDialog({
  entry,
  labels,
  onClose,
  onSave,
  onError,
}: {
  entry: Show | 'new' | null;
  labels: Record<ShowFormat, string>;
  onClose: () => void;
  onSave: (e: CustomEntryInput) => Promise<void>;
  onError: (m: string) => void;
}) {
  const [title, setTitle] = useState('');
  const [alts, setAlts] = useState('');
  const [year, setYear] = useState('');
  const [format, setFormat] = useState<ShowFormat>('TV');
  const [release, setRelease] = useState<ShowRelease | ''>('');
  const [cover, setCover] = useState('');
  const [uploading, setUploading] = useState(false);
  const file = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!entry) return;
    const e = entry === 'new' ? null : entry;
    setTitle(e?.titleRomaji ?? '');
    setAlts([e?.titleEnglish, ...(e?.synonyms ?? [])].filter(Boolean).join('\n'));
    setYear(e?.startYear ? String(e.startYear) : '');
    setFormat(e?.format ?? 'TV');
    setRelease(e?.release ?? '');
    setCover(e?.coverImage ?? '');
  }, [entry]);

  const upload = async (f: File) => {
    setUploading(true);
    const url = await attempt(async () => window.GOTPoll.catalogs.saveCover(await f.arrayBuffer(), f.type), onError);
    setUploading(false);
    if (url) setCover(url);
  };

  return (
    <Dialog open={entry !== null} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>{entry === 'new' ? 'Add an entry' : 'Edit entry'}</DialogTitle>
          <DialogDescription>Chat votes by its name or any of the other names you list.</DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-[1fr_auto] gap-4">
          <div className="space-y-3">
            <div className="space-y-1">
              <Label htmlFor="entry-title">Name</Label>
              <Input id="entry-title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Elden Ring" />
            </div>
            <div className="space-y-1">
              <Label htmlFor="entry-alts">Other names chat might use</Label>
              <textarea
                id="entry-alts"
                value={alts}
                onChange={(e) => setAlts(e.target.value)}
                rows={3}
                placeholder={'One per line, e.g.\nER\nElden'}
                className="border-input placeholder:text-muted-foreground w-full rounded-md border bg-transparent px-3 py-2 text-sm"
              />
            </div>
            <div className="flex gap-3">
              <div className="w-24 space-y-1">
                <Label htmlFor="entry-year">Year</Label>
                <Input id="entry-year" inputMode="numeric" value={year} onChange={(e) => setYear(e.target.value.replace(/\D/g, '').slice(0, 4))} />
              </div>
              <div className="flex-1 space-y-1">
                <Label>Kind</Label>
                <div className="flex gap-1">
                  {(['TV', 'MOVIE', 'TV_SHORT'] as ShowFormat[]).map((f) => (
                    <button
                      key={f}
                      type="button"
                      onClick={() => setFormat(f)}
                      className={cn(
                        'flex-1 truncate rounded-md border px-2 py-1.5 text-xs',
                        format === f ? 'bg-foreground text-background border-foreground' : 'text-muted-foreground'
                      )}
                    >
                      {labels[f]}
                    </button>
                  ))}
                </div>
              </div>
            </div>
            <div className="space-y-1">
              <Label>Released?</Label>
              <div className="flex gap-1">
                {(
                  [
                    ['', 'Don’t say'],
                    ['released', 'Released'],
                    ['airing', 'Ongoing'],
                    ['upcoming', 'Upcoming'],
                  ] as const
                ).map(([v, l]) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setRelease(v)}
                    className={cn('flex-1 rounded-md border px-2 py-1.5 text-xs', release === v ? 'bg-foreground text-background border-foreground' : 'text-muted-foreground')}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>
          </div>
          <div className="flex w-36 flex-col gap-2">
            <Label>Cover</Label>
            <button
              type="button"
              onClick={() => file.current?.click()}
              className="bg-muted/50 hover:bg-muted relative grid aspect-[3/4] w-full place-items-center overflow-hidden rounded-lg border border-dashed"
              title="Upload an image"
            >
              {cover ? (
                <img src={cover} alt="" className="absolute inset-0 h-full w-full object-cover" />
              ) : uploading ? (
                <Loader2 className="h-5 w-5 animate-spin opacity-60" />
              ) : (
                <span className="text-muted-foreground flex flex-col items-center gap-1 text-[11px]">
                  <ImageUp className="h-5 w-5" /> Upload
                </span>
              )}
            </button>
            <input
              ref={file}
              type="file"
              accept="image/png,image/jpeg,image/webp,image/gif"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void upload(f);
                e.target.value = '';
              }}
            />
            <Input value={cover} onChange={(e) => setCover(e.target.value)} placeholder="…or an image link" className="h-7 text-[11px]" />
            {cover && (
              <button type="button" className="text-muted-foreground text-left text-[11px] hover:underline" onClick={() => setCover('')}>
                Remove cover
              </button>
            )}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button
            disabled={!title.trim() || uploading}
            onClick={() =>
              onSave({
                title,
                altTitles: alts.split(/\n|,/).map((a) => a.trim()).filter(Boolean),
                year: year ? Number(year) : null,
                format,
                cover: cover || null,
                release: release || null,
              })
            }
          >
            {entry === 'new' ? 'Add' : 'Save'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CopyDialog({
  open,
  into,
  catalogs,
  existing,
  onClose,
  onCopy,
}: {
  open: boolean;
  into: CatalogSummary;
  catalogs: CatalogSummary[];
  existing: Show[];
  onClose: () => void;
  onCopy: (s: Show) => Promise<void>;
}) {
  const sources = catalogs.filter((c) => c.id !== into.id && c.installed && c.count > 0);
  const [from, setFrom] = useState<string>('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [added, setAdded] = useState<Set<string>>(new Set());
  useEffect(() => {
    if (open && (!from || !sources.some((s) => s.id === from))) setFrom(sources[0]?.id ?? '');
    if (open) setAdded(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  useEffect(() => {
    if (!open || !from || !query.trim()) {
      setHits([]);
      return;
    }
    let alive = true;
    const t = setTimeout(() => window.GOTPoll.catalogs.search(from, query, 12).then((h) => alive && setHits(h)), 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [open, from, query]);
  const have = new Set(existing.map((e) => e.titleRomaji.toLowerCase()));

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-xl gap-3">
        <DialogHeader>
          <DialogTitle>Copy into {into.name}</DialogTitle>
          <DialogDescription>Titles are copied with their other names, year and cover – edit them freely afterwards.</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5">
          {sources.map((s) => {
            const Icon = KIND_ICON[s.kind];
            return (
              <button
                key={s.id}
                onClick={() => setFrom(s.id)}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs',
                  from === s.id ? 'bg-foreground text-background border-foreground' : 'text-muted-foreground'
                )}
              >
                <Icon className="h-3.5 w-3.5" /> {s.name}
              </button>
            );
          })}
        </div>
        <div className="relative">
          <Search className="text-muted-foreground absolute top-1/2 left-2.5 h-4 w-4 -translate-y-1/2" />
          <Input autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search…" className="pl-8" />
        </div>
        <ul className="-mx-2 max-h-[50vh] min-h-24 overflow-y-auto">
          {hits.map(({ show }) => {
            const done = added.has(`${from}:${show.id}`) || have.has(show.titleRomaji.toLowerCase());
            return (
              <li key={show.id} className="flex items-center gap-3 rounded-md px-2 py-1.5">
                <Thumb src={show.coverImage} className="h-12 w-9" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{show.titleRomaji}</div>
                  <div className="text-muted-foreground truncate text-xs">{[show.titleEnglish, show.startYear].filter(Boolean).join(' · ')}</div>
                </div>
                <Button
                  size="sm"
                  variant={done ? 'ghost' : 'outline'}
                  disabled={done}
                  onClick={async () => {
                    await onCopy(show);
                    setAdded((s) => new Set(s).add(`${from}:${show.id}`));
                  }}
                >
                  {done ? <Check className="h-3.5 w-3.5" /> : <Plus className="h-3.5 w-3.5" />}
                  {done ? 'In it' : 'Add'}
                </Button>
              </li>
            );
          })}
          {query.trim() && hits.length === 0 && <li className="text-muted-foreground px-2 py-6 text-center text-sm">Nothing found</li>}
        </ul>
      </DialogContent>
    </Dialog>
  );
}

function NameDialog({
  open,
  title,
  description,
  confirm,
  onClose,
  onSave,
}: {
  open: boolean;
  title: string;
  description: string;
  confirm: string;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
}) {
  const [name, setName] = useState('');
  useEffect(() => {
    if (open) setName('');
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && name.trim() && void onSave(name)}
          placeholder="Games of the year"
        />
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!name.trim()} onClick={() => onSave(name)}>
            {confirm}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Thumb({ src, className }: { src: string | null; className?: string }) {
  return src ? (
    <img src={src} alt="" onError={(e) => (e.currentTarget.style.visibility = 'hidden')} className={cn('bg-muted shrink-0 rounded object-cover', className)} />
  ) : (
    <div className={cn('bg-muted shrink-0 rounded', className)} />
  );
}
