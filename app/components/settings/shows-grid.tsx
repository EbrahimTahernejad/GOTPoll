import { useEffect, useMemo, useState, useRef } from 'react';
import { Badge } from '~/components/ui/badge';
import { Checkbox } from '~/components/ui/checkbox';
import { ExternalLink, Pencil, Plus, Split } from 'lucide-react';
import { EntryDialog } from '~/components/settings/catalogs-section';
import { Button } from '~/components/ui/button';
import useCatalog from '~/hooks/useCatalog';
import { sourceUrl } from '~/lib/tournament';
import { cn } from '~/lib/utils';
import { AgGridReact, type CustomFloatingFilterProps } from 'ag-grid-react';
import {
  themeQuartz,
  type ColDef,
  type FilterChangedEvent,
  type FilterModifiedEvent,
  type ICellRendererParams,
  type IFilter,
  type IFilterParams,
  type IFloatingFilterParams,
  type ITextFilterParams,
  type TextFilterParams,
  type ValueSetterParams,
} from 'ag-grid-community';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '~/components/ui/select';
import {
  Dialog,
  DialogContent,
  DialogTrigger,
} from '~/components/ui/dialog';

type GridContext = {
  handleIgnoreToggle: (showId: number) => void;
  onEdit: (show: Show) => void;
  onSplit: (show: ShowRow, split: boolean) => void;
};

type SimpleFilterModel<V> = {
  filter: V;
  type: 'equals' | 'contains';
  filterType: 'text' | 'number';
};

type FloatingFilterProps<V> = CustomFloatingFilterProps<
  IFilter,
  ShowRow,
  any,
  SimpleFilterModel<V>
>;

