export type Platform = 'twitch' | 'youtube' | 'rumble';

export type ChatMessage = {
  platform: Platform;
  userId: string;
  text: string;
};

export type Deliver = (m: ChatMessage) => void;

/** Browser-ish headers: YouTube and Rumble serve degraded pages to bots. */
export const BROWSER_HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
  'Accept-Language': 'en-US,en;q=0.9',
};

/** fetch with a per-request timeout that also honours the session's abort. */
export async function fetchWithin(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit & { timeoutMs?: number; signal: AbortSignal }
) {
  const { timeoutMs = 15_000, signal, ...rest } = init;
  return fetchImpl(url, { ...rest, signal: AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]) });
}
