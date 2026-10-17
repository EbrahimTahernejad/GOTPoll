import { useEffect, useState } from 'react';

/**
 * Viewer page feed: a websocket that receives a full PublicSnapshot on every
 * change. Reconnects with backoff, so OBS sources survive app restarts.
 */
export default function useLiveRanking() {
  const [snap, setSnap] = useState<PublicSnapshot | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    let ws: WebSocket | null = null;
    let retry: ReturnType<typeof setTimeout> | null = null;
    let attempt = 0;
    let closed = false;

    // first paint shouldn't wait for the socket
    fetch('/api/counts')
      .then((r) => r.json())
      .then((s: PublicSnapshot) => setSnap((cur) => cur ?? s))
      .catch(() => {});

    // compressed binary feed when the browser can inflate it (survives tunnels)
    const canInflate = typeof DecompressionStream !== 'undefined';
    let order: Promise<void> = Promise.resolve();
    const decode = async (data: unknown): Promise<string> => {
      if (typeof data === 'string') return data;
      const stream = new Blob([data as ArrayBuffer]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      return new Response(stream).text();
    };

    const connect = () => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      ws = new WebSocket(`${proto}://${location.host}/ws${canInflate ? '?z=1' : ''}`);
      ws.binaryType = 'arraybuffer';
      ws.onopen = () => {
        attempt = 0;
        setConnected(true);
      };
      ws.onmessage = (e) => {
        // inflating is async – chain it so snapshots apply in arrival order
        order = order.then(async () => {
          try {
            const msg = JSON.parse(await decode(e.data));
            if (msg.type === 'snapshot') setSnap(msg.data as PublicSnapshot);
          } catch {
            // ignore malformed frames
          }
        });
      };
      ws.onclose = () => {
        setConnected(false);
        if (closed) return;
        const delay = Math.min(10_000, 500 * 2 ** attempt++);
        retry = setTimeout(connect, delay);
      };
    };
    connect();

    return () => {
      closed = true;
      if (retry) clearTimeout(retry);
      ws?.close();
    };
  }, []);

  return { snap, connected };
}
