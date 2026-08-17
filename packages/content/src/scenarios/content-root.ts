import { join, resolve } from 'node:path';

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
 */

export interface ResolvedContentRoot {
  /** Absolute, for the loader. */
  readonly absolute: string;
  /** Repository-relative with POSIX separators — the form the frozen corpus records. */
  readonly recorded: string;
}

export function resolveContentRoot(
  repositoryRoot: string,
  manifest: ScenarioManifest
): ResolvedContentRoot {
  if (manifest.contentRoot !== null) {
    return {
      absolute: resolve(join(repositoryRoot, manifest.contentRoot)),
      recorded: manifest.contentRoot.replace(/\\/gu, '/')
    };
  }

  if (manifest.fault === null) {
    return { absolute: resolve(join(repositoryRoot, 'content')), recorded: 'content' };
  }

  if (manifest.fault.kind === 'missing_content_root') {
    // Nothing is created: the fault *is* the absence. The path sits under `artifacts/`,
    // which is git-ignored, so a tree that somehow grew it would still not have it
    // committed.
    const relative = `artifacts/oracle-faults/${manifest.fault.path.replace(/\\/gu, '/')}`;
    return { absolute: resolve(join(repositoryRoot, relative)), recorded: relative };
  }

  throw new Error(
    `Scenario fault kind '${manifest.fault.kind}' has no reproduction here. Add one — a runner ` +
      'that skips the fault it was told to reproduce runs the wrong scenario and reports success.'
  );
}
