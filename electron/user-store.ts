import Database from 'better-sqlite3';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { cleanFilters } from './poll/filters.js';

// Everything the streamer decides lives here, separate from the catalog, so
// catalog updates/reverts never lose ignores, taught aliases or settings.

const newId = () => Math.random().toString(36).slice(2, 10);

const DEFAULT_SETTINGS: Settings = {
  // no channels baked in – the streamer adds theirs in Settings → Channels
  channels: [],
  pollTitle: 'Anime Poll',
  glass: true,
  pollFilters: { formats: ['TV', 'TV_SHORT', 'MOVIE'], release: ['released', 'airing', 'upcoming'] },
  tunnelProvider: 'cloudflare',
  ngrokToken: '',
  tunnelAutoStart: false,
  onePerViewer: false,
  // romaji-aware by default: multilingual embeddings + a local LLM judge.
  // Falls back to classic on its own until the models are downloaded.
  matcherStrategy: 'hybrid-llm',
  embedModel: 'e5',
  llmModel: 'auto',
};

// Western shows AniList doesn't carry. Negative ids can never collide with
// AniList (got-poll used 193297+, which AniList has since handed out).
const CUSTOM_SHOWS: Show[] = [
  custom(-1, 'Avatar the Last Airbender', null, ['ATLA', 'Avatar: The Legend of Aang', 'Avatar', 'The Last Airbender'], 2005, 'SPRING',
    'https://shopalliz.com/cdn/shop/files/H246839875bbc439aabc17ac6f0265277t.webp?v=1706579435&width=1445', 596437),
  custom(-2, 'Akumajo Dracula', 'Castlevania', [], 2017, 'SUMMER',
    'https://i.ebayimg.com/images/g/pN0AAOSwgv5ZWWF2/s-l1200.jpg', 596436),
  custom(-3, 'Invincible', null, [], 2021, 'SPRING',
    'https://i.ebayimg.com/images/g/O4sAAOSwdxBlM-3j/s-l1600.jpg', 596434),
];

function custom(
  id: number, titleRomaji: string, titleEnglish: string | null, synonyms: string[],
  startYear: number, season: ShowSeason, coverImage: string, popularity: number
): Show {
  return {
    id, titleRomaji, titleEnglish, synonyms, startYear, season, format: 'TV', coverImage,
    coverColor: null, popularity, score: null, favourites: null, parentId: null, eligible: true, release: 'released',
    custom: true,
  };
}

function cleanChannels(list: ChannelConfig[]): ChannelConfig[] {
  return list
    .filter((c) => ['twitch', 'youtube', 'rumble'].includes(c.platform) && typeof c.target === 'string' && c.target.trim())
    .map((c) => ({
      id: c.id || newId(),
      platform: c.platform,
      target: c.target.trim(),
      label: (c.label ?? '').trim().slice(0, 60),
      enabled: c.enabled !== false,
      createdAt: c.createdAt || Date.now(),
    }));
}

export class UserStore {
  private db: Database.Database;

