import { EventEmitter } from 'node:events';
import { Matcher } from '../matching/matcher.js';
import { cleanMessage } from '../matching/normalize.js';
import type { CatalogStore } from '../catalog/store.js';
import type { UserStore } from '../user-store.js';
import { sessionFor, type SourceDeps } from './sources/factory.js';
import type { ChatMessage } from './sources/types.js';
import { Supervisor } from './supervisor.js';
import { cleanFilters, cleanShortlist, optionNumber } from './filters.js';
import { PRECISE_FUZZY, type Strategy } from '../matching/strategies.js';

// Votes are tracked per *phrase* (a cleaned chat message), not per show:
//
//   phrase "frieren"      -> show 154587, voters {tw:1, yt:abc, ...}
//   phrase "sousou frien" -> show 154587, voters {...}
//   phrase "lol"          -> null (unmatched), voters {...}
//
// Show totals are the union of voters over the phrases mapped to it. Because
// raw phrases are kept, the streamer can fix the matcher mid-poll ("this
// phrase means that show" / "this isn't a vote") and every past vote is
// recounted instantly – nothing is lost to a bad guess.

type Bucket = {
  sample: string;
  voters: Set<string>;
  showId: number | null;
  stage: MatchStage | null;
  score: number | null;
  lastAt: number;
};

const MAX_UNMATCHED = 3000;
const EMIT_EVERY_MS = 200;

export class PollEngine extends EventEmitter<{ update: [PollSnapshot] }> {
  private state: PollState = 'idle';
  private startedAt: number | null = null;
  private endedAt: number | null = null;
  private filters: PollFilters = { formats: ['TV', 'TV_SHORT', 'MOVIE'], release: ['released', 'airing', 'upcoming'] };
  private mode: PollMode = 'open';
  private shortlist: number[] = [];
  /** shortlist polls: a forgiving matcher that only knows the options */
  private optionMatcher: Matcher | null = null;
  private releaseKnown = true;
  private messages = 0;
  private version = 0;

  private shows = new Map<number, Show>();
  private matcher: Matcher | null = null;
  private ignored = new Set<number>();
  private dismissed = new Set<string>();
  private buckets = new Map<string, Bucket>();
  private votes = new Map<number, Set<string>>();
  /** onePerViewer: voter -> phrase they currently vote with */
  private lastPhrase = new Map<string, string>();
  private onePerViewer = false;
  private catalogVersionAtStart = '';
  private strategy: Strategy | null = null;
  private pendingAi = 0;

  /** running connection per channel id, with the config it was started from */
  private supervisors = new Map<string, { sup: Supervisor; key: string }>();
  private status = new Map<string, SourceStatus>();
  private emitTimer: NodeJS.Timeout | null = null;

  constructor(
    private catalog: CatalogStore,
    private user: UserStore,
    /** main process passes the hidden-browser channel lookup */
    private deps: SourceDeps & {
      /** build the configured AI strategy for this poll (null = classic only) */
      makeStrategy?: (matcher: Matcher) => Strategy | null;
    } = {}
  ) {
    super();
    catalog.on('changed', () => this.schedule());
  }

  // ------------------------------------------------------------ lifecycle

