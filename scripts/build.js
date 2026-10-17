// Package the app for one platform.
//
//   pnpm build            current platform
//   pnpm build win        Windows x64 (NSIS installer)
//   pnpm build linux      Linux x64 (AppImage)
//   pnpm build mac        macOS arm64 (DMG, unsigned)
//
// Native modules (SQLite, llama.cpp, ONNX Runtime) are built for the machine
// that runs this, so build each platform on that platform – CI does exactly
// that (.github/workflows/build.yml).

import { execSync } from 'node:child_process';
import fs from 'node:fs';

const TARGETS = {
  win: { flag: '--win --x64', os: 'win32' },
  linux: { flag: '--linux --x64', os: 'linux' },
  mac: { flag: '--mac --arm64', os: 'darwin' },
};
const current = { win32: 'win', linux: 'linux', darwin: 'mac' }[process.platform];
const platform = process.argv[2] ?? current;
const target = TARGETS[platform];
if (!target) {
  console.error(`Unknown platform "${platform}". Use one of: ${Object.keys(TARGETS).join(', ')}`);
  process.exit(1);
}
if (target.os !== process.platform) {
  console.warn(`! Building ${platform} on ${process.platform}: native modules will be for the wrong OS. Build on ${platform} (or use CI).`);
}

const run = (cmd, env = {}) => {
  console.log(`\n> ${cmd}`);
  execSync(cmd, { stdio: 'inherit', env: { ...process.env, ...env } });
};

fs.rmSync('build', { recursive: true, force: true });

run('pnpm exec react-router build');
run('pnpm exec tsc -p electron/tsconfig.json');
fs.renameSync('build/electron/preload.js', 'build/electron/preload.mjs');

fs.cpSync('assets', 'build/assets', { recursive: true });
for (const f of ['pnpm-lock.yaml', 'pnpm-workspace.yaml', 'package.json']) fs.copyFileSync(f, `build/${f}`);
fs.mkdirSync('build/build', { recursive: true });
fs.copyFileSync('public/icon.png', 'build/build/icon.png');
// electron-builder wants a flat node_modules, not pnpm's symlink farm
fs.writeFileSync('build/.npmrc', 'node-linker=hoisted\n');

process.chdir('build');
run('pnpm install --no-frozen-lockfile', {
  // use the prebuilt llama.cpp / ONNX binaries; never compile on a build box
  NODE_LLAMA_CPP_SKIP_DOWNLOAD: 'true',
  ONNXRUNTIME_NODE_INSTALL_CUDA: 'skip',
});
run(`pnpm exec electron-builder ${target.flag} --publish never`);

const out = fs.readdirSync('dist').filter((f) => /\.(exe|AppImage|dmg|deb|zip)$/.test(f));
console.log(`\n✓ ${platform}: ${out.map((f) => `build/dist/${f}`).join(', ')}`);
