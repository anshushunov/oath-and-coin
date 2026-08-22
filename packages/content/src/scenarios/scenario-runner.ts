import {
  heroId,
  proposeContractToHero,
  type ContentId,
  type DecisionResult,
  type DomainEvent,
  type GameState
} from '@oath-and-coin/simulation';

import type { ContentSet } from '../content-set.ts';
import { createInitialState } from '../initial-state.ts';

import type { ScenarioCommand } from './scenario-commands.ts';

/**
 * The rules this build implements, recorded in every state and artifact. One half of
 * the reproducibility tuple (`TDD` §7.1) — the other halves are the content version and
 * the seed. A constant rather than a parameter because a run cannot choose which rules
 * the binary contains.
 */
export const RULESET_VERSION = 'm1-decision/1';

/** What one scenario step did. */
export interface StepOutcome {
  readonly command: ScenarioCommand;
  readonly applied: boolean;
  readonly rejectionCode: string | null;
  /**
   * The content id of the hero who answered — `null` when the step was rejected before
   * any hero was resolved. Definition rather than runtime id so a report or an artifact
   * stays readable and stable: the index is a property of one campaign's roster, the
   * definition is a property of the content.
   */
  readonly heroDefinition: ContentId | null;
  readonly decision: DecisionResult | null;
  readonly events: readonly DomainEvent[];
}

/**
 * The result of a whole run: every step, and the state it ended in.
 *
 * Deliberately without value equality over its collections. Two runs are compared
 * through the determinism artifact, which is an explicit, stable projection — comparing
 * outcome objects instead would make the comparison depend on which fields happen to be
 * on these types today.
 */
export interface ScenarioOutcome {
  readonly finalState: GameState;
  readonly steps: readonly StepOutcome[];
}

/**
 * Applies a command list to a state that already exists — the half of a run that does
 * not care where the state came from. `runScenario` builds that state fresh from
 * content and a seed; a run continuing from a save (Task 16) hands this the state a
 * {@link import('../save/snapshot-codec.ts').decodeSnapshot} produced instead. Neither
 * caller repeats the loop: there is one place a command is applied to a state, and
 * both entry points go through it.
 */
export function applyScenarioCommands(
  state: GameState,
  commands: readonly ScenarioCommand[]
): ScenarioOutcome {
  let current = state;
  const steps: StepOutcome[] = [];

  for (const command of commands) {
    const id = heroId(command.heroIndex);
    const result = proposeContractToHero(current, {
      commandId: command.commandId,
      heroId: id,
      contractId: command.contract,
      expectedStateVersion: command.expectedStateVersion
    });

    steps.push({
      command,
      applied: result.applied,
      rejectionCode: result.rejectionCode,
      heroDefinition: current.heroes.get(id)?.definition ?? null,
      decision: result.decision,
      events: result.events
    });

    // A rejected step returns the state it was given, so this assignment is a no-op for
    // it — the run continues rather than aborting, because "what did the engine refuse
    // and why" is part of what a scenario is for.
    current = result.state;
  }

  return { finalState: current, steps };
}

/**
 * Runs a scenario against content: builds the initial state from the content and the
 * seed, then applies each command in order. A thin wrapper over
 * {@link applyScenarioCommands} — the only thing this adds is where the starting state
 * comes from.
 */
export function runScenario(
  content: ContentSet,
  commands: readonly ScenarioCommand[],
  seed: bigint
): ScenarioOutcome {
  return applyScenarioCommands(createInitialState(content, seed, RULESET_VERSION), commands);
}