  async start(config: Partial<PollConfig>, opts: { sources?: boolean } = {}) {
    if (this.state === 'running') return;
    this.resetData();
    this.filters = cleanFilters(config.filters ?? this.filters);
    this.shortlist = cleanShortlist(config.shortlist ?? []);
    // a shortlist poll needs options; without them it's an open poll
    this.mode = config.mode === 'shortlist' && this.shortlist.length ? 'shortlist' : 'open';
    this.user.setSettings({ pollFilters: this.filters, pollMode: config.mode ?? 'open', pollShortlist: this.shortlist });
    const settings = this.user.settings();
    this.onePerViewer = settings.onePerViewer;
    this.ignored = this.user.ignores();
    this.dismissed = this.user.dismissed();

    // Snapshot the catalog: an update finishing mid-poll can't move the
    // ground under a running count. It applies to the next poll.
    // Match against EVERY votable show and let the filters decide what
    // counts: a vote for a filtered-out show must not drift onto a
    // look-alike that happens to pass the filters.
    const pool = [...this.catalog.all(), ...this.user.customShows()].filter((s) => s.eligible);
    this.releaseKnown = this.catalog.info().hasRelease;
    this.shows = new Map(pool.map((s) => [s.id, s]));
    this.catalogVersionAtStart = this.catalog.info().file;
    this.matcher = new Matcher({
      shows: pool,
      sequels: this.catalog.sequelAliases().filter((s) => this.shows.has(s.rootId)),
      learned: this.user.aliases().filter((a) => this.shows.has(a.showId)).map((a) => ({ alias: a.phrase, showId: a.showId })),
    });

    this.optionMatcher = null;
    if (this.mode === 'shortlist') {
      const options = this.shortlist.flatMap((id) => this.shows.get(id) ?? []);
      this.shortlist = options.map((s) => s.id); // drop ids no longer in the catalog
      const ids = new Set(this.shortlist);
      // with only a few candidates a looser threshold is safe: "frieren s2",
      // "chainsaw" or a typo should land on the option it obviously means
      this.optionMatcher = new Matcher({
        shows: options,
        sequels: this.catalog.sequelAliases().filter((s) => ids.has(s.rootId)),
        threshold: 0.6,
        margin: 0.02,
      });
    }

    this.strategy = this.deps.makeStrategy?.(this.matcher) ?? null;
    this.pendingAi = 0;
    this.state = 'running';
    this.startedAt = Date.now();
    this.endedAt = null;

    if (opts.sources !== false) this.applyChannels();
    this.schedule(true);
  }

  stop() {
    if (this.state !== 'running') return;
    const sups = [...this.supervisors.values()];
    this.supervisors.clear();
    this.status.clear();
    sups.forEach(({ sup }) => void sup.stop());
    this.state = 'ended';
    this.endedAt = Date.now();
    this.schedule(true);
  }

  /** The computer woke up / network came back: reconnect everything now. */
  kickSources(reason?: string) {
    this.supervisors.forEach(({ sup }) => sup.kick(reason));
  }

  /**
   * Bring connections in line with the saved channel list. Safe to call any
   * time: while a poll runs, adding/enabling a channel connects it right away,
   * disabling/removing disconnects it, and untouched ones keep running.
   */
  applyChannels() {
    if (this.state !== 'running') {
      this.schedule();
      return;
    }
    const wanted = this.user.settings().channels.filter((c) => c.enabled);
    const keyOf = (c: ChannelConfig) => `${c.platform}|${c.target}`;
    for (const [id, { sup, key }] of this.supervisors) {
      const c = wanted.find((w) => w.id === id);
      if (!c || keyOf(c) !== key) {
        this.supervisors.delete(id);
        this.status.delete(id);
        void sup.stop();
      }
    }
    const deliver = (m: ChatMessage) => this.ingest(m);
    const since = () => this.startedAt ?? 0;
    for (const c of wanted) {
      if (this.supervisors.has(c.id)) continue;
      const { session, tuning } = sessionFor(c, deliver, since, this.deps);
      const sup: Supervisor = new Supervisor({
        name: c.id,
        session,
        ...tuning,
        onStatus: (s) => {
          // ignore late reports from a connection we already dropped
          if (this.supervisors.get(c.id)?.sup !== sup) return;
          this.status.set(c.id, s);
          this.schedule();
        },
      });
      this.supervisors.set(c.id, { sup, key: keyOf(c) });
      sup.start();
    }
    this.schedule();
  }

  reset() {
    this.stop();
    this.resetData();
    this.state = 'idle';
    this.startedAt = this.endedAt = null;
    this.schedule(true);
  }

  private resetData() {
    this.buckets.clear();
    this.votes.clear();
    this.lastPhrase.clear();
    this.messages = 0;
  }

  // ------------------------------------------------------------ votes

