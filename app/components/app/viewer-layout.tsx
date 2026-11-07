import { LayoutTemplate } from 'lucide-react';
import { useEffect, useState } from 'react';
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

const SCREENS: { title: string; hint?: string; sliders: { key: Key; label: string }[]; sketch: (f: ViewerFreeSpace, l: Layout) => React.ReactNode }[] = [
  {
    title: 'Board',
    hint: 'poll and tournament open round',
    sliders: [
      { key: 'nav', label: 'Top bar' },
      { key: 'top', label: 'Top three' },
      { key: 'rows', label: 'Rows below' },
    ],
    sketch: (f, l) => <BoardSketch f={f} l={l} />,
  },
  { title: 'Final results', hint: 'poll reveal and tournament champion', sliders: [{ key: 'final', label: 'Keep free' }], sketch: (f) => <FinalSketch free={f.final} /> },
  { title: 'Bracket', sliders: [{ key: 'bracket', label: 'Keep free' }], sketch: (f) => <BracketSketch free={f.bracket} /> },
  { title: '1v1 / versus', hint: 'versus polls, 1v1 intro and vote', sliders: [{ key: 'versus', label: 'Keep free' }], sketch: (f) => <VersusSketch free={f.versus} /> },
  { title: 'Coin flip', sliders: [{ key: 'coin', label: 'Keep free' }], sketch: (f) => <CoinSketch free={f.coin} /> },
  { title: 'Cage draw', sliders: [{ key: 'draw', label: 'Keep free' }], sketch: (f) => <DrawSketch free={f.draw} /> },
  { title: 'Other screens', hint: 'qualifiers, report, “opens soon”', sliders: [{ key: 'other', label: 'Keep free' }], sketch: (f) => <ListSketch free={f.other} /> },
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
                <div key={s.title} className={cn('bg-foreground/[0.03] flex gap-4 rounded-lg border p-3', s.title === 'Board' && 'md:col-span-2')}>
                  <Frame preset={preset}>{s.sketch(l.layouts[l.layoutPreset], l)}</Frame>
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
function Frame({ preset, children }: { preset: (typeof PRESETS)[number]; children: React.ReactNode }) {
  const framed = preset.chrome.length > 0;
  return (
    <div className={cn('relative aspect-video w-56 shrink-0 self-start overflow-hidden rounded-md border', framed ? 'bg-emerald-950' : 'bg-[#0d0b18]')}>
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

const box = 'absolute rounded-[2px] bg-white/25';
const faint = 'absolute rounded-[2px] bg-white/12';

/** content area: everything left of the free space, with a small margin */
const area = (free: number, top = 13, bottom = 4) => ({ left: '3%', right: `calc(3% + ${free}%)`, top: `${top}%`, bottom: `${bottom}%` });

function TopBar({ free }: { free: number }) {
  return <div className="absolute top-0 left-0 h-[9%] border-b border-white/10 bg-white/[0.06]" style={{ right: `${free}%` }} />;
}

function BoardSketch({ f, l }: { f: ViewerFreeSpace; l: Layout }) {
  const cols = l.liveColumns;
  const rows = Math.min(7, Math.ceil(Math.max(0, l.liveRows - 3) / cols));
  return (
    <>
      <TopBar free={f.nav} />
      <div className="absolute top-[13%] left-[3%] flex h-[26%] gap-[3%]" style={{ right: `calc(3% + ${f.top}%)` }}>
        {[1.25, 1, 1].map((x, i) => (
          <div key={i} className="rounded-sm bg-white/25" style={{ flex: x }} />
        ))}
      </div>
      <div className="absolute top-[43%] bottom-[3%] left-[3%] grid content-start gap-[5%_3%]" style={{ right: `calc(3% + ${f.rows}%)`, gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {Array.from({ length: rows * cols }, (_, i) => (
          <div key={i} className="h-[0.5rem] rounded-[2px] bg-white/15" />
        ))}
      </div>
    </>
  );
}

function FinalSketch({ free }: { free: number }) {
  return (
    <div className="absolute" style={area(free, 12, 4)}>
      <div className={box} style={{ left: '35%', right: '35%', top: '0%', height: '9%' }} />
      {/* 2 · 1 · 3 */}
      {[
        [8, 30, 38],
        [37, 26, 30],
        [66, 30, 44],
      ].map(([left, w, top], i) => (
        <div key={i} className={i === 1 ? box : faint} style={{ left: `${left}%`, width: `${w - 4}%`, top: `${top}%`, bottom: '30%' }} />
      ))}
      {[0, 1].map((r) =>
        [0, 1, 2].map((c) => <div key={`${r}${c}`} className={faint} style={{ left: `${4 + c * 31}%`, width: '28%', top: `${76 + r * 12}%`, height: '8%' }} />)
      )}
    </div>
  );
}

function BracketSketch({ free }: { free: number }) {
  const rounds = [8, 4, 2, 1];
  return (
    <div className="absolute flex gap-[4%]" style={area(free, 14, 6)}>
      {rounds.map((n, r) => (
        <div key={r} className="flex flex-1 flex-col justify-around">
          {Array.from({ length: n }, (_, i) => (
            <div key={i} className="h-[0.45rem] rounded-[2px] bg-white/20" />
          ))}
        </div>
      ))}
    </div>
  );
}

function VersusSketch({ free }: { free: number }) {
  return (
    <div className="absolute" style={area(free, 14, 8)}>
      <div className={box} style={{ left: '6%', width: '38%', top: '0%', bottom: '0%' }} />
      <div className={box} style={{ right: '6%', width: '38%', top: '0%', bottom: '0%' }} />
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-[10px] font-black text-white/60">VS</div>
    </div>
  );
}

function CoinSketch({ free }: { free: number }) {
  return (
    <div className="absolute" style={area(free, 14, 8)}>
      <div className="absolute top-1/2 left-1/2 aspect-square h-[62%] -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-amber-200/60 bg-amber-200/25" />
    </div>
  );
}

function DrawSketch({ free }: { free: number }) {
  return (
    <div className="absolute" style={area(free, 14, 6)}>
      <div className="absolute top-[4%] left-[8%] aspect-square h-[88%] rounded-full border-2 border-white/30 bg-white/[0.06]" />
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className={faint} style={{ right: '4%', width: '34%', top: `${8 + i * 14}%`, height: '9%' }} />
      ))}
    </div>
  );
}

function ListSketch({ free }: { free: number }) {
  return (
    <div className="absolute" style={area(free, 14, 6)}>
      <div className={box} style={{ left: '25%', right: '25%', top: '0%', height: '10%' }} />
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className={faint} style={{ left: '10%', right: '10%', top: `${18 + i * 13}%`, height: '9%' }} />
      ))}
    </div>
  );
}
