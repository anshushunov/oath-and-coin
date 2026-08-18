import { toPosixPath } from '../paths.ts';

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
 */
export function resolveContentRoot(manifest: ScenarioManifest): string {
  if (manifest.contentRoot !== null) {
    return toPosixPath(manifest.contentRoot);
  }

  if (manifest.fault === null) {
    return 'content';
  }

  if (manifest.fault.kind === 'missing_content_root') {
    // Nothing is created: the fault *is* the absence. The path sits under `artifacts/`,
    // which is git-ignored, so a tree that somehow grew it would still not have it
    // committed.
    return `artifacts/oracle-faults/${toPosixPath(manifest.fault.path)}`;
  }

  throw new Error(
    `Scenario fault kind '${manifest.fault.kind}' has no reproduction here. Add one — a runner ` +
      'that skips the fault it was told to reproduce runs the wrong scenario and reports success.'
  );
}
