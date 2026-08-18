import type { ContentSourcePort } from '@oath-and-coin/application';
import {
  loadLocaleCatalogue,
  memoryFileSource,
  type ContentFileSource
} from '@oath-and-coin/content';

/**
 * The browser's half of the loader split — the implementation of
 * {@link ContentFileSource} that Task 12 designed the port around and that had never
 * run in a browser until this file existed (`FULL_TYPESCRIPT_MIGRATION` §13.5).
 *
 * `packages/content` stopped knowing about directories so that the shipped tree could
 * be read by the same loader on both runtimes; `@oath-and-coin/content/node` answers
 * "where do the bytes come from" with a filesystem, and this answers it with the
 * bundle. There is one loader, one digest and one set of diagnostics behind both —
 * which is the whole point of having rejected a build-time content snapshot (§12.2):
 * a snapshot would have made `content_version` a property of the serializer, and
 * nothing would have forced the two ways of obtaining a `ContentSet` to agree.
 *
 * What that leaves to prove here is that the bundle and the disk hold the *same*
 * bytes. `content-source.test.ts` proves it the only way that is not circular: by
 * computing `content_version` over this source and comparing it with the value the
 * frozen corpus recorded for all 54 entries, rather than with whatever another
 * source in the same process answers.
 */

/**
 * Everything the load sequence can read, as a repository-relative POSIX path to its
 * UTF-8 text.
 *
 * Two roots and one exclusion, and each of the three is a decision:
 *
 * - `content/**` is the shipped tree — the thing `content_version` is computed over;
 * - `scenarios/**` is what a run is: a manifest, a command list, and for some
 *   scenarios a fixture content root the manifest names (`scenarios/fixtures/...`).
 *   Globbed whole rather than as "manifests plus command lists plus fixtures",
 *   because which files a manifest decides to name is the manifest's business —
 *   a narrower pattern would turn a new scenario layout into a missing file in the
 *   browser and nowhere else;
 * - `*.canonical.json` is excluded because it is the oracle's recorded *output*, read
 *   by the parity tool and by nothing the game runs. It is also 137 KB of the 154 KB
 *   under `scenarios/`, so shipping it would nearly double the bundle to carry
 *   answers the browser never asks for.
 *
 * `exhaustive: true` is not a detail. Without it the glob skips dotfiles, and
 * `scenarios/fixtures/screen_empty` keeps two `.gitkeep` files that hold its empty
 * `contracts/` and `traits/` directories in git. They are part of that root, so they
 * are part of its digest: the corpus records `914b935df2b48720` as the content
 * version of `screen_empty`, and a source that quietly dropped them would answer
 * something else — on one scenario, in the browser only.
 */
const bundledFiles: Readonly<Record<string, unknown>> = import.meta.glob(
  ['../../../content/**/*', '../../../scenarios/**/*', '!../../../scenarios/**/*.canonical.json'],
  { query: '?raw', import: 'default', eager: true, exhaustive: true }
);

/**
 * What Vite prefixes every key of the glob above with.
 *
 * The patterns are relative to this module, so the keys come back relative to it as
 * well — `../../../content/heroes/bram.json`. A path that reaches
 * {@link memoryFileSource} still carrying that prefix is refused by
 * `requireSourcePath`, which is the behaviour it was written for; stripping it here
 * is what turns a bundler's key into the repository-relative path everything else in
 * the workspace speaks.
 */
const GLOB_PREFIX = '../../../';

const repositoryFiles: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(bundledFiles).map(([key, contents]) => [
    repositoryPath(key),
    requireText(key, contents)
  ])
);

/**
 * The locale catalogue's directory inside the content tree, and the extension its
 * files carry.
 *
 * The catalogue is read from `content/locale/`, never from the content root a
 * scenario decided on: `game/app/Main.cs` resolved it that way too, and for the
 * reason its own comment gives — the fixture roots under `scenarios/fixtures/` carry
 * heroes and contracts and no `locale/` directory at all, so a run against one of
 * them would have no text to show.
 */
const LOCALE_DIRECTORY = 'locale';

/** The content tree the game ships, as the corpus names it. */
const SHIPPED_CONTENT_ROOT = 'content';

/** The directory holding every scenario's manifest and command list. */
const SCENARIO_ROOT = 'scenarios';

