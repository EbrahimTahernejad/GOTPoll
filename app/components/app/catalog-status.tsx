import { AnimatePresence, motion } from 'motion/react';
import { AlertTriangle, CheckCircle2, CloudDownload, Database, History, Loader2, ShieldCheck, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Button } from '~/components/ui/button';
import useCatalog from '~/hooks/useCatalog';
import useCatalogs from '~/hooks/useCatalogs';
import { cn } from '~/lib/utils';

export function percent(s: CatalogStatus) {
  if (s.state === 'validating') return 97;
  if (s.state === 'applying' || s.state === 'done') return 100;
  if (s.state !== 'running' || !s.progress?.partitionsTotal) return 2;
  return Math.max(2, Math.min(95, (s.progress.partitionsDone / s.progress.partitionsTotal) * 95));
}

export function useNow(active: boolean) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

export function relativeTime(ts: number) {
  if (!ts) return 'never';
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  const d = Math.floor(s / 86400);
  return d === 1 ? 'yesterday' : `${d} days ago`;
}

export function statusLine(s: CatalogStatus, now: number, source = 'AniList') {
  switch (s.state) {
    case 'running': {
      const p = s.progress;
      if (!p) return `Connecting to ${source}…`;
      if (p.phase === 'waiting' && p.waitUntil) {
        return `${source} rate limit – resuming in ${Math.max(0, Math.ceil((p.waitUntil - now) / 1000))}s`;
      }
      if (p.unit === 'MB') return `${p.label} · ${p.partitionsDone}/${p.partitionsTotal} MB · ${p.fetched.toLocaleString()} titles kept`;
      return `${p.label ? `${p.label} · ` : ''}${p.fetched.toLocaleString()} shows fetched`;
    }
    case 'validating':
      return 'Verifying the new catalog…';
    case 'applying':
      return 'Switching over…';
    case 'done':
      return `Updated – ${s.total.toLocaleString()} titles (+${s.added.toLocaleString()} new${s.removed ? `, −${s.removed.toLocaleString()} removed` : ''})`;
    case 'error':
      return s.error ?? 'Update failed';
    case 'cancelled':
      return 'Update cancelled – nothing changed';
    default:
      return '';
  }
}

/** Small title-bar indicator, visible while any catalog updates or just finished. */
export function CatalogPill() {
  const list = useCatalogs();
  const working = list.find((c) => ['running', 'validating', 'applying'].includes(c.status.state)) ?? list.find((c) => ['done', 'error'].includes(c.status.state) && 'finishedAt' in c.status && Date.now() - c.status.finishedAt < 7000);
  const status: CatalogStatus = working?.status ?? { state: 'idle' };
  const busy = status.state === 'running' || status.state === 'validating' || status.state === 'applying';
  const now = useNow(busy);
  const [showDone, setShowDone] = useState(false);
  useEffect(() => {
    if (status.state === 'done' || status.state === 'error') {
      setShowDone(true);
      const t = setTimeout(() => setShowDone(false), 6000);
      return () => clearTimeout(t);
    }
  }, [status.state]);

  const visible = busy || showDone;
  const pct = percent(status);
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0, y: -6, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: -6, scale: 0.95 }}
          className="pointer-events-auto [app-region:no-drag]"
        >
          <Link
            to="/settings"
            className="bg-background/70 hover:bg-background flex items-center gap-2 rounded-full border px-2.5 py-1 text-xs backdrop-blur"
            title={statusLine(status, now, working?.kind === 'imdb' ? 'IMDb' : working?.kind === 'games' ? 'Wikidata' : 'AniList')}
          >
            {busy ? (
              <svg viewBox="0 0 20 20" className="h-4 w-4 -rotate-90">
                <circle cx="10" cy="10" r="8" className="stroke-foreground/15" strokeWidth="3" fill="none" />
                <motion.circle
                  cx="10"
                  cy="10"
                  r="8"
                  className="stroke-primary"
                  strokeWidth="3"
                  fill="none"
                  strokeLinecap="round"
                  strokeDasharray={50.3}
                  animate={{ strokeDashoffset: 50.3 * (1 - pct / 100) }}
                />
              </svg>
            ) : status.state === 'done' ? (
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-amber-500" />
            )}
            <span>
              {busy ? `Updating ${working?.name ?? 'catalog'} ${Math.round(pct)}%` : status.state === 'done' ? `${working?.name ?? 'Catalog'} updated` : 'Update failed'}
            </span>
          </Link>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** Full catalog card for the settings page. */
