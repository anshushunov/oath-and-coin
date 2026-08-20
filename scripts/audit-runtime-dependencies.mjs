import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * What this repository ships to a player, named one package at a time.
 *
 * `ADR-010` §123 pins direct versions and freezes the lockfile, and §125 asks for a
 * review of every runtime dependency. Both of those are about the moment a dependency
 * is *added*. Nothing until now looked at the result: which external packages are
 * reachable from the code that ships, whether anybody wrote down why, and what came
 * along behind them. `pnpm verify` does not answer that — a package added to
 * `dependencies` makes every stage of it greener, not redder — and neither does the
 * lockfile, which records versions rather than intent.
 *
 * Three properties, reported independently and every one of them to the end, because a
 * gate that stops at the first disagreement hides how much else is wrong:
 *
 * 1. **Every external runtime dependency is written down here, with a reason, against
 *    the members that may declare it.** The allowlist is the review §125 asks for,
 *    turned into something that fails a build. A dependency that arrives without an
 *    entry is not refused because it is dangerous — it is refused because nobody said
 *    anything about it.
 * 2. **Every one of them is pinned to exactly the version this file records.** The
 *    workspace suite already refuses a range (`tests/architecture/workspace.test.ts`,
 *    "every dependency of every member is pinned to an exact version"); what is new
 *    here is that the number must equal the number beside the reason. A bump therefore
 *    edits the record, which is the point: `4.4.3 -> 5.0.0` with the old sentence still
 *    beside it is a review that did not happen.
 * 3. **Nothing else is reachable.** The transitive closure of those roots is walked and
 *    every package in it must appear below. This is the property the other two cannot
 *    state: one line in one manifest can bring in forty packages, and the manifest diff
 *    shows one line.
 *
 * **`workspace:*` is excluded, deliberately and by name.** The internal packages are
 * not versioned — the range is literally `workspace:*`, so "pinned exactly" is not a
 * question that can be asked of them — and they are this repository's own code, which
 * is reviewed as code rather than as supply chain. Excluding them silently would leave
 * a reader unable to tell a decision from an oversight.
 *
 * **What this does not claim.** It reads manifests, not bundles: a package listed here
 * and imported by nobody still passes, and the bundler's tree-shaking is not modelled.
 * The claim is about what is *permitted* to reach a player's machine, not about what a
 * particular build put there.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The external packages this repository ships, why, and who may declare each one.
 *
 * `members` is not decoration. "zod is allowed" and "zod is allowed in the content
 * layer and in the desktop host" are different statements, and only the second one
 * notices the day the simulation package — the one layer forbidden to depend on
 * anything at all — acquires it.
 */
const ALLOWED_DIRECT = {
  'pixi.js': {
    version: '8.19.0',
    members: ['apps/web'],
    reason:
      'The renderer ADR-010 chose for the browser and the packaged desktop build alike. It is the one graphics dependency; anything else drawing pixels would be a second one.'
  },
  react: {
    version: '19.2.8',
    members: ['apps/web'],
    reason:
      'The UI layer ADR-010 names. Confined to apps/web on purpose: packages/presentation computes read models and knows nothing about a DOM.'
  },
  'react-dom': {
    version: '19.2.8',
    members: ['apps/web'],
    reason: 'React on a browser document. Same member and the same reason as react.'
  },
  zod: {
    version: '4.4.3',
    members: ['apps/desktop', 'packages/content'],
    reason:
      'The content contracts are Zod contracts and the browser validates content with them (.dependency-cruiser.cjs, content-core-imports-only-simulation-and-zod). The desktop host declares it separately because ADR-010 §80 requires every IPC payload to be validated in the main process, and apps/desktop imports no package of ours.'
  }
};

/**
 * Everything the four roots above drag in. Each entry names who brings it, so that a
 * package that stops being brought is noticed as a stale line rather than living here
 * forever.
 *
 * Written from a measurement, not from the registry's own description of itself: the
 * list is what `scripts/audit-runtime-dependencies.mjs` reported the first time it ran
 * over this tree.
 */
