import { FilterGroup } from './bits';
import MultiSelect from './multi-select';

// Which catalogs a poll or tournament votes from, and what counts from each:
// format, release and genres / tags, as dropdowns. With several catalogs
// ticked, each gets its own row ("only movies from IMDb, only movies from
// AniList").

export const RELEASES: { id: ShowRelease; label: string; hint: string }[] = [
  { id: 'released', label: 'Released', hint: 'At least one full season out (sequels may still be airing)' },
  { id: 'airing', label: 'Airing', hint: 'First season still airing' },
  { id: 'upcoming', label: 'Upcoming', hint: 'Not aired yet' },
];

type Group = { formats: ShowFormat[]; release: ShowRelease[]; tags?: string[] };
const ALL: Group = { formats: ['TV', 'TV_SHORT', 'MOVIE'], release: ['released', 'airing', 'upcoming'] };
type Part = CatalogMeta['parts'][number];

/** Tick catalogs on and off; the last one can't go. */
export function CatalogPicker({ catalogs, disabled, lockedTitle }: { catalogs: CatalogSummary[]; disabled?: boolean; lockedTitle: string }) {
  const usable = catalogs.filter((c) => c.installed && (c.kind !== 'custom' || c.count > 0));
  const selected = catalogs.filter((c) => c.selected).map((c) => c.id);
  return (
    <FilterGroup label={selected.length > 1 ? `Catalogs · ${selected.length} pooled` : 'Catalog'}>
      <MultiSelect
        label="Vote from"
        required
        options={usable.map((c) => ({ value: c.id, label: c.name, count: c.eligible }))}
        value={selected}
        disabled={disabled}
        title={disabled ? lockedTitle : 'Tick several to pool them'}
        onChange={(next) => window.GOTPoll.catalogs.select(next.join('+')).catch(() => {})}
      />
    </FilterGroup>
  );
}

/** Format, release and genre dropdowns for one catalog (or the only one in use). */
export function GroupFilters({
  part,
  group,
  onChange,
  disabled,
  releaseKnown = true,
}: {
  part: Part;
  group: Group;
  onChange: (g: Group) => void;
  disabled?: boolean;
  releaseKnown?: boolean;
}) {
  const tagLabel = part.kind === 'anilist' ? 'Genres & tags' : 'Genres';
  return (
    <>
      {part.formats.length > 1 && (
        <MultiSelect
          label="Format"
          required
          options={part.formats.map((f) => ({ value: f.id, label: f.label }))}
          value={group.formats.filter((f) => part.formats.some((x) => x.id === f))}
          disabled={disabled}
          // formats this catalog doesn't have stay ticked, so they never hide another catalog's titles
          onChange={(next) => onChange({ ...group, formats: [...(next as ShowFormat[]), ...group.formats.filter((f) => !part.formats.some((x) => x.id === f))] })}
        />
      )}
      {part.releases && (
        <MultiSelect
          label="Release"
          required
          options={RELEASES.map((r) => ({ value: r.id, label: r.label, hint: r.hint }))}
          value={group.release}
          disabled={disabled || !releaseKnown}
          title={!releaseKnown ? 'Update the catalog to use this' : undefined}
          onChange={(next) => onChange({ ...group, release: next as ShowRelease[] })}
        />
      )}
      {part.tags.length > 0 ? (
        <MultiSelect
          label={tagLabel}
          options={part.tags.map((t) => ({ value: t.name, label: t.name, count: t.count }))}
          value={group.tags ?? []}
          disabled={disabled}
          onChange={(next) => onChange({ ...group, tags: next })}
        />
      ) : (
        part.kind !== 'custom' && (
          <span
            className="border-foreground/10 text-muted-foreground cursor-help rounded-full border border-dashed px-3 py-1 text-xs"
            title={`Update ${part.name} (Settings → Catalogs) to filter by ${tagLabel.toLowerCase()}`}
          >
            {tagLabel} · update catalog
          </span>
        )
      )}
    </>
  );
}

/** A pooled poll: one compact line per catalog, each with its own dropdowns. */
export function PooledFilters({
  parts,
  filters,
  onChange,
  disabled,
}: {
  parts: Part[];
  filters: PollFilters;
  onChange: (f: PollFilters) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5">
      <div className="text-muted-foreground text-[11px] font-medium tracking-wide uppercase">Counts</div>
      {parts.map((part) => (
        <div key={part.id} className="flex flex-wrap items-center gap-1.5">
          <span className="w-28 truncate text-xs font-semibold" title={part.name}>
            {part.name}
          </span>
          <GroupFilters
            part={part}
            group={filters.byCatalog?.[part.id] ?? ALL}
            disabled={disabled}
            onChange={(g) => onChange({ ...filters, byCatalog: { ...filters.byCatalog, [part.id]: g } })}
          />
        </div>
      ))}
    </div>
  );
}
