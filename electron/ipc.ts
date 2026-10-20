import { BrowserWindow, ipcMain, shell } from 'electron';
import { describeChannel, testChannel } from './poll/sources/factory.js';
import { shareInfo, startTunnel, stopTunnel, tunnel } from './sharing.js';
import {
  ai,
  catalog,
  hardware,
  poll,
  prepareAi,
  probe,
  saveCover,
  search,
  searchIn,
  selectCatalog,
  sourceDeps,
  tournament,
  user,
  warmUpRumble,
} from './services.js';

const broadcast = (channel: string, payload: unknown) => {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload);
};

catalog.on('status', (s) => broadcast('catalog:status', s));
catalog.on('changed', (info) => broadcast('catalog:changed', info));
catalog.on('list', (l) => broadcast('catalogs:list', l));
catalog.on('covers', (c) => broadcast('catalogs:covers', c));
poll.on('update', (s) => broadcast('poll:update', s));
tournament.on('update', (s) => broadcast('tournament:update', s));
ai.on('status', (s) => broadcast('ai:status', s));
tunnel.on('status', (s) => broadcast('share:status', s));

// ---- sharing the viewer page
ipcMain.handle('share:info', () => shareInfo());
ipcMain.handle('share:start', () => startTunnel());
ipcMain.handle('share:stop', () => stopTunnel());
ai.on('packs', (p) => broadcast('ai:packs', p));

// ---- local AI (free, offline models)
ipcMain.handle('ai:status', () => ai.status);
ipcMain.handle('ai:packs', () => ai.packs());
ipcMain.handle('ai:hardware', () => hardware());
ipcMain.handle('ai:download', (_, id: string) => {
  // fire and forget – progress arrives via ai:packs; load once it lands
  ai.download(id).then(() => prepareAi()).catch(() => {});
});
ipcMain.handle('ai:pause', (_, id: string) => ai.pause(id));
ipcMain.handle('ai:cancel', (_, id: string) => ai.cancel(id));
ipcMain.handle('ai:remove', (_, id: string) => ai.remove(id));
ipcMain.handle('ai:prepare', () => prepareAi());

// ---- catalog
ipcMain.handle('catalog:info', () => catalog.info());
ipcMain.handle('catalog:shows', () => catalog.all());
ipcMain.handle('catalog:status', () => catalog.status);
ipcMain.handle('catalog:update', () => {
  // fire and forget – progress arrives via catalog:status events
  void catalog.update();
});
ipcMain.handle('catalog:cancel', () => catalog.cancel());
ipcMain.handle('catalog:revert', () => catalog.revert());
ipcMain.handle('catalog:search', (_, query: string, limit?: number) => search(query, limit));
ipcMain.handle('catalog:probe', (_, message: string) => probe(message));

// ---- every catalog
ipcMain.handle('catalogs:list', () => catalog.list());
ipcMain.handle('catalogs:select', (_, id: string) => selectCatalog(id));
ipcMain.handle('catalogs:update', (_, id: string) => {
  // fire and forget – progress arrives via catalogs:list
  void catalog.update(id).catch(() => {});
});
ipcMain.handle('catalogs:cancel', (_, id: string) => catalog.cancel(id));
ipcMain.handle('catalogs:revert', (_, id: string) => catalog.revert(id));
ipcMain.handle('catalogs:create', (_, name: string) => catalog.create(name));
ipcMain.handle('catalogs:rename', (_, id: string, name: string) => catalog.custom(id).rename(name));
ipcMain.handle('catalogs:remove', (_, id: string) => {
  if (catalog.selectedId() === id && (poll.isRunning || tournament.snapshot().tournament)) {
    throw new Error('It’s in use by a running poll or tournament');
  }
  catalog.remove(id);
});
ipcMain.handle('catalogs:labels', (_, id: string) => catalog.custom(id).labels());
ipcMain.handle('catalogs:setLabels', (_, id: string, labels: Partial<Record<ShowFormat, string>>) => catalog.custom(id).setLabels(labels));
ipcMain.handle('catalogs:entries', (_, id: string) => catalog.showsOf(id));
ipcMain.handle('catalogs:addEntry', (_, id: string, e: CustomEntryInput) => catalog.custom(id).add(e));
ipcMain.handle('catalogs:updateEntry', (_, id: string, showId: number, e: CustomEntryInput) => catalog.custom(id).update(showId, e));
ipcMain.handle('catalogs:removeEntry', (_, id: string, showId: number) => catalog.custom(id).remove(showId));
ipcMain.handle('catalogs:search', (_, id: string, query: string, limit?: number) => searchIn(id, query, limit));
ipcMain.handle('catalogs:saveCover', (_, bytes: ArrayBuffer, type: string) => saveCover(bytes, type));

// ---- poll
// a plain poll can't take the engine away from an open tournament
const notDuringTournament = () => {
  if (tournament.snapshot().tournament) throw new Error('A tournament is open – close it first');
};
ipcMain.handle('poll:start', (_, config: PollConfig) => {
  notDuringTournament();
  return poll.start(config);
});
ipcMain.handle('poll:stop', () => {
  notDuringTournament();
  poll.stop();
});
ipcMain.handle('poll:reset', () => {
  notDuringTournament();
  poll.reset();
});

// ---- tournament
ipcMain.handle('tournament:snapshot', () => tournament.snapshot());
ipcMain.handle('tournament:act', (_, action: TournamentAction) => tournament.act(action));
ipcMain.handle('poll:snapshot', () => poll.snapshot());
ipcMain.handle('poll:assign', (_, phrase: string, showId: number) => poll.assign(phrase, showId));
ipcMain.handle('poll:dismiss', (_, phrase: string) => poll.dismiss(phrase));
ipcMain.handle('poll:phrasesFor', (_, showId: number) => poll.phrasesFor(showId));

// ---- streamer data
ipcMain.handle('ignores:list', () => [...user.ignores()]);
ipcMain.handle('ignores:set', (_, showId: number, ignored: boolean) => poll.setIgnored(showId, ignored));
ipcMain.handle('aliases:list', () => user.aliases());
ipcMain.handle('aliases:remove', (_, phrase: string) => user.forget(phrase));
ipcMain.handle('aliases:dismissed', () => user.dismissedList());
ipcMain.handle('aliases:restore', (_, phrase: string) => poll.undismiss(phrase));
ipcMain.handle('settings:get', () => user.settings());
ipcMain.handle('settings:set', (_, patch: Partial<Settings>) => {
  const next = user.setSettings(patch);
  if ('matcherStrategy' in patch || 'embedModel' in patch || 'llmModel' in patch) void prepareAi();
  // switching provider / token while online: reopen with the new settings
  if (('tunnelProvider' in patch || 'ngrokToken' in patch) && tunnel.running) void startTunnel();
  if ('channels' in patch) {
    poll.applyChannels(); // connect / disconnect live, mid-poll
    warmUpRumble();
  }
  return next;
});
ipcMain.handle('channels:describe', (_, platform: ChatPlatform, input: string) => describeChannel(platform, input));
ipcMain.handle('channels:test', (_, c: Pick<ChannelConfig, 'platform' | 'target'>) => testChannel(c, sourceDeps));

ipcMain.handle('openExternal', (_, url: string) => {
  if (/^https?:\/\//.test(url)) return shell.openExternal(url);
});

export {};