const ALLOWED_TRANSITIVE = {
  '@pixi/colord': 'pixi.js — parses the colour notations a tint or a fill can be written in',
  '@types/earcut': 'pixi.js — type declarations only; no code of it can execute',
  '@webgpu/types': 'pixi.js — type declarations only; no code of it can execute',
  '@xmldom/xmldom': 'pixi.js — SVG parsing for vector assets',
  earcut: 'pixi.js — polygon triangulation behind Graphics fills',
  eventemitter3: 'pixi.js — the event emitter its display objects are built on',
  'gifuct-js': 'pixi.js — animated GIF decoding',
  ismobilejs: 'pixi.js — chooses a device profile at startup',
  'js-binary-schema-parser': 'pixi.js > gifuct-js — the binary reader that decoder uses',
  'parse-svg-path': 'pixi.js — SVG path data for Graphics',
  scheduler: 'react-dom — React’s own cooperative scheduler',
  'tiny-lru': 'pixi.js — the cache behind its text and texture lookups'
};

/** An exact version: no caret, no tilde, no range, no tag. */
const EXACT_VERSION = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

/**
 * The workspace members, read from the file pnpm itself reads.
 *
 * A three-line scanner rather than a YAML dependency, and it refuses anything but the
 * shape this repository actually uses — a flat list of exact directories under
 * `packages:`. `tests/architecture/workspace.test.ts` already forbids a glob there, so
 * the shape is enforced; what would be dishonest is to guess at an entry this scanner
 * does not understand and audit a list quietly missing a member.
 */
