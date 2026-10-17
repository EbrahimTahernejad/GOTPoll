import { AnimatePresence, motion } from 'motion/react';
import { Check, Cloud, Copy, Eye, EyeOff, ExternalLink, Globe, Loader2, Monitor, Network, Power, ShieldCheck } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Switch } from '~/components/ui/switch';
import { cn } from '~/lib/utils';

export function useShare() {
  const [info, setInfo] = useState<ShareInfo | null>(null);
  useEffect(() => {
    let alive = true;
    window.GOTPoll.share.info().then((i) => alive && setInfo(i));
    const off = window.GOTPoll.share.onStatus((tunnel) => setInfo((cur) => (cur ? { ...cur, tunnel } : cur)));
    return () => {
      alive = false;
      off();
    };
  }, []);
  return info;
}

function CopyButton({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="icon"
      variant="ghost"
      className="h-8 w-8"
      title="Copy link"
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
    >
      {done ? <Check className="h-4 w-4 text-emerald-500" /> : <Copy className="h-4 w-4" />}
    </Button>
  );
}

function LinkRow({ icon: Icon, label, hint, url }: { icon: typeof Globe; label: string; hint: string; url: string }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="bg-foreground/5 grid h-9 w-9 shrink-0 place-items-center rounded-lg">
        <Icon className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="text-sm font-medium">{label}</div>
        <div className="text-muted-foreground truncate font-mono text-xs" title={url}>
          {url}
        </div>
        <div className="text-muted-foreground text-[11px]">{hint}</div>
      </div>
      <CopyButton text={url} />
      <Button size="icon" variant="ghost" className="h-8 w-8" title="Open" onClick={() => window.GOTPoll.openExternal(url)}>
        <ExternalLink className="h-4 w-4" />
      </Button>
    </div>
  );
}

const STATE_TEXT: Record<TunnelStatus['state'], string> = {
  off: 'Off',
  installing: 'Setting up…',
  starting: 'Opening…',
  online: 'Online',
  reconnecting: 'Reconnecting…',
  error: 'Problem',
};

/** Links to the viewer page: this PC, the local network, and a public tunnel. */
export function ShareLinks({ info }: { info: ShareInfo }) {
  const t = info.tunnel;
  const busy = t.state === 'installing' || t.state === 'starting' || t.state === 'reconnecting';
  const provider = t.provider === 'ngrok' ? 'ngrok' : 'Cloudflare';
  return (
    <div className="bg-card/60 divide-y overflow-hidden rounded-xl border">
      <LinkRow icon={Monitor} label="This PC" hint="Add as a browser source in OBS on this computer." url={info.localUrl} />
      {info.lanUrls.map((u) => (
        <LinkRow key={u} icon={Network} label="Your network" hint="Another PC or phone on the same Wi-Fi / LAN." url={u} />
      ))}

      {/* public link */}
      <div className="relative px-4 py-3">
        <div className="flex items-center gap-3">
          <div className="bg-foreground/5 grid h-9 w-9 shrink-0 place-items-center rounded-lg">
            <Globe className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-sm font-medium">
              Public link
              <span
                className={cn(
                  'flex items-center gap-1 rounded-full px-1.5 text-[10px] font-semibold',
                  t.state === 'online'
                    ? 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
                    : t.state === 'error'
                      ? 'bg-rose-500/15 text-rose-600 dark:text-rose-400'
                      : 'bg-foreground/5 text-muted-foreground'
                )}
              >
                {busy && <Loader2 className="h-2.5 w-2.5 animate-spin" />}
                {STATE_TEXT[t.state]}
              </span>
              <span className="text-muted-foreground text-[11px] font-normal">via {provider}</span>
            </div>
            <div className={cn('text-muted-foreground truncate text-xs', t.url && 'font-mono')} title={t.url ?? ''}>
              {t.url ?? (t.detail || 'Anyone with the link can watch the ranking – nothing else.')}
            </div>
          </div>
          {t.url && t.state === 'online' && (
            <>
              <CopyButton text={t.url} />
              <Button size="icon" variant="ghost" className="h-8 w-8" title="Open" onClick={() => window.GOTPoll.openExternal(t.url!)}>
                <ExternalLink className="h-4 w-4" />
              </Button>
            </>
          )}
          {t.state === 'off' || t.state === 'error' ? (
            <Button size="sm" onClick={() => window.GOTPoll.share.start()}>
              <Power className="h-3.5 w-3.5" /> {t.state === 'error' ? 'Retry' : 'Go public'}
            </Button>
          ) : (
            <Button size="sm" variant="outline" onClick={() => window.GOTPoll.share.stop()}>
              Stop
            </Button>
          )}
        </div>
        <AnimatePresence>
          {t.state === 'installing' && t.progress != null && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="bg-foreground/10 mt-3 h-1 overflow-hidden rounded-full">
              <motion.div className="bg-foreground/60 h-full" animate={{ width: `${t.progress * 100}%` }} />
            </motion.div>
          )}
        </AnimatePresence>
        {t.state === 'online' && t.provider === 'cloudflare' && (
          <p className="text-muted-foreground mt-2 text-[11px]">This address changes every time the link is reopened.</p>
        )}
        {t.state === 'online' && t.provider === 'ngrok' && (
          <p className="text-muted-foreground mt-2 text-[11px]">
            Browsers see a one-click ngrok notice first (remembered 7 days). In OBS, use “Interact” to click it once.
          </p>
        )}
      </div>
    </div>
  );
}

