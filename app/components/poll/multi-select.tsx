import { Check, ChevronDown, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { DropdownMenu, DropdownMenuCheckboxItem, DropdownMenuContent, DropdownMenuTrigger } from '~/components/ui/dropdown-menu';
import { cn } from '~/lib/utils';

export type MultiOption = { value: string; label: string; hint?: string; count?: number };

/**
 * A chip that opens a checklist: pick any number of options. Long lists
 * (genres & tags) get a search box. `required` keeps at least one ticked;
 * otherwise nothing ticked means "any".
 */
export default function MultiSelect({
  label,
  options,
  value,
  onChange,
  disabled,
  required,
  title,
}: {
  label: string;
  options: MultiOption[];
  value: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  required?: boolean;
  title?: string;
}) {
  const [query, setQuery] = useState('');
  const searchable = options.length > 12;
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options;
    // what's ticked stays on top, so it's easy to untick
    return [...list.filter((o) => value.includes(o.value)), ...list.filter((o) => !value.includes(o.value))];
  }, [options, query, value]);

  const picked = options.filter((o) => value.includes(o.value));
  const all = picked.length === options.length;
  const summary =
    picked.length === 0 ? (required ? 'none' : 'Any') : all && required ? 'All' : picked.length <= 2 ? picked.map((o) => o.label).join(', ') : `${picked[0].label} +${picked.length - 1}`;
  const narrowed = required ? !all : picked.length > 0;

  const toggle = (v: string) => {
    const next = value.includes(v) ? value.filter((x) => x !== v) : [...value, v];
    if (required && !next.length) return;
    onChange(next);
  };

  return (
    <DropdownMenu onOpenChange={(open) => !open && setQuery('')}>
      <DropdownMenuTrigger
        disabled={disabled}
        title={title}
        className={cn(
          'flex max-w-64 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all outline-none',
          narrowed ? 'border-foreground bg-foreground text-background' : 'border-foreground/15 text-foreground hover:border-foreground/40',
          disabled && 'cursor-not-allowed opacity-50'
        )}
      >
        <span className={cn(narrowed ? 'opacity-70' : 'text-muted-foreground')}>{label}</span>
        <span className="truncate">{summary}</span>
        <ChevronDown className="h-3 w-3 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-64 p-0">
        {searchable && (
          <div className="flex items-center gap-2 border-b px-2.5 py-2">
            <Search className="text-muted-foreground h-3.5 w-3.5" />
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              // keep typing in the box – the menu would jump to items by letter
              onKeyDown={(e) => e.key !== 'Escape' && e.key !== 'ArrowDown' && e.stopPropagation()}
              placeholder={`Find ${label.toLowerCase()}…`}
              className="placeholder:text-muted-foreground w-full bg-transparent text-sm outline-none"
            />
          </div>
        )}
        <div className="max-h-72 overflow-y-auto p-1">
          {shown.map((o) => (
            <DropdownMenuCheckboxItem
              key={o.value}
              checked={value.includes(o.value)}
              disabled={required && value.length === 1 && value.includes(o.value)}
              onSelect={(e) => {
                e.preventDefault();
                toggle(o.value);
              }}
              title={o.hint}
            >
              <span className="min-w-0 flex-1 truncate">{o.label}</span>
              {o.count !== undefined && <span className="text-muted-foreground text-[11px] tabular-nums">{o.count.toLocaleString()}</span>}
            </DropdownMenuCheckboxItem>
          ))}
          {shown.length === 0 && <div className="text-muted-foreground px-2 py-3 text-center text-xs">Nothing called that</div>}
        </div>
        <div className="flex items-center justify-between border-t px-2.5 py-1.5 text-xs">
          <span className="text-muted-foreground">
            {required ? `${picked.length} of ${options.length}` : picked.length ? `${picked.length} picked – any of them counts` : 'Any counts'}
          </span>
          {required ? (
            !all && (
              <button className="hover:text-foreground text-muted-foreground flex items-center gap-1" onClick={() => onChange(options.map((o) => o.value))}>
                <Check className="h-3 w-3" /> All
              </button>
            )
          ) : (
            picked.length > 0 && (
              <button className="hover:text-foreground text-muted-foreground" onClick={() => onChange([])}>
                Clear
              </button>
            )
          )}
        </div>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
