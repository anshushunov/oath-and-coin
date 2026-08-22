import {
  RNG_ALGORITHM_VERSION,
  canonicalBytes,
  canonicalSha256,
  canonicalize,
  type CanonicalValue,
  type CausalTrace,
  type ContractState,
  type DecisionResult,
  type DomainEvent,
  type GameState,
  type HeldTrait,
  type HeroState,
  type TraceBlock,
  type TraceFactor
} from '@oath-and-coin/simulation';

import type { ScenarioOutcome, StepOutcome } from './scenario-runner.ts';

/**
 * The machine-readable half of a run's output (`AGENTS.md` §11): the seed, the versions,
 * every command, every decision, and the final state with its whole event log and every
 * stored explanation. This is what two runs are compared on — never the human-readable
 * report, which exists to be reworded.
 *
 * "Canonical" is a property, not a label. Object keys reach the output in ordinal order
 * whatever order they were built in, because `canonicalize` sorts them; numbers are
 * written by the RFC 8785 rules and therefore never through a host locale (`TDD` §7.3);
 * the output is compact, so no formatting choice can drift.
 *
 * Two things the C# projection needed and this one does not. It mapped enum-shaped
 * values through explicit switches that *threw* on an unmapped member, so a new event
 * type failed loudly instead of serializing under a name derived from its class — here
 * the discriminant is already the exact string the artifact writes, and a new union
 * member breaks the exhaustive `switch` at compile time. And it wrote `selected_score`
 * only when a score existed, through a conditional assignment; here `undefined` is the
 * absence and `canonicalize` omits it, which is the same rule stated once instead of at
 * every optional key.
 */

/**
 * Shape version of this artifact. A comparison across builds that disagree on the shape
 * is not a determinism failure, and this is what tells them apart.
 *
 * It steps together with the artifact's own shape, not with the rules a run applies:
 * `ADR-013` retired byte parity with the frozen C# corpus as a property the port owes,
 * so a rule change that leaves `describeOutcome`'s fields and their types alone is not a
 * reason to move this number. It still holds at 3 for now — `FULL_TYPESCRIPT_MIGRATION`
 * §7.2 found the RFC 8785 writer and the C# one differing only on inputs no artifact
 * contains — but that is a fact about the artifacts written so far, not a promise about
 * the ones after. What now stands in for the parity evidence this version used to
 * protect is the canonical snapshots committed under `scenarios/`: a rule change that
 * alters the shape or the content of an artifact must update its `.canonical.json`
 * alongside it, and that diff is where the change is reviewed.
 */
export const ARTIFACT_VERSION = 3;

/** The canonical text of a whole run. */
export function toCanonicalJson(outcome: ScenarioOutcome): string {
  return canonicalize(describeOutcome(outcome));
}

/** The canonical bytes of a whole run — UTF-8, which is what the hash covers. */
export function toCanonicalBytes(outcome: ScenarioOutcome): Uint8Array {
  return canonicalBytes(describeOutcome(outcome));
}

/** SHA-256 of {@link toCanonicalBytes}, lowercase hex. */
export function artifactHash(outcome: ScenarioOutcome): string {
  return canonicalSha256(describeOutcome(outcome));
}

/**
 * The canonical rendering of a single stored explanation, on its own rather than
 * embedded in a whole run's artifact — so a test can prove that one field distinguishes
 * two traces without building a scenario run around it. The C# version reached this
 * through `InternalsVisibleTo`; here it is simply exported, because the projection is a
 * pure function of its argument and nothing is protected by hiding it.
 */
export function renderTrace(trace: CausalTrace): string {
  return canonicalize(describeTrace(trace));
}

/** The canonical rendering of a single decision, on its own. See {@link renderTrace}. */
export function renderDecision(decision: DecisionResult): string {
  return canonicalize(describeDecision(decision));
}

function describeOutcome(outcome: ScenarioOutcome): CanonicalValue {
  return {
    artifact_version: ARTIFACT_VERSION,
    rng_algorithm: RNG_ALGORITHM_VERSION,
    seed: outcome.finalState.metadata.campaignSeed,
    ruleset_version: outcome.finalState.metadata.rulesetVersion,
    content_version: outcome.finalState.metadata.contentVersion,
    steps: outcome.steps.map(describeStep),
    final_state: describeState(outcome.finalState)
  };
}

