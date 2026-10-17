import { concurrently } from 'concurrently';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const cwd = path.resolve(fileURLToPath(import.meta.url), '../..');

concurrently(
  [
    { command: 'react-router dev', name: 'react-router' },
    { command: 'node ./scripts/dev.electron.js', name: 'electron' },
  ],
  {
    cwd,
  }
);
