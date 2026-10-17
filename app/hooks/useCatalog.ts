import { useEffect, useState } from 'react';

/** Catalog metadata + live update status, pushed from the main process. */
export default function useCatalog() {
  const [info, setInfo] = useState<CatalogMeta | null>(null);
  const [status, setStatus] = useState<CatalogStatus>({ state: 'idle' });
  useEffect(() => {
    let alive = true;
    window.GOTPoll.catalog.info().then((i) => alive && setInfo(i));
    window.GOTPoll.catalog.status().then((s) => alive && setStatus(s));
    const offStatus = window.GOTPoll.catalog.onStatus(setStatus);
    const offChanged = window.GOTPoll.catalog.onChanged(setInfo);
    return () => {
      alive = false;
      offStatus();
      offChanged();
    };
  }, []);
  const busy = status.state === 'running' || status.state === 'validating' || status.state === 'applying';
  return { info, status, busy };
}