  /** Feed one chat message. Public so tests / simulators can drive it. */
  ingest(m: ChatMessage) {
    if (this.state !== 'running' || !this.matcher) return;
    // shortlist polls: "2" / "#2" / "!vote 2" is a vote for option 2
    const num = this.mode === 'shortlist' ? optionNumber(m.text) : null;
    if (num !== null && num >= 1 && num <= this.shortlist.length) {
      this.vote(m, `#${num}`, { showId: this.shortlist[num - 1], stage: 'exact', score: 1 });
      return;
    }
    const phrase = cleanMessage(m.text);
    if (!phrase || this.dismissed.has(phrase)) return;
    this.messages++;
    this.vote(m, phrase);
  }

  /**
   * Record one viewer saying `phrase`. `preset` skips matching (a number
   * vote in a shortlist poll already knows its show).
   */
  private vote(
    m: ChatMessage,
    phrase: string,
    preset?: { showId: number; stage: MatchStage; score: number }
  ) {
    if (preset) this.messages++;
    const voter = `${m.platform}:${m.userId}`;

    let bucket = this.buckets.get(phrase);
    if (!bucket) {
      // taught phrases first, then the options, then the whole library
      let hit: { showId: number; stage: MatchStage; score: number } | null = preset ?? null;
      if (!hit) {
        const full = this.matcher!.match(phrase, this.ignored);
        hit = full?.stage === 'learned' ? full : (this.optionMatcher?.match(phrase, this.ignored) ?? full);
      }
      bucket = {
        sample: m.text.trim().slice(0, 120),
        voters: new Set(),
        showId: hit?.showId ?? null,
        stage: hit?.stage ?? null,
        score: hit?.score ?? null,
        lastAt: 0,
      };
      this.buckets.set(phrase, bucket);
      if (!preset && this.strategy && this.strategy.id !== 'classic') {
        // pure vector replaces classic; hybrids only help where classic gave up
        if (this.strategy.id === 'vector' && bucket.stage !== 'learned') {
          bucket.showId = bucket.stage = bucket.score = null;
          this.resolveWithAi(phrase);
        } else if ((this.strategy.id === 'precise-llm' || this.strategy.id === 'precise-hybrid-llm') && bucket.stage === 'fuzzy' && (bucket.score ?? 0) < PRECISE_FUZZY) {
          // not confident enough: hold it back until the LLM decides
          bucket.showId = bucket.stage = bucket.score = null;
          this.resolveWithAi(phrase);
        } else if (bucket.showId === null && !this.matcher!.isChatter(phrase)) {
          this.resolveWithAi(phrase);
        }
      }
      if (bucket.showId === null) this.trimUnmatched();
    }
    bucket.lastAt = Date.now();
    if (bucket.voters.has(voter)) return;

    if (this.onePerViewer && bucket.showId !== null) {
      const prev = this.lastPhrase.get(voter);
      if (prev && prev !== phrase) {
        const old = this.buckets.get(prev);
        if (old) {
          old.voters.delete(voter);
          if (old.showId !== null) this.recountShow(old.showId);
        }
      }
      this.lastPhrase.set(voter, phrase);
    }

    bucket.voters.add(voter);
    if (bucket.showId !== null) {
      let set = this.votes.get(bucket.showId);
      if (!set) this.votes.set(bucket.showId, (set = new Set()));
      set.add(voter);
      this.version++;
    }
    this.schedule();
  }

  /**
   * Ask the AI strategy in the background. Chat handling never waits: the
   * phrase sits in Unmatched until the model answers, then its voters move.
   */
  private resolveWithAi(phrase: string) {
    const strategy = this.strategy;
    if (!strategy || this.pendingAi >= 200) return; // a burst can't queue forever
    this.pendingAi++;
    const view = { has: (id: number) => this.ignored.has(id) || !this.shows.has(id) } as Set<number>;
    strategy
      .match(phrase, view)
      .then((hit) => {
        const b = this.buckets.get(phrase);
        if (!hit || !b || b.stage === 'learned' || this.strategy !== strategy) return;
        const prev = b.showId;
        b.showId = hit.showId;
        b.stage = hit.stage;
        b.score = hit.score;
        if (prev !== null) this.recountShow(prev);
        this.recountShow(hit.showId);
        this.version++;
        this.schedule();
      })
      .catch(() => {})
      .finally(() => {
        this.pendingAi--;
      });
  }

