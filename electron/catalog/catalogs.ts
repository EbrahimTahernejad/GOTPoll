import { EventEmitter } from 'node:events';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { CoverResolver } from './covers.js';
import { CustomCatalog, customNumberOf, isCustomId } from './custom.js';
import { GAME_FORMATS, gamesSource, isGameId } from './games.js';
import { IMDB_FORMATS, imdbSource, isImdbId } from './imdb.js';
import { CatalogStore, type CatalogInfo, type UpdateStatus } from './store.js';

// Every catalog the app knows, and which one is in use. Everything else
// (polls, matching, search, the AI index, tournaments) talks to this, so it
// always works on the selected catalog:
//
//   anime    AniList – bundled copy, updates in the app
//   screen   Movies & series – IMDb's free datasets, imported in the app
//   games    Video games – Wikidata, imported in the app
//   custom-N the streamer's own, built in the app (any number of them)

export type SelectedCatalogInfo = CatalogInfo & {
  id: string;
  name: string;
  kind: CatalogKind;
  /** the format chips, named the way this catalog names them */
  formats: FormatLabel[];
  /** does it know released / airing / upcoming? */
  releases: boolean;
  /** below this popularity a 1–2 word message counts as chatter (catalog units) */
  popularityFloor: number;
};

// "Obscure", per catalog: AniList users · IMDb votes · Wikipedias · (custom: nothing is)
const POPULARITY_FLOOR: Record<CatalogKind, number> = { anilist: 5000, imdb: 15000, games: 15, custom: 0 };

const ANIME_FORMATS: FormatLabel[] = [
  { id: 'TV', label: 'TV' },
  { id: 'MOVIE', label: 'Movie' },
  { id: 'TV_SHORT', label: 'Short' },
];

type BuiltIn = 'anime' | 'screen' | 'games';
const BUILT_IN: { id: BuiltIn; name: string; kind: CatalogKind }[] = [
  { id: 'anime', name: 'Anime', kind: 'anilist' },
  { id: 'screen', name: 'Movies & series', kind: 'imdb' },
  { id: 'games', name: 'Games', kind: 'games' },
];
const isBuiltIn = (id: string): id is BuiltIn => BUILT_IN.some((b) => b.id === id);

