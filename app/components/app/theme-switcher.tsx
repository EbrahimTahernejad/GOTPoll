import { cn } from '~/lib/utils';
import { useTheme } from '~/providers/theme';
import { MonitorCog, Moon, Sun } from 'lucide-react';

export default function ThemeSwitcher({
  className,
  inline,
}: {
  className?: string;
  inline?: boolean;
}) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      className={cn(
        'border-foreground/20 relative isolate flex h-6 w-[4.3rem] flex-row rounded-full border',
        inline ? 'inline-flex' : '',
        className
      )}
    >
      <div
        className={cn(
          'border-foreground/20 absolute -top-px z-10 h-6 w-6 cursor-pointer rounded-full border transition-all',
          theme == 'system'
            ? '-start-px'
            : theme == 'light'
              ? 'start-[1.3rem]'
              : 'start-[calc(2.6rem+2px)]'
        )}
      ></div>
      <button
        className="relative z-20 h-full flex-1 cursor-pointer"
        onClick={() => setTheme('system')}
      >
        <MonitorCog className="absolute top-1/2 left-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2" />
      </button>
      <button
        className="relative z-20 h-full flex-1 cursor-pointer"
        onClick={() => setTheme('light')}
      >
        <Sun className="absolute top-1/2 left-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2" />
      </button>
      <button
        className="relative z-20 h-full flex-1 cursor-pointer"
        onClick={() => setTheme('dark')}
      >
        <Moon className="absolute top-1/2 left-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2" />
      </button>
    </div>
  );
}