const YearFloatingFilter = ({
  model,
  onModelChange,
}: FloatingFilterProps<number>) => {
  const value = useMemo(() => model?.filter.toString() ?? 'all', [model]);
  const years = useMemo(() => {
    const startYear = 1907;
    const endYear = new Date().getFullYear();
    return Array.from(
      { length: endYear - startYear + 1 },
      (_, i) => startYear + i
    );
  }, []);

  return (
    <div className="w-full px-2">
      <Select
        value={value}
        onValueChange={(value) => {
          onModelChange(
            value === 'all'
              ? null
              : {
                  filter: parseInt(value),
                  type: 'equals',
                  filterType: 'number',
                }
          );
        }}
      >
        <SelectTrigger className="h-4 w-full border-0 !bg-transparent px-0 py-0 text-xs shadow-none !ring-0">
          <SelectValue placeholder="Year" className="text-xs" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" className="text-xs">
            All
          </SelectItem>
          {years.map((year: number) => (
            <SelectItem key={year} className="text-xs" value={year.toString()}>
              {year}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

const SeasonFloatingFilter = ({
  model,
  onModelChange,
}: FloatingFilterProps<string>) => {
  const value = useMemo(() => model?.filter ?? 'all', [model]);
  const seasons = ['WINTER', 'SPRING', 'SUMMER', 'FALL'];

  return (
    <div className="w-full px-2">
      <Select
        value={value}
        onValueChange={(value) => {
          onModelChange(
            value === 'all'
              ? null
              : {
                  filter: value,
                  type: 'equals',
                  filterType: 'text',
                }
          );
        }}
      >
        <SelectTrigger className="h-4 w-full border-0 !bg-transparent px-0 py-0 text-xs shadow-none !ring-0">
          <SelectValue placeholder="Season" className="text-xs" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" className="text-xs">
            All
          </SelectItem>
          {seasons.map((season: string) => (
            <SelectItem className="text-xs" key={season} value={season}>
              {season}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

const FormatFloatingFilter = ({
  model,
  onModelChange,
  api,
}: FloatingFilterProps<string>) => {
  const value = useMemo(() => model?.filter ?? 'all', [model]);
  const formats = ['TV', 'TV_SHORT', 'MOVIE'];

  return (
    <div className="w-full px-2">
      <Select
        value={value}
        onValueChange={(value) => {
          onModelChange(
            value === 'all'
              ? null
              : {
                  filter: value,
                  type: 'equals',
                  filterType: 'text',
                }
          );
        }}
      >
        <SelectTrigger className="h-4 w-full border-0 !bg-transparent px-0 py-0 text-xs shadow-none !ring-0">
          <SelectValue placeholder="Format" className="text-xs" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" className="text-xs">
            All
          </SelectItem>
          {formats.map((format: string) => (
            <SelectItem className="text-xs" key={format} value={format}>
              {format}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

const ReleaseFloatingFilter = ({
  model,
  onModelChange,
  api,
}: FloatingFilterProps<string>) => {
  const value = useMemo(() => model?.filter ?? 'all', [model]);
  const formats = ['released', 'airing', 'upcoming'];

  return (
    <div className="w-full px-2">
      <Select
        value={value}
        onValueChange={(value) => {
          onModelChange(
            value === 'all'
              ? null
              : {
                  filter: value,
                  type: 'equals',
                  filterType: 'text',
                }
          );
        }}
      >
        <SelectTrigger className="h-4 w-full border-0 !bg-transparent px-0 py-0 text-xs shadow-none !ring-0">
          <SelectValue placeholder="Release" className="text-xs" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" className="text-xs">
            All
          </SelectItem>
          {formats.map((format: string) => (
            <SelectItem className="text-xs" key={format} value={format}>
              {format}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
};

const IgnoreFloatingFilter = ({
  model,
  onModelChange,
}: FloatingFilterProps<number>) => {
  const value = useMemo(() => model?.filter.toString() ?? 'all', [model]);

  return (
    <div className="w-full px-2">
      <Select
        value={value}
        onValueChange={(value) => {
          onModelChange(
            value === 'all'
              ? null
              : {
                  filter: parseInt(value),
                  type: 'equals',
                  filterType: 'number',
                }
          );
        }}
      >
        <SelectTrigger className="h-4 w-full border-0 !bg-transparent px-0 py-0 text-xs shadow-none !ring-0">
          <SelectValue placeholder="Year" className="text-xs" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all" className="text-xs">
            All
          </SelectItem>
          <SelectItem className="text-xs" value="1">
            Yes
          </SelectItem>
          <SelectItem className="text-xs" value="0">
            No
          </SelectItem>
        </SelectContent>
      </Select>
    </div>
  );
};

const columnDefs: ColDef<ShowRow>[] = [
  {
    field: 'titleRomaji',
    headerName: 'Title',
    flex: 2,
    filter: 'agTextColumnFilter',
    filterParams: {
      filterOptions: ['contains'],
      buttons: ['reset', 'apply'],
    },
    floatingFilter: true,
    suppressHeaderFilterButton: true,
    suppressFloatingFilterButton: true,
    cellRenderer: (params: ICellRendererParams<ShowRow>) => {
      const show = params.data;
      if (!show) return null;
      return (
        <div className="relative flex h-full w-full items-center gap-2">
          {show.coverImage && (
            <img
              src={show.coverImage}
              alt={show.titleRomaji}
              className="h-12 w-12 shrink-0 rounded object-cover"
            />
          )}
          <div className="flex flex-col items-start gap-0.5 overflow-hidden text-ellipsis whitespace-nowrap">
            <div className="flex items-center gap-1.5 text-sm [line-height:1.1] font-medium">
              {show.titleRomaji}
              {show.split && <Badge variant="secondary" className="h-4 px-1 text-[9px]">own entry</Badge>}
              {show.edited && <Badge variant="secondary" className="h-4 px-1 text-[9px]">edited</Badge>}
              {show.added && <Badge variant="secondary" className="h-4 px-1 text-[9px]">added</Badge>}
            </div>
            {show.titleEnglish && (
              <div className="text-muted-foreground text-xs [line-height:1.1]">
                {show.titleEnglish}
              </div>
            )}
          </div>
          {/* row tools float over the cell on hover, so titles keep their room */}
          <div className="bg-background/90 absolute top-1/2 right-1 flex -translate-y-1/2 items-center gap-2 rounded-md px-1.5 py-1 opacity-0 shadow-sm transition-opacity [.ag-row-hover_&]:opacity-100">
          <button
            className="text-muted-foreground hover:text-foreground"
            title="Edit its title, other names, cover…"
            onClick={() => (params.context as GridContext).onEdit(show)}
          >
            <Pencil className="h-4 w-4" />
          </button>
          {sourceUrl(show.id) && (
            <Dialog>
              <DialogTrigger asChild>
                <button className="text-muted-foreground hover:text-foreground" title="Open its page">
                  <ExternalLink className="h-4 w-4" />
                </button>
              </DialogTrigger>
              <DialogContent className="mt-[24px] h-fit w-fit !max-w-none overflow-hidden p-0">
                <webview className="h-[calc(100vh-64px)] w-[calc(100vw-24px)]" src={sourceUrl(show.id)!}></webview>
              </DialogContent>
            </Dialog>
          )}
          </div>
        </div>
      );
    },
  },
  {
    field: 'startYear',
    headerName: 'Year',
    width: 100,
    filter: 'agNumberColumnFilter',
    filterParams: {
      filterOptions: ['equals'],
      buttons: ['reset', 'apply'],
    },
    floatingFilter: true,
    suppressHeaderFilterButton: true,
    suppressFloatingFilterButton: true,
    floatingFilterComponent: YearFloatingFilter,
    cellRenderer: (params: ICellRendererParams<ShowRow>) => {
      return <div className="flex h-full items-center">{params.value}</div>;
    },
  },
  {
    field: 'season',
    headerName: 'Season',
    width: 120,
    filter: 'agTextColumnFilter',
    filterParams: {
      filterOptions: ['equals'],
      buttons: ['reset', 'apply'],
    },
    floatingFilter: true,
    suppressHeaderFilterButton: true,
    suppressFloatingFilterButton: true,
    floatingFilterComponent: SeasonFloatingFilter,
    cellRenderer: (params: ICellRendererParams<ShowRow>) => {
      return (
        <div className="flex h-full items-center">
          <Badge variant="secondary">{params.value}</Badge>
        </div>
      );
    },
  },
  {
    field: 'release',
    headerName: 'Release',
    width: 130,
    filter: 'agTextColumnFilter',
    filterParams: {
      filterOptions: ['equals'],
      buttons: ['reset', 'apply'],
    },
    floatingFilter: true,
    suppressHeaderFilterButton: true,
    suppressFloatingFilterButton: true,
    floatingFilterComponent: ReleaseFloatingFilter,
    cellRenderer: (params: ICellRendererParams<ShowRow>) => {
      return (
        <div className="flex h-full items-center">
          {params.value ? <Badge variant={params.value === 'released' ? 'secondary' : 'outline'}>{params.value}</Badge> : <span className="text-muted-foreground text-xs">–</span>}
        </div>
      );
    },
  },
  {
    field: 'format',
    headerName: 'Format',
    width: 120,
    filter: 'agTextColumnFilter',
    filterParams: {
      filterOptions: ['equals'],
      buttons: ['reset', 'apply'],
    },
    editable: true,
    floatingFilter: true,
    suppressHeaderFilterButton: true,
    suppressFloatingFilterButton: true,
    floatingFilterComponent: FormatFloatingFilter,
    cellRenderer: (params: ICellRendererParams<ShowRow>) => {
      return (
        <div className="flex h-full items-center">
          <Badge variant="outline">{params.value}</Badge>
        </div>
      );
    },
  },
  {
    field: 'ignored',
    headerName: 'Ignored',
    width: 100,
    filter: 'agNumberColumnFilter',
    filterParams: {
      filterOptions: ['equals'],
      buttons: ['reset', 'apply'],
    },
    floatingFilter: true,
    suppressHeaderFilterButton: true,
    suppressFloatingFilterButton: true,
    floatingFilterComponent: IgnoreFloatingFilter,
    valueSetter: (params: ValueSetterParams<ShowRow, number>) => {
      if (!params.data) return false;
      (params.context as GridContext).handleIgnoreToggle(params.data.id);
      return true;
    },
    cellRenderer: (params: ICellRendererParams<ShowRow>) => {
      return (
        <div className="flex h-full items-center">
          <Checkbox
            checked={params.value === 1}
            onCheckedChange={(checked) => {
              params.setValue?.(checked ? 1 : 0);
            }}
          />
        </div>
      );
    },
  },
];

const defaultColDef: ColDef<ShowRow> = {
  sortable: true,
  filter: true,
  resizable: false,
};

type ShowRow = Show & {
  ignored: number;
  /** sequels: the franchise it counts for (or used to) */
  partOf: string | null;
};

// Sequels view: every later season, the show it counts for, and the switch
// that makes it an entry of its own (Boruto out of Naruto).
const sequelColumnDefs: ColDef<ShowRow>[] = [
  { ...columnDefs[0], flex: 2 },
  {
    field: 'partOf',
    headerName: 'Counts for',
    flex: 1,
    filter: 'agTextColumnFilter',
    filterParams: { filterOptions: ['contains'], buttons: ['reset', 'apply'] },
    floatingFilter: true,
    suppressHeaderFilterButton: true,
    suppressFloatingFilterButton: true,
    cellRenderer: (params: ICellRendererParams<ShowRow>) => (
      <div className={cn('flex h-full items-center text-sm', params.data?.split && 'text-muted-foreground line-through')}>{params.value}</div>
    ),
  },
  {
    field: 'split',
    headerName: 'Own entry',
    width: 120,
    cellRenderer: (params: ICellRendererParams<ShowRow>) => (
      <div className="flex h-full items-center">
        <Checkbox
          checked={!!params.data?.split}
          onCheckedChange={(checked) => params.data && (params.context as GridContext).onSplit(params.data, !!checked)}
        />
      </div>
    ),
  },
];

export default function ShowsGrid() {
  const [_shows, setShows] = useState<Show[]>([]);
  const [ignoredShows, setIgnoredShows] = useState<Set<number>>(new Set());
  const [view, setView] = useState<'titles' | 'sequels'>('titles');
  const [editing, setEditing] = useState<Show | 'new' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { info } = useCatalog();
  const labels = useMemo(() => {
    const out: Record<ShowFormat, string> = { TV: 'TV', MOVIE: 'Movie', TV_SHORT: 'Short' };
    for (const f of info?.formats ?? []) out[f.id] = f.label;
    return out;
  }, [info]);
  const byId = useMemo(() => new Map(_shows.map((s) => [s.id, s])), [_shows]);
  // the top of a sequel's franchise (split-off sequels show what they came from)
  const franchiseOf = (s: Show) => {
    let cur: Show | undefined = s;
    for (let hops = 0; cur?.parentId != null && hops < 40; hops++) {
      const up = byId.get(cur.parentId);
      if (!up) break;
      cur = up;
    }
    return cur && cur !== s ? cur.titleRomaji : null;
  };
  const shows = useMemo<ShowRow[]>(() => {
    return _shows
      .filter((show) => (view === 'titles' ? show.eligible : !show.eligible || show.split))
      .map((show) => ({
        ...show,
        ignored: ignoredShows.has(show.id) ? 1 : 0,
        partOf: view === 'sequels' ? franchiseOf(show) : null,
      }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [_shows, ignoredShows, view, byId]);
  const sequelCount = useMemo(() => _shows.filter((s) => !s.eligible || s.split).length, [_shows]);
  const custom = info?.kind === 'custom';

  const ref = useRef<AgGridReact>(null);

  const loadData = async () => {
    try {
      const [shows, ignored] = await Promise.all([
        window.GOTPoll.catalog.shows(),
        window.GOTPoll.ignores.list(),
      ]);
      setIgnoredShows(new Set(ignored));
      setShows(shows);
    } catch (error) {
      console.error('Failed to load shows:', error);
    }
  };

  useEffect(() => {
    loadData();
    return window.GOTPoll.catalog.onChanged(() => loadData());
  }, []);

  const handleIgnoreToggle = async (showId: number) => {
    const next = new Set(ignoredShows);
    const ignore = !next.has(showId);
    await window.GOTPoll.ignores.set(showId, ignore);
    if (ignore) next.add(showId);
    else next.delete(showId);
    setIgnoredShows(next);
  };

  const save = async (input: CustomEntryInput) => {
    if (!info) return;
    try {
      if (editing === 'new' || custom || (editing && editing.added)) {
        // new titles (and ones added before) live with the catalog's additions
        if (editing === 'new') await window.GOTPoll.catalogs.addEntry(info.id, input);
        else if (editing) await window.GOTPoll.catalogs.updateEntry(info.id, editing.id, input);
      } else if (editing) {
        await window.GOTPoll.catalogs.override(editing.id, {
          title: input.title,
          altTitles: input.altTitles,
          year: input.year,
          format: input.format,
          cover: input.cover,
          release: input.release,
          ...(editing.split ? { split: true } : {}),
        });
      }
      setEditing(null);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err).replace(/^.*Error: /, ''));
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-2">
      <div className="flex items-center gap-2">
        {sequelCount > 0 && (
          <div className="bg-foreground/5 flex rounded-full p-0.5 text-xs">
            {(
              [
                ['titles', `Titles · ${(_shows.length - sequelCount + _shows.filter((s) => s.split).length).toLocaleString()}`],
                ['sequels', `Sequels · ${sequelCount.toLocaleString()}`],
              ] as const
            ).map(([v, label]) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className={cn('rounded-full px-3 py-1 font-medium', view === v ? 'bg-background shadow-sm' : 'text-muted-foreground')}
              >
                {label}
              </button>
            ))}
          </div>
        )}
        <span className="text-muted-foreground text-xs">
          {view === 'sequels'
            ? 'Later seasons count for their franchise. Tick “Own entry” to make one votable by itself (e.g. Boruto out of Naruto).'
            : 'Edits stay yours – catalog updates never undo them.'}
        </span>
        <div className="grow" />
        {error && <span className="text-destructive text-xs">{error}</span>}
        {!custom && (
          <Button size="sm" variant="outline" onClick={() => setEditing('new')}>
            <Plus className="h-3.5 w-3.5" /> Add a title
          </Button>
        )}
      </div>
    <AgGridReact
      ref={ref}
      rowData={shows}
      columnDefs={view === 'sequels' ? sequelColumnDefs : columnDefs}
      defaultColDef={defaultColDef}
      pagination={true}
      paginationPageSize={15}
      animateRows={true}
      className="flex flex-1 flex-col"
      skipHeaderOnAutoSize={false}
      theme={themeQuartz.withParams({
        fontFamily: 'var(--font-sans)',
        backgroundColor: 'transparent',
        // follow the app's light / dark colours (the header was a white strip in dark mode)
        foregroundColor: 'var(--foreground)',
        headerBackgroundColor: 'transparent',
        chromeBackgroundColor: 'transparent',
        borderColor: 'color-mix(in oklab, var(--foreground) 12%, transparent)',
      })}
      getRowId={(params) => params.data.id.toString()}
      context={{
        handleIgnoreToggle,
        onEdit: (s: Show) => setEditing(s),
        onSplit: (s: ShowRow, split: boolean) => window.GOTPoll.catalogs.split(s.id, split),
      }}
      rowHeight={52}
      suppressMultiSort={true}
      noRowsOverlayComponent={() => <>No Data!</>}
      paginationPageSizeSelector={false}
    />
      <EntryDialog
        entry={editing}
        labels={labels}
        onClose={() => setEditing(null)}
        onSave={save}
        onError={setError}
        description={
          editing === 'new'
            ? `A title ${info?.name ?? 'the catalog'} doesn’t have. It stays with your copy of the catalog.`
            : 'Your changes stay on top of the catalog – updates never undo them.'
        }
        onReset={
          editing && editing !== 'new' && editing.edited && !editing.added
            ? async () => {
                await window.GOTPoll.catalogs.override(editing.id, editing.split ? { split: true } : null);
                setEditing(null);
              }
            : undefined
        }
      />
    </div>
  );
}
