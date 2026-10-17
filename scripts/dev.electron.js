import { TscWatchClient } from 'tsc-watch';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyFile, cp, rm } from 'node:fs/promises';
import { exec } from 'node:child_process';

const cwd = path.resolve(fileURLToPath(import.meta.url), '../..');
let process = null;

const watch = new TscWatchClient();

watch.start('-p', 'electron/tsconfig.json');

watch.on('success', async () => {
  await rm(path.resolve(cwd, 'build/electron/preload.mjs'), { force: true });
  await rm(path.resolve(cwd, 'build/assets/'), {
    force: true,
    recursive: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 1000));
  await copyFile(
    path.resolve(cwd, 'build/electron/preload.js'),
    path.resolve(cwd, 'build/electron/preload.mjs')
  );
  await cp(path.resolve(cwd, 'assets/'), path.resolve(cwd, 'build/assets/'), {
    recursive: true,
  });
  if (process) {
    console.log('Killing process');
    process.kill(2);
  }
  const proc = exec('electron ./build/electron/main.js', { cwd });
  proc.stdout.on('data', (data) => {
    console.log(data);
  });
  proc.stderr.on('data', (data) => {
    console.error(data);
  });
  process = proc;
});
