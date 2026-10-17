import { app, BrowserWindow, session } from 'electron';

// rumble.com pages sit behind Cloudflare's browser check, which plain HTTP
// clients can't pass – but a real Chromium does, on its own, like any visitor.
// So channel pages are opened in a hidden window (cookies persist, so later
// checks are instant) and we just read the video links off the page.
// If Rumble ever asks for an interactive "are you human" click, the window is
// shown so the streamer can do it; we never try to get around it.

const PARTITION = 'persist:rumble';
const CHALLENGE_TITLE = /just a moment|attention required|verify/i;

let win: BrowserWindow | null = null;
let quitting = false;
app.on('before-quit', () => {
  quitting = true;
});
let busy: Promise<unknown> = Promise.resolve();

function getWindow() {
  if (win && !win.isDestroyed()) return win;
  // We only need the page's links: never pull video, images or fonts. A live
  // preview left streaming in a hidden window would eat the stream's upload.
  const ses = session.fromPartition(PARTITION);
  ses.webRequest.onBeforeRequest((details, cb) => {
    const heavy = ['image', 'media', 'font', 'object'].includes(details.resourceType);
    cb({ cancel: heavy || /\.(m3u8|mp4|ts|webm)(\?|$)/i.test(details.url) });
  });
  win = new BrowserWindow({
    show: false,
    width: 1100,
    height: 800,
    title: 'Rumble – quick check',
    autoHideMenuBar: true,
    webPreferences: { partition: PARTITION, sandbox: true, contextIsolation: true, backgroundThrottling: false },
  });
  win.webContents.setAudioMuted(true);
  win.on('close', (e) => {
    if (quitting) return;
    // closing the prompt just hides it; we reuse the window
    e.preventDefault();
    win?.hide();
  });
  return win;
}

/** Video links on a channel's livestreams page, in page order. */
export function findRumbleCandidates(channelPath: string, signal: AbortSignal): Promise<string[]> {
  // one page load at a time – the window is shared
  const run = busy.then(() => load(channelPath, signal));
  busy = run.catch(() => {});
  return run;
}

async function load(channelPath: string, signal: AbortSignal): Promise<string[]> {
  signal.throwIfAborted();
  const w = getWindow();
  // don't await the full load – ad-heavy pages may never "finish"; dom-ready
  // of the real page (not the challenge page) is what we wait for
  let domReadyAt = 0;
  const onDom = () => {
    if (!CHALLENGE_TITLE.test(w.webContents.getTitle())) domReadyAt ||= Date.now();
  };
  w.webContents.on('dom-ready', onDom);
  w.loadURL(`https://rumble.com${channelPath}/livestreams`).catch(() => {});
  const onAbort = () => w.webContents.stop();
  signal.addEventListener('abort', onAbort, { once: true });
  const startedAt = Date.now();
  let shown = false;
  try {
    for (;;) {
      signal.throwIfAborted();
      const title = w.webContents.getTitle();
      if (!CHALLENGE_TITLE.test(title)) {
        const links = (await Promise.race([
          w.webContents.executeJavaScript(
            `[...document.querySelectorAll('a[href]')].map(a => a.getAttribute('href')).filter(h => /^\\/v[a-z0-9]+-[^?#]*\\.html/i.test(h)).map(h => 'https://rumble.com' + h.split('?')[0])`
          ),
          new Promise<string[]>((r) => setTimeout(() => r([]), 3_000)),
        ])) as string[];
        onDom();
        // links render client-side: give the real page a few seconds after load
        if (links.length || (domReadyAt && Date.now() - domReadyAt > 10_000)) return [...new Set(links)];
      } else if (!shown && Date.now() - startedAt > 20_000) {
        // the automatic check didn't clear – let a human click it
        shown = true;
        w.center();
        w.show();
      }
      if (Date.now() - startedAt > 180_000) {
        throw new Error(domReadyAt ? "Rumble channel page didn't load" : 'Rumble check not completed');
      }
      await new Promise((r) => setTimeout(r, 1_000));
    }
  } finally {
    signal.removeEventListener('abort', onAbort);
    w.webContents.off('dom-ready', onDom);
    if (!w.isDestroyed()) {
      if (shown) w.hide();
      // unload the page so nothing keeps running/streaming in the background
      w.loadURL('about:blank').catch(() => {});
    }
  }
}
