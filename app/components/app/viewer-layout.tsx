import { LayoutTemplate } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '~/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '~/components/ui/dialog';
import { cn } from '~/lib/utils';

// Title bar → Layout: how the viewer page fits around the streamer's own
// overlay, screen by screen, for each of their two scenes, and how big the
// board is. Each screen has a small preview with the scene's camera (and
// chat) drawn on top, so it's plain to see whether anything sits under
// them. Every move goes out live.

type Layout = Pick<Settings, 'liveRows' | 'liveColumns' | 'layoutPreset' | 'layouts'>;
type Key = keyof ViewerFreeSpace;

type Rect = { left: number; top: number; right: number; bottom: number };

// Each scene as it looks on stream (% of the stream): where the viewer page
// sits, the streamer's camera / chat / small screen, and the scene's own bars.
// The defaults are made for these.
const PRESETS: {
  id: LayoutPreset;
  name: string;
  hint: string;
  /** where the viewer page is on the stream */
  page: Rect;
  overlay: (Rect & { label: string; tone: 'cam' | 'chat'; vertical?: boolean })[];
  /** the scene's own frame and bars – not covering the page, drawn so the scene is recognisable */
  chrome: Rect[];
}[] = [
  {
    id: 'full',
    name: 'Full screen',
    hint: 'camera top-right, chat below it',
    page: { left: 0, top: 0, right: 0, bottom: 0 },
    overlay: [
      { label: 'CAMERA', tone: 'cam', left: 65, top: 0, right: 0, bottom: 58 },
      { label: 'CHAT', tone: 'chat', left: 84, top: 42, right: 0, bottom: 0, vertical: true },
    ],
    chrome: [],
  },
  {
    id: 'framed',
    name: 'Big screen',
    hint: 'vote in the big frame, face in the small screen',
    page: { left: 1.75, top: 12.4, right: 25.25, bottom: 15.2 },
    overlay: [
      { label: 'CHAT', tone: 'chat', left: 77.5, top: 11.5, right: 0.5, bottom: 45 },
      { label: 'FACE', tone: 'cam', left: 55.75, top: 57.9, right: 3.25, bottom: 5 },
    ],
    chrome: [
      { left: 0, top: 0, right: 0, bottom: 90.3 },
      { left: 0, top: 87, right: 61, bottom: 4 },
    ],
  },
];

const pct = (r: Rect) => ({ left: `${r.left}%`, top: `${r.top}%`, right: `${r.right}%`, bottom: `${r.bottom}%` });

// each screen's preview is the real viewer page in preview mode (sample titles), shrunk into its frame
const SCREENS: { title: string; hint?: string; kind: string; sliders: { key: Key; label: string }[] }[] = [
  {
    title: 'Board',
    hint: 'poll and tournament open round',
    kind: 'board',
    sliders: [
      { key: 'nav', label: 'Top bar' },
      { key: 'top', label: 'Top three' },
      { key: 'rows', label: 'Rows below' },
    ],
  },
  { title: 'Final results', hint: 'poll reveal and tournament champion', kind: 'final', sliders: [{ key: 'final', label: 'Keep free' }] },
  { title: 'Bracket', kind: 'bracket', sliders: [{ key: 'bracket', label: 'Keep free' }] },
  { title: '1v1 / versus', hint: 'versus polls, 1v1 intro and vote', kind: 'versus', sliders: [{ key: 'versus', label: 'Keep free' }] },
  { title: 'Coin flip', kind: 'coin', sliders: [{ key: 'coin', label: 'Keep free' }] },
  { title: 'Cage draw', kind: 'draw', sliders: [{ key: 'draw', label: 'Keep free' }] },
  { title: 'Other screens', hint: 'qualifiers, report, “opens soon”', kind: 'other', sliders: [{ key: 'other', label: 'Keep free' }] },
];

