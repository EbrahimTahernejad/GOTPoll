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
  poll: {
    start: (formats) => invoke('poll:start', formats),
    stop: () => invoke('poll:stop'),
    reset: () => invoke('poll:reset'),
    snapshot: () => invoke('poll:snapshot'),
    assign: (phrase, showId) => invoke('poll:assign', phrase, showId),
    dismiss: (phrase) => invoke('poll:dismiss', phrase),
    phrasesFor: (showId) => invoke('poll:phrasesFor', showId),
    onUpdate: (cb) => subscribe('poll:update', cb),
  },
  ignores: {
    list: () => invoke('ignores:list'),
    set: (showId, ignored) => invoke('ignores:set', showId, ignored),
  },
  aliases: {
    list: () => invoke('aliases:list'),
    remove: (phrase) => invoke('aliases:remove', phrase),
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
  channels: {
    describe: (platform, input) => invoke('channels:describe', platform, input),
    test: (channel) => invoke('channels:test', channel),
  },
};

contextBridge.exposeInMainWorld('GOTPoll', api);
