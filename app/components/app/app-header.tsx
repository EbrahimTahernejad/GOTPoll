import { Settings2, Share2, Swords, Vote } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router';
import { CatalogPill } from '~/components/app/catalog-status';
import { TitleBarContent } from '~/components/app/title-bar';
import { ShareLinks, useShare } from '~/components/share/share-panel';
import { Button } from '~/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '~/components/ui/dialog';
import { cn } from '~/lib/utils';

/** Title bar of the main screens: name, Poll / Tournament switch, share, settings. */
export default function AppHeader() {
  const [title, setTitle] = useState('Anime Poll');
  useEffect(() => {
    window.GOTPoll.settings.get().then((s) => setTitle(s.pollTitle));
  }, []);
  return (
    <TitleBarContent>
      <div className="flex items-center gap-2 select-none">
        <div className="h-9 w-9 bg-[url(/icon.png)] bg-cover bg-center bg-no-repeat" />
        <div className="text-xl font-semibold">{title}</div>
      </div>
      <nav className="bg-foreground/5 pointer-events-auto ml-4 flex rounded-full p-0.5 [app-region:no-drag]">
        {[
          { to: '/', label: 'Poll', icon: Vote },
          { to: '/tournament', label: 'Tournament', icon: Swords },
        ].map(({ to, label, icon: Icon }) => (
          <NavLink
            key={to}
            to={to}
            end
            className={({ isActive }) =>
              cn(
                'flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors',
                isActive ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground'
              )
            }
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </NavLink>
        ))}
      </nav>
      <div className="grow" />
      <div className="mr-2 flex items-center gap-2">
        <CatalogPill />
        <ShareButton />
        <Button variant="ghost" size="icon" asChild className="pointer-events-auto [app-region:no-drag]">
          <Link to="/settings">
            <Settings2 className="h-4 w-4" />
          </Link>
        </Button>
      </div>
    </TitleBarContent>
  );
}

/** Title-bar "Share" button: viewer page links + the public link toggle. */
function ShareButton() {
  const info = useShare();
  const [open, setOpen] = useState(false);
  const online = info?.tunnel.state === 'online';
  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className="pointer-events-auto [app-region:no-drag]"
        onClick={() => setOpen(true)}
        title="Viewer page links"
      >
        <span className="relative">
          <Share2 className="h-4 w-4" />
          {online && <span className="absolute -top-0.5 -right-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />}
        </span>
        Share
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-xl">
          <DialogHeader>
            <DialogTitle>Share the viewer page</DialogTitle>
            <DialogDescription>The live ranking and final reveal – read-only, nothing else in the app.</DialogDescription>
          </DialogHeader>
          {info && <ShareLinks info={info} />}
        </DialogContent>
      </Dialog>
    </>
  );
}
