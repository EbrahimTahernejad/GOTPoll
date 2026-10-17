import { createContext, use, useEffect, useMemo, useState } from 'react';
import ThemeSwitcher from './theme-switcher';

type TitleBarContentContextType = {
  title: React.ReactNode;
  setTitle: (title: React.ReactNode | null) => void;
};

const TitleBarContentContext = createContext<TitleBarContentContextType>(
  null as unknown as TitleBarContentContextType
);

function useTitleBarContent() {
  const context = use(TitleBarContentContext);
  if (!context) {
    throw new Error(
      'useTitleBarContent must be used within a TitleBarContentProvider'
    );
  }
  return context;
}

export default function TitleBar() {
  const [opacity, setOpacity] = useState(0);
  const { title } = useTitleBarContent();
  const [isElectron, setIsElectron] = useState(false);

  const isWindowControlInEnd = useMemo(() => {
    // check if the window control is in the end or start
    // use useragent to check for the OS
    if (navigator.userAgent.includes('Mac OS X')) {
      return false;
    }
    return true;
  }, []);

  useEffect(() => {
    const handleResizeScroll = () => {
      const maxScrollHeight = 8;
      const scrollHeight = window.scrollY;
      const opacity = Math.max(Math.min(scrollHeight / maxScrollHeight, 1), 0);
      setOpacity(opacity);
    };

    window.addEventListener('resize', handleResizeScroll);
    window.addEventListener('scroll', handleResizeScroll);

    setIsElectron(window.navigator.userAgent.includes('Electron'));

    return () => {
      window.removeEventListener('resize', handleResizeScroll);
      window.removeEventListener('scroll', handleResizeScroll);
    };
  }, []);

  return (
    // make electron draggable
    <div className="pointer-events-none fixed inset-x-0 top-0 isolate z-50 h-14 [app-region:drag]">
      <div
        className="border-foreground/15 bg-secondary/60 absolute inset-0 z-50 border-b backdrop-blur"
        style={{ opacity }}
      />
      <div className="relative isolate z-50 flex h-full w-full flex-row items-center gap-2 px-3">
        {!isWindowControlInEnd && isElectron && (
          <div className="w-14 shrink-0" />
        )}
        <div className="flex grow flex-row items-center">{title}</div>
        <ThemeSwitcher className="pointer-events-auto shrink-0 [app-region:no-drag]" />
        {isWindowControlInEnd && isElectron && (
          <div className="w-32 shrink-0" />
        )}
      </div>
    </div>
  );
}

export function TitleBarBackground() {
  const [opacity, setOpacity] = useState(0);

  useEffect(() => {
    const handleResizeScroll = () => {
      const maxScrollHeight = 8;
      const scrollHeight = window.scrollY;
      const opacity = Math.max(Math.min(scrollHeight / maxScrollHeight, 1), 0);
      setOpacity(opacity);
    };

    window.addEventListener('resize', handleResizeScroll);
    window.addEventListener('scroll', handleResizeScroll);

    return () => {
      window.removeEventListener('resize', handleResizeScroll);
      window.removeEventListener('scroll', handleResizeScroll);
    };
  }, []);

  return (
    <div
      className="bg-secondary pointer-events-none fixed inset-x-0 top-0 isolate z-0 h-14"
      style={{ opacity }}
    />
  );
}

export function TitleBarSpacer() {
  return <div className="h-14 shrink-0" />;
}

export function TitleBarContentProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [title, setTitle] = useState<React.ReactNode | null>(null);

  return (
    <TitleBarContentContext value={{ title, setTitle }}>
      {children}
    </TitleBarContentContext>
  );
}

export function TitleBarContent({ children }: { children: React.ReactNode }) {
  const { setTitle } = useTitleBarContent();

  useEffect(() => {
    setTitle(children);
    return () => {
      setTitle(null);
    };
  }, [children]);

  return null;
}
