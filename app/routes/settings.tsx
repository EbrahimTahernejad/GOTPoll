import { AnimatePresence, motion } from 'motion/react';
import { ChevronLeft, Database, FlaskConical, ListChecks, MessagesSquare, Sparkles, Trash2, Vote } from 'lucide-react';
import AiSection from '~/components/settings/ai-section';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router';
import { CatalogCard, relativeTime } from '~/components/app/catalog-status';
import { TitleBarContent } from '~/components/app/title-bar';
import ChannelsSection from '~/components/channels/channels-section';
import ShowsGrid from '~/components/settings/shows-grid';
import { Badge } from '~/components/ui/badge';
import { Button } from '~/components/ui/button';
import { Input } from '~/components/ui/input';
import { Label } from '~/components/ui/label';
import { Switch } from '~/components/ui/switch';
import usePoll from '~/hooks/usePoll';
import { cn } from '~/lib/utils';

const SECTIONS = [
  { id: 'channels', label: 'Channels', icon: MessagesSquare, hint: 'Twitch · YouTube · Rumble' },
  { id: 'matching', label: 'Matching', icon: FlaskConical, hint: 'Test messages, taught phrases' },
  { id: 'ai', label: 'Local AI', icon: Sparkles, hint: 'Strategy, models, GPU' },
  { id: 'voting', label: 'Voting rules', icon: Vote, hint: 'Who counts, how often' },
  { id: 'catalog', label: 'Catalog', icon: Database, hint: 'AniList show list' },
  { id: 'shows', label: 'Shows', icon: ListChecks, hint: 'Hide shows from polls' },
] as const;
type SectionId = (typeof SECTIONS)[number]['id'];