export default function ViewerLayoutButton() {
  const [open, setOpen] = useState(false);
  const [l, setL] = useState<Layout | null>(null);
  useEffect(() => {
    if (open) window.GOTPoll.settings.get().then((s) => setL({ liveRows: s.liveRows, liveColumns: s.liveColumns, layoutPreset: s.layoutPreset, layouts: s.layouts }));
  }, [open]);
  const set = (patch: Partial<Layout>) => {
    if (!l) return;
    setL({ ...l, ...patch });
    void window.GOTPoll.settings.set(patch);
  };
  const setFree = (k: Key, v: number) => l && set({ layouts: { ...l.layouts, [l.layoutPreset]: { ...l.layouts[l.layoutPreset], [k]: v } } });
  const preset = PRESETS.find((p) => p.id === l?.layoutPreset) ?? PRESETS[0];
  const [port, setPort] = useState<number | null>(null);
  useEffect(() => {
    if (open) window.GOTPoll.getServerPort().then(setPort);
  }, [open]);

  return (
    <>
      <Button variant="ghost" size="sm" className="pointer-events-auto [app-region:no-drag]" onClick={() => setOpen(true)} title="How the viewer page is laid out">
        <LayoutTemplate className="h-4 w-4" />
        Layout
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>Viewer page layout</DialogTitle>
            <DialogDescription>
              How much of the width to keep free on the right for your camera and chat, screen by screen. Changes show right away; phones on the public
              link use the whole screen.
            </DialogDescription>
          </DialogHeader>
          {l && (
            <div className="flex gap-2">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  onClick={() => set({ layoutPreset: p.id })}
                  className={cn(
                    'flex flex-1 items-center gap-3 rounded-lg border p-2 text-left transition-colors',
                    p.id === l.layoutPreset ? 'border-foreground bg-foreground/[0.06]' : 'hover:bg-foreground/[0.03] opacity-70'
                  )}
                >
                  <div className={cn('relative aspect-video w-20 shrink-0 overflow-hidden rounded border', p.chrome.length ? 'bg-emerald-950' : 'bg-[#0d0b18]')}>
                    <Chrome preset={p} />
                    <div className={cn('absolute bg-[#0d0b18]', p.chrome.length > 0 && 'ring-1 ring-emerald-400/70')} style={pct(p.page)} />
                    <Overlay preset={p} />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      {p.name}
                      {p.id === l.layoutPreset && <span className="rounded-full bg-emerald-500 px-1.5 text-[10px] font-bold text-white">LIVE</span>}
                    </div>
                    <div className="text-muted-foreground text-xs">{p.hint}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
          {l && (
            <div className="grid gap-3 md:grid-cols-2">
              {SCREENS.map((s) => (
                <div
                  key={s.title}
                  className={cn('bg-foreground/[0.03] flex gap-4 rounded-lg border p-3', s.title === 'Board' ? 'items-start md:col-span-2' : 'flex-col')}
                >
                  <Frame preset={preset} className={s.title === 'Board' ? 'w-[26rem]' : 'w-full'}>
                    {port && <LivePage port={port} kind={s.kind} l={l} />}
                  </Frame>
                  <div className="min-w-0 flex-1 space-y-2.5">
                    <div className="text-sm font-semibold">
                      {s.title}
                      {s.hint && <span className="text-muted-foreground ml-1.5 text-xs font-normal">{s.hint}</span>}
                    </div>
                    {s.sliders.map((x) => (
                      <Row key={x.key} label={x.label} value={l.layouts[l.layoutPreset][x.key]} unit="%" max={50} onChange={(v) => setFree(x.key, v)} />
                    ))}
                    {s.title === 'Board' && (
                      <div className="grid grid-cols-2 gap-4 border-t pt-2.5">
                        <Row label="Shows" value={l.liveRows} min={3} max={100} onChange={(liveRows) => set({ liveRows })} />
                        <Row label="Columns" value={l.liveColumns} min={1} max={6} onChange={(liveColumns) => set({ liveColumns })} />
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function Row({ label, value, unit = '', min = 0, max, onChange }: { label: string; value: number; unit?: string; min?: number; max: number; onChange: (v: number) => void }) {
  return (
    <label className="block space-y-0.5">
      <span className="flex items-baseline justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-semibold tabular-nums">
          {value}
          {unit}
        </span>
      </span>
      <input type="range" min={min} max={max} value={value} onChange={(e) => onChange(Number(e.target.value))} className="accent-foreground w-full" />
    </label>
  );
}

// ---------------------------------------------------------------- sketches

/** The scene on stream: its bars, the viewer page in its place (the sketch), and the camera / chat on top. */
function Frame({ preset, className, children }: { preset: (typeof PRESETS)[number]; className?: string; children: React.ReactNode }) {
  const framed = preset.chrome.length > 0;
  return (
    <div className={cn('relative aspect-video shrink-0 overflow-hidden rounded-md border', framed ? 'bg-emerald-950' : 'bg-[#0d0b18]', className)}>
      <Chrome preset={preset} />
      <div className={cn('absolute overflow-hidden bg-[#0d0b18]', framed && 'rounded-[2px] ring-1 ring-emerald-400/70')} style={pct(preset.page)}>
        {children}
      </div>
      <Overlay preset={preset} labels />
    </div>
  );
}

function Chrome({ preset }: { preset: (typeof PRESETS)[number] }) {
  return (
    <>
      {preset.chrome.map((c, i) => (
        <div key={i} className="absolute bg-emerald-500/35" style={pct(c)} />
      ))}
    </>
  );
}

function Overlay({ preset, labels }: { preset: (typeof PRESETS)[number]; labels?: boolean }) {
  return (
    <>
      {preset.overlay.map((o) => (
        <div
          key={o.label}
          className={cn(
            'absolute grid place-items-center text-[9px] font-bold tracking-widest',
            o.tone === 'cam' ? 'border-2 border-amber-300/80 bg-amber-300/15 text-amber-200' : 'border-2 border-sky-300/80 bg-sky-300/15 text-sky-200',
            o.vertical && '[writing-mode:vertical-rl]',
            // the face sits on top of the page; the rest is beside it
            o.tone === 'cam' && 'bg-[#2a2410]/90'
          )}
          style={pct(o)}
        >
          {labels && o.label}
        </div>
      ))}
    </>
  );
}

/**
 * The viewer page itself in preview mode, at 1600×900 and scaled to its frame.
 * The sliders reach it by postMessage, so it follows them as they move.
 */
function LivePage({ port, kind, l }: { port: number; kind: string; l: Layout }) {
  const box = useRef<HTMLDivElement>(null);
  const frame = useRef<HTMLIFrameElement>(null);
  const [scale, setScale] = useState(0);
  const [ready, setReady] = useState(0);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setScale(el.clientWidth / 1600));
    ro.observe(el);
    // the page says when it listens; (re)send the values then
    const onMessage = (e: MessageEvent) => {
      if (e.source === frame.current?.contentWindow && (e.data as { gotpoll?: string })?.gotpoll === 'preview-ready') setReady((n) => n + 1);
    };
    window.addEventListener('message', onMessage);
    return () => {
      ro.disconnect();
      window.removeEventListener('message', onMessage);
    };
  }, []);
  useEffect(() => {
    if (!ready) return;
    frame.current?.contentWindow?.postMessage(
      { gotpoll: 'layout', freeSpace: l.layouts[l.layoutPreset], liveRows: l.liveRows, liveColumns: l.liveColumns },
      `http://localhost:${port}`
    );
  }, [ready, l, port]);
  return (
    <div ref={box} className="absolute inset-0">
      <iframe
        ref={frame}
        title={`${kind} preview`}
        src={`http://localhost:${port}/?preview=${kind}&clean`}
        tabIndex={-1}
        className="pointer-events-none absolute top-0 left-0 origin-top-left border-0"
        style={{ width: 1600, height: 900, transform: `scale(${scale})` }}
      />
    </div>
  );
}
