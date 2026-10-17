// Poll filters, kept dependency-free so the engine stays testable in plain Node.

export function cleanFilters(f: PollFilters): PollFilters {
  const formats = (['TV', 'TV_SHORT', 'MOVIE'] as const).filter((x) => f.formats?.includes(x));
  const release = (['released', 'airing', 'upcoming'] as const).filter((x) => f.release?.includes(x));
  // an empty group would make every show uncountable – treat it as "all"
  return {
    formats: formats.length ? formats : ['TV', 'TV_SHORT', 'MOVIE'],
    release: release.length ? release : ['released', 'airing', 'upcoming'],
  };
}