export default function SettingsPage() {
  const navigate = useNavigate();
  const poll = usePoll();
  const [section, setSection] = useState<SectionId>(() => {
    try {
      return (localStorage.getItem('settings-section') as SectionId) || 'channels';
    } catch {
      return 'channels';
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem('settings-section', section);
    } catch {
      // ignore
    }
  }, [section]);

  const liveChannels = poll.sources.filter((s) => s.status.state === 'live').length;

  return (
    <div className="flex h-[calc(100vh-56px)] w-full gap-4">
      <TitleBarContent>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="icon"
            onClick={() => navigate('/')}
            className="pointer-events-auto cursor-pointer [app-region:no-drag]"
          >
            <ChevronLeft className="!h-5 !w-5" />
          </Button>
          <h1 className="text-xl font-semibold">Settings</h1>
        </div>
      </TitleBarContent>

      {/* sidebar */}
      <nav className="flex w-56 shrink-0 flex-col gap-1 pb-3 pl-3">
        {SECTIONS.map((s) => {
          const active = section === s.id;
          const Icon = s.icon;
          return (
            <button
              key={s.id}
              onClick={() => setSection(s.id)}
              className={cn(
                'relative flex items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors',
                active ? 'text-foreground' : 'text-muted-foreground hover:text-foreground hover:bg-accent/40'
              )}
            >
              {active && (
                <motion.span
                  layoutId="settings-nav"
                  className="bg-card absolute inset-0 rounded-lg border shadow-sm"
                  transition={{ type: 'spring', stiffness: 500, damping: 40 }}
                />
              )}
              <Icon className="relative h-4 w-4 shrink-0" />
              <span className="relative min-w-0 flex-1">
                <span className="block text-sm font-medium">{s.label}</span>
                <span className="text-muted-foreground block truncate text-[11px]">{s.hint}</span>
              </span>
              {s.id === 'channels' && poll.state === 'running' && (
                <span className="relative rounded-full bg-emerald-500/15 px-1.5 text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
                  {liveChannels} live
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* content */}
      {/* padding lives inside the scroller so content scrolls edge to edge */}
      <main className="min-h-0 min-w-0 flex-1 overflow-y-auto">
        <AnimatePresence mode="wait">
          <motion.div
            key={section}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.15 }}
            className={cn('pt-1 pr-3 pb-6', section === 'shows' && 'flex h-full flex-col pb-3')}
          >
            {section === 'channels' && <ChannelsSection poll={poll} />}
            {section === 'matching' && <MatchingTab />}
            {section === 'ai' && (
              <div className="max-w-5xl space-y-4">
                <SectionTitle title="Local AI" text="Optional smarter matching with free models that run on your machine." />
                <AiSection />
              </div>
            )}
            {section === 'voting' && <VotingSection running={poll.state === 'running'} />}
            {section === 'catalog' && (
              <div className="max-w-3xl space-y-4">
                <SectionTitle title="Show catalog" text="Every anime chat can vote for, from AniList." />
                <CatalogCard pollRunning={poll.state === 'running'} />
              </div>
            )}
            {section === 'shows' && (
              <div className="flex min-h-0 flex-1 flex-col gap-4">
                <SectionTitle title="Shows" text="Tick “Ignored” to keep a show out of every poll." />
                <ShowsGrid />
              </div>
            )}
          </motion.div>
        </AnimatePresence>
      </main>
    </div>
  );
}

function SectionTitle({ title, text }: { title: string; text: string }) {
  return (
    <div>
      <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
      <p className="text-muted-foreground text-sm">{text}</p>
    </div>
  );
}

// ------------------------------------------------------------------ voting

function VotingSection({ running }: { running: boolean }) {
  const [settings, setSettings] = useState<Settings | null>(null);
  useEffect(() => {
    window.GOTPoll.settings.get().then(setSettings);
  }, []);
  if (!settings) return null;
  const set = async (patch: Partial<Settings>) => setSettings(await window.GOTPoll.settings.set(patch));
  return (
    <div className="max-w-2xl space-y-4">
      <SectionTitle title="Voting rules" text={running ? 'Changes apply to the next poll.' : 'How votes are counted.'} />
      <div className="bg-card/60 divide-y rounded-xl border">
        <label className="flex cursor-pointer items-center justify-between gap-6 p-4">
          <div>
            <div className="font-medium">One vote per viewer</div>
            <p className="text-muted-foreground text-sm">
              Off: a viewer can vote for several shows (each counts once). On: only their latest vote counts.
            </p>
          </div>
          <Switch checked={settings.onePerViewer} onCheckedChange={(v) => set({ onePerViewer: v })} />
        </label>
        <label className="flex items-center justify-between gap-6 p-4">
          <div>
            <div className="font-medium">Poll title</div>
            <p className="text-muted-foreground text-sm">Shown in the app and on the viewer page.</p>
          </div>
          <Input
            className="max-w-64"
            defaultValue={settings.pollTitle}
            onBlur={(e) => e.target.value.trim() && set({ pollTitle: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
          />
        </label>
        <div className="text-muted-foreground p-4 text-sm">
          The same person typing the same show twice always counts once – across rephrasings and reconnects.
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ matching

function MatchingTab() {
  const [message, setMessage] = useState('');
  const [probe, setProbe] = useState<MatchProbe | null>(null);
  const [aliases, setAliases] = useState<LearnedAlias[]>([]);
  const [shows, setShows] = useState<Map<number, Show>>(new Map());

  useEffect(() => {
    window.GOTPoll.aliases.list().then(setAliases);
    window.GOTPoll.catalog.shows().then((s) => setShows(new Map(s.map((x) => [x.id, x]))));
  }, []);

  useEffect(() => {
    if (!message.trim()) {
      setProbe(null);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      window.GOTPoll.catalog.probe(message).then((p) => alive && setProbe(p));
    }, 100);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [message]);

  const winner = probe?.result ? shows.get(probe.result.showId) : null;

  return (
    <div className="grid max-w-5xl grid-cols-[1.2fr_1fr] gap-3">
      <div className="col-span-full">
        <SectionTitle title="Matching" text="Try messages and manage phrases you’ve taught." />
      </div>
      <section className="bg-card/60 rounded-xl border p-4">
        <div className="mb-3 flex items-center gap-2">
          <FlaskConical className="h-4 w-4 opacity-70" />
          <h3 className="font-semibold">Try the matcher</h3>
        </div>
        <Input
          autoFocus
          placeholder="Type a chat message, e.g. “!vote frieran s2 🔥”"
          value={message}
          onChange={(e) => setMessage(e.target.value)}
        />
        {probe && (
          <div className="mt-3 space-y-3 text-sm">
            <div className="text-muted-foreground text-xs">
              cleaned → <code className="bg-muted rounded px-1">{probe.cleaned ?? '(not a vote)'}</code>
            </div>
            <div
              className={cn(
                'rounded-lg border p-3',
                winner ? 'border-emerald-500/40 bg-emerald-500/10' : 'border-amber-500/40 bg-amber-500/10'
              )}
            >
              {winner && probe.result ? (
                <div className="flex items-center gap-3">
                  {winner.coverImage && <img src={winner.coverImage} className="h-12 w-9 rounded object-cover" alt="" />}
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-medium">{winner.titleRomaji}</div>
                    <div className="text-muted-foreground truncate text-xs">{winner.titleEnglish}</div>
                  </div>
                  <Badge variant="secondary">{probe.result.stage}</Badge>
                  <span className="text-xs tabular-nums">{Math.round(probe.result.score * 100)}%</span>
                </div>
              ) : (
                <span>No confident match – this would land in “Unmatched chat”.</span>
              )}
            </div>
            {probe.aiResult !== undefined && (
              <div className="bg-foreground/5 flex items-center gap-2 rounded-lg px-3 py-2 text-xs">
                <Sparkles className="h-3.5 w-3.5" />
                <span className="text-muted-foreground">{probe.strategy}:</span>
                <span className="min-w-0 flex-1 truncate font-medium">
                  {probe.aiResult ? (shows.get(probe.aiResult.showId)?.titleRomaji ?? `#${probe.aiResult.showId}`) : 'no match'}
                </span>
                {probe.aiMs !== undefined && <span className="text-muted-foreground tabular-nums">{probe.aiMs.toFixed(0)} ms</span>}
              </div>
            )}
            <div>
              <div className="text-muted-foreground mb-1 text-xs">Candidates</div>
              <ul className="space-y-1">
                {probe.candidates.map((c) => (
                  <li key={c.show.id} className="flex items-center gap-2 text-xs">
                    <span className="min-w-0 flex-1 truncate">{c.show.titleRomaji}</span>
                    <div className="bg-foreground/10 h-1.5 w-24 overflow-hidden rounded-full">
                      <div className="bg-primary h-full" style={{ width: `${c.score * 100}%` }} />
                    </div>
                    <span className="w-8 text-right tabular-nums">{Math.round(c.score * 100)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
        <p className="text-muted-foreground mt-4 text-xs leading-relaxed">
          Messages are cleaned (emoji, “!vote”, “season 2”, romaji spellings like ō/ou), then matched exactly against
          titles, synonyms and sequel names, then by a distinctive single word, then fuzzily (character-trigram TF-IDF
          + Jaro-Winkler). Anything uncertain is left for you instead of guessed.
        </p>
      </section>

      <section className="bg-card/60 rounded-xl border p-4">
        <h3 className="font-semibold">Taught phrases</h3>
        <p className="text-muted-foreground mb-3 text-xs">
          Every “Count as…” you do in a poll is remembered here and wins over the matcher.
        </p>
        <ul className="space-y-1">
          {aliases.map((a) => (
            <li key={a.phrase} className="group hover:bg-accent/50 flex items-center gap-2 rounded-md px-2 py-1 text-sm">
              <code className="bg-muted rounded px-1 text-xs">{a.phrase}</code>
              <span className="text-muted-foreground">→</span>
              <span className="min-w-0 flex-1 truncate">{shows.get(a.showId)?.titleRomaji ?? `#${a.showId}`}</span>
              <span className="text-muted-foreground text-[10px]">{relativeTime(a.createdAt)}</span>
              <Button
                size="icon"
                variant="ghost"
                className="h-6 w-6 opacity-0 group-hover:opacity-100"
                onClick={async () => {
                  await window.GOTPoll.aliases.remove(a.phrase);
                  setAliases((list) => list.filter((x) => x.phrase !== a.phrase));
                }}
              >
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </li>
          ))}
          {aliases.length === 0 && <li className="text-muted-foreground py-6 text-center text-xs">Nothing taught yet</li>}
        </ul>
      </section>
    </div>
  );
}

