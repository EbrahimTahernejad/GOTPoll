import { useEffect } from 'react';

// Room for the streamer's own overlay (camera, chat) on the right of the
// viewer page, per screen, as a share of the width. Set in the app (title
// bar → Layout) and pushed live; screens read it as --free-nav, --free-top,
// --free-rows, --free-final, … Phones skip it – the public link on a small
// screen has no overlay on top and no width to spare.

const NARROW = 900;
const KEYS: (keyof ViewerFreeSpace)[] = ['nav', 'top', 'rows', 'final', 'bracket', 'coin', 'versus', 'draw', 'other'];

export default function useFreeSpace(snap: PublicSnapshot | null) {
  const free = snap?.freeSpace;
  const key = free ? KEYS.map((k) => free[k]).join(',') : '';
  useEffect(() => {
    const apply = () => {
      const narrow = window.innerWidth < NARROW;
      const root = document.documentElement.style;
      for (const k of KEYS) root.setProperty(`--free-${k}`, `${narrow || !free ? 0 : free[k]}vw`);
      // the board's top row as a plain number, for scaling its cards to the room left
      root.setProperty('--free-top-n', String(narrow || !free ? 0 : free.top / 100));
    };
    apply();
    window.addEventListener('resize', apply);
    return () => window.removeEventListener('resize', apply);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
}

/** The variable a tournament screen keeps clear of (the open round's board handles its own rows). */
export function freeVarOf(screen: PublicTournament['screen']): string | null {
  switch (screen) {
    case 'open':
      return null;
    case 'bracket':
      return '--free-bracket';
    case 'coin':
      return '--free-coin';
    case 'draw':
      return '--free-draw';
    case 'intro':
    case 'match':
      return '--free-versus';
    case 'champion':
      return '--free-final';
    default:
      return '--free-other';
  }
}
