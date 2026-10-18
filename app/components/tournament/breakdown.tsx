import { PlatformIcon } from '~/components/channels/platforms';
import { breakdownRows, PLATFORM_COLOR } from '~/lib/tournament';

/** Votes per chat as small platform chips (the channel name only when it tells chats apart). */
export function BreakdownChips({ breakdown, channels }: { breakdown: Record<string, number> | undefined; channels: PublicChannel[] }) {
  const rows = breakdownRows(breakdown, channels);
  if (!rows.length) return null;
  return (
    <span className="flex flex-wrap items-center gap-1">
      {rows.map((r) => (
        <span key={r.key} className="bg-background/70 flex items-center gap-1 rounded-full border py-px pr-1.5 pl-0.5 text-[10px] whitespace-nowrap tabular-nums">
          <span className="grid h-3.5 w-3.5 place-items-center rounded-full text-white" style={{ background: PLATFORM_COLOR[r.platform] }}>
            <PlatformIcon platform={r.platform} className="h-2 w-2" />
          </span>
          {r.name && <span className="text-muted-foreground max-w-20 truncate">{r.name}</span>}
          <b>{r.count}</b>
        </span>
      ))}
    </span>
  );
}
