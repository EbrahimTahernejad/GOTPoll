import { Droplet, Square } from 'lucide-react';
import { useEffect, useState } from 'react';
import { cn } from '~/lib/utils';

/** Apply the glass setting to the page (window background + dialogs). */
export function applyGlassClass(on: boolean) {
  document.documentElement.classList.toggle('no-glass', !on);
}

/** Glass ↔ solid, styled like the theme switcher next to it. */
export default function GlassSwitcher({ className }: { className?: string }) {
  const [glass, setGlass] = useState(true);
  useEffect(() => {
    window.GOTPoll.settings.get().then((s) => {
      setGlass(s.glass);
      applyGlassClass(s.glass);
    });
  }, []);

  const choose = (on: boolean) => {
    setGlass(on);
    applyGlassClass(on); // instant; the window effect follows from main
    void window.GOTPoll.setGlass(on);
  };

  return (
    <div
      className={cn('border-foreground/20 relative isolate flex h-6 w-[2.9rem] flex-row rounded-full border', className)}
      title={glass ? 'Glass: translucent window and dialogs' : 'Solid: no transparency'}
    >
      <div
        className={cn(
          'border-foreground/20 absolute -top-px z-10 h-6 w-6 cursor-pointer rounded-full border transition-all',
          glass ? '-start-px' : 'start-[calc(1.3rem-1px)]'
        )}
      />
      <button className="relative z-20 h-full flex-1 cursor-pointer" onClick={() => choose(true)} aria-label="Glass">
        <Droplet className="absolute top-1/2 left-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2" />
      </button>
      <button className="relative z-20 h-full flex-1 cursor-pointer" onClick={() => choose(false)} aria-label="Solid">
        <Square className="absolute top-1/2 left-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2" />
      </button>
    </div>
  );
}