  /** Streamer says: this phrase means that show. Recounts past voters too. */
  assign(phrase: string, showId: number) {
    const show = this.shows.get(showId) ?? this.catalog.all().find((s) => s.id === showId);
    if (!show) throw new Error(`Unknown show ${showId}`);
    this.user.teach(phrase, showId);
    this.dismissed.delete(phrase);
    if (!this.shows.has(showId)) this.shows.set(showId, show);
    this.matcher?.teach(phrase, showId);
    const b = this.buckets.get(phrase);
    if (b) {
      const prev = b.showId;
      b.showId = showId;
      b.stage = 'learned';
      b.score = 1;
      if (prev !== null) this.recountShow(prev);
      this.recountShow(showId);
    }
    this.version++;
    this.schedule(true);
  }

  /** Streamer says: this phrase is not a vote. */
  /**
   * Undo "Not a vote". Takes effect immediately; viewers who typed it
   * earlier in this poll were dropped, so they count from their next message.
   */
  undismiss(phrase: string) {
    this.user.undismiss(phrase);
    this.dismissed.delete(phrase);
    this.schedule(true);
  }

  dismiss(phrase: string) {
    this.user.dismiss(phrase);
    this.dismissed.add(phrase);
    this.matcher?.forget(phrase);
    const b = this.buckets.get(phrase);
    this.buckets.delete(phrase);
    if (b?.showId != null) this.recountShow(b.showId);
    this.version++;
    this.schedule(true);
  }

  /** Ignoring a show mid-poll re-routes its phrases to the next best match. */
  setIgnored(showId: number, ignored: boolean) {
    this.user.setIgnored(showId, ignored);
    if (ignored) this.ignored.add(showId);
    else this.ignored.delete(showId);
    if (this.state === 'idle' || !this.matcher) return;
    const touched = new Set<number>([showId]);
    for (const [phrase, b] of this.buckets) {
      const affected = ignored ? b.showId === showId : b.showId === null;
      if (!affected || b.stage === 'learned') continue;
      const hit = this.matcher.match(phrase, this.ignored);
      if (b.showId !== null) touched.add(b.showId);
      b.showId = hit?.showId ?? null;
      b.stage = hit?.stage ?? null;
      b.score = hit?.score ?? null;
      if (b.showId !== null) touched.add(b.showId);
    }
    touched.forEach((id) => this.recountShow(id));
    this.version++;
    this.schedule(true);
  }

  private recountShow(showId: number) {
    const set = new Set<string>();
    for (const b of this.buckets.values()) {
      if (b.showId === showId) b.voters.forEach((v) => set.add(v));
    }
    if (set.size) this.votes.set(showId, set);
    else this.votes.delete(showId);
  }

  private trimUnmatched() {
    let unmatched = 0;
    for (const b of this.buckets.values()) if (b.showId === null) unmatched++;
    if (unmatched <= MAX_UNMATCHED) return;
    // drop the stalest single-voter chatter first
    const victims = [...this.buckets.entries()]
      .filter(([, b]) => b.showId === null)
      .sort((a, b) => a[1].voters.size - b[1].voters.size || a[1].lastAt - b[1].lastAt)
      .slice(0, unmatched - MAX_UNMATCHED + 200);
    victims.forEach(([k]) => this.buckets.delete(k));
  }

  // ------------------------------------------------------------ views

  phrasesFor(showId: number): PollPhrase[] {
    return [...this.buckets.entries()]
      .filter(([, b]) => b.showId === showId)
      .map(([phrase, b]) => toPhrase(phrase, b))
      .sort((a, b) => b.voters - a.voters);
  }