export function CatalogCard({ pollRunning }: { pollRunning: boolean }) {
  const { info, status, busy } = useCatalog();
  const now = useNow(busy);
  const pct = percent(status);
  const line = statusLine(status, now);
  const stale = info ? Date.now() - info.syncedAt > 14 * 86400_000 : false;

  return (
    <div className="bg-card/40 relative overflow-hidden rounded-xl border p-4">
      <div className="flex items-start gap-3">
        <div className="bg-primary/10 text-primary grid h-10 w-10 shrink-0 place-items-center rounded-lg">
          <Database className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h3 className="font-semibold">Show catalog</h3>
            {stale && !busy && (
              <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                out of date
              </span>
            )}
          </div>
          <p className="text-muted-foreground text-sm">
            {info ? (
              <>
                {info.eligible.toLocaleString()} votable shows ({info.count.toLocaleString()} incl. sequels) · synced{' '}
                {relativeTime(info.syncedAt)}
                {info.source === 'bundled' || info.source === 'legacy' ? ' (bundled copy)' : ''}
              </>
            ) : (
              'Loading…'
            )}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          {info?.canRevert && !busy && (
            <Button variant="ghost" size="sm" onClick={() => window.GOTPoll.catalog.revert()} title="Go back to the previous catalog">
              <History className="h-4 w-4" />
              Revert
            </Button>
          )}
          {busy ? (
            <Button variant="outline" size="sm" onClick={() => window.GOTPoll.catalog.cancel()} disabled={status.state !== 'running'}>
              <X className="h-4 w-4" />
              Cancel
            </Button>
          ) : (
            <Button size="sm" onClick={() => window.GOTPoll.catalog.update()}>
              <CloudDownload className="h-4 w-4" />
              Update from AniList
            </Button>
          )}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {(busy || status.state === 'done' || status.state === 'error' || status.state === 'cancelled') && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="mt-4 space-y-2">
              <div className="bg-foreground/10 h-2 overflow-hidden rounded-full">
                <motion.div
                  className={cn(
                    'h-full rounded-full',
                    status.state === 'error'
                      ? 'bg-destructive'
                      : status.state === 'cancelled'
                        ? 'bg-muted-foreground'
                        : 'bg-gradient-to-r from-violet-500 via-fuchsia-500 to-amber-400'
                  )}
                  animate={{ width: `${status.state === 'error' || status.state === 'cancelled' ? 100 : pct}%` }}
                  transition={{ type: 'spring', stiffness: 80, damping: 20 }}
                />
              </div>
              <div className="flex items-center gap-2 text-xs">
                {busy && <Loader2 className="h-3.5 w-3.5 animate-spin opacity-60" />}
                {status.state === 'error' && <AlertTriangle className="text-destructive h-3.5 w-3.5" />}
                {status.state === 'done' && <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500" />}
                <span className={cn('text-muted-foreground', status.state === 'error' && 'text-destructive')}>{line}</span>
                {status.state === 'running' && status.progress && (
                  <span className="text-muted-foreground ml-auto tabular-nums">
                    {status.progress.partitionsDone}/{status.progress.partitionsTotal} ranges · {status.progress.requests} requests
                  </span>
                )}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="text-muted-foreground mt-3 flex items-start gap-2 text-xs">
        <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-500" />
        <span>
          Updates download into a separate file and only replace the current catalog after it’s verified – you can keep
          using the app (and run polls) the whole time.
          {pollRunning && ' The running poll keeps its current list; the new one applies to the next poll.'}
        </span>
      </div>
    </div>
  );
}
