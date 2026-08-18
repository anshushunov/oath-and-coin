import { artifactHash, loadAndRunScenario, type ScenarioRunResult } from '@oath-and-coin/content';
import {
  LOADING_SCREEN,
  contractOfferScreenModel,
  failedScreen,
  type ContractOfferScreenModel
} from '@oath-and-coin/presentation';

import type { ContentSourcePort } from './ports.ts';

/**
 * The load sequence turned into a screen — `game/app/Main.cs` without Godot.
 *
 * The C# host did this inside `_Ready`: read the scenario, run it, hand the outcome to
 * the screen factory, and show whichever of the five states came out. Everything but
 * the last step already lived in `packages/content` after Task 10; this is where the
 * last step goes, and it is the only place in the workspace where content and
 * presentation meet. That is not a coincidence of layout — `packages/presentation` may
 * not import `packages/content` at all (`ADR-010`), so the layer that joins them has to
 * be a third one.
 */

export interface SessionRequest {
  readonly content: ContentSourcePort;
  readonly scenario: string;
  /** The checkpoint to stop at, or `null` for the manifest's last one. */
  readonly checkpoint: string | null;
  readonly seed: bigint;
}

/**
 * Everything a screen needs, and the three facts a bug report needs beside it.
 *
 * `contentVersion` and `canonicalHash` are `null` exactly when no run produced them —
 * a loading screen has read no content, a failed one produced no artifact. Reported as
 * `null` rather than as an empty string because "this run has no artifact" and "this
 * run has an artifact with no bytes" are different claims, and only one of them is ever
 * true.
 */
export interface SessionState {
  readonly screen: ContractOfferScreenModel;
  readonly contentVersion: string | null;
  readonly canonicalHash: string | null;
  /**
   * The underlying failure message, kept beside the screen and never inside what gets
   * hashed.
   *
   * It can name an absolute path, so it is machine-dependent — the frozen corpus
   * records `read_model` with no `error_detail` for exactly that reason. A session that
   * carried it into the projection would make the read-model hash a property of where
   * the game was installed.
   */
  readonly errorDetail: string | null;
}

/** Runs one scenario to one checkpoint and answers the screen it lands on. */
export function startSession(request: SessionRequest): SessionState {
  const result = loadAndRunScenario({
    scenarios: request.content.scenarios,
    openContentRoot: (path) => request.content.openContentRoot(path),
    scenario: request.scenario,
    checkpoint: request.checkpoint,
    seed: request.seed
  });

  return {
    screen: screenFor(result),
    contentVersion:
      result.kind === 'ran' ? result.outcome.finalState.metadata.contentVersion : null,
    canonicalHash: result.kind === 'ran' ? artifactHash(result.outcome) : null,
    errorDetail: result.kind === 'failed' ? result.errorDetail : null
  };
}

/**
 * The screen a run produces, by the three-way split the load sequence reports.
 *
 * This lived in `tools/scenario-runner/src/parity.ts` until Task 12, and it lived there
 * because there was no application layer yet — not because a parity tool is where the
 * rule belongs. It is one rule with one home now, and parity calls it: a second copy
 * would be a second answer to "which screen does a failed run show", and the corpus
 * would only ever measure one of them.
 *
 * `loading` is the one state no run computes — it is a fact about the scenario's
 * manifest — so it comes from the single stated constant rather than being inferred
 * from an absence of content, which would make it indistinguishable from `Empty`. The
 * corpus tells the two apart: `screen_loading` and `screen_empty` carry the same
 * content and different `read_model.sha256`.
 */
export function screenFor(result: ScenarioRunResult): ContractOfferScreenModel {
  switch (result.kind) {
    case 'loading':
      return LOADING_SCREEN;
    case 'failed':
      return failedScreen(result.errorCode, result.errorDetail);
    case 'ran':
      return contractOfferScreenModel(result.outcome.finalState, result.outcome.steps);
    default:
      return result satisfies never;
  }
}