  constructor(dir: string) {
    this.db = new Database(path.join(dir, 'user.db'));
    this.db.pragma('journal_mode = WAL');
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS ignores (show_id INTEGER PRIMARY KEY, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS aliases (phrase TEXT PRIMARY KEY, show_id INTEGER NOT NULL, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS dismissed (phrase TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    this.migrateFromGotPoll(path.join(dir, 'shows.db'));
  }

  /** got-poll kept ignores inside the catalog file; carry them over once. */
  private migrateFromGotPoll(legacyPath: string) {
    if (this.db.prepare("SELECT 1 FROM settings WHERE key = 'migrated_v1'").get()) return;
    if (existsSync(legacyPath)) {
      try {
        const legacy = new Database(legacyPath, { readonly: true, fileMustExist: true });
        const rows = legacy.prepare('SELECT show_id FROM show_ignores').all() as { show_id: number }[];
        legacy.close();
        const insert = this.db.prepare('INSERT OR IGNORE INTO ignores (show_id, created_at) VALUES (?, ?)');
        this.db.transaction(() => rows.forEach((r) => insert.run(r.show_id, Date.now())))();
      } catch {
        // no ignores table – nothing to migrate
      }
    }
    this.db.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('migrated_v1', 'true')").run();
  }

  customShows(): Show[] {
    return CUSTOM_SHOWS;
  }

  ignores(): Set<number> {
    const rows = this.db.prepare('SELECT show_id FROM ignores').all() as { show_id: number }[];
    return new Set(rows.map((r) => r.show_id));
  }

  setIgnored(showId: number, ignored: boolean) {
    if (ignored) {
      this.db.prepare('INSERT OR IGNORE INTO ignores (show_id, created_at) VALUES (?, ?)').run(showId, Date.now());
    } else {
      this.db.prepare('DELETE FROM ignores WHERE show_id = ?').run(showId);
    }
  }

  aliases(): LearnedAlias[] {
    return (
      this.db.prepare('SELECT phrase, show_id, created_at FROM aliases ORDER BY created_at DESC').all() as {
        phrase: string; show_id: number; created_at: number;
      }[]
    ).map((r) => ({ phrase: r.phrase, showId: r.show_id, createdAt: r.created_at }));
  }

  teach(phrase: string, showId: number) {
    this.db
      .prepare('INSERT OR REPLACE INTO aliases (phrase, show_id, created_at) VALUES (?, ?, ?)')
      .run(phrase, showId, Date.now());
    this.db.prepare('DELETE FROM dismissed WHERE phrase = ?').run(phrase);
  }

  forget(phrase: string) {
    this.db.prepare('DELETE FROM aliases WHERE phrase = ?').run(phrase);
  }

  dismissed(): Set<string> {
    const rows = this.db.prepare('SELECT phrase FROM dismissed').all() as { phrase: string }[];
    return new Set(rows.map((r) => r.phrase));
  }

  dismiss(phrase: string) {
    this.db.prepare('INSERT OR IGNORE INTO dismissed (phrase, created_at) VALUES (?, ?)').run(phrase, Date.now());
    this.forget(phrase);
  }

  settings(): Settings {
    const rows = this.db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[];
    const stored = Object.fromEntries(rows.map((r) => [r.key, JSON.parse(r.value)])) as Record<string, any>;
    const out: Settings = { ...DEFAULT_SETTINGS, channels: [...DEFAULT_SETTINGS.channels] };
    if (typeof stored.onePerViewer === 'boolean') out.onePerViewer = stored.onePerViewer;
    if (stored.tunnelProvider === 'cloudflare' || stored.tunnelProvider === 'ngrok') out.tunnelProvider = stored.tunnelProvider;
    if (typeof stored.ngrokToken === 'string') out.ngrokToken = stored.ngrokToken.trim();
    if (typeof stored.tunnelAutoStart === 'boolean') out.tunnelAutoStart = stored.tunnelAutoStart;
    if (stored.pollFilters && Array.isArray(stored.pollFilters.formats) && Array.isArray(stored.pollFilters.release)) {
      out.pollFilters = cleanFilters(stored.pollFilters);
    }
    if (typeof stored.glass === 'boolean') out.glass = stored.glass;
    if (typeof stored.pollTitle === 'string' && stored.pollTitle.trim()) out.pollTitle = stored.pollTitle.trim().slice(0, 60);
    if (['classic', 'vector', 'hybrid', 'hybrid-llm', 'precise-hybrid-llm', 'precise-llm'].includes(stored.matcherStrategy)) out.matcherStrategy = stored.matcherStrategy;
    if (['minilm', 'e5'].includes(stored.embedModel)) out.embedModel = stored.embedModel;
    if (['auto', 'qwen-1.5b', 'qwen-3b', 'qwen-7b'].includes(stored.llmModel)) out.llmModel = stored.llmModel;
    if (Array.isArray(stored.channels)) {
      out.channels = stored.channels;
    } else if ('twitchChannel' in stored || 'youtubeChannelId' in stored || 'rumbleUrl' in stored) {
      // one-channel-per-platform settings from before → a channel list
      out.channels = [];
      const add = (platform: ChatPlatform, target: unknown, enabled: unknown) => {
        if (typeof target === 'string' && target.trim()) {
          out.channels.push({ id: newId(), platform, target: target.trim(), label: '', enabled: enabled !== false, createdAt: Date.now() });
        }
      };
      add('twitch', stored.twitchChannel, stored.twitchEnabled);
      add('youtube', stored.youtubeChannelId, stored.youtubeEnabled);
      add('rumble', stored.rumbleUrl, stored.rumbleEnabled);
    }
    return out;
  }

  setSettings(patch: Partial<Settings>): Settings {
    const stmt = this.db.prepare('INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)');
    this.db.transaction(() => {
      for (const [k, v] of Object.entries(patch)) {
        if (!(k in DEFAULT_SETTINGS) || v === undefined) continue;
        const clean = k === 'channels' ? cleanChannels(v as ChannelConfig[]) : k === 'pollFilters' ? cleanFilters(v as PollFilters) : v;
        stmt.run(k, JSON.stringify(clean));
      }
    })();
    return this.settings();
  }
}
