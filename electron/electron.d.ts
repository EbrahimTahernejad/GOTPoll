import type { CatalogInfo, UpdateStatus } from './catalog/store';

declare global {
  type ShowFormat = 'TV' | 'TV_SHORT' | 'MOVIE';
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
    custom?: boolean;
  };

  type RankedShow = Show & { count: number };

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

  type PollSnapshot = {
    version: number;
    state: PollState;
    startedAt: number | null;
    endedAt: number | null;
    formats: ShowFormat[];
    messages: number;
    totalVoters: number;
    totalVotes: number;
    ranking: RankedShow[];
    unmatched: PollPhrase[];
    /** every configured channel and its connection state */
    sources: ChannelState[];
    /** catalog changed since this poll started – applies to the next poll */
    catalogPending: boolean;
  };

  type PublicEntry = {
    id: number;
    title: string;
    subtitle: string | null;
    cover: string | null;
    color: string | null;
    format: ShowFormat;
    year: number | null;
    count: number;
  };

  type PublicSnapshot = {
    version: number;
    title: string;
    state: PollState;
    startedAt: number | null;
    endedAt: number | null;
    totalVoters: number;
    totalVotes: number;
    ranking: PublicEntry[];
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
    /** how chat is matched to shows – all local and free */
    matcherStrategy: MatcherStrategy;
    embedModel: 'minilm' | 'e5';
    /** 'auto' = biggest that fits the GPU (7B on an 8 GB card) */
    llmModel: 'auto' | 'qwen-1.5b' | 'qwen-3b' | 'qwen-7b';
    /** one vote per viewer – a new vote replaces their previous one */
    onePerViewer: boolean;
  };

  type LearnedAlias = { phrase: string; showId: number; createdAt: number };

  type SearchHit = { show: Show; score: number; alias: string };

  type MatchProbe = {
    strategy: MatcherStrategy;
    cleaned: string | null;
    result: { showId: number; score: number; stage: MatchStage; alias: string } | null;
    /** what the selected AI strategy says (when it isn't classic and is ready) */
    aiResult?: { showId: number; score: number; stage: MatchStage; alias: string } | null;
    aiMs?: number;
    candidates: SearchHit[];
  };

  type CatalogStatus = UpdateStatus;
  type CatalogMeta = CatalogInfo;

  interface Window {
    GOTPoll: {
      setTheme: (theme: 'light' | 'dark' | 'system') => Promise<boolean>;
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
      poll: {
        start: (formats: ShowFormat[]) => Promise<void>;
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
      ignores: {
        list: () => Promise<number[]>;
        set: (showId: number, ignored: boolean) => Promise<void>;
      };
      aliases: {
        list: () => Promise<LearnedAlias[]>;
        remove: (phrase: string) => Promise<void>;
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
