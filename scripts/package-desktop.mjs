import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Produces the packaged Windows application the Task 4 gate measures.
 *
 * Builds everything first — the renderer and both host entries — then lets
 * electron-builder copy the results into
 * `artifacts/electron-spike/win-unpacked`. Packaging a stale dist is the kind
 * of mistake that produces a green gate for code that is not in the tree.
 *
 * Direct binary invocation for the same reason as `build-workspace.mjs`: a
 * nested pnpm under corepack resolves to the wrong pnpm and stops with a
 * version error that says nothing about packaging.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function run(label, cwd, command, args) {
  console.log(`\n> ${label}`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`${label} failed (exit ${String(result.status)}).`);
    process.exit(result.status ?? 1);
  }
}

run('build every workspace member', repoRoot, process.execPath, [
  join(repoRoot, 'scripts', 'build-workspace.mjs')
]);

const desktop = join(repoRoot, 'apps', 'desktop');

run('package: electron-builder --win --dir', desktop, process.execPath, [
  join(desktop, 'node_modules', 'electron-builder', 'cli.js'),
  '--win',
  '--dir',
  '--config',
  'electron-builder.yml'
]);
