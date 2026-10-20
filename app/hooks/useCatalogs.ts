import { useEffect, useState } from 'react';

/** Every catalog and how it stands, pushed from the main process. */
export default function useCatalogs() {
  const [list, setList] = useState<CatalogSummary[]>([]);
  useEffect(() => {
    let alive = true;
    window.GOTPoll.catalogs.list().then((l) => alive && setList(l));
    const off = window.GOTPoll.catalogs.onList(setList);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return list;
}