function readWorkspaceMembers() {
  const lines = readFileSync(join(repoRoot, 'pnpm-workspace.yaml'), 'utf8').split(/\r?\n/u);
  const members = [];
  let inside = false;

  for (const line of lines) {
    if (/^packages:\s*$/u.test(line)) {
      inside = true;
      continue;
    }
    if (!inside) {
      continue;
    }
    if (/^\s*(#.*)?$/u.test(line)) {
      continue;
    }
    // Any other top-level key ends the block.
    if (/^\S/u.test(line)) {
      break;
    }
    const entry = /^\s+-\s+(\S+)\s*$/u.exec(line);
    if (entry === null || entry[1].includes('*')) {
      throw new Error(
        `pnpm-workspace.yaml has an entry this script cannot read: ${JSON.stringify(line)}. ` +
          'The audit refuses rather than auditing a member list it may have misread.'
      );
    }
    members.push(entry[1]);
  }

  if (members.length === 0) {
    throw new Error('pnpm-workspace.yaml declares no members, which cannot be right.');
  }
  return members;
}

/**
 * Where Node would find `name` when asked from `fromDirectory` — the real path, with
 * pnpm's symlink into `.pnpm` followed.
 *
 * Node's own resolver is not used because `require.resolve('<name>/package.json')`
 * fails outright on any package whose `exports` map does not publish its manifest,
 * which several of these do. Walking `node_modules` upward is what the runtime does
 * anyway, and under pnpm the real directory has that package's own dependencies
 * beside it, so the same walk keeps working one level down.
 */
function locateManifest(name, fromDirectory) {
  let directory = fromDirectory;
  for (;;) {
    const candidate = join(directory, 'node_modules', name, 'package.json');
    if (existsSync(candidate)) {
      return realpathSync(candidate);
    }
    const parent = dirname(directory);
    if (parent === directory) {
      return null;
    }
    directory = parent;
  }
}

const members = readWorkspaceMembers();
const failures = [];

/** Every external dependency any member declares as a runtime one. */
const declared = [];

for (const member of members) {
  const directory = join(repoRoot, ...member.split('/'));
  const manifest = readJson(join(directory, 'package.json'));

  // `optionalDependencies` too, and not for symmetry. An SDK or a native runtime that
  // "degrades when absent" arrives in exactly that section, and it is installed and
  // shipped like any other — the workspace suite widened its own checks to all four
  // sections after external review found the same hole there.
  for (const section of ['dependencies', 'optionalDependencies']) {
    for (const [name, range] of Object.entries(manifest[section] ?? {})) {
      if (range.startsWith('workspace:')) {
        continue;
      }
      declared.push({ member, section, name, range, directory });
    }
  }
}

// ---------------------------------------------------------------- property 1

for (const { member, section, name, range } of declared) {
  const entry = ALLOWED_DIRECT[name];
  if (entry === undefined) {
    failures.push(
      `[1] ${member} (${section}) declares ${name}@${range}, which no entry in ` +
        'ALLOWED_DIRECT accounts for. ADR-010 §125 asks for a review of every runtime ' +
        'dependency; the review is the entry.'
    );
    continue;
  }
  if (typeof entry.reason !== 'string' || entry.reason.trim() === '') {
    failures.push(`[1] ${name} is allowed with no reason recorded, which is not a review.`);
  }
  if (!entry.members.includes(member)) {
    failures.push(
      `[1] ${name} is allowed in ${entry.members.join(', ')} and ${member} is not one of them. ` +
        'Widening it is an edit to this file, with a sentence saying why that layer ships it.'
    );
  }
}

// ---------------------------------------------------------------- property 2

for (const { member, section, name, range } of declared) {
  const entry = ALLOWED_DIRECT[name];
  if (entry === undefined) {
    // Already reported above; a second line about a package nobody vouched for adds noise.
    continue;
  }
  if (!EXACT_VERSION.test(range)) {
    failures.push(
      `[2] ${member} (${section}) declares ${name}@${range}, which is a range rather than a ` +
        'version. ADR-010 §123: a caret is "whatever the registry served that day".'
    );
    continue;
  }
  if (range !== entry.version) {
    failures.push(
      `[2] ${member} (${section}) declares ${name}@${range} while this file records ` +
        `${entry.version}. Whichever is right, the reason beside the version was written about ` +
        'the other one.'
    );
  }
}

// ---------------------------------------------------------------- property 3

const closure = new Map();
const queue = declared.map(({ name, directory, member }) => ({
  name,
  from: directory,
  broughtBy: member
}));
const directlyDeclared = new Set(declared.map(({ name }) => name));

while (queue.length > 0) {
  const { name, from, broughtBy } = queue.shift();
  const manifestPath = locateManifest(name, from);

  if (manifestPath === null) {
    failures.push(
      `[3] ${name}, reached via ${broughtBy}, is declared and not installed. Run ` +
        '`pnpm install --frozen-lockfile`; an audit over a half-installed tree says nothing.'
    );
    continue;
  }

  const existing = closure.get(manifestPath);
  if (existing !== undefined) {
    existing.broughtBy.add(broughtBy);
    continue;
  }

  const manifest = readJson(manifestPath);
  closure.set(manifestPath, {
    name,
    version: manifest.version,
    broughtBy: new Set([broughtBy])
  });

  const nextDirectory = dirname(manifestPath);
  for (const section of ['dependencies', 'optionalDependencies']) {
    for (const dependency of Object.keys(manifest[section] ?? {})) {
      queue.push({ name: dependency, from: nextDirectory, broughtBy: `${broughtBy} > ${name}` });
    }
  }
}

for (const { name, version, broughtBy } of closure.values()) {
  // A package a member declares itself was already answered for by property 1, and
  // reporting it twice would mean one mistake could not be told from two.
  if (directlyDeclared.has(name)) {
    continue;
  }
  if (!(name in ALLOWED_TRANSITIVE)) {
    failures.push(
      `[3] ${name}@${version} is in the runtime tree and in no list here. It arrived through ` +
        `${[...broughtBy].sort().join(' | ')} — the diff that let it in named its parent, not it.`
    );
  }
}

for (const name of Object.keys(ALLOWED_TRANSITIVE)) {
  const stillThere = [...closure.values()].some((entry) => entry.name === name);
  if (!stillThere) {
    failures.push(
      `[3] ${name} is listed here and is no longer in the runtime tree. A stale allowlist ` +
        'entry is a permission nobody remembers granting.'
    );
  }
}

// ---------------------------------------------------------------- the evidence

// AGENTS.md §11: the number a reader sees is produced by the run that produced it.
// Written before the verdict, so a failed audit still leaves the tree it walked behind.
const reportDirectory = join(repoRoot, 'artifacts', 'runtime-audit');
mkdirSync(reportDirectory, { recursive: true });
writeFileSync(
  join(reportDirectory, 'report.json'),
  `${JSON.stringify(
    {
      members,
      declared: declared.map(({ member, section, name, range }) => ({
        member,
        section,
        name,
        range
      })),
      closure: [...closure.values()]
        .map(({ name, version, broughtBy }) => ({
          name,
          version,
          broughtBy: [...broughtBy].sort()
        }))
        .sort((a, b) => a.name.localeCompare(b.name)),
      failures
    },
    null,
    2
  )}\n`,
  'utf8'
);

if (failures.length > 0) {
  console.error(`audit-runtime-dependencies found ${failures.length} problem(s):`);
  for (const failure of failures) {
    console.error(`  ${failure}`);
  }
  process.exit(1);
}

console.log(
  `audit-runtime-dependencies: ${String(declared.length)} declared runtime dependencies over ` +
    `${String(members.length)} members reach ${String(closure.size)} packages, all of them ` +
    'accounted for. Report: artifacts/runtime-audit/report.json'
);
