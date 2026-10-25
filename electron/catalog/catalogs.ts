import { EventEmitter } from 'node:events';
import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import path from 'node:path';
import { CoverResolver } from './covers.js';
import { CustomCatalog, customNumberOf, isCustomId } from './custom.js';
import { GAME_FORMATS, isGameId, makeGamesSource, type IgdbKeys } from './games.js';
import { IMDB_FORMATS, imdbSource, isImdbId } from './imdb.js';
import { CatalogStore, type CatalogInfo, type UpdateStatus } from './store.js';

// Every catalog the app knows, and which one is in use. Everything else
// (polls, matching, search, the AI index, tournaments) talks to this, so it
// always works on the selected catalog:
//
//   anime    AniList – bundled copy, updates in the app
//   screen   Movies & series – IMDb's free datasets, imported in the app
//   games    Video games – Wikidata, Wikipedia, Steam (+ IGDB with the streamer's keys), imported in the app
//   custom-N the streamer's own, built in the app (any number of them)
//
// Several can be in use at once ("anime+screen"): their titles are pooled,
// each keeps its own popularity floor and the poll filters it per catalog.

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
  /** the catalogs in use – one, or several pooled together */
  parts: CatalogPart[];
};

export type CatalogPart = { id: string; name: string; kind: CatalogKind; formats: FormatLabel[]; releases: boolean };

const MIX = '+';
/** one empty list, so the overlay cache sees "no additions" as unchanged */
const NONE: Show[] = [];

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
/** custom-catalog numbers reserved for titles added to the built-in catalogs */
const ADDITIONS_NUMBER: Record<BuiltIn, number> = { anime: 9001, screen: 9002, games: 9003 };

// chat is Latin-script; skip "进击的巨人 第二季" style sequel titles
const LATIN = /^[\p{Script=Latin}\p{N}\p{P}\p{S}\s]+$/u;

/** Titles of later seasons, each pointing at the root of its franchise (stopping at split-off sequels). */
function sequelAliasesOf(shows: Show[]): { title: string; rootId: number }[] {
  const byId = new Map(shows.map((s) => [s.id, s]));
  const out: { title: string; rootId: number }[] = [];
  for (const s of shows) {
    if (s.eligible) continue;
    let cur: Show | undefined = s;
    for (let hops = 0; cur && !cur.eligible && hops < 40; hops++) cur = cur.parentId != null ? byId.get(cur.parentId) : undefined;
    if (!cur?.eligible) continue;
    for (const title of [s.titleRomaji, s.titleEnglish, ...s.synonyms]) {
      if (title && LATIN.test(title)) out.push({ title, rootId: cur.id });
    }
  }
  return out;
}

