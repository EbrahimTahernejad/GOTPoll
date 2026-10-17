// Refresh the bundled seed catalog (assets/shows.db) from AniList.
//
//   pnpm update-shows
//
// Runs under Electron's Node (ELECTRON_RUN_AS_NODE) so it shares the
// better-sqlite3 build with the app. Same safety rules as the in-app updater:
// write to a temp file, validate, then atomically replace.

import Database from 'better-sqlite3';
import { renameSync, rmSync } from 'node:fs';
import path from 'node:path';
import { fetchCatalog } from './anilist.js';
import { CATALOG_SQL, mediaToRow, prepareUpsert, SCHEMA_VERSION, setMeta, type ShowRow } from './schema.js';

const out = path.resolve(process.argv[2] ?? 'assets/shows.db');
const tmp = `${out}.tmp`;
rmSync(tmp, { force: true });

const db = new Database(tmp);
db.exec(CATALOG_SQL);
const upsert = prepareUpsert(db);
const abort = new AbortController();
process.on('SIGINT', () => abort.abort());

let last = 0;
try {
  const p = await fetchCatalog({
    signal: abort.signal,
    onBatch: (media) => upsert(media.map(mediaToRow).filter((r): r is ShowRow => !!r)),
    onProgress: (p) => {
      if (Date.now() - last < 1000 && p.phase === 'fetching') return;
      last = Date.now();
      const wait = p.waitUntil ? ` (rate limited, ${Math.ceil((p.waitUntil - Date.now()) / 1000)}s)` : '';
      process.stdout.write(
        `\r${p.label.padEnd(10)} ${p.partitionsDone}/${p.partitionsTotal} ranges · ${p.fetched} shows · ${p.requests} requests${wait}   `
      );
    },
  });
  const n = (db.prepare('SELECT COUNT(*) AS n FROM shows').get() as { n: number }).n;
  if (n < 1000) throw new Error(`only ${n} shows fetched – refusing to replace the seed`);
  setMeta(db, { schema: SCHEMA_VERSION, source: 'bundled', synced_at: Date.now() });
  db.exec('VACUUM');
  db.close();
  renameSync(tmp, out);
  console.log(`\n✓ ${n} shows written to ${out} (${p.requests} requests)`);
} catch (err) {
  db.close();
  rmSync(tmp, { force: true });
  console.error(`\n✗ ${err instanceof Error ? err.message : err}`);
  process.exit(1);
}
