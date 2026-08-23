import {
  composeOffer,
  heroId,
  lockOffer,
  pollCrew,
  proposeContractToHero,
  type CommandResult,
  type ContentId,
  type DecisionResult,
  type DomainEvent,
  type GameState
} from '@oath-and-coin/simulation';

import type { ContentSet } from '../content-set.ts';
import { createInitialState } from '../initial-state.ts';

import { ScenarioCommandKind, type ScenarioCommand } from './scenario-commands.ts';

/**
 * The rules this build implements, recorded in every state and artifact. One half of
 * the reproducibility tuple (`TDD` §7.1) — the other halves are the content version and
 * the seed. A constant rather than a parameter because a run cannot choose which rules
 * the binary contains.
 */
export const RULESET_VERSION = 'm1-decision/1';

/**
 * One decision a step produced, with the hero it belongs to when the step's decisions do
 * not all belong to one.
 *
 * `pollCrew` is the only command that produces that shape — six heroes answering inside
 * a single step — and this optional field is how the screen tells them apart
 * (`DecidedOutcome.heroDefinition`, `packages/presentation`). Every other command
 * answers at most one hero, already named by {@link StepOutcome.heroDefinition}, and
 * leaves this `undefined` rather than restating the same fact twice.
 */
export interface StepDecision extends DecisionResult {
  readonly heroDefinition?: ContentId;
}

/** What one scenario step did. */
export interface StepOutcome {
  readonly command: ScenarioCommand;
  readonly applied: boolean;
  readonly rejectionCode: string | null;
  /**
   * The content id of the hero who answered — `null` when no single hero answers this
   * step. Definition rather than runtime id so a report or an artifact stays readable
   * and stable: the index is a property of one campaign's roster, the definition is a
   * property of the content.
   *
   * Three of the four commands leave this `null` by construction. `composeOffer` names
   * a *key* hero rather than a responder, and `lockOffer` names none at all — neither
   * produces a decision this field could belong to. **`pollCrew` leaves it `null` even
   * though its step is full of heroes**, and that is the load-bearing case: the screen
   * resolves a decision's hero as `decision.heroDefinition ?? step.heroDefinition`, so a
   * poll step that also carried a step-level hero would silently relabel every decision
   * that forgot its own onto that one name. `null` here turns that mistake into a throw
   * inside `toResponseLine` instead — a defect review of Task 13 found by name, closed
   * on this side of the boundary because this is the side that builds the step.
   */
  readonly heroDefinition: ContentId | null;
  /**
   * Every decision this step's events explain, in the same order as {@link events} —
   * empty for a rejected step, which explains itself through {@link rejectionCode}
   * instead, and empty for `composeOffer` and `lockOffer`, which are the player's own
   * acts and decide nothing.
   */
  readonly decisions: readonly StepDecision[];
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
 * content and a seed; a run continuing from a save hands this the state a
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
    const result = apply(current, command);

    steps.push({
      command,
      applied: result.applied,
      rejectionCode: result.rejectionCode,
      heroDefinition: respondingHeroOf(current, command),
      decisions: attributeDecisions(current, command, result),
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
 * The one place a scenario step becomes an engine call. A `switch` over the union
 * rather than a lookup table: adding `settleContract` (Task 14) to
 * {@link ScenarioCommand} then fails to compile here, which is where it must be
 * handled, instead of falling through to a default that quietly does nothing.
 */
function apply(state: GameState, command: ScenarioCommand): CommandResult {
  switch (command.kind) {
    case ScenarioCommandKind.ComposeOffer:
      return composeOffer(state, {
        commandId: command.commandId,
        contractId: command.contract,
        keyHero: heroId(command.keyHeroIndex),
        advance: command.advance,
        methodTag: command.methodTag,
        promisedBonus: command.promisedBonus,
        expectedStateVersion: command.expectedStateVersion
      });
    case ScenarioCommandKind.ProposeContractToHero:
      return proposeContractToHero(state, {
        commandId: command.commandId,
        heroId: heroId(command.heroIndex),
        contractId: command.contract,
        expectedStateVersion: command.expectedStateVersion
      });
    case ScenarioCommandKind.LockOffer:
      return lockOffer(state, {
        commandId: command.commandId,
        contractId: command.contract,
        expectedStateVersion: command.expectedStateVersion
      });
    case ScenarioCommandKind.PollCrew:
      return pollCrew(state, {
        commandId: command.commandId,
        contractId: command.contract,
        expectedStateVersion: command.expectedStateVersion
      });
  }
}

/**
 * The single hero a step's decisions belong to, or `null` when there is no such hero —
 * see {@link StepOutcome.heroDefinition} for why `pollCrew` is deliberately in the
 * second group and not the first.
 *
 * Read off the state the command was applied *to*, because that is the roster the
 * index was written against.
 */
function respondingHeroOf(state: GameState, command: ScenarioCommand): ContentId | null {
  if (command.kind !== ScenarioCommandKind.ProposeContractToHero) {
    return null;
  }

  return state.heroes.get(heroId(command.heroIndex))?.definition ?? null;
}

/**
 * Names the hero behind every decision of a poll, and leaves every other command's
 * decisions as the engine returned them.
 *
 * Paired by trace id rather than by position. The engine appends a decision and its
 * event together in one loop, so index `i` of each does line up today — but a
 * positional pairing is exactly the assumption that turns into a silent misattribution
 * the first time either list grows an entry the other does not, and misattribution is
 * the whole failure mode the per-decision hero exists to prevent. `causalTraceId` is a
 * real key: it is minted per decision and written onto the event that decision caused.
 */
function attributeDecisions(
  state: GameState,
  command: ScenarioCommand,
  result: CommandResult
): readonly StepDecision[] {
  if (command.kind !== ScenarioCommandKind.PollCrew) {
    return result.decisions;
  }

  const heroByTrace = new Map<number, ContentId>();
  for (const domainEvent of result.events) {
    if (
      domainEvent.causalTraceId === null ||
      (domainEvent.kind !== 'hero_accepted_contract' &&
        domainEvent.kind !== 'hero_declined_contract')
    ) {
      continue;
    }

    const hero = state.heroes.get(domainEvent.heroId);
    if (hero === undefined) {
      throw new Error(
        `A poll of '${command.contract}' recorded an answer by hero#${String(domainEvent.heroId)}, ` +
          'but the campaign it was polled against has no such hero.'
      );
    }

    heroByTrace.set(domainEvent.causalTraceId, hero.definition);
  }

  return result.decisions.map((decision) => {
    const hero = heroByTrace.get(decision.trace.traceId);

    // Loud rather than `?? undefined`: a decision whose hero cannot be recovered would
    // otherwise fall back to the step's own — which is `null` for a poll — and be
    // reported by the screen as an unnamed response instead of as this defect.
    if (hero === undefined) {
      throw new Error(
        `A poll of '${command.contract}' produced decision with trace ${String(decision.trace.traceId)}, ` +
          'but none of the events it returned was caused by that trace — the decision cannot be ' +
          'attributed to a hero, and a response line with no name is worse than a failed run.'
      );
    }

    return { ...decision, heroDefinition: hero };
  });
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