export class Catalogs extends EventEmitter<{
  /** the selected catalog changed (another one picked, updated, edited) */
  changed: [SelectedCatalogInfo];
  /** the selected catalog's update progress */
  status: [UpdateStatus];
  /** any catalog's summary changed */
  list: [CatalogSummary[]];
  /** posters found for some titles */
  covers: [{ id: number; url: string }[]];
}> {
  readonly anime: CatalogStore;
  readonly screen: CatalogStore;
  readonly games: CatalogStore;
  readonly covers: CoverResolver;
  private customs = new Map<string, CustomCatalog>();
  private customDir: string;
  private patched = new WeakSet<Show[]>();

  constructor(
    userData: string,
    seedPath: string,
    private opts: {
      selected: () => string;
      setSelected: (id: string) => void;
      /** hand-made extra shows that belong with the anime catalog */
      animeExtras: () => Show[];
    }
  ) {
    super();
    this.anime = new CatalogStore(path.join(userData, 'catalog'), seedPath);
    const dir = path.join(userData, 'catalogs');
    this.screen = new CatalogStore(path.join(dir, 'screen'), null, 5000, imdbSource);
    this.games = new CatalogStore(path.join(dir, 'games'), null, 2000, gamesSource);
    this.customDir = path.join(dir, 'custom');
    mkdirSync(this.customDir, { recursive: true });
    this.covers = new CoverResolver(path.join(dir, 'covers.db'));
  }

  init() {
    this.anime.init();
    this.screen.init();
    this.games.init();
    for (const f of readdirSync(this.customDir)) {
      if (!/^custom-\d+\.db$/.test(f)) continue;
      try {
        this.attach(new CustomCatalog(path.join(this.customDir, f)));
      } catch {
        // unreadable file – leave it alone
      }
    }
    for (const [id, store] of [
      ['anime', this.anime],
      ['screen', this.screen],
      ['games', this.games],
    ] as const) {
      store.on('changed', () => this.onCatalogChanged(id));
      store.on('status', (s) => {
        if (this.selectedId() === id) this.emit('status', s);
        this.emit('list', this.list());
      });
    }
    this.covers.on('resolved', (batch) => {
      // posters land on the shared show objects, so open polls pick them up
      const byId = new Map(batch.map((b) => [b.id, b.url]));
      for (const s of this.screen.all()) {
        const url = byId.get(s.id);
        if (url) s.coverImage = url;
      }
      this.emit('covers', batch);
    });
  }

  // ------------------------------------------------------------ the selected catalog

  selectedId(): string {
    const id = this.opts.selected();
    return this.has(id) ? id : 'anime';
  }

  select(id: string) {
    if (!this.has(id)) throw new Error('Unknown catalog');
    if (id === this.selectedId()) return;
    this.opts.setSelected(id);
    this.emit('changed', this.info());
    this.emit('list', this.list());
  }

  /** Every show of the selected catalog (eligible = can be voted for). */
  all(): Show[] {
    return this.showsOf(this.selectedId());
  }

  info(): SelectedCatalogInfo {
    const id = this.selectedId();
    const formats =
      id === 'anime' ? ANIME_FORMATS : id === 'screen' ? IMDB_FORMATS : id === 'games' ? GAME_FORMATS : this.custom(id).formats();
    const releases = isBuiltIn(id) ? true : this.custom(id).all().some((s) => s.release !== null);
    return { ...this.storeOf(id).info(), id, name: this.nameOf(id), kind: this.kindOf(id), formats, releases, popularityFloor: this.floorOf(id) };
  }

  /** The chatter guard's popularity floor for a catalog. */
  floorOf(id: string) {
    return POPULARITY_FLOOR[this.kindOf(id)];
  }

  sequelAliases(): { title: string; rootId: number }[] {
    return this.selectedId() === 'anime' ? this.anime.sequelAliases() : [];
  }

  get status(): UpdateStatus {
    const s = this.storeOf(this.selectedId());
    return s instanceof CatalogStore ? s.status : { state: 'idle' };
  }

  /** A title by id from whichever catalog it belongs to (past tournaments, other catalogs). */
  lookup(id: number): Show | undefined {
    const where = isImdbId(id) ? 'screen' : isGameId(id) ? 'games' : isCustomId(id) ? `custom-${customNumberOf(id)}` : 'anime';
    if (!this.has(where)) return undefined;
    return this.showsOf(where).find((s) => s.id === id);
  }

  /** Fetch posters for these titles if they don't have one yet (IMDb). */
  wantCovers(ids: number[]) {
    const need = ids.filter((id) => isImdbId(id) && !this.covers.get(id));
    if (need.length) this.covers.want(need);
  }

  // ------------------------------------------------------------ any catalog

  has(id: string) {
    return isBuiltIn(id) || this.customs.has(id);
  }

  showsOf(id: string): Show[] {
    if (id === 'anime') return [...this.anime.all(), ...this.opts.animeExtras()];
    if (id === 'screen') {
      const list = this.screen.all();
      if (!this.patched.has(list)) {
        // a fresh load: put the posters found so far back on
        for (const s of list) s.coverImage ??= this.covers.get(s.id);
        this.patched.add(list);
      }
      return list;
    }
    if (id === 'games') return this.games.all();
    return this.custom(id).all();
  }

  list(): CatalogSummary[] {
    const selected = this.selectedId();
    const summary = (id: string): CatalogSummary => {
      const store = this.storeOf(id);
      const info = store.info();
      return {
        id,
        name: this.nameOf(id),
        kind: this.kindOf(id),
        installed: info.installed,
        count: info.count,
        eligible: info.eligible,
        syncedAt: info.syncedAt,
        canRevert: info.canRevert,
        selected: id === selected,
        status: store instanceof CatalogStore ? store.status : { state: 'idle' },
      };
    };
    return [...BUILT_IN.map((b) => b.id), ...[...this.customs.keys()].sort((a, b) => num(a) - num(b))].map(summary);
  }

  async update(id = this.selectedId()) {
    const s = this.storeOf(id);
    if (!(s instanceof CatalogStore)) throw new Error('Custom catalogs are edited, not updated');
    await s.update();
  }

  cancel(id = this.selectedId()) {
    const s = this.storeOf(id);
    if (s instanceof CatalogStore) s.cancel();
  }

  revert(id = this.selectedId()) {
    const s = this.storeOf(id);
    return s instanceof CatalogStore ? s.revert() : false;
  }

  /** Cancel every update in flight (app quitting). */
  cancelAll() {
    this.anime.cancel();
    this.screen.cancel();
    this.games.cancel();
  }

  // ------------------------------------------------------------ custom catalogs

  create(name: string): string {
    const next = Math.max(0, ...[...this.customs.values()].map((c) => c.number)) + 1;
    const c = new CustomCatalog(path.join(this.customDir, `custom-${next}.db`), { number: next, name: name.trim().slice(0, 60) || 'Custom catalog' });
    this.attach(c);
    this.emit('list', this.list());
    return c.id;
  }

  custom(id: string): CustomCatalog {
    const c = this.customs.get(id);
    if (!c) throw new Error('Unknown catalog');
    return c;
  }

  remove(id: string) {
    const c = this.custom(id);
    if (this.selectedId() === id) this.select('anime');
    this.customs.delete(id);
    c.close();
    for (const ext of ['', '-wal', '-shm']) rmSync(`${c.file}${ext}`, { force: true });
    this.emit('list', this.list());
  }

  // ------------------------------------------------------------ internals

  private attach(c: CustomCatalog) {
    this.customs.set(c.id, c);
    c.on('changed', () => this.onCatalogChanged(c.id));
  }

  private onCatalogChanged(id: string) {
    if (this.selectedId() === id) this.emit('changed', this.info());
    this.emit('list', this.list());
  }

  private storeOf(id: string): CatalogStore | CustomCatalog {
    return id === 'anime' ? this.anime : id === 'screen' ? this.screen : id === 'games' ? this.games : this.custom(id);
  }

  private nameOf(id: string) {
    return BUILT_IN.find((b) => b.id === id)?.name ?? this.custom(id).name;
  }

  private kindOf(id: string): CatalogKind {
    return BUILT_IN.find((b) => b.id === id)?.kind ?? 'custom';
  }
}

const num = (id: string) => Number(id.split('-')[1]);
