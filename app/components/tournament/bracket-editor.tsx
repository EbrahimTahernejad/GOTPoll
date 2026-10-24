import { AnimatePresence, motion } from 'motion/react';
import { ArrowLeftRight, Ban, Coins, Crown, Eraser, Medal, MoreHorizontal, Play, Replace, RotateCcw, Shuffle, Tv, UserX, Wand2 } from 'lucide-react';
import { useState } from 'react';
import { Button } from '~/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '~/components/ui/dropdown-menu';
import { matchLabel, roundName } from '~/lib/tournament';
import { cn } from '~/lib/utils';
import { BreakdownChips } from './breakdown';
import ShowPicker from './show-picker';

/**
 * The bracket, editable. First-round slots can be replaced, swapped or made
 * a bye; every match can be played, replayed, settled by hand or cleared.
 * Later rounds fill themselves from the results.
 */
export default function BracketEditor({
  snap,
  library,
  channels,
  act,
}: {
  snap: TournamentSnapshot;
  library: Map<number, Show>;
  channels: PublicChannel[];
  act: (a: TournamentAction) => Promise<void>;
}) {
  const t = snap.tournament!;
  const [swapFrom, setSwapFrom] = useState<number | null>(null);
  const [replacing, setReplacing] = useState<number | null>(null);
  const liveBusy = !!t.live && t.live.stage !== 'result';
  const rounds = snap.rounds;

  const onSlotClick = (slot: number) => {
    if (swapFrom === null) return false;
    if (swapFrom !== slot) void act({ type: 'swap-slots', a: swapFrom, b: slot });
    setSwapFrom(null);
    return true;
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 border-b px-4 py-2">
        <h2 className="text-sm font-semibold">Bracket</h2>
        <span className="text-muted-foreground text-xs">
          {t.slots.filter((x) => x !== null).length} shows · {rounds.length} rounds
        </span>
        <AnimatePresence>
          {swapFrom !== null && (
            <motion.span
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="flex items-center gap-2 rounded-full bg-sky-500/15 px-2.5 py-0.5 text-xs text-sky-700 dark:text-sky-300"
            >
              <ArrowLeftRight className="h-3 w-3" /> Pick the slot to swap with
              <button className="underline" onClick={() => setSwapFrom(null)}>
                cancel
              </button>
            </motion.span>
          )}
        </AnimatePresence>
        <div className="grow" />
        <Button
          size="sm"
          variant="ghost"
          onClick={() => act({ type: 'third-place', on: !t.config.thirdPlace })}
          title="The semi-final losers play for third – before or after the final"
        >
          <Medal className="h-3.5 w-3.5" /> {t.config.thirdPlace ? 'Drop 3rd place' : 'Add 3rd place'}
        </Button>
        <Button size="sm" variant="ghost" disabled={liveBusy} onClick={() => act({ type: 'reseed' })} title="Order by open-round votes, returning shows on top">
          <Wand2 className="h-3.5 w-3.5" /> Reseed
        </Button>
        <Button size="sm" variant="ghost" disabled={liveBusy} onClick={() => act({ type: 'shuffle' })} title="Random draw">
          <Shuffle className="h-3.5 w-3.5" /> Shuffle
        </Button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto p-3">
        <div className="flex min-h-full gap-6">
          {rounds.map((row, r) => (
            <div key={r} className="flex max-w-72 min-w-52 flex-1 flex-col">
              <div className="text-muted-foreground mb-2 text-[11px] font-medium tracking-wide uppercase">
                {roundName(r, rounds.length)}
              </div>
              <div className="flex flex-1 flex-col justify-around gap-3">
                {[...row, ...(r === rounds.length - 1 && snap.third ? [snap.third] : [])].map((m) => (
                  <MatchCard
                    key={m.key}
                    m={m}
                    t={t}
                    roundsCount={rounds.length}
                    library={library}
                    channels={channels}
                    act={act}
                    liveBusy={liveBusy}
                    swapping={swapFrom !== null}
                    onSlot={(side) => {
                      const slot = 2 * m.index + side;
                      return onSlotClick(slot);
                    }}
                    onSlotMenu={(side, what) => {
                      const slot = 2 * m.index + side;
                      if (what === 'replace') setReplacing(slot);
                      if (what === 'swap') setSwapFrom(slot);
                      if (what === 'bye') void act({ type: 'set-slot', index: slot, showId: null });
                      if (what === 'disqualify') void act({ type: 'disqualify', index: slot });
                    }}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <ShowPicker
        open={replacing !== null}
        title="Put a show in this slot"
        description="Results that depended on this slot are cleared. Picking a show already in the bracket swaps the two."
        current={replacing !== null ? t.slots[replacing] : null}
        taken={t.slots.filter((x): x is number => x !== null)}
        onClose={() => setReplacing(null)}
        onPick={(show) => {
          if (replacing !== null) void act({ type: 'set-slot', index: replacing, showId: show.id });
          setReplacing(null);
        }}
      />
    </div>
  );
}

function MatchCard({
  m,
  t,
  roundsCount,
  library,
  channels,
  act,
  liveBusy,
  swapping,
  onSlot,
  onSlotMenu,
}: {
  m: BracketMatch;
  t: Tournament;
  roundsCount: number;
  library: Map<number, Show>;
  channels: PublicChannel[];
  act: (a: TournamentAction) => Promise<void>;
  liveBusy: boolean;
  swapping: boolean;
  onSlot: (side: 0 | 1) => boolean;
  onSlotMenu: (side: 0 | 1, what: 'replace' | 'swap' | 'bye' | 'disqualify') => void;
}) {
  const isLive = t.live?.key === m.key && t.live.stage !== 'result';
  const focused = t.focus === m.key;
  const editable = m.round === 0 && m.key !== '3p' && !liveBusy;
  const playable = m.status === 'ready' && !liveBusy;
  const replayable = (m.status === 'done' || m.status === 'tie') && !liveBusy;
  const pair = typeof m.a === 'number' && typeof m.b === 'number';

  return (
    <div
      className={cn(
        'bg-background/60 group relative rounded-lg border transition-shadow',
        isLive && 'border-rose-500/60 shadow-[0_0_0_3px] shadow-rose-500/15',
        !isLive && focused && 'border-foreground/40',
        m.status === 'tie' && 'border-amber-500/60'
      )}
    >
      <div className="flex items-center gap-1.5 px-2 pt-1.5 text-[10px]">
        <span className="text-muted-foreground font-medium">{matchLabel(m.key, roundsCount)}</span>
        <StatusChip status={m.status} manual={m.result?.manual} coin={m.result?.coin} />
        <div className="grow" />
        {pair && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="text-muted-foreground hover:text-foreground rounded p-0.5" title="Match options">
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              {playable && (
                <DropdownMenuItem onClick={() => act({ type: 'start-match', key: m.key })}>
                  <Play className="h-3.5 w-3.5" /> Start this match
                </DropdownMenuItem>
              )}
              {m.status === 'tie' && !isLive && (
                <DropdownMenuItem onClick={() => act({ type: 'coin-flip', key: m.key })}>
                  <Coins className="h-3.5 w-3.5" /> Flip a coin
                </DropdownMenuItem>
              )}
              {replayable && (
                <DropdownMenuItem onClick={() => act({ type: 'retry-match', key: m.key })}>
                  <RotateCcw className="h-3.5 w-3.5" /> Rematch
                </DropdownMenuItem>
              )}
              <DropdownMenuItem onClick={() => act({ type: 'show', screen: 'intro', focus: m.key })}>
                <Tv className="h-3.5 w-3.5" /> Show the VS screen
              </DropdownMenuItem>
              {m.result && (
                <DropdownMenuItem onClick={() => act({ type: 'show', screen: 'match', focus: m.key })}>
                  <Tv className="h-3.5 w-3.5" /> Show its result
                </DropdownMenuItem>
              )}
              {!isLive && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onClick={() => act({ type: 'set-winner', key: m.key, showId: m.a as number })}>
                    <Crown className="h-3.5 w-3.5" /> {library.get(m.a as number)?.titleRomaji ?? 'Top'} wins
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={() => act({ type: 'set-winner', key: m.key, showId: m.b as number })}>
                    <Crown className="h-3.5 w-3.5" /> {library.get(m.b as number)?.titleRomaji ?? 'Bottom'} wins
                  </DropdownMenuItem>
                </>
              )}
              {m.result && !isLive && (
                <DropdownMenuItem onClick={() => act({ type: 'clear-result', key: m.key })}>
                  <Eraser className="h-3.5 w-3.5" /> Clear the result
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      <div className="p-1">
        {([0, 1] as const).map((side) => (
          <SideRow
            key={side}
            id={side === 0 ? m.a : m.b}
            show={library.get((side === 0 ? m.a : m.b) as number)}
            votes={m.result?.votes[side]}
            breakdown={m.result?.breakdown[side]}
            channels={channels}
            winner={typeof m.winner === 'number' && m.winner === (side === 0 ? m.a : m.b)}
            loser={typeof m.winner === 'number' && m.winner !== (side === 0 ? m.a : m.b) && m.status === 'done'}
            bye={m.status === 'bye' && (side === 0 ? m.a : m.b) === null}
            editable={editable}
            swapping={swapping && editable}
            onClick={() => onSlot(side)}
            onMenu={(what) => onSlotMenu(side, what)}
          />
        ))}
      </div>
      {playable && (
        <button
          onClick={() => act({ type: 'start-match', key: m.key })}
          className="bg-foreground text-background absolute top-1/2 -right-3 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-full opacity-0 shadow-lg transition-opacity group-hover:opacity-100"
          title="Start this match"
        >
          <Play className="h-3 w-3 fill-current" />
        </button>
      )}
    </div>
  );
}

function SideRow({
  id,
  show,
  votes,
  breakdown,
  channels,
  winner,
  loser,
  bye,
  editable,
  swapping,
  onClick,
  onMenu,
}: {
  id: number | null | undefined;
  show: Show | undefined;
  votes?: number;
  breakdown?: Record<string, number>;
  channels: PublicChannel[];
  winner: boolean;
  loser: boolean;
  bye: boolean;
  editable: boolean;
  swapping: boolean;
  onClick: () => boolean;
  onMenu: (what: 'replace' | 'swap' | 'bye' | 'disqualify') => void;
}) {
  const body = (
    <div
      className={cn(
        'flex h-9 w-full items-center gap-2 rounded-md px-1.5 text-left',
        winner && 'bg-emerald-500/10',
        loser && 'opacity-45',
        swapping && 'ring-1 ring-sky-500/50 hover:bg-sky-500/10',
        editable && !swapping && 'hover:bg-accent'
      )}
    >
      {show?.coverImage ? (
        <img src={show.coverImage} alt="" className="h-7 w-5 shrink-0 rounded-sm object-cover" />
      ) : (
        <div className="bg-muted h-7 w-5 shrink-0 rounded-sm" />
      )}
      <span className={cn('min-w-0 flex-1 truncate text-xs', !show && 'text-muted-foreground italic', winner && 'font-semibold')}>
        {show ? show.titleRomaji : bye ? 'Bye' : id === null ? '—' : 'TBD'}
      </span>
      {winner && <Crown className="h-3 w-3 shrink-0 text-amber-500" />}
      {votes !== undefined && (
        <span className="group/votes relative text-xs font-bold tabular-nums">
          {votes}
          {breakdown && Object.keys(breakdown).length > 0 && (
            <span className="bg-popover pointer-events-none absolute right-0 bottom-full z-20 mb-1 hidden rounded-md border p-1.5 shadow-lg group-hover/votes:block">
              <BreakdownChips breakdown={breakdown} channels={channels} />
            </span>
          )}
        </span>
      )}
    </div>
  );
  if (!editable) return body;
  if (swapping) {
    return (
      <button type="button" className="block w-full" onClick={onClick}>
        {body}
      </button>
    );
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button type="button" className="block w-full">
          {body}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start">
        <DropdownMenuItem onClick={() => onMenu('replace')}>
          <Replace className="h-3.5 w-3.5" /> Replace…
        </DropdownMenuItem>
        <DropdownMenuItem onClick={() => onMenu('swap')}>
          <ArrowLeftRight className="h-3.5 w-3.5" /> Swap with…
        </DropdownMenuItem>
        {id !== null && (
          <DropdownMenuItem onClick={() => onMenu('bye')}>
            <UserX className="h-3.5 w-3.5" /> Make it a bye
          </DropdownMenuItem>
        )}
        {typeof id === 'number' && (
          <DropdownMenuItem onClick={() => onMenu('disqualify')}>
            <Ban className="h-3.5 w-3.5" /> Disqualify – next best comes in
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function StatusChip({ status, manual, coin }: { status: BracketStatus; manual?: boolean; coin?: boolean }) {
  const map: Partial<Record<BracketStatus, { label: string; cls: string }>> = {
    live: { label: 'LIVE', cls: 'bg-rose-500/15 text-rose-600 dark:text-rose-400' },
    ready: { label: 'Ready', cls: 'bg-foreground/5 text-muted-foreground' },
    tie: { label: 'Tie – pick a winner', cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-400' },
    done: { label: coin ? 'Coin flip' : manual ? 'Picked' : 'Done', cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400' },
    bye: { label: 'Bye', cls: 'bg-foreground/5 text-muted-foreground' },
  };
  const s = map[status];
  if (!s) return null;
  return <span className={cn('rounded-full px-1.5 py-px font-semibold', s.cls)}>{s.label}</span>;
}