function describeStep(step: StepOutcome): CanonicalValue {
  return {
    command: {
      command_id: step.command.commandId,
      hero_index: step.command.heroIndex,
      contract: step.command.contract,
      expected_state_version: step.command.expectedStateVersion
    },
    applied: step.applied,
    rejection_code: step.rejectionCode,
    hero_definition: step.heroDefinition,
    decisions: step.decisions.map(describeDecision),
    events: step.events.map(describeEvent)
  };
}

/**
 * A decision's projection, with `selected_score` **absent** — not written as `null` —
 * when the decision was blocked. The canonical artifact carries no empty slots: a key
 * present with a null value and a key absent must not become two different-looking ways
 * of saying "no score", or a comparison keyed on key presence would drift from one
 * keyed on value.
 */
function describeDecision(decision: DecisionResult): CanonicalValue {
  return {
    selected_action: decision.selectedAction,
    considered_actions: decision.consideredActions,
    trace_id: decision.trace.traceId,
    selected_score: decision.selectedScore ?? undefined
  };
}

function describeState(state: GameState): CanonicalValue {
  return {
    metadata: {
      save_schema_version: state.metadata.saveSchemaVersion,
      ruleset_version: state.metadata.rulesetVersion,
      content_version: state.metadata.contentVersion,
      campaign_seed: state.metadata.campaignSeed,
      state_version: state.metadata.stateVersion,
      logical_time: state.metadata.logicalTime,
      next_event_id: state.metadata.nextEventId,
      next_trace_id: state.metadata.nextTraceId,
      next_decision_ordinal: state.metadata.nextDecisionOrdinal
    },
    heroes: state.heroes.values().map(describeHero),
    contracts: state.contracts.values().map(describeContract),
    traces: state.traces.values().map(describeTrace),
    history: state.history.map(describeEvent),
    applied_command_ids: state.appliedCommandIds.values(),

    // The rulebook every decision is weighed against was the one part of state the
    // projection did not carry, so two states differing only in what a trait *means* —
    // its tag, whether it is a red line, what it weighs — produced byte-identical
    // artifacts. That is a state a replay cannot reconstruct from its own artifact,
    // which is the one thing an artifact is for. Keyed by trait id, already the map's
    // sort order. Adding it is what stepped the version to 3.
    trait_rules: state.traitRules.values().map(describeTrait)
  };
}

function describeHero(hero: HeroState): CanonicalValue {
  return {
    hero_id: hero.id,
    definition: hero.definition,
    display_name_key: hero.displayNameKey,
    greed: hero.greed,
    caution: hero.caution,
    pride: hero.pride,
    trust_in_guild: hero.trustInGuild,
    traits: hero.traits,
    relationships: Object.fromEntries(hero.relationships.entries())
  };
}

function describeContract(contract: ContractState): CanonicalValue {
  return {
    id: contract.id,
    patron_fee: contract.patronFee,
    risk: contract.risk,
    required_crew: contract.requiredCrew,
    tags: contract.tags.values(),
    status: contract.status,
    responded_by: contract.respondedBy.values(),
    accepted_by: contract.acceptedBy.values()
  };
}

function describeTrait(trait: HeldTrait): CanonicalValue {
  return {
    id: trait.id,
    tag: trait.tag,
    is_principle: trait.isPrinciple,
    weight: trait.weight
  };
}

function describeTrace(trace: CausalTrace): CanonicalValue {
  return {
    trace_id: trace.traceId,
    positive_factors: trace.positiveFactors.map(describeFactor),
    negative_factors: trace.negativeFactors.map(describeFactor),
    blocked_by: trace.blockedBy.map(describeBlock),
    tie_break: trace.tieBreak
  };
}

function describeFactor(factor: TraceFactor): CanonicalValue {
  return {
    reason_code: factor.reasonCode,
    source_entity: factor.sourceEntity,
    magnitude: factor.magnitude
  };
}

function describeBlock(block: TraceBlock): CanonicalValue {
  return {
    reason_code: block.reasonCode,
    source_entity: block.sourceEntity
  };
}

function describeEvent(domainEvent: DomainEvent): CanonicalValue {
  const base = {
    kind: domainEvent.kind,
    event_id: domainEvent.eventId,
    logical_time: domainEvent.logicalTime,
    causal_trace_id: domainEvent.causalTraceId
  };

  switch (domainEvent.kind) {
    case 'hero_accepted_contract':
    case 'hero_declined_contract':
      return { ...base, hero_id: domainEvent.heroId, contract_id: domainEvent.contractId };
  }
}
