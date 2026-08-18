import { requireSourcePath } from '../paths.ts';

import type { ScenarioManifest } from './scenario-manifest.ts';

/**
 * The content root a scenario reads from, decided by the scenario itself.
 *
 * This existed in C# only inside the oracle exporter (`OracleEnvelope.ContentRootFor`),
 * and external review found what that cost the port: `content_root` and `fault` were
 * parsed by the manifest loader and then read by nothing outside tests. So
 * `run --scenario screen_error` — a scenario whose entire purpose is to fail with
 * `CONTENT_ROOT_NOT_FOUND` — loaded the production tree and printed a canonical hash,
 * exit 0. A manifest field nobody reads is worse than an absent one: it looks like the
 * scenario is configured and it is not.
 *
 * The kind is read from the fault, never from the scenario's name. A resolver that
 * recognised `screen_error` by name would agree with a manifest whose fault it had never
 * reproduced — the one thing this comparison exists to rule out.
 *
 * What it answers is a repository-relative path with POSIX separators — the form the
 * frozen corpus records, and the form a caller hands back to a source. Turning that
 * into somewhere a file can be read from is the caller's business and no longer this
 * function's: the browser has no `resolve` and no absolute paths, and the decision the
 * manifest makes is the same either way.
 *
 * **The shape of that path is checked here, and Task 13 is what made it necessary.**
 * `content_root` is a `z.string()` with no further constraint, and the two ways of
 * opening the root it names do not agree on every string one can put there. A
 * filesystem resolves `fixtures/decision_core/../screen_empty` and opens the second
 * directory; a browser source holds a flat set of repository-relative paths and finds
 * no such prefix, so it answers "no content root" and the game shows
 * `CONTENT_ROOT_NOT_FOUND`. One manifest, two runtimes, two outcomes — which is
 * precisely the divergence the `ContentFileSource` port was introduced to rule out,
 * found by external review of Task 13 as the second implementation of that port
 * arrived. The same applies to an absolute root and to an empty one, which a
 * filesystem reads as the repository itself.
 *
 * It is refused rather than canonicalised because a scenario has no reason to
 * navigate: every shipped manifest names its root plainly, and `..` inside authored
 * data is the shape that reads whatever happens to be beside the content. The refusal
 * becomes `SCENARIO_INVALID` — a fact about the scenario file, which is what it is.
 */
export function resolveContentRoot(manifest: ScenarioManifest): string {
  if (manifest.contentRoot !== null) {
    return requireRepositoryRelativeRoot(manifest.contentRoot);
  }

  if (manifest.fault === null) {
    return 'content';
  }

  if (manifest.fault.kind === 'missing_content_root') {
    // Nothing is created: the fault *is* the absence. The path sits under `artifacts/`,
    // which is git-ignored, so a tree that somehow grew it would still not have it
    // committed.
    //
    // The authored half is held to the same shape as `content_root` above: a fault
    // that navigated out of `artifacts/` would name a directory that exists, and the
    // scenario whose whole purpose is to fail would quietly succeed.
    return `artifacts/oracle-faults/${requireRepositoryRelativeRoot(manifest.fault.path)}`;
  }

  throw new Error(
    `Scenario fault kind '${manifest.fault.kind}' has no reproduction here. Add one — a runner ` +
      'that skips the fault it was told to reproduce runs the wrong scenario and reports success.'
  );
}

/**
 * An authored path, as a repository-relative root both runtimes read the same way.
 *
 * `requireSourcePath` is the rule, reused rather than restated: it already refuses an
 * absolute path, a `.` or `..` segment and a NUL byte, and it refuses them for the
 * same reason — two implementations of one port must not disagree about what a path
 * means. The one thing it accepts and a content root may not be is the empty path,
 * which names the source's own root: a filesystem would open the repository and read
 * every JSON file in it as content, and a bundle would answer that it holds nothing.
 */
function requireRepositoryRelativeRoot(authored: string): string {
  const root = requireSourcePath(authored);

  if (root === '') {
    throw new Error(
      `Content root '${authored}' names nothing. A scenario that leaves its root empty is asking ` +
        'to be run against whatever the caller happens to be standing in.'
    );
  }

  return root;
}
