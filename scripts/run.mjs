import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Keep tool caches, IPC sockets, and temporary files inside the repository.
const root = fileURLToPath(new URL('..', import.meta.url));
const temporary = resolve(root, '.tmp');
mkdirSync(temporary, { recursive: true });
const targets = {
  demo: ['--import', 'tsx', 'src/cli.ts'],
  samples: ['--import', 'tsx', 'scripts/generate-samples.ts'],
  typecheck: ['node_modules/typescript/bin/tsc', '--noEmit'],
  test: ['node_modules/vitest/vitest.mjs', 'run'],
};
const [task, ...args] = process.argv.slice(2);
if (!Object.hasOwn(targets, task)) throw new Error('Unknown project command.');
const child = spawnSync(process.execPath, [...targets[task], ...args], {
  cwd: root,
  stdio: 'inherit',
  env: { ...process.env, TMPDIR: temporary, TMP: temporary, TEMP: temporary, TSX_DISABLE_CACHE: '1' },
});
if (child.error) console.error('Could not start the project command.');
process.exitCode = child.status ?? 1;
