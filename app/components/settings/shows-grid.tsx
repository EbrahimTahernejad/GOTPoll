import { useEffect, useMemo, useState, useRef } from 'react';
import { Badge } from '~/components/ui/badge';
import { Checkbox } from '~/components/ui/checkbox';
import { ExternalLink } from 'lucide-react';
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
        <div className="flex h-full w-full items-center gap-2">
          {show.coverImage && (
            <img
              src={show.coverImage}
              alt={show.titleRomaji}
              className="h-12 w-12 shrink-0 rounded object-cover"
            />
          )}
          <div className="flex flex-col items-start gap-0.5 overflow-hidden text-ellipsis whitespace-nowrap">
            <div className="text-sm [line-height:1.1] font-medium">
              {show.titleRomaji}
            </div>
            {show.titleEnglish && (
              <div className="text-muted-foreground text-xs [line-height:1.1]">
                {show.titleEnglish}
              </div>
            )}
          </div>
          <div className="grow" />
          <Dialog>
            <DialogTrigger asChild>
              <button className="text-muted-foreground">
                <ExternalLink className="h-4 w-4" />
              </button>
            </DialogTrigger>
            <DialogContent className="mt-[24px] h-fit w-fit !max-w-none overflow-hidden p-0">
              <webview
                className="h-[calc(100vh-64px)] w-[calc(100vw-24px)]"
                src={`https://anilist.co/anime/${show.id}`}
              ></webview>
            </DialogContent>
          </Dialog>
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
};

export default function ShowsGrid() {
  const [_shows, setShows] = useState<Show[]>([]);
  const [ignoredShows, setIgnoredShows] = useState<Set<number>>(new Set());
  const shows = useMemo<ShowRow[]>(() => {
    return _shows
      .filter((show) => show.eligible)
      .map((show) => ({
        ...show,
        ignored: ignoredShows.has(show.id) ? 1 : 0,
      }));
  }, [_shows, ignoredShows]);

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

  return (
    <AgGridReact
      ref={ref}
      rowData={shows}
      columnDefs={columnDefs}
      defaultColDef={defaultColDef}
      pagination={true}
      paginationPageSize={15}
      animateRows={true}
      className="flex flex-1 flex-col"
      skipHeaderOnAutoSize={false}
      theme={themeQuartz.withParams({
        fontFamily: 'var(--font-sans)',
        backgroundColor: 'transparent',
      })}
      getRowId={(params) => params.data.id.toString()}
      context={{ handleIgnoreToggle }}
      rowHeight={52}
      suppressMultiSort={true}
      noRowsOverlayComponent={() => <>No Data!</>}
      paginationPageSizeSelector={false}
    />
  );
}