/** Settings → Sharing: provider, ngrok token, auto start. */
export function SharingSettings() {
  const info = useShare();
  const [settings, setSettings] = useState<Settings | null>(null);
  const [token, setToken] = useState('');
  const [reveal, setReveal] = useState(false);
  useEffect(() => {
    window.GOTPoll.settings.get().then((s) => {
      setSettings(s);
      setToken(s.ngrokToken);
    });
  }, []);
  if (!settings || !info) return null;
  const set = async (patch: Partial<Settings>) => setSettings(await window.GOTPoll.settings.set(patch));

  const providers: { id: TunnelProvider; name: string; icon: typeof Cloud; points: string[] }[] = [
    {
      id: 'cloudflare',
      name: 'Cloudflare Quick Tunnel',
      icon: Cloud,
      points: ['Free, no account, no key', 'New random address each time', 'Up to ~200 viewers at once'],
    },
    {
      id: 'ngrok',
      name: 'ngrok',
      icon: Globe,
      points: ['Same address every time', 'Needs your free ngrok token', '1 GB/month on the free plan, one-click notice for browsers'],
    },
  ];

  return (
    <div className="space-y-5">
      <ShareLinks info={info} />

      <div>
        <h3 className="mb-2 text-sm font-semibold">Public link provider</h3>
        <div className="grid grid-cols-2 gap-3">
          {providers.map((p) => {
            const active = settings.tunnelProvider === p.id;
            const Icon = p.icon;
            return (
              <button
                key={p.id}
                onClick={() => set({ tunnelProvider: p.id })}
                className={cn(
                  'bg-card/60 relative rounded-xl border p-4 text-left transition-all hover:shadow-md',
                  active ? 'border-foreground/40 shadow-md' : 'opacity-80 hover:opacity-100'
                )}
              >
                {active && <motion.span layoutId="tunnel-ring" className="border-foreground/50 pointer-events-none absolute inset-0 rounded-xl border-2" />}
                <div className="flex items-center gap-2">
                  <Icon className="h-4 w-4" />
                  <span className="font-semibold">{p.name}</span>
                  {active && <Check className="ml-auto h-4 w-4" />}
                </div>
                <ul className="text-muted-foreground mt-2 space-y-0.5 text-xs">
                  {p.points.map((x) => (
                    <li key={x}>· {x}</li>
                  ))}
                </ul>
              </button>
            );
          })}
        </div>
      </div>

      <AnimatePresence initial={false}>
        {settings.tunnelProvider === 'ngrok' && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="bg-card/60 space-y-2 rounded-xl border p-4">
              <Label htmlFor="ngrok-token">ngrok authtoken</Label>
              <div className="flex gap-2">
                <Input
                  id="ngrok-token"
                  type={reveal ? 'text' : 'password'}
                  autoComplete="off"
                  spellCheck={false}
                  placeholder="paste from dashboard.ngrok.com → Your Authtoken"
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  onBlur={() => token !== settings.ngrokToken && set({ ngrokToken: token })}
                  className="font-mono"
                />
                <Button size="icon" variant="ghost" onClick={() => setReveal((r) => !r)} title={reveal ? 'Hide' : 'Show'}>
                  {reveal ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                Free at ngrok.com. It’s stored only on this computer and only sent to ngrok.
              </p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <label className="bg-card/60 flex items-center justify-between gap-6 rounded-xl border p-4">
        <div>
          <div className="font-medium">Open the public link when the app starts</div>
          <p className="text-muted-foreground text-sm">Off by default – the viewer page stays on this computer and network until you share it.</p>
        </div>
        <Switch checked={settings.tunnelAutoStart} onCheckedChange={(v) => set({ tunnelAutoStart: v })} />
      </label>

      <div className="text-muted-foreground flex items-start gap-2 text-xs">
        <ShieldCheck className="mt-px h-3.5 w-3.5 shrink-0 text-emerald-500" />
        <span>
          The public link only reaches a read-only copy of the viewer page and its live feed. Settings, controls and
          everything else in the app can’t be reached from it.
        </span>
      </div>
    </div>
  );
}
