import {
  Actions,
  type CausalTrace,
  type ContentId,
  type DomainEvent,
  type GameState,
  type TraceFactor
} from '@oath-and-coin/simulation';
import type { DecidedOutcome, DecidedStep } from '@oath-and-coin/presentation';

/**
 * The answered steps of a campaign, rebuilt from the campaign itself.
 *
 * A save carries a `GameState` and nothing else — that is the whole point of `ADR-007`'s
 * event log and of storing traces in state rather than beside a command's return value.
 * What it deliberately does not carry is the `StepOutcome` list a live run produced: that
 * list describes a process, and a process is not resumable. So a session reopened from a
 * save has to answer "who answered what, and why" out of history and traces, which is
 * exactly the pair `withEvent` keeps consistent.
 *
 * Rejected steps are absent and cannot be otherwise: a refused command produces no event
 * (`CommandResult.rejected` returns the state it was handed, with no events and no
 * decision), so nothing about it is in the campaign to rebuild. That is a real difference
 * from a live run's step list, and it is why {@link import('@oath-and-coin/presentation').contractOfferScreenModel}
 * takes the focused contract as an argument: after a reload, "the contract the first step
 * named" is a question about a different first step.
 */
export function restoreDecidedSteps(state: GameState): readonly DecidedStep[] {
  return state.history.map((event) => {
    const decision = restoreOutcome(state, event);

    return {
      command: { contract: event.contractId },
      heroDefinition: heroDefinitionOf(state, event),
      decisions: decision === null ? [] : [decision]
    };
  });
}

function heroDefinitionOf(state: GameState, event: DomainEvent): ContentId {
  if (event.kind === 'offer_revised') {
    throw new Error(
      `Event ${String(event.eventId)} ('offer_revised') names no hero — composing an offer is the ` +
        "player's own choice, not a decision a hero made. restoreDecidedSteps does not yet " +
        'describe a step with no hero behind it; DecidedStep.heroDefinition growing a null case ' +
        'is presentation-layer work this command does not do.'
    );
  }

  const hero = state.heroes.get(event.heroId);

  if (hero === undefined) {
    throw new Error(
      `Event ${String(event.eventId)} records an answer by hero#${String(event.heroId)}, but the ` +
        'campaign it was restored from has no such hero — a corrupt save, not a decision by ' +
        'nobody.'
    );
  }

  return hero.definition;
}

/**
 * The decision behind one event, or `null` for an event that explains itself.
 *
 * `causalTraceId` is nullable on every event because a tick is not a decision; today both
 * members of the union carry one, and a step with no decision is filtered out by the
 * screen factory rather than guessed at here.
 */
function restoreOutcome(state: GameState, event: DomainEvent): DecidedOutcome | null {
  if (event.causalTraceId === null) {
    return null;
  }

  const trace = state.traces.get(event.causalTraceId);

  if (trace === undefined) {
    throw new Error(
      `Event ${String(event.eventId)} references causalTraceId ${String(event.causalTraceId)}, ` +
        'but the campaign it was restored from stores no trace under that id — a corrupt save, ' +
        'not an unexplained decision.'
    );
  }

  return {
    selectedAction: actionOf(event),
    selectedScore: restoreScore(trace),
    trace
  };
}

/**
 * The score the decision was taken on, recomputed from the factors it was written down
 * as.
 *
 * Neither the event nor the trace carries the number, and the trace is the arithmetic
 * itself: every term that contributed is in one of the two lists, with the magnitude the
 * score used, so their difference *is* the score. That the two paths agree is not assumed
 * here — it is asserted in the engine's own suite over hand-built contexts and again in
 * `packages/content` over the whole space the loader admits.
 *
 * A blocked decision has no score, and it must not be given one. The lists of a blocked
 * trace are both empty, so summing unconditionally would answer `0` — the one placeholder
 * `TDD` §8 singles out as the worst possible, because under "accept at score ≥ 0" it
 * reads as consent, and `createDecisionResult` refuses to build that shape at all.
 */
function restoreScore(trace: CausalTrace): number | null {
  if (trace.blockedBy.length > 0) {
    return null;
  }

  return total(trace.positiveFactors) - total(trace.negativeFactors);
}

function total(factors: readonly TraceFactor[]): number {
  return factors.reduce((sum, factor) => sum + factor.magnitude, 0);
}

/**
 * Which action the hero chose, read off the event's own discriminant rather than inferred
 * from the score. The event is what the campaign recorded happening; a sign test on a
 * recomputed number would be this layer deciding the rule again.
 */
function actionOf(event: DomainEvent): ContentId {
  switch (event.kind) {
    case 'hero_accepted_contract':
      return Actions.Accept;
    case 'hero_declined_contract':
      return Actions.Decline;
    case 'offer_revised':
      throw new Error(
        `actionOf was given an 'offer_revised' event (${String(event.eventId)}); its causalTraceId ` +
          'is always null, so restoreOutcome returns before this function is ever called on one.'
      );
    default:
      return event satisfies never;
  }
}
