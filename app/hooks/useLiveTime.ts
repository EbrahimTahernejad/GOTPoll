import { useEffect, useState } from 'react';

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${pad(Math.floor(s / 3600))}:${pad(Math.floor(s / 60) % 60)}:${pad(s % 60)}`;
};

/** hh:mm:ss since `startedAt`, frozen at `endedAt` once the poll ends. */
export default function useLiveTime(startedAt: number | null, endedAt: number | null = null) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!startedAt || endedAt) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [startedAt, endedAt]);

  if (!startedAt) return null;
  return fmt((endedAt ?? now) - startedAt);
}
