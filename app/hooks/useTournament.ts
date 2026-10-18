import { useEffect, useState } from 'react';

/** The open tournament (and the setup draft), pushed from the main process. */
export default function useTournament() {
  const [snap, setSnap] = useState<TournamentSnapshot | null>(null);
  useEffect(() => {
    let alive = true;
    window.GOTPoll.tournament.snapshot().then((s) => alive && setSnap(s));
    const off = window.GOTPoll.tournament.onUpdate(setSnap);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return snap;
}
