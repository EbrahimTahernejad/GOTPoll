// Poll filters, kept dependency-free so the engine stays testable in plain Node.

export function cleanFilters(f: PollFilters): PollFilters {
  const out = cleanGroup(f);
  if (f.byCatalog && typeof f.byCatalog === 'object') {
    const by = Object.entries(f.byCatalog).filter(([id, g]) => /^[\w-]{1,40}$/.test(id) && g && typeof g === 'object');
    if (by.length) return { ...out, byCatalog: Object.fromEntries(by.map(([id, g]) => [id, cleanGroup(g)])) };
  }
  return out;
}

function cleanGroup(f: Omit<PollFilters, 'byCatalog'>): Omit<PollFilters, 'byCatalog'> {
  const formats = (['TV', 'TV_SHORT', 'MOVIE'] as const).filter((x) => f.formats?.includes(x));
  const release = (['released', 'airing', 'upcoming'] as const).filter((x) => f.release?.includes(x));
  // an empty group would make every show uncountable – treat it as "all"
  return {
    formats: formats.length ? formats : ['TV', 'TV_SHORT', 'MOVIE'],
    release: release.length ? release : ['released', 'airing', 'upcoming'],
  };
}

export const MAX_OPTIONS = 20;

/** Unique show ids, in order, capped. */
export function cleanShortlist(ids: number[]): number[] {
  const out: number[] = [];
  for (const id of ids) {
    if (Number.isInteger(id) && !out.includes(id)) out.push(id);
    if (out.length >= MAX_OPTIONS) break;
  }
  return out;
}

/**
 * A vote by number in a shortlist poll: "2", "#2", "!vote 2", "vote #2",
 * "option 2", "2!!". Returns the 1-based number or null.
 */
export function optionNumber(raw: string): number | null {
  const m = /^\s*(?:!?\s*(?:vote|option|opt|number|no\.?)\s*)?#?\s*(\d{1,2})\s*[!.]*\s*$/i.exec(raw);
  return m ? Number(m[1]) : null;
}
