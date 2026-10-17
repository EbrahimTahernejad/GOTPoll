import { BrowserWindow, ipcMain, shell } from 'electron';
import { describeChannel, testChannel } from './poll/sources/factory.js';
import { ai, catalog, hardware, poll, prepareAi, probe, search, sourceDeps, user, warmUpRumble } from './services.js';

const broadcast = (channel: string, payload: unknown) => {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload);
};

catalog.on('status', (s) => broadcast('catalog:status', s));
catalog.on('changed', (info) => broadcast('catalog:changed', info));
poll.on('update', (s) => broadcast('poll:update', s));
ai.on('status', (s) => broadcast('ai:status', s));
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
ipcMain.handle('catalog:shows', () => [...catalog.all(), ...user.customShows()]);
ipcMain.handle('catalog:status', () => catalog.status);
ipcMain.handle('catalog:update', () => {
  // fire and forget – progress arrives via catalog:status events
  void catalog.update();
});
ipcMain.handle('catalog:cancel', () => catalog.cancel());
ipcMain.handle('catalog:revert', () => catalog.revert());
ipcMain.handle('catalog:search', (_, query: string, limit?: number) => search(query, limit));
ipcMain.handle('catalog:probe', (_, message: string) => probe(message));

// ---- poll
ipcMain.handle('poll:start', (_, formats: ShowFormat[]) => poll.start(formats));
ipcMain.handle('poll:stop', () => poll.stop());
ipcMain.handle('poll:reset', () => poll.reset());
ipcMain.handle('poll:snapshot', () => poll.snapshot());
ipcMain.handle('poll:assign', (_, phrase: string, showId: number) => poll.assign(phrase, showId));
ipcMain.handle('poll:dismiss', (_, phrase: string) => poll.dismiss(phrase));
ipcMain.handle('poll:phrasesFor', (_, showId: number) => poll.phrasesFor(showId));

// ---- streamer data
ipcMain.handle('ignores:list', () => [...user.ignores()]);
ipcMain.handle('ignores:set', (_, showId: number, ignored: boolean) => poll.setIgnored(showId, ignored));
ipcMain.handle('aliases:list', () => user.aliases());
ipcMain.handle('aliases:remove', (_, phrase: string) => user.forget(phrase));
ipcMain.handle('settings:get', () => user.settings());
ipcMain.handle('settings:set', (_, patch: Partial<Settings>) => {
  const next = user.setSettings(patch);
  if ('matcherStrategy' in patch || 'embedModel' in patch || 'llmModel' in patch) void prepareAi();
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
