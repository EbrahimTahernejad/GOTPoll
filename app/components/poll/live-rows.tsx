import { Columns3, MonitorPlay } from 'lucide-react';
import { useEffect, useState } from 'react';

/**
 * How many shows the viewer page's board shows, and in how many columns.
 * Every move goes out to the viewer page right away, so it can be changed
 * mid-poll.
 */
export default function LiveRows() {
  const [s, setS] = useState<{ rows: number; cols: number } | null>(null);
  useEffect(() => {
    window.GOTPoll.settings.get().then((x) => setS({ rows: x.liveRows, cols: x.liveColumns }));
  }, []);
  if (!s) return null;
  return (
    <div className="text-muted-foreground flex items-center gap-4 text-xs">
      <label className="flex items-center gap-2" title="How many shows the viewer page shows – changes live">
        <MonitorPlay className="h-3.5 w-3.5" />
        On screen
        <input
          type="range"
          min={3}
          max={100}
          value={s.rows}
          onChange={(e) => {
            setS({ ...s, rows: Number(e.target.value) });
            void window.GOTPoll.settings.set({ liveRows: Number(e.target.value) });
          }}
          className="accent-foreground w-28"
        />
        <span className="text-foreground w-6 font-semibold tabular-nums">{s.rows}</span>
      </label>
      <label className="flex items-center gap-2" title="Columns under the top three – the list scrolls when they don't fit">
        <Columns3 className="h-3.5 w-3.5" />
        Columns
        <input
          type="range"
          min={1}
          max={6}
          value={s.cols}
          onChange={(e) => {
            setS({ ...s, cols: Number(e.target.value) });
            void window.GOTPoll.settings.set({ liveColumns: Number(e.target.value) });
          }}
          className="accent-foreground w-16"
        />
        <span className="text-foreground w-3 font-semibold tabular-nums">{s.cols}</span>
      </label>
    </div>
  );
}
