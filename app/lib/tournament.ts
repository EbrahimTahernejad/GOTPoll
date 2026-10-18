// Naming helpers shared by the tournament control page and the viewer page.

/** "Final", "Semi-finals", "Quarter-finals", "Round of 16" … */
export function roundName(round: number, rounds: number) {
  const fromEnd = rounds - 1 - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return 'Semi-finals';
  if (fromEnd === 2) return 'Quarter-finals';
  return `Round of ${2 ** (fromEnd + 1)}`;
}

/** Short tag for one match: "Final", "SF 2", "QF 3", "R16 · 5". */
export function matchLabel(key: string, rounds: number) {
  if (key === '3p') return 'Third place';
  const [round, index] = key.split('-').map(Number);
  const fromEnd = rounds - 1 - round;
  if (fromEnd === 0) return 'Final';
  if (fromEnd === 1) return `Semi-final ${index + 1}`;
  if (fromEnd === 2) return `Quarter-final ${index + 1}`;
  return `${roundName(round, rounds)} · ${index + 1}`;
}

const PLATFORM_NAME: Record<ChatPlatform, string> = { twitch: 'Twitch', youtube: 'YouTube', rumble: 'Rumble' };

/**
 * Votes per chat → rows to show, in a stable order. Keys are channel ids
 * (labelled by platform, plus the channel name when one platform has
 * several chats) or a bare platform name.
 */
export function breakdownRows(breakdown: Record<string, number> | undefined | null, channels: PublicChannel[]) {
  const rows: { key: string; platform: ChatPlatform; label: string; name: string | null; count: number }[] = [];
  for (const [key, count] of Object.entries(breakdown ?? {})) {
    const ch = channels.find((c) => c.id === key);
    const platform = ch?.platform ?? (key in PLATFORM_NAME ? (key as ChatPlatform) : null);
    if (!platform) continue;
    rows.push({ key, platform, label: PLATFORM_NAME[platform], name: ch?.name ?? null, count });
  }
  // merge chats that end up with the same label (an unnamed channel + the platform)
  const merged = new Map<string, (typeof rows)[number]>();
  for (const r of rows) {
    const id = `${r.platform}|${r.name ?? ''}`;
    const cur = merged.get(id);
    if (cur) cur.count += r.count;
    else merged.set(id, { ...r });
  }
  const order: ChatPlatform[] = ['twitch', 'youtube', 'rumble'];
  return [...merged.values()].sort(
    (a, b) => order.indexOf(a.platform) - order.indexOf(b.platform) || (a.name ?? '').localeCompare(b.name ?? '')
  );
}

export const PLATFORM_COLOR: Record<ChatPlatform, string> = { twitch: '#9146FF', youtube: '#FF0033', rumble: '#85C742' };

/** The app's own copy of the viewer page's chat labels (from the poll snapshot). */
export function channelsOf(sources: ChannelState[]): PublicChannel[] {
  const on = sources.filter((c) => c.enabled);
  return on.map((c) => ({
    id: c.id,
    platform: c.platform,
    name:
      on.filter((o) => o.platform === c.platform).length > 1
        ? c.label || c.target.replace(/^https?:\/\/(www\.)?(rumble\.com\/(c|user)\/)?(youtube\.com\/)?/, '')
        : null,
  }));
}
