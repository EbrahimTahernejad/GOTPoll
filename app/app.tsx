import { AllCommunityModule, ModuleRegistry } from 'ag-grid-community';
import { Outlet } from 'react-router';
import TitleBar, { TitleBarSpacer } from './components/app/title-bar';
import { TitleBarBackground } from './components/app/title-bar';
import Providers from './providers';
import { useEffect, useState } from 'react';
import Public from './routes/public';

ModuleRegistry.registerModules([AllCommunityModule]);

export default function App() {
  // null until we know where we run: the Electron UI must never mount in a
  // browser (window.GOTPoll doesn't exist there).
  const [isElectron, setIsElectron] = useState<boolean | null>(null);

  useEffect(() => {
    // the control UI needs the preload bridge – OBS, browsers and any other
    // Chromium shell without it get the viewer page
    const electron = typeof window.GOTPoll !== 'undefined';
    if (!electron) document.documentElement.classList.add('not-electron');
    setIsElectron(electron);
  }, []);

  if (isElectron === null) return null;
  // Opened in a browser / OBS: the viewer page owns the whole screen.
  if (!isElectron) return <Public />;

  return (
    <Providers>
      <TitleBarBackground />
      <div className="relative isolate z-10 flex min-h-screen w-full flex-col">
        <TitleBarSpacer />
        <Outlet />
      </div>
      <TitleBar />
    </Providers>
  );
}
