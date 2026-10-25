import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';

const invoke = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args);

function subscribe<T>(channel: string, cb: (payload: T) => void) {
  const handler = (_: IpcRendererEvent, payload: T) => cb(payload);
  ipcRenderer.on(channel, handler);
  return () => {
    ipcRenderer.removeListener(channel, handler);
  };
}

const api: Window['GOTPoll'] = {
  setTheme: (theme) => invoke('setTheme', theme),
  setGlass: (on) => invoke('setGlass', on),
  getServerPort: () => invoke('getServerPort'),
  openExternal: (url) => invoke('openExternal', url),
  catalog: {
    info: () => invoke('catalog:info'),
    shows: () => invoke('catalog:shows'),
    status: () => invoke('catalog:status'),
    update: () => invoke('catalog:update'),
    cancel: () => invoke('catalog:cancel'),
    revert: () => invoke('catalog:revert'),
    search: (query, limit) => invoke('catalog:search', query, limit),
    probe: (message) => invoke('catalog:probe', message),
    onStatus: (cb) => subscribe('catalog:status', cb),
    onChanged: (cb) => subscribe('catalog:changed', cb),
  },
  catalogs: {
    list: () => invoke('catalogs:list'),
    select: (id) => invoke('catalogs:select', id),
    update: (id) => invoke('catalogs:update', id),
    cancel: (id) => invoke('catalogs:cancel', id),
    revert: (id) => invoke('catalogs:revert', id),
    create: (name) => invoke('catalogs:create', name),
    rename: (id, name) => invoke('catalogs:rename', id, name),
    remove: (id) => invoke('catalogs:remove', id),
    labels: (id) => invoke('catalogs:labels', id),
    setLabels: (id, labels) => invoke('catalogs:setLabels', id, labels),
    entries: (id) => invoke('catalogs:entries', id),
    addEntry: (id, entry) => invoke('catalogs:addEntry', id, entry),
    override: (showId, o) => invoke('catalogs:override', showId, o),
    split: (showId, on) => invoke('catalogs:split', showId, on),
    updateEntry: (id, showId, entry) => invoke('catalogs:updateEntry', id, showId, entry),
    removeEntry: (id, showId) => invoke('catalogs:removeEntry', id, showId),
    search: (id, query, limit) => invoke('catalogs:search', id, query, limit),
    checkIgdb: (clientId, clientSecret) => invoke('catalogs:checkIgdb', clientId, clientSecret),
    saveCover: (bytes, type) => invoke('catalogs:saveCover', bytes, type),
    onList: (cb) => subscribe('catalogs:list', cb),
    onCovers: (cb) => subscribe('catalogs:covers', cb),
  },
  poll: {
    start: (config) => invoke('poll:start', config),
    stop: () => invoke('poll:stop'),
    reset: () => invoke('poll:reset'),
    snapshot: () => invoke('poll:snapshot'),
    assign: (phrase, showId) => invoke('poll:assign', phrase, showId),
    dismiss: (phrase) => invoke('poll:dismiss', phrase),
    phrasesFor: (showId) => invoke('poll:phrasesFor', showId),
    onUpdate: (cb) => subscribe('poll:update', cb),
  },
  tournament: {
    snapshot: () => invoke('tournament:snapshot'),
    act: (action) => invoke('tournament:act', action),
    onUpdate: (cb) => subscribe('tournament:update', cb),
  },
  ignores: {
    list: () => invoke('ignores:list'),
    set: (showId, ignored) => invoke('ignores:set', showId, ignored),
  },
  aliases: {
    list: () => invoke('aliases:list'),
    remove: (phrase) => invoke('aliases:remove', phrase),
    dismissed: () => invoke('aliases:dismissed'),
    restore: (phrase) => invoke('aliases:restore', phrase),
  },
  settings: {
    get: () => invoke('settings:get'),
    set: (patch) => invoke('settings:set', patch),
  },
  ai: {
    status: () => invoke('ai:status'),
    packs: () => invoke('ai:packs'),
    hardware: () => invoke('ai:hardware'),
    download: (id) => invoke('ai:download', id),
    pause: (id) => invoke('ai:pause', id),
    cancel: (id) => invoke('ai:cancel', id),
    remove: (id) => invoke('ai:remove', id),
    prepare: () => invoke('ai:prepare'),
    onStatus: (cb) => subscribe('ai:status', cb),
    onPacks: (cb) => subscribe('ai:packs', cb),
  },
  share: {
    info: () => invoke('share:info'),
    start: () => invoke('share:start'),
    stop: () => invoke('share:stop'),
    onStatus: (cb) => subscribe('share:status', cb),
  },
  channels: {
    describe: (platform, input) => invoke('channels:describe', platform, input),
    test: (channel) => invoke('channels:test', channel),
  },
};

contextBridge.exposeInMainWorld('GOTPoll', api);
