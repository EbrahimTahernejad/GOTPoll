import { useEffect, useState } from 'react';

const EMPTY: PollSnapshot = {
  version: 0,
  state: 'idle',
  startedAt: null,
  endedAt: null,
  formats: [],
  messages: 0,
  totalVoters: 0,
  totalVotes: 0,
  ranking: [],
  unmatched: [],
  sources: [],
  catalogPending: false,
};

/** Live poll state in the Electron app – pushed from the main process. */
export default function usePoll() {
  const [snap, setSnap] = useState<PollSnapshot>(EMPTY);
  useEffect(() => {
    let alive = true;
    window.GOTPoll.poll.snapshot().then((s) => alive && setSnap(s));
    const off = window.GOTPoll.poll.onUpdate(setSnap);
    return () => {
      alive = false;
      off();
    };
  }, []);
  return snap;
}
