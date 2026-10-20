import { useEffect, useState } from 'react';

/**
 * The selected catalog's titles by id. Reloads when the catalog changes;
 * posters fetched as needed (movies & series) are patched in as they arrive.
 */
export default function useLibrary() {
  const [library, setLibrary] = useState<Map<number, Show>>(new Map());
  useEffect(() => {
    let alive = true;
    const load = () =>
      window.GOTPoll.catalog.shows().then((list) => alive && setLibrary(new Map(list.map((x) => [x.id, x]))));
    void load();
    const offChanged = window.GOTPoll.catalog.onChanged(() => void load());
    const offCovers = window.GOTPoll.catalogs.onCovers((batch) =>
      setLibrary((cur) => {
        const next = new Map(cur);
        for (const { id, url } of batch) {
          const s = next.get(id);
          if (s) next.set(id, { ...s, coverImage: url });
        }
        return next;
      })
    );
    return () => {
      alive = false;
      offChanged();
      offCovers();
    };
  }, []);
  return library;
}
