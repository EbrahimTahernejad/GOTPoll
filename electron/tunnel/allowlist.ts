// What the outside world may reach through a tunnel. Tunnels connect from
// localhost, so "is it local?" checks mean nothing for tunneled traffic –
// the tunnel therefore points at a separate server that only serves this.

const EXACT = new Set(['/', '/index.html', '/icon.png', '/favicon.ico', '/api/counts']);

/** Is `method url` part of the read-only viewer page? */
export function isPublicRequest(method: string, rawUrl: string, dev = false): boolean {
  if (method !== 'GET' && method !== 'HEAD') return false;
  let path: string;
  try {
    path = decodeURIComponent(new URL(rawUrl, 'http://x').pathname);
  } catch {
    return false;
  }
  if (path.includes('..') || path.includes('\\')) return false;
  if (EXACT.has(path)) return true;
  // hashed build assets
  if (/^\/assets\/[\w.-]+\.(js|css|woff2?|png|svg|jpg|webp)$/.test(path)) return true;
  // the Vite dev server's module graph (dev builds only)
  if (dev && /^\/(@vite|@id|@fs|@react-refresh|app|node_modules\/\.vite|electron\/electron\.d\.ts)\b/.test(path)) return true;
  return false;
}

/** WebSocket upgrades: only the live feed. */
export function isPublicUpgrade(rawUrl: string): boolean {
  try {
    return new URL(rawUrl, 'http://x').pathname === '/ws';
  } catch {
    return false;
  }
}