/**
 * A source over the files the bundle holds under `root`, or `null` when it holds
 * none.
 *
 * `null` rather than a throw because an absent content root is a result the game
 * shows a player rather than an accident: `CONTENT_ROOT_NOT_FOUND` is one of the five
 * stable error codes, and `screen_error` is a shipped scenario whose whole purpose is
 * to reach it by naming `artifacts/oracle-faults/fixtures/does-not-exist` — a path no
 * glob will ever match, which is exactly how the fault reproduces here.
 *
 * Containment is tested against `root` plus a separator, never as a bare prefix:
 * `content-x/` starts with `content` and is not inside it, and a source that treated
 * it as inside would load one tree's heroes into another's campaign.
 */
export function openRepositoryRoot(root: string): ContentFileSource | null {
  const prefix = `${root}/`;
  const held: Record<string, string> = {};
  let count = 0;

  for (const [path, text] of Object.entries(repositoryFiles)) {
    if (!path.startsWith(prefix)) {
      continue;
    }

    held[path.slice(prefix.length)] = text;
    count += 1;
  }

  return count === 0 ? null : memoryFileSource(held);
}

/**
 * What the application layer needs in order to run a scenario in a browser.
 *
 * The same two questions `@oath-and-coin/content/node` answers from a disk, so the
 * session code above this is identical on both runtimes and neither knows which one
 * it is on.
 */
export function browserContentSource(): ContentSourcePort {
  return {
    scenarios: requireRepositoryRoot(SCENARIO_ROOT),
    openContentRoot: (repositoryRelativePath) => openRepositoryRoot(repositoryRelativePath)
  };
}

/**
 * The catalogue for one locale, read out of the bundle through the same loader and
 * the same Zod contract Node reads it through.
 *
 * A missing catalogue throws rather than answering an empty map: every key on the
 * screen would then resolve to nothing, and a screen of blanks is the failure that
 * looks like a layout bug for an afternoon.
 *
 * Answered as a `ReadonlyMap` rather than as the loader's own `SortedMap`, which is
 * what `expectedSnapshot` and the screen both ask for. The sort order is the
 * simulation's device for making a *state* hash independent of insertion order; a
 * catalogue is looked up by key and never hashed, so what it gains from being sorted
 * is nothing and what it costs is a type neither consumer accepts.
 */
export function browserLocaleCatalogue(locale: string): ReadonlyMap<string, string> {
  const catalogue = loadLocaleCatalogue(
    requireRepositoryRoot(SHIPPED_CONTENT_ROOT),
    `${LOCALE_DIRECTORY}/${locale}.json`
  );

  return new Map(catalogue.entries());
}

/**
 * A root the bundle is required to hold.
 *
 * `content` and `scenarios` are not scenario-decided paths — they are what the build
 * put in the bundle. Their absence is a broken build, not a game state, and it is
 * worth a message that says so rather than a `CONTENT_ROOT_NOT_FOUND` screen blaming
 * the scenario.
 */
function requireRepositoryRoot(root: string): ContentFileSource {
  const source = openRepositoryRoot(root);

  if (source === null) {
    throw new Error(
      `The browser bundle holds no files under '${root}'. The glob in content-source.ts is what ` +
        'puts them there, so this is a build defect rather than something a scenario can cause.'
    );
  }

  return source;
}

function repositoryPath(globKey: string): string {
  if (!globKey.startsWith(GLOB_PREFIX)) {
    throw new Error(
      `Glob key '${globKey}' does not start with '${GLOB_PREFIX}', so this module can no longer ` +
        'turn it into a repository-relative path. Either the patterns moved or the file did; ' +
        'both change what the keys look like, and a key handed on unstripped would be refused ' +
        'by the source as an escaping path rather than quietly read from the wrong place.'
    );
  }

  return globKey.slice(GLOB_PREFIX.length);
}

/**
 * The bundled contents of one file, as the text `?raw` promises.
 *
 * Checked rather than asserted, because the promise is the bundler's and not the
 * compiler's: `import.meta.glob` is typed loosely enough that a changed `query` would
 * hand a module object here and typecheck. `memoryFileSource` would then encode
 * `[object Module]` as the file's bytes, `content_version` would move, and the first
 * thing to notice would be a parity run against a corpus recorded years of commits
 * earlier.
 */
function requireText(globKey: string, contents: unknown): string {
  if (typeof contents !== 'string') {
    throw new Error(
      `Glob key '${globKey}' resolved to ${typeof contents} rather than to the text '?raw' ` +
        'promises. The bundle would hold something other than the file, and every hash computed ' +
        'over it would be a hash of that something.'
    );
  }

  return contents;
}
