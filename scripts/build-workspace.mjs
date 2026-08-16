import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Builds every buildable workspace member.
 *
 * A Node script rather than `pnpm --recursive build`, for the reason the root
 * tsconfig also records: a pnpm spawned from a process corepack already
 * started resolves to corepack's known-good release instead of the pinned
 * packageManager and refuses to run. Local binaries are invoked directly, so
 * this works whether the entry point was `pnpm build` or `corepack pnpm build`.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Each member's own Vite, not a hoisted one — `hoist=false` is the point.
 *
 * The desktop host is two builds, not one: a preload script under
 * `sandbox: true` cannot require a shared chunk, so its entry has to be built
 * on its own (see apps/desktop/vite.shared.ts).
 */
const builds = [
  { member: 'apps/web', args: ['build'] },
  { member: 'apps/desktop', args: ['build', '--config', 'vite.main.config.ts'] },
  { member: 'apps/desktop', args: ['build', '--config', 'vite.preload.config.ts'] }
];

for (const { member, args } of builds) {
  const cwd = join(repoRoot, member);
  const vite = join(cwd, 'node_modules', 'vite', 'bin', 'vite.js');

  console.log(`\n> ${member}: vite ${args.join(' ')}`);
  const result = spawnSync(process.execPath, [vite, ...args], { cwd, stdio: 'inherit' });

  if (result.status !== 0) {
    console.error(`${member} failed to build (exit ${String(result.status)}).`);
    process.exit(result.status ?? 1);
  }
}
