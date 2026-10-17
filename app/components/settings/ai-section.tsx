import { AnimatePresence, motion } from 'motion/react';
import {
  Check,
  Crosshair,
  Cpu,
  Download,
  Gauge,
  Layers,
  Loader2,
  Pause,
  Play,
  Sparkles,
  Target,
  Trash2,
  Type,
  X,
  Zap,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import { Button } from '~/components/ui/button';
import { cn } from '~/lib/utils';

// Measured with scripts/bench-strategies.mjs (2.6k chat-style votes, 56 hard
// ones, 149 chatter lines). See docs/matching.md.
const STRATEGIES: {
  id: MatcherStrategy;
  name: string;
  icon: typeof Type;
  blurb: string;
  needs: ('embed' | 'llm')[];
  stats: { main: string; hard: string; ms: string };
}[] = [
  {
    id: 'classic',
    name: 'Classic',
    icon: Type,
    blurb: 'Spelling-aware text matching. Instant, nothing to download.',
    needs: [],
    stats: { main: '93.4%', hard: '75%', ms: '2 ms' },
  },
  {
    id: 'hybrid',
    name: 'Hybrid',
    icon: Layers,
    blurb: 'Classic first; a small embedding model rescues what it misses.',
    needs: ['embed'],
    stats: { main: '94.5%', hard: '82%', ms: '5 ms' },
  },
  {
    id: 'hybrid-llm',
    name: 'Hybrid + AI judge',
    icon: Sparkles,
    blurb: 'Hybrid, then a local LLM decides the phrases still in doubt.',
    needs: ['embed', 'llm'],
    // with Qwen2.5 7B (what "auto" picks on an 8 GB GPU)
    stats: { main: '97.5%', hard: '93%', ms: 'only on doubts' },
  },
  {
    id: 'precise-hybrid-llm',
    name: 'Precise Hybrid + AI',
    icon: Target,
    blurb: 'Text matching only when highly confident; the LLM decides everything else from text + embedding candidates.',
    needs: ['embed', 'llm'],
    stats: { main: '—', hard: '—', ms: 'on non-certain' },
  },
  {
    id: 'precise-llm',
    name: 'Precise + AI',
    icon: Crosshair,
    blurb: 'Text matching only when highly confident; the LLM decides the rest. No embedding model needed.',
    needs: ['llm'],
    stats: { main: '—', hard: '—', ms: 'on non-certain' },
  },
];

const fmtBytes = (n: number) =>
  n >= 1e9 ? `${(n / 1e9).toFixed(n >= 1e10 ? 0 : 1)} GB` : n >= 1e6 ? `${(n / 1e6).toFixed(0)} MB` : `${Math.max(1, Math.round(n / 1e3))} KB`;
const fmtEta = (s: number | null) =>
  s === null ? '' : s >= 3600 ? `${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m` : s >= 60 ? `${Math.floor(s / 60)}m ${s % 60}s` : `${s}s`;

export default function AiSection() {
  const [settings, setSettings] = useState<Settings | null>(null);
  const [packs, setPacks] = useState<AiPack[]>([]);
  const [hw, setHw] = useState<AiHardware | null>(null);
  const [status, setStatus] = useState<{ embed: AiPartStatus; llm: AiPartStatus } | null>(null);

  useEffect(() => {
    window.GOTPoll.settings.get().then(setSettings);
    window.GOTPoll.ai.packs().then(setPacks);
    window.GOTPoll.ai.status().then(setStatus);
    window.GOTPoll.ai.hardware().then(setHw);
    const a = window.GOTPoll.ai.onPacks(setPacks);
    const b = window.GOTPoll.ai.onStatus(setStatus);
    return () => {
      a();
      b();
    };
  }, []);

  if (!settings) return null;
  const set = async (patch: Partial<Settings>) => setSettings(await window.GOTPoll.settings.set(patch));
  const embedPack = packs.find((p) => p.id === settings.embedModel);
  const llmId = settings.llmModel === 'auto' ? (hw?.recommended ?? 'qwen-3b') : settings.llmModel;
  const llmPack = packs.find((p) => p.id === llmId);
  const ready = (needs: ('embed' | 'llm')[]) =>
    needs.every((n) => (n === 'embed' ? embedPack?.installed : llmPack?.installed));

  return (
    <div className="space-y-6">
      {/* ---------------- strategy */}
      <div>
        <h3 className="mb-1 text-sm font-semibold">Matching strategy</h3>
        <p className="text-muted-foreground mb-3 text-xs">
          Everything runs on this computer – free, offline, no account. Numbers are from the built-in benchmark.
        </p>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
          {STRATEGIES.map((s) => {
            const active = settings.matcherStrategy === s.id;
            const ok = ready(s.needs);
            const Icon = s.icon;
            return (
              <button
                key={s.id}
                onClick={() => set({ matcherStrategy: s.id })}
                className={cn(
                  'bg-card/60 relative flex flex-col gap-2 rounded-xl border p-3.5 text-left transition-all hover:shadow-md',
                  active ? 'border-foreground/40 shadow-md' : 'opacity-80 hover:opacity-100'
                )}
              >
                {active && (
                  <motion.span layoutId="strategy-ring" className="border-foreground/50 pointer-events-none absolute inset-0 rounded-xl border-2" />
                )}
                <div className="flex items-center gap-2">
                  <span className="bg-foreground/5 grid h-8 w-8 place-items-center rounded-lg">
                    <Icon className="h-4 w-4" />
                  </span>
                  <span className="font-semibold">{s.name}</span>
                  {active && <Check className="ml-auto h-4 w-4" />}
                </div>
                <p className="text-muted-foreground text-xs leading-relaxed">{s.blurb}</p>
                <div className="mt-auto grid grid-cols-3 gap-1 pt-1 text-center">
                  <Stat label="votes right" value={s.stats.main} />
                  <Stat label="hard ones" value={s.stats.hard} />
                  <Stat label="speed" value={s.stats.ms} />
                </div>
                {s.needs.length > 0 && (
                  <div className={cn('text-[11px]', ok ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
                    {ok
                      ? 'Models installed'
                      : `Needs ${s.needs.map((n) => (n === 'embed' ? embedPack?.name : llmPack?.name)).join(' + ')} – download below`}
                  </div>
                )}
              </button>
            );
          })}
        </div>
        {status && settings.matcherStrategy !== 'classic' && <LoadState status={status} />}
      </div>

      {/* ---------------- hardware */}
      <HardwareCard hw={hw} />

      {/* ---------------- models */}
      <div className="space-y-4">
        <ModelGroup
          title="Embedding models"
          hint="Small and fast; used by Hybrid and as candidate finder for the AI."
          packs={packs.filter((p) => p.kind === 'embed')}
          selected={settings.embedModel}
          onSelect={(id) => set({ embedModel: id as Settings['embedModel'] })}
          hw={hw}
        />
        <ModelGroup
          title="Language models (LLM)"
          hint="Judge what chat means when text matching isn't sure. Bigger = smarter, needs more GPU memory."
          packs={packs.filter((p) => p.kind === 'llm')}
          selected={llmId}
          onSelect={(id) => set({ llmModel: id as Settings['llmModel'] })}
          hw={hw}
        />
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-foreground/[0.04] rounded-md px-1 py-1">
      <div className="text-xs font-semibold tabular-nums">{value}</div>
      <div className="text-muted-foreground text-[10px]">{label}</div>
    </div>
  );
}

function LoadState({ status }: { status: { embed: AiPartStatus; llm: AiPartStatus } }) {
  const parts = (['embed', 'llm'] as const).filter((k) => status[k].state !== 'off');
  if (!parts.length) return null;
  return (
    <div className="mt-3 flex flex-wrap gap-2">
      {parts.map((k) => {
        const s = status[k];
        return (
          <span key={k} className="bg-foreground/5 flex items-center gap-2 rounded-full px-3 py-1 text-xs">
            {s.state === 'ready' ? (
              <Check className="h-3.5 w-3.5 text-emerald-500" />
            ) : s.state === 'error' || s.state === 'missing' ? (
              <X className="h-3.5 w-3.5 text-amber-500" />
            ) : (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            )}
            <span className="font-medium">{k === 'embed' ? 'Embeddings' : 'LLM'}</span>
            <span className="text-muted-foreground">
              {s.state === 'indexing' ? `indexing ${Math.round((s.progress ?? 0) * 100)}% · ${s.detail}` : s.state === 'missing' ? `not downloaded · ${s.detail}` : s.detail ?? s.state}
            </span>
          </span>
        );
      })}
    </div>
  );
}

function HardwareCard({ hw }: { hw: AiHardware | null }) {
  const gpuName = hw?.devices[0];
  return (
    <div className="bg-card/60 flex items-center gap-4 rounded-xl border p-4">
      <div className="bg-foreground/5 grid h-10 w-10 shrink-0 place-items-center rounded-xl">
        {hw?.gpu ? <Zap className="h-5 w-5" /> : <Cpu className="h-5 w-5" />}
      </div>
      <div className="min-w-0 flex-1">
        {!hw ? (
          <div className="text-muted-foreground flex items-center gap-2 text-sm">
            <Loader2 className="h-4 w-4 animate-spin" /> Checking your hardware…
          </div>
        ) : (
          <>
            <div className="font-medium">
              {hw.gpu ? `${gpuName ?? 'GPU'} · ${hw.gpu.toUpperCase()}` : 'No supported GPU – models run on the CPU'}
            </div>
            <div className="text-muted-foreground text-xs">
              {hw.gpu ? `${(hw.vramFree / 1e9).toFixed(1)} GB free of ${(hw.vramTotal / 1e9).toFixed(1)} GB · ` : ''}
              recommended LLM: <span className="text-foreground font-medium">{hw.recommended.replace('qwen-', 'Qwen2.5 ').toUpperCase().replace('QWEN2.5', 'Qwen2.5')}</span>
            </div>
          </>
        )}
      </div>
      <Gauge className="text-muted-foreground h-4 w-4" />
    </div>
  );
}

function ModelGroup({
  title,
  hint,
  packs,
  selected,
  onSelect,
  hw,
}: {
  title: string;
  hint: string;
  packs: AiPack[];
  selected: string;
  onSelect: (id: string) => void;
  hw: AiHardware | null;
}) {
  return (
    <div>
      <h3 className="text-sm font-semibold">{title}</h3>
      <p className="text-muted-foreground mb-2 text-xs">{hint}</p>
      <div className="bg-card/60 divide-y overflow-hidden rounded-xl border">
        {packs.map((p) => (
          <ModelRow key={p.id} pack={p} selected={selected === p.id} onSelect={() => onSelect(p.id)} hw={hw} />
        ))}
      </div>
    </div>
  );
}

function ModelRow({ pack: p, selected, onSelect, hw }: { pack: AiPack; selected: boolean; onSelect: () => void; hw: AiHardware | null }) {
  const size = p.files.reduce((n, f) => n + f.size, 0);
  const d = p.download && p.download.state !== 'done' ? p.download : null;
  const pct = d ? (d.received / Math.max(1, d.total)) * 100 : 0;
  const fits = p.kind === 'llm' && hw ? (hw.gpu ? hw.vramFree / 1e9 >= (p.vramGb ?? 0) + 0.5 : null) : null;
  const recommended = hw?.recommended === p.id;

  return (
    <div className="relative flex items-center gap-3 px-4 py-3">
      {/* progress fills the row */}
      <AnimatePresence>
        {d && (
          <motion.div
            className="bg-foreground/[0.06] absolute inset-y-0 left-0"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1, width: `${pct}%` }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 60, damping: 20 }}
          />
        )}
      </AnimatePresence>

      <button
        onClick={onSelect}
        className={cn(
          'relative grid h-5 w-5 shrink-0 place-items-center rounded-full border transition-colors',
          selected ? 'border-foreground bg-foreground text-background' : 'border-foreground/30 hover:border-foreground/60'
        )}
        title="Use this model"
      >
        {selected && <Check className="h-3 w-3" />}
      </button>

      <div className="relative min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-medium">{p.name}</span>
          <span className="text-muted-foreground text-xs">{fmtBytes(size)}</span>
          {recommended && <Tag className="bg-foreground text-background">recommended</Tag>}
          {fits === true && <Tag>fits on GPU</Tag>}
          {fits === false && <Tag className="text-amber-600 dark:text-amber-400">partly on CPU</Tag>}
          {p.speed && <Tag>{p.speed}</Tag>}
        </div>
        <div className="text-muted-foreground truncate text-xs">
          {d ? (
            d.state === 'downloading' ? (
              <span className="tabular-nums">
                {fmtBytes(d.received)} of {fmtBytes(d.total)} · {(d.speed / 1e6).toFixed(1)} MB/s · {fmtEta(d.etaSec)} left ·{' '}
                {d.connections} connections
              </span>
            ) : d.state === 'paused' ? (
              <span className="tabular-nums">
                Paused at {fmtBytes(d.received)} of {fmtBytes(d.total)} – resumes where it stopped
              </span>
            ) : d.state === 'verifying' ? (
              'Verifying checksum…'
            ) : d.state === 'error' ? (
              <span className="text-destructive">{d.error}</span>
            ) : (
              'Starting…'
            )
          ) : (
            p.blurb
          )}
        </div>
      </div>

      <div className="relative flex shrink-0 items-center gap-1">
        {p.installed ? (
          <>
            <span className="text-muted-foreground mr-1 flex items-center gap-1 text-xs">
              <Check className="h-3.5 w-3.5 text-emerald-500" /> Installed
            </span>
            <Button size="icon" variant="ghost" className="h-8 w-8" title="Delete from disk" onClick={() => window.GOTPoll.ai.remove(p.id)}>
              <Trash2 className="h-4 w-4" />
            </Button>
          </>
        ) : d?.state === 'downloading' || d?.state === 'verifying' ? (
          <>
            <Button size="icon" variant="ghost" className="h-8 w-8" title="Pause" onClick={() => window.GOTPoll.ai.pause(p.id)}>
              <Pause className="h-4 w-4" />
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" title="Cancel" onClick={() => window.GOTPoll.ai.cancel(p.id)}>
              <X className="h-4 w-4" />
            </Button>
          </>
        ) : d?.state === 'paused' || d?.state === 'error' ? (
          <>
            <Button size="sm" variant="outline" onClick={() => window.GOTPoll.ai.download(p.id)}>
              <Play className="h-3.5 w-3.5" /> {d.state === 'error' ? 'Retry' : 'Resume'}
            </Button>
            <Button size="icon" variant="ghost" className="h-8 w-8" title="Cancel" onClick={() => window.GOTPoll.ai.cancel(p.id)}>
              <X className="h-4 w-4" />
            </Button>
          </>
        ) : (
          <Button size="sm" variant="outline" onClick={() => window.GOTPoll.ai.download(p.id)}>
            <Download className="h-3.5 w-3.5" /> Download
          </Button>
        )}
      </div>
    </div>
  );
}

function Tag({ children, className }: { children: React.ReactNode; className?: string }) {
  return <span className={cn('bg-foreground/5 rounded px-1.5 py-px text-[10px] font-medium', className)}>{children}</span>;
}
