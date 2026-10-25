import { FilterChip, FilterGroup } from './bits';

// Which catalogs a poll or tournament votes from, and – when several are
// ticked – each one's own format / release chips ("only movies from IMDb,
// only movies from AniList").

export const RELEASES: { id: ShowRelease; label: string; hint: string }[] = [
  { id: 'released', label: 'Released', hint: 'At least one full season out (sequels may still be airing)' },
  { id: 'airing', label: 'Airing', hint: 'First season still airing' },
  { id: 'upcoming', label: 'Upcoming', hint: 'Not aired yet' },
];

const ALL: { formats: ShowFormat[]; release: ShowRelease[] } = { formats: ['TV', 'TV_SHORT', 'MOVIE'], release: ['released', 'airing', 'upcoming'] };

/** Tick catalogs on and off; the last one can't go. */
export function CatalogPicker({ catalogs, disabled, lockedTitle }: { catalogs: CatalogSummary[]; disabled?: boolean; lockedTitle: string }) {
  const usable = catalogs.filter((c) => c.installed && (c.kind !== 'custom' || c.count > 0));
  const selected = catalogs.filter((c) => c.selected).map((c) => c.id);
  const toggle = (id: string) => {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : [...selected, id];
    if (next.length) window.GOTPoll.catalogs.select(next.join('+')).catch(() => {});
  };
  return (
    <FilterGroup label={selected.length > 1 ? `Catalogs · ${selected.length} pooled` : 'Catalog'}>
      {usable.map((c) => (
        <FilterChip
          key={c.id}
          on={c.selected}
          disabled={disabled || (c.selected && selected.length === 1)}
          title={disabled ? lockedTitle : c.selected ? `Stop voting from ${c.name}` : `Vote from ${c.name} too`}
          onClick={() => toggle(c.id)}
        >
          {c.name}
        </FilterChip>
      ))}
    </FilterGroup>
  );
}

/** One catalog's chips inside a pooled poll. */
export function PartFilters({
  part,
  filters,
  onChange,
  disabled,
}: {
  part: CatalogMeta['parts'][number];
  filters: PollFilters;
  onChange: (f: PollFilters) => void;
  disabled?: boolean;
}) {
  const g = filters.byCatalog?.[part.id] ?? ALL;
  const toggle = <K extends 'formats' | 'release'>(key: K, value: (typeof ALL)[K][number]) => {
    const list = g[key] as string[];
    const next = list.includes(value) ? list.filter((x) => x !== value) : [...list, value];
    // a group can't be emptied: none of this catalog's titles would count
    if (next.length) onChange({ ...filters, byCatalog: { ...filters.byCatalog, [part.id]: { ...g, [key]: next } } });
  };
  return (
    <FilterGroup label={part.name}>
      {part.formats.map((f) => (
        <FilterChip key={f.id} on={g.formats.includes(f.id)} disabled={disabled} onClick={() => toggle('formats', f.id)}>
          {f.label}
        </FilterChip>
      ))}
      {part.releases && <span className="bg-foreground/10 mx-1 h-4 w-px" />}
      {part.releases &&
        RELEASES.map((r) => (
          <FilterChip key={r.id} title={r.hint} on={g.release.includes(r.id)} disabled={disabled} onClick={() => toggle('release', r.id)}>
            {r.label}
          </FilterChip>
        ))}
    </FilterGroup>
  );
}
