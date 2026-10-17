// Run a script with Electron's Node (ELECTRON_RUN_AS_NODE) – works the same
// in cmd, PowerShell, bash and zsh, unlike `VAR=1 electron …` in package.json.
//   node scripts/electron-node.mjs <args for electron>
import { spawnSync } from 'node:child_process';
import electron from 'electron';

const r = spawnSync(electron, process.argv.slice(2), {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
});
process.exit(r.status ?? 1);
