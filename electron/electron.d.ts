import type { SelectedCatalogInfo } from './catalog/catalogs';
import type { UpdateStatus } from './catalog/store';

declare global {
  type ShowFormat = 'TV' | 'TV_SHORT' | 'MOVIE';
  /** of the franchise's first season: released = at least one full season out */
  type ShowRelease = 'released' | 'airing' | 'upcoming';
  type ShowSeason = 'SPRING' | 'SUMMER' | 'FALL' | 'WINTER';

  type Show = {
    id: number;
    titleRomaji: string;
    titleEnglish: string | null;
    synonyms: string[];
    startYear: number | null;
    season: ShowSeason | null;
    format: ShowFormat;
    coverImage: string | null;
    coverColor: string | null;
    popularity: number;
    score: number | null;
    favourites: number | null;
    parentId: number | null;
    /** franchise root – the only kind of entry polls count */
    eligible: boolean;
    /** null when the catalog predates release status (update it) */
    release: ShowRelease | null;
    custom?: boolean;
    /** changed by the streamer (built-in catalogs) */
    edited?: boolean;
    /** a sequel the streamer made its own entry (e.g. Boruto out of Naruto) */
    split?: boolean;
    /** added by the streamer to a built-in catalog */
    added?: boolean;
  };

  /**
   * The streamer's changes to a built-in catalog title. Kept apart from the
   * catalog file, so they survive every update.
   */
  type ShowOverride = {
    title?: string;
    /** replaces the other names (the first one shows as the subtitle) */
    altTitles?: string[];
    year?: number | null;
    format?: ShowFormat;
    /** null = no cover */
    cover?: string | null;
    release?: ShowRelease | null;
    /** a sequel that counts on its own instead of for its franchise */
    split?: boolean;
  };

  // ------------------------------------------------------------ catalogs
  //   anilist  the anime catalog (AniList)
  //   imdb     movies & series (IMDb's free datasets)
  //   games    video games (Wikidata)
  //   custom   built by the streamer in the app – any number of them
  type CatalogKind = 'anilist' | 'imdb' | 'games' | 'custom';

  /** One of the three format slots, as a catalog names it (TV / Movie / Short, Movie / Series / Mini-series, …). */
  type FormatLabel = { id: ShowFormat; label: string };

  type CatalogSummary = {
    id: string;
    name: string;
    kind: CatalogKind;
    /** movies & series exist only after their first download */
    installed: boolean;
    count: number;
    eligible: number;
    syncedAt: number;
    canRevert: boolean;
    selected: boolean;
    status: CatalogStatus;
  };

  /** A custom catalog entry, as typed in the app. */
  type CustomEntryInput = {
    title: string;
    /** other names chat might use */
    altTitles: string[];
    year: number | null;
    format: ShowFormat;
    /** a link, or an image saved with catalogs.saveCover */
    cover: string | null;
    release: ShowRelease | null;
  };

  /** option = its number in a shortlist poll (1-based) */
  /**
   * option    – its number in a shortlist poll (1-based)
   * breakdown – shortlist polls: votes per chat (channel id, or the platform
   *             when the source has no channel – the dev simulator)
   */
  type RankedShow = Show & { count: number; option?: number; breakdown?: Record<string, number> };

  type MatchStage = 'exact' | 'token' | 'fuzzy' | 'learned';

  /** A distinct cleaned chat message and who sent it. */
  type PollPhrase = {
    phrase: string;
    sample: string;
    voters: number;
    showId: number | null;
    stage: MatchStage | null;
    score: number | null;
  };

  type SourceState = 'off' | 'connecting' | 'live' | 'waiting' | 'error';
  type SourceStatus = { state: SourceState; detail?: string; retryAt?: number };
  type ChatPlatform = 'twitch' | 'youtube' | 'rumble';

  type PollState = 'idle' | 'running' | 'ended';

  /** which shows count in a poll – matching ignores these on purpose */
  type PollFilters = { formats: ShowFormat[]; release: ShowRelease[] };

  /**
   * open      – any show in the library, narrowed by filters
   * shortlist – only the picked shows count; chat can vote by number
   */
  type PollMode = 'open' | 'shortlist';

  type PollConfig = { mode: PollMode; filters: PollFilters; shortlist: number[] };

  type PollSnapshot = {
    version: number;
    state: PollState;
    startedAt: number | null;
    endedAt: number | null;
    filters: PollFilters;
    mode: PollMode;
    /** shortlist poll: the option shows, in number order */
    shortlist: number[];
    /** votes that matched a show the filters leave out (not counted) */
    filteredVotes: number;
    /** the catalog has release status (older catalogs need an update) */
    releaseKnown: boolean;
    messages: number;
    totalVoters: number;
    totalVotes: number;
    ranking: RankedShow[];
    unmatched: PollPhrase[];
    /** every configured channel and its connection state */
    sources: ChannelState[];
    /** catalog changed since this poll started – applies to the next poll */
    catalogPending: boolean;
    /** who started the current run – a tournament round, or a plain poll */
    owner: PollOwner;
  };

  type PollOwner = 'poll' | 'tournament';

  type PublicEntry = {
    id: number;
    title: string;
    subtitle: string | null;
    cover: string | null;
    color: string | null;
    format: ShowFormat;
    year: number | null;
    count: number;
    /** shortlist poll: the number chat can type */
    option?: number;
    /** shortlist poll: votes per chat (see PublicChannel) */
    breakdown?: Record<string, number>;
  };

  /**
   * An enabled chat as the viewer page labels it. `name` is only set when
   * the streamer listens to two or more chats on the same platform –
   * otherwise the platform alone says it all.
   */
  type PublicChannel = { id: string; platform: ChatPlatform; name: string | null };

  type PublicSnapshot = {
    version: number;
    title: string;
    mode: PollMode;
    state: PollState;
    startedAt: number | null;
    endedAt: number | null;
    totalVoters: number;
    totalVotes: number;
    ranking: PublicEntry[];
    channels: PublicChannel[];
    /** an open tournament takes over the viewer page */
    tournament: PublicTournament | null;
    /** what chat is voting from – sets the wording ("anime", "movie or show", …) */
    catalog: { name: string; kind: CatalogKind };
  };

  // ------------------------------------------------------------ tournament
  //
  //   open round      any show, chat may back several (top N−Y go through)
  //   qualifiers      top M shown; Y returning shows are already in
  //   bracket         N entries, editable; 1v1s, one vote per viewer
  //   champion

  type TournamentConfig = {
    title: string;
    /** N – bracket entries, returning shows included */
    size: number;
    /** M – how many open-round results the qualifiers screen shows */
    showTop: number;
    /** Y – returning shows (recent runners-up), straight into the bracket */
    carried: number[];
    filters: PollFilters;
    /** play the semi-final losers for third (before or after the final) */
    thirdPlace: boolean;
  };

  type TournamentPhase = 'open' | 'open-results' | 'bracket' | 'done';
  /** what the viewer page shows */
  type TournamentScreen = 'open' | 'open-results' | 'draw' | 'bracket' | 'intro' | 'match' | 'coin' | 'champion' | 'report';
  type BoutStage = 'intro' | 'voting' | 'result';

  type MatchResult = {
    a: number;
    b: number;
    /** null = a tie the streamer still has to settle */
    winner: number | null;
    votes: [number, number];
    breakdown: [Record<string, number>, Record<string, number>];
    /** winner picked by hand */
    manual?: boolean;
    /** a tie settled by a coin flip */
    coin?: boolean;
    endedAt: number;
  };

  /**
   * Shows tied on votes across the qualifying line: more of them than spots
   * left. Settled by a random draw or by the streamer's pick.
   */
  type CutTie = {
    candidates: number[];
    votes: number;
    slots: number;
    picked: number[] | null;
    /** draw = lottery (3+ level) · coin = two level for one spot */
    method: 'draw' | 'coin' | 'manual' | null;
    at: number | null;
  };

  type Tournament = {
    id: string;
    createdAt: number;
    config: TournamentConfig;
    phase: TournamentPhase;
    screen: TournamentScreen;
    open: { ranking: { id: number; count: number }[]; startedAt: number; endedAt: number | null; run: number };
    /** first-round order, a power of two long; null = bye */
    slots: (number | null)[];
    /** by match key "round-index"; only valid while its pairing still stands */
    results: Record<string, MatchResult>;
    live: { key: string; stage: BoutStage; run: number; at: number } | null;
    /** the match the bracket screen points at */
    focus: string | null;
    /** a tie at the qualifying line (from the open round) */
    cut?: CutTie | null;
    /** the last coin flip, for the viewer page's coin screen ("cut" = the qualifying line) */
    coin?: { key: string; at: number } | null;
    /** struck out by the streamer (rules: too many episodes, already watched, …) – never count, never qualify */
    removed?: number[];
  };

  type BracketStatus = 'waiting' | 'ready' | 'live' | 'done' | 'tie' | 'bye' | 'empty';

  type BracketMatch = {
    key: string;
    round: number;
    index: number;
    /** show id · null = nobody (bye) · undefined = not decided yet */
    a: number | null | undefined;
    b: number | null | undefined;
    status: BracketStatus;
    winner: number | null | undefined;
    result: MatchResult | null;
  };

  type TournamentRecord = {
    id: string;
    title: string;
    finishedAt: number;
    champion: number;
    runnerUp: number;
    third?: number;
    entries: number[];
    /** the whole tournament as it finished – lets it be re-opened to view */
    data?: Tournament;
  };

  /** A past tournament in a list (without its full data). */
  type TournamentSummary = Omit<TournamentRecord, 'data'> & { viewable: boolean };

  type TournamentSnapshot = {
    tournament: Tournament | null;
    /** rounds, first to final (derived from slots + results) */
    rounds: BracketMatch[][];
    /** the third-place match (null when off, or before the semis exist) */
    third: BracketMatch | null;
    /** open round: who's through, and who's tied on the line (unsettled) */
    qualified: number[];
    tied: number[];
    draft: TournamentConfig;
    history: TournamentSummary[];
    /** a past tournament re-opened for the viewer page (read-only) */
    viewing: { record: TournamentSummary; tournament: Tournament; rounds: BracketMatch[][]; third: BracketMatch | null } | null;
    canUndo: boolean;
    /** what the next undo reverts, for the button's tooltip */
    undoLabel: string | null;
  };

  type TournamentAction =
    | { type: 'draft'; patch: Partial<TournamentConfig> }
    | { type: 'start-open' }
    | { type: 'stop-open' }
    | { type: 'retry-open' }
    | { type: 'build-bracket' }
    | { type: 'reseed' }
    | { type: 'shuffle' }
    | { type: 'set-slot'; index: number; showId: number | null }
    | { type: 'swap-slots'; a: number; b: number }
    | { type: 'start-match'; key: string }
    | { type: 'begin-voting' }
    | { type: 'stop-match' }
    | { type: 'cancel-match' }
    | { type: 'retry-match'; key: string }
    | { type: 'set-winner'; key: string; showId: number }
    | { type: 'clear-result'; key: string }
    | { type: 'continue' }
    | { type: 'show'; screen: TournamentScreen; focus?: string | null }
    | { type: 'undo' }
    | { type: 'close' }
    | { type: 'third-place'; on: boolean }
    | { type: 'cut-draw' }
    | { type: 'cut-pick'; ids: number[] }
    | { type: 'coin-flip'; key: string }
    | { type: 'forget-history'; id: string }
    | { type: 'view-archive'; id: string }
    | { type: 'remove-nominee'; showId: number }
    | { type: 'restore-nominee'; showId: number }
    | { type: 'disqualify'; index: number }
    | { type: 'stop-viewing' };

  type PublicMatch = {
    key: string;
    round: number;
    index: number;
    a: PublicEntry | null;
    b: PublicEntry | null;
    status: BracketStatus;
    winner: number | null;
    votes: [number, number] | null;
    breakdown: [Record<string, number>, Record<string, number>] | null;
    coin: boolean;
    /** winner picked by hand */
    manual: boolean;
  };

  type PublicTournament = {
    id: string;
    title: string;
    /** a past tournament re-opened to look back at */
    archived: boolean;
    createdAt: number;
    finishedAt: number | null;
    /** open-round votes for the shows that got any (top 100) */
    openVotes: number;
    phase: TournamentPhase;
    screen: TournamentScreen;
    size: number;
    /** open-round places that go through (N − Y) */
    qualifySpots: number;
    carried: PublicEntry[];
    /** frozen open-round standings, top M (live ones come in `ranking`) */
    standings: PublicEntry[];
    qualified: number[];
    tied: number[];
    cut: (Omit<CutTie, 'candidates'> & { candidates: PublicEntry[] }) | null;
    coin: { key: string; at: number; winner: number } | null;
    rounds: PublicMatch[][];
    third: PublicMatch | null;
    live: { key: string; stage: BoutStage; at: number } | null;
    focus: string | null;
    champion: PublicEntry | null;
    runnerUp: PublicEntry | null;
    thirdPlace: PublicEntry | null;
  };

  /** One chat to listen to. Any number per platform. */
  type ChannelConfig = {
    id: string;
    platform: ChatPlatform;
    /** Twitch name · YouTube @handle / UC… / link · Rumble channel or video link */
    target: string;
    /** optional display name */
    label: string;
    enabled: boolean;
    createdAt: number;
  };

  type ChannelState = ChannelConfig & { status: SourceStatus };

  type ChannelTestResult =
    | { result: 'live'; detail?: string; messages: number }
    | { result: 'offline'; detail?: string }
    | { result: 'error'; detail: string };

  type MatcherStrategy = 'classic' | 'vector' | 'hybrid' | 'hybrid-llm' | 'precise-hybrid-llm' | 'precise-llm';

  type AiPartStatus = {
    state: 'off' | 'missing' | 'loading' | 'indexing' | 'ready' | 'error';
    progress?: number;
    detail?: string;
  };

  type AiDownload = {
    state: 'queued' | 'downloading' | 'paused' | 'verifying' | 'done' | 'error';
    total: number;
    received: number;
    speed: number;
    etaSec: number | null;
    connections: number;
    error?: string;
  };

  type AiPack = {
    id: string;
    kind: 'embed' | 'llm';
    name: string;
    blurb: string;
    repo: string;
    files: { path: string; size: number }[];
    vramGb?: number;
    speed?: string;
    installed: boolean;
    bytesOnDisk: number;
    download: AiDownload | null;
  };

  type AiHardware = {
    gpu: 'cuda' | 'vulkan' | 'metal' | false;
    devices: string[];
    vramTotal: number;
    vramFree: number;
    recommended: string;
  };

  type TunnelProvider = 'cloudflare' | 'ngrok';

  type TunnelStatus = {
    provider: TunnelProvider;
    state: 'off' | 'installing' | 'starting' | 'online' | 'reconnecting' | 'error';
    url: string | null;
    detail?: string;
    progress?: number;
  };

  type ShareInfo = {
    /** this PC (OBS on the same machine) */
    localUrl: string;
    /** other devices on the same network */
    lanUrls: string[];
    tunnel: TunnelStatus;
  };

  type Settings = {
    channels: ChannelConfig[];
    /** public link provider – cloudflare needs no account */
    tunnelProvider: TunnelProvider;
    /** the streamer's own ngrok authtoken; stays in the local settings db */
    ngrokToken: string;
    /** open the public link when the app starts */
    tunnelAutoStart: boolean;
    /** shown on the app and the viewer page */
    pollTitle: string;
    /** translucent window and dialogs */
    glass: boolean;
    /** last used poll filters */
    pollFilters: PollFilters;
    /** last used poll mode and shortlist */
    pollMode: PollMode;
    pollShortlist: number[];
    /** how chat is matched to shows – all local and free */
    matcherStrategy: MatcherStrategy;
    embedModel: 'minilm' | 'e5';
    /** 'auto' = biggest that fits the GPU (7B on an 8 GB card) */
    llmModel: 'auto' | 'qwen-1.5b' | 'qwen-3b' | 'qwen-7b';
    /** one vote per viewer – a new vote replaces their previous one */
    onePerViewer: boolean;
    /** the catalog in use: 'anime', 'screen', 'games' or 'custom-N' */
    catalog: string;
  };

  type LearnedAlias = { phrase: string; showId: number; createdAt: number };

  type SearchHit = { show: Show; score: number; alias: string };

  type MatchProbe = {
    strategy: MatcherStrategy;
    cleaned: string | null;
    /** the phrase was marked "Not a vote" – chat typing it is dropped */
    dismissed: boolean;
    /** the phrase was taught to a show ("Count as…") */
    taughtTo: number | null;
    result: { showId: number; score: number; stage: MatchStage; alias: string } | null;
    /** what the selected AI strategy says (when it isn't classic and is ready) */
    aiResult?: { showId: number; score: number; stage: MatchStage; alias: string } | null;
    aiMs?: number;
    candidates: SearchHit[];
  };

  type CatalogStatus = UpdateStatus;
  type CatalogMeta = SelectedCatalogInfo;

  interface Window {
    GOTPoll: {
      setTheme: (theme: 'light' | 'dark' | 'system') => Promise<boolean>;
      /** translucent window + dialogs (true) or solid (false); saved */
      setGlass: (on: boolean) => Promise<void>;
      getServerPort: () => Promise<number>;
      openExternal: (url: string) => Promise<void>;
      catalog: {
        info: () => Promise<CatalogMeta>;
        shows: () => Promise<Show[]>;
        status: () => Promise<CatalogStatus>;
        update: () => Promise<void>;
        cancel: () => Promise<void>;
        revert: () => Promise<boolean>;
        search: (query: string, limit?: number) => Promise<SearchHit[]>;
        probe: (message: string) => Promise<MatchProbe>;
        onStatus: (cb: (s: CatalogStatus) => void) => () => void;
        onChanged: (cb: (info: CatalogMeta) => void) => () => void;
      };
      catalogs: {
        list: () => Promise<CatalogSummary[]>;
        /** switch the catalog in use (not while a poll or tournament runs) */
        select: (id: string) => Promise<void>;
        update: (id: string) => Promise<void>;
        cancel: (id: string) => Promise<void>;
        revert: (id: string) => Promise<boolean>;
        create: (name: string) => Promise<string>;
        rename: (id: string, name: string) => Promise<void>;
        remove: (id: string) => Promise<void>;
        labels: (id: string) => Promise<Record<ShowFormat, string>>;
        setLabels: (id: string, labels: Partial<Record<ShowFormat, string>>) => Promise<void>;
        entries: (id: string) => Promise<Show[]>;
        addEntry: (id: string, entry: CustomEntryInput) => Promise<Show>;
        /** change a built-in catalog title (null = back to the catalog's own data) */
        override: (showId: number, o: ShowOverride | null) => Promise<void>;
        /** make a sequel its own entry (or back to its franchise); other edits stay */
        split: (showId: number, on: boolean) => Promise<void>;
        updateEntry: (id: string, showId: number, entry: CustomEntryInput) => Promise<void>;
        removeEntry: (id: string, showId: number) => Promise<void>;
        /** search any catalog (to copy titles into a custom one) */
        search: (id: string, query: string, limit?: number) => Promise<SearchHit[]>;
        /** keep an image file for a cover; returns its URL */
        saveCover: (bytes: ArrayBuffer, type: string) => Promise<string>;
        onList: (cb: (list: CatalogSummary[]) => void) => () => void;
        /** posters found for titles (movies & series) */
        onCovers: (cb: (batch: { id: number; url: string }[]) => void) => () => void;
      };
      poll: {
        start: (config: PollConfig) => Promise<void>;
        stop: () => Promise<void>;
        reset: () => Promise<void>;
        snapshot: () => Promise<PollSnapshot>;
        /** teach "phrase means show" – recounts everyone who typed it */
        assign: (phrase: string, showId: number) => Promise<void>;
        /** this phrase is not a vote – drops it from the poll and unmatched list */
        dismiss: (phrase: string) => Promise<void>;
        phrasesFor: (showId: number) => Promise<PollPhrase[]>;
        onUpdate: (cb: (s: PollSnapshot) => void) => () => void;
      };
      tournament: {
        snapshot: () => Promise<TournamentSnapshot>;
        /** every step goes through here; errors come back as rejections */
        act: (action: TournamentAction) => Promise<void>;
        onUpdate: (cb: (s: TournamentSnapshot) => void) => () => void;
      };
      ignores: {
        list: () => Promise<number[]>;
        set: (showId: number, ignored: boolean) => Promise<void>;
      };
      aliases: {
        list: () => Promise<LearnedAlias[]>;
        remove: (phrase: string) => Promise<void>;
        /** phrases marked "Not a vote" */
        dismissed: () => Promise<{ phrase: string; createdAt: number }[]>;
        restore: (phrase: string) => Promise<void>;
      };
      settings: {
        get: () => Promise<Settings>;
        set: (patch: Partial<Settings>) => Promise<Settings>;
      };
      ai: {
        status: () => Promise<{ embed: AiPartStatus; llm: AiPartStatus }>;
        packs: () => Promise<AiPack[]>;
        hardware: () => Promise<AiHardware>;
        download: (id: string) => Promise<void>;
        pause: (id: string) => Promise<void>;
        cancel: (id: string) => Promise<void>;
        remove: (id: string) => Promise<void>;
        /** load + index what the current strategy needs */
        prepare: () => Promise<void>;
        onStatus: (cb: (s: { embed: AiPartStatus; llm: AiPartStatus }) => void) => () => void;
        onPacks: (cb: (p: AiPack[]) => void) => () => void;
      };
      share: {
        info: () => Promise<ShareInfo>;
        start: () => Promise<void>;
        stop: () => Promise<void>;
        onStatus: (cb: (s: TunnelStatus) => void) => () => void;
      };
      channels: {
        /** parse what the user typed: normalised target + a friendly name, or an error */
        describe: (platform: ChatPlatform, input: string) => Promise<{ ok: true; target: string; name: string; follows: boolean } | { ok: false; error: string }>;
        /** connect once (≤25s) and report whether it's live */
        test: (channel: Pick<ChannelConfig, 'platform' | 'target'>) => Promise<ChannelTestResult>;
      };
    };
  }
}

export {};