function cleanOverride(o: ShowOverride): ShowOverride | null {
  const out: ShowOverride = {};
  if (typeof o.title === 'string' && o.title.trim()) out.title = o.title.trim().slice(0, 200);
  if (Array.isArray(o.altTitles)) out.altTitles = [...new Set(o.altTitles.map((a) => String(a).trim()).filter(Boolean))].slice(0, 30);
  if (o.year === null || (typeof o.year === 'number' && o.year > 1800 && o.year < 3000)) out.year = o.year === null ? null : Math.round(o.year);
  if (o.format && ['TV', 'TV_SHORT', 'MOVIE'].includes(o.format)) out.format = o.format;
  if (o.cover === null || typeof o.cover === 'string') out.cover = o.cover?.trim() || null;
  if (o.release === null || (o.release && ['released', 'airing', 'upcoming'].includes(o.release))) out.release = o.release;
  if (o.split) out.split = true;
  return Object.keys(out).length ? out : null;
}

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
  /** titles the streamer added to a built-in catalog (one small file each) */
  private additions = new Map<BuiltIn, CustomCatalog>();
  private overrides: Map<number, ShowOverride> = new Map();
  private overlays = new Map<BuiltIn, { base: Show[]; extra: Show[]; v: number; out: Show[]; sequels: { title: string; rootId: number }[] }>();
  private overrideVersion = 0;
  private mixes = new Map<string, { inputs: Show[][]; out: Show[] }>();
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
      /** the streamer's edits to built-in catalog titles */
      overrides: () => Map<number, ShowOverride>;
      saveOverride: (showId: number, o: ShowOverride | null) => void;
      /** the streamer's own free IGDB (Twitch developer) keys, if they added them */
      igdbKeys?: () => IgdbKeys | null;
    }
  ) {
    super();
    this.anime = new CatalogStore(path.join(userData, 'catalog'), seedPath);
    const dir = path.join(userData, 'catalogs');
    this.screen = new CatalogStore(path.join(dir, 'screen'), null, 5000, imdbSource);
    this.games = new CatalogStore(path.join(dir, 'games'), null, 2000, makeGamesSource(opts.igdbKeys));
    this.customDir = path.join(dir, 'custom');
    mkdirSync(this.customDir, { recursive: true });
    this.covers = new CoverResolver(path.join(dir, 'covers.db'));
  }

  init() {
    this.anime.init();
    this.screen.init();
    this.games.init();
    this.overrides = this.opts.overrides();
    for (const b of BUILT_IN) {
      const file = path.join(this.customDir, `builtin-${b.id}.db`);
      if (existsSync(file)) this.attachAdditions(b.id, new CustomCatalog(file));
    }
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
        if (this.partsOf(this.selectedId()).includes(id)) this.emit('status', s);
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

  /** Pick the catalog(s) in use: "screen", or several as "anime+screen". */
  select(id: string) {
    if (!this.has(id)) throw new Error('Unknown catalog');
    id = this.mixOf(this.partsOf(id));
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
    const ids = this.partsOf(id);
    const parts = ids.map((p) => this.partOf(p));
    if (ids.length === 1) return { ...this.storeOf(id).info(), ...parts[0], parts, popularityFloor: this.floorOf(id) };
    const each = ids.map((p) => this.storeOf(p).info());
    const formats: FormatLabel[] = [];
    for (const f of parts.flatMap((p) => p.formats)) if (!formats.some((x) => x.id === f.id)) formats.push(f);
    return {
      file: each.map((e) => e.file).join(MIX),
      installed: each.every((e) => e.installed),
      hasRelease: each.every((e) => e.hasRelease),
      count: each.reduce((n, e) => n + e.count, 0),
      eligible: each.reduce((n, e) => n + e.eligible, 0),
      syncedAt: Math.min(...each.map((e) => e.syncedAt)),
      source: 'mixed',
      canRevert: false,
      id,
      name: parts.map((p) => p.name).join(' + '),
      // the wording that fits any title ("type a title in chat")
      kind: 'custom',
      formats,
      releases: parts.some((p) => p.releases),
      popularityFloor: this.floorOf(id),
      parts,
    };
  }

  private partOf(id: string): CatalogPart {
    const formats =
      id === 'anime' ? ANIME_FORMATS : id === 'screen' ? IMDB_FORMATS : id === 'games' ? GAME_FORMATS : this.custom(id).formats();
    const releases = isBuiltIn(id) ? true : this.custom(id).all().some((s) => s.release !== null);
    return { id, name: this.nameOf(id), kind: this.kindOf(id), formats, releases };
  }

  /** The chatter guard's popularity floor for a catalog (the lowest of a mix). */
  floorOf(id: string) {
    return Math.min(...this.partsOf(id).map((p) => POPULARITY_FLOOR[this.kindOf(p)]));
  }

  /** The floor for one title – its own catalog's. */
  floorFor(showId: number) {
    return POPULARITY_FLOOR[this.kindOf(this.ownerOf(showId))] ?? 0;
  }

  /** The single catalog a title comes from ('anime', 'screen', 'custom-3', …). */
  ownerOf(showId: number): string {
    return isImdbId(showId) ? 'screen' : isGameId(showId) ? 'games' : isCustomId(showId) ? this.ownerOfCustom(customNumberOf(showId)) : 'anime';
  }

  /** "anime+screen" → ['anime', 'screen'] */
  partsOf(id: string): string[] {
    return id.split(MIX).filter(Boolean);
  }

  /** Several catalog ids as one, in the order the list shows them. */
  mixOf(ids: string[]): string {
    const order = this.list().map((c) => c.id);
    return [...new Set(ids)].sort((a, b) => order.indexOf(a) - order.indexOf(b)).join(MIX);
  }

  sequelAliases(): { title: string; rootId: number }[] {
    return this.sequelsOf(this.selectedId());
  }

  /** Sequel titles pointing at their franchise root (anime), with the streamer's splits applied. */
  sequelsOf(id: string): { title: string; rootId: number }[] {
    if (id.includes(MIX)) return this.partsOf(id).flatMap((p) => this.sequelsOf(p));
    if (id !== 'anime') return [];
    this.showsOf('anime');
    return this.overlays.get('anime')!.sequels;
  }

  get status(): UpdateStatus {
    const stores = this.partsOf(this.selectedId()).map((p) => this.storeOf(p));
    const busy = stores.find((s) => s instanceof CatalogStore && s.status.state !== 'idle') ?? stores[0];
    return busy instanceof CatalogStore ? busy.status : { state: 'idle' };
  }

  /** A title by id from whichever catalog it belongs to (past tournaments, other catalogs). */
  lookup(id: number): Show | undefined {
    const where = this.ownerOf(id);
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
    const parts = this.partsOf(id);
    return parts.length > 0 && new Set(parts).size === parts.length && parts.every((p) => isBuiltIn(p) || this.customs.has(p));
  }

  showsOf(id: string): Show[] {
    if (id.includes(MIX)) {
      // pooled; rebuilt only when one of the catalogs changed
      const inputs = this.partsOf(id).map((p) => this.showsOf(p));
      const cached = this.mixes.get(id);
      if (cached && cached.inputs.every((x, i) => x === inputs[i])) return cached.out;
      const out = inputs.flat();
      this.mixes.set(id, { inputs, out });
      return out;
    }
    if (!isBuiltIn(id)) return this.custom(id).all();
    let base: Show[];
    if (id === 'screen') {
      base = this.screen.all();
      if (!this.patched.has(base)) {
        // a fresh load: put the posters found so far back on
        for (const s of base) s.coverImage ??= this.covers.get(s.id);
        this.patched.add(base);
      }
    } else base = id === 'anime' ? this.anime.all() : this.games.all();
    const handMade = id === 'anime' ? this.opts.animeExtras() : [];
    const added = this.additions.get(id)?.all() ?? NONE;
    return this.overlay(id, base, handMade, added);
  }

  /**
   * A built-in catalog with the streamer's changes on top. Untouched titles
   * stay the very same objects (posters found later land on them).
   */
  private overlay(id: BuiltIn, base: Show[], handMade: Show[], added: Show[]): Show[] {
    const cached = this.overlays.get(id);
    const extra = added; // CustomCatalog keeps one array until it changes
    if (cached && cached.base === base && cached.extra === extra && cached.v === this.overrideVersion) return cached.out;
    const ov = this.overrides;
    const apply = (s: Show): Show => {
      const o = ov.get(s.id);
      if (!o) return s;
      const alts = o.altTitles;
      return {
        ...s,
        titleRomaji: o.title?.trim() || s.titleRomaji,
        titleEnglish: alts ? (alts[0] ?? null) : s.titleEnglish,
        synonyms: alts ? alts.slice(1) : s.synonyms,
        startYear: o.year !== undefined ? o.year : s.startYear,
        format: o.format ?? s.format,
        coverImage: o.cover !== undefined ? o.cover : s.coverImage,
        release: o.release !== undefined ? o.release : s.release,
        eligible: s.eligible || !!o.split,
        split: !!o.split && !s.eligible,
        edited: Object.keys(o).some((k) => k !== 'split'),
      };
    };
    const out = [...base.map(apply), ...handMade.map(apply), ...added.map((s) => ({ ...apply(s), added: true }))];
    this.overlays.set(id, { base, extra, v: this.overrideVersion, out, sequels: id === 'anime' ? sequelAliasesOf(out) : [] });
    return out;
  }

  /** Change a built-in catalog title; null puts it back as the catalog has it. */
  setOverride(showId: number, o: ShowOverride | null) {
    const clean = o ? cleanOverride(o) : null;
    this.opts.saveOverride(showId, clean);
    if (clean) this.overrides.set(showId, clean);
    else this.overrides.delete(showId);
    this.overrideVersion++;
    this.onCatalogChanged(this.ownerOf(showId));
  }

  /** Count a sequel on its own (or back with its franchise), keeping any other edits. */
  setSplit(showId: number, on: boolean) {
    const { split: _, ...rest } = this.overrides.get(showId) ?? {};
    this.setOverride(showId, on ? { ...rest, split: true } : rest);
  }

  /** Where entries of a catalog are added and edited: a custom catalog itself, or a built-in's additions. */
  editable(id: string): CustomCatalog {
    if (id.includes(MIX)) throw new Error('Pick one catalog to add titles to');
    if (!isBuiltIn(id)) return this.custom(id);
    let c = this.additions.get(id);
    if (!c) {
      c = new CustomCatalog(path.join(this.customDir, `builtin-${id}.db`), { number: ADDITIONS_NUMBER[id], name: `${this.nameOf(id)} additions` });
      this.attachAdditions(id, c);
    }
    return c;
  }

  private attachAdditions(id: BuiltIn, c: CustomCatalog) {
    this.additions.set(id, c);
    c.on('changed', () => this.onCatalogChanged(id));
  }

  /** custom-N, or the built-in catalog whose additions use that number */
  private ownerOfCustom(n: number): string {
    const b = BUILT_IN.find((x) => ADDITIONS_NUMBER[x.id] === n);
    return b ? b.id : `custom-${n}`;
  }

  list(): CatalogSummary[] {
    const selected = this.partsOf(this.selectedId());
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
        selected: selected.includes(id),
        status: store instanceof CatalogStore ? store.status : { state: 'idle' },
      };
    };
    return [...BUILT_IN.map((b) => b.id), ...[...this.customs.keys()].sort((a, b) => num(a) - num(b))].map(summary);
  }

  async update(id = this.partsOf(this.selectedId())[0]) {
    const s = this.storeOf(id);
    if (!(s instanceof CatalogStore)) throw new Error('Custom catalogs are edited, not updated');
    await s.update();
  }

  cancel(id = this.partsOf(this.selectedId())[0]) {
    const s = this.storeOf(id);
    if (s instanceof CatalogStore) s.cancel();
  }

  revert(id = this.partsOf(this.selectedId())[0]) {
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
    const parts = this.partsOf(this.selectedId());
    if (parts.includes(id)) this.select(parts.filter((p) => p !== id).join(MIX) || 'anime');
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
    if (this.partsOf(this.selectedId()).includes(id)) this.emit('changed', this.info());
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