  snapshot(): PollSnapshot {
    const ranking: RankedShow[] = [];
    let totalVotes = 0;
    let filteredVotes = 0;
    const voters = new Set<string>();
    for (const [id, set] of this.votes) {
      const show = this.shows.get(id);
      if (!show || this.ignored.has(id) || !set.size) continue;
      if (!this.counts(show)) {
        filteredVotes += set.size;
        continue;
      }
      ranking.push({ ...show, count: set.size });
      totalVotes += set.size;
      set.forEach((v) => voters.add(v));
    }
    if (this.mode === 'shortlist') {
      // every option is on the board from the start, numbered
      for (const [i, id] of this.shortlist.entries()) {
        const existing = ranking.find((r) => r.id === id);
        if (existing) existing.option = i + 1;
        else if (this.shows.get(id) && !this.ignored.has(id)) ranking.push({ ...this.shows.get(id)!, count: 0, option: i + 1 });
      }
      ranking.sort((a, b) => b.count - a.count || (a.option ?? 99) - (b.option ?? 99));
    } else {
      ranking.sort((a, b) => b.count - a.count || b.popularity - a.popularity);
    }

    const unmatched = [...this.buckets.entries()]
      .filter(([, b]) => b.showId === null)
      .sort((a, b) => b[1].voters.size - a[1].voters.size || b[1].lastAt - a[1].lastAt)
      .slice(0, 60)
      .map(([phrase, b]) => toPhrase(phrase, b));

    return {
      version: this.version,
      state: this.state,
      startedAt: this.startedAt,
      endedAt: this.endedAt,
      filters: this.filters,
      mode: this.mode,
      shortlist: this.shortlist,
      filteredVotes,
      // a running poll keeps what it started with; otherwise ask the catalog now
      releaseKnown: this.state === 'idle' ? this.catalog.info().hasRelease : this.releaseKnown,
      messages: this.messages,
      totalVoters: voters.size,
      totalVotes,
      ranking,
      unmatched,
      sources: this.user.settings().channels.map((c) => ({
        ...c,
        status: (c.enabled && this.status.get(c.id)) || { state: 'off' },
      })),
      catalogPending:
        this.state === 'running' && this.catalogVersionAtStart !== '' &&
        this.catalogVersionAtStart !== this.catalog.info().file,
    };
  }

  /** Does this show count under the poll's filters? */
  private counts(show: Show) {
    if (this.mode === 'shortlist') return this.shortlist.includes(show.id);
    if (!this.filters.formats.includes(show.format)) return false;
    // unknown release (old catalog): can't judge – count it
    return show.release === null || this.filters.release.includes(show.release);
  }

  publicSnapshot(s = this.snapshot()): PublicSnapshot {
    return {
      version: s.version,
      title: this.user.settings().pollTitle,
      mode: s.mode,
      state: s.state,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      totalVoters: s.totalVoters,
      totalVotes: s.totalVotes,
      ranking: s.ranking.slice(0, 40).map((r) => ({
        id: r.id,
        title: r.titleRomaji,
        subtitle: r.titleEnglish && r.titleEnglish.toLowerCase() !== r.titleRomaji.toLowerCase() ? r.titleEnglish : null,
        cover: r.coverImage,
        color: r.coverColor,
        format: r.format,
        year: r.startYear,
        count: r.count,
        option: r.option,
      })),
    };
  }

  /** Coalesce bursts of chat into at most ~5 UI/websocket pushes a second. */
  private schedule(now = false) {
    if (now) {
      if (this.emitTimer) clearTimeout(this.emitTimer);
      this.emitTimer = null;
      this.emit('update', this.snapshot());
      return;
    }
    if (this.emitTimer) return;
    this.emitTimer = setTimeout(() => {
      this.emitTimer = null;
      this.emit('update', this.snapshot());
    }, EMIT_EVERY_MS);
  }
}

function toPhrase(phrase: string, b: Bucket): PollPhrase {
  return {
    phrase,
    sample: b.sample,
    voters: b.voters.size,
    showId: b.showId,
    stage: b.stage,
    score: b.score,
  };
}
