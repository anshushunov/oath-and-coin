import {
  RNG_ALGORITHM_VERSION,
  canonicalBytes,
  canonicalSha256,
  canonicalize,
  type CanonicalValue,
  type CausalTrace,
  type ContractResolution,
  type ContractState,
  type DomainEvent,
  type GameState,
  type HeldTrait,
  type HeroState,
  type OfferState,
  type TraceBlock,
  type TraceFactor
} from '@oath-and-coin/simulation';

import { ScenarioCommandKind, type ScenarioCommand } from './scenario-commands.ts';
import type { ScenarioOutcome, StepDecision, StepOutcome } from './scenario-runner.ts';

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
 * reason to move this number. What now stands in for the parity evidence this version
 * used to protect is the canonical snapshots committed under `scenarios/`: a rule change
 * that alters the shape or the content of an artifact must update its `.canonical.json`
 * alongside it, and that diff is where the change is reviewed.
 *
 * **4, not 3, and bumped once for every shift inside this unreleased slice.**
 * `describeStep`'s `decisions` replaced the singular `decision` in Task 5;
 * `describeContract` nested `respondedBy`/`acceptedBy` under `offer` and added
 * `mood_ordinals` in Task 6; and Task 11a turned `describeStep`'s `command` block into a
 * per-command projection (`command`, and the fields that command actually carries) while
 * `describeDecision` gained the `hero_definition` a poll's decisions need. All are shape
 * changes this number exists to describe, and all landed before this artifact ever
 * shipped. The plan's own final value for this constant is `4`; one bump covering every
 * shift reaches it without an intermediate, momentarily-false `3` sitting in the tree for
 * the tasks between Task 6 and Task 14, which is where the schedule originally placed the
 * move. Task 14 did not bump it again — at that point it was already at the negotiation
 * slice's own target, and an increment there would have moved it for no shape change.
 *
 * **5, moved by the contract-resolution engine's Task 3 (`RESOLUTION_SPEC` §2.8).**
 * `describeHero` gained `capability` and `wounds`, `describeContract` gained `needs` and
 * `resolution`, `describeOffer` gained `invited` and `commitments`, and
 * `describeCommand`'s `compose_offer` branch gained `invited` — every one of them a
 * shape change, and every one describing a field a later task will move. Like
 * `SAVE_SCHEMA_VERSION`, this number moves **again** when the resolution events and the
 * sixth command arrive: they are a second change to this shape, and one number covering
 * both would make an artifact written between them indistinguishable from one written
 * before.
 */
export const ARTIFACT_VERSION = 5;

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
export function renderDecision(decision: StepDecision): string {
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
    command: describeCommand(step.command),
    applied: step.applied,
    rejection_code: step.rejectionCode,
    hero_definition: step.heroDefinition,
    decisions: step.decisions.map(describeDecision),
    events: step.events.map(describeEvent)
  };
}

/**
 * A step's command, written with the same keys the scenario file wrote it with.
 *
 * Mirroring the wire format rather than flattening every command into one shape is what
 * keeps the artifact readable as *what the run was asked to do*: a `poll_crew` step has
 * no hero index, and a projection that wrote one anyway — `null`, or the last hero it
 * happened to see — would be the artifact stating a fact the command never carried.
 * The `switch` is exhaustive, so `settle_contract` (Task 20) could not reach the wire
 * format without a decision about how it is written here too — the decision made:
 * `pay` is the one field it adds over the shared base.
 */
function describeCommand(command: ScenarioCommand): CanonicalValue {
  const base = {
    command: command.kind,
    command_id: command.commandId,
    contract: command.contract,
    expected_state_version: command.expectedStateVersion
  };

  switch (command.kind) {
    case ScenarioCommandKind.ComposeOffer:
      return {
        ...base,
        key_hero_index: command.keyHeroIndex,
        invited_indexes: command.invitedIndexes,
        advance: command.advance,
        // `null`, never elided. Everywhere else in this projection an absent key means
        // "there is no such thing" (`selected_score` on a blocked decision, `key_hero` on
        // an uncomposed offer), and `method_tag` is the one field where the two readings
        // come apart: a package that chose no method is not a package that was never
        // asked. The wire format already refuses to conflate them — `method_tag` is
        // required and nullable, with its own test — and this function promises the same
        // keys the scenario wrote it with.
        method_tag: command.methodTag,
        promised_bonus: command.promisedBonus
      };
    case ScenarioCommandKind.ProposeContractToHero:
      return { ...base, hero_index: command.heroIndex };
    case ScenarioCommandKind.LockOffer:
    case ScenarioCommandKind.PollCrew:
      return base;
    case ScenarioCommandKind.SettleContract:
      return { ...base, pay: command.pay };
  }
}

/**
 * A decision's projection, with `selected_score` **absent** — not written as `null` —
 * when the decision was blocked. The canonical artifact carries no empty slots: a key
 * present with a null value and a key absent must not become two different-looking ways
 * of saying "no score", or a comparison keyed on key presence would drift from one
 * keyed on value.
 *
 * `hero_definition` follows the same rule and for a sharper reason: it is present only
 * on a `pollCrew` decision, because only there does a step hold answers from more than
 * one hero. On every other step the hero is the step's own, written once above — and an
 * artifact that restated it per decision would carry the same fact in two places that
 * could disagree.
 */
function describeDecision(decision: StepDecision): CanonicalValue {
  return {
    selected_action: decision.selectedAction,
    considered_actions: decision.consideredActions,
    trace_id: decision.trace.traceId,
    selected_score: decision.selectedScore ?? undefined,
    hero_definition: decision.heroDefinition
  };
}

export function describeState(state: GameState): CanonicalValue {
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

    // The second field this projection left unwritten while a command already moved
    // it: `settleContract` (Task 14) has paid the patron fee in and the advance out on
    // every settlement since it shipped (`engine.ts`'s own `nextTreasury`), and nothing
    // here described the number that changed. Found the same way `grievance` and
    // `believesGuildPromises` were — external review of this task's own snapshots,
    // after the fact, not by a mechanical guard (`determinism-artifact-key-coverage.test.ts`'s
    // `describeState reads every top-level field of GameState` test, at line 116, is the
    // guard this omission is why it exists).
    treasury: state.treasury,

    // The rulebook every decision is weighed against was the one part of state the
    // projection did not carry, so two states differing only in what a trait *means* —
    // its tag, whether it is a red line, what it weighs — produced byte-identical
    // artifacts. That is a state a replay cannot reconstruct from its own artifact,
    // which is the one thing an artifact is for. Keyed by trait id, already the map's
    // sort order. Adding it is what stepped the version to 3.
    trait_rules: state.traitRules.values().map(describeTrait)
  };
}

/**
 * `grievance` and `believes_guild_promises` were absent here through Task 14, which
 * wired the only command that writes either (`settleContract`'s broken-promise branch,
 * `NEGOTIATION_SPEC` §3.3) without updating the one place a run's whole campaign state
 * is described. Found by Task 20's own Step 4: a `WITNESS_SHARE` mutant broke every
 * grievance a `promise_broken`/`witness_remembers` settlement computes and reddened
 * nothing here, because nothing here was reading either field. `mood_ordinals` on
 * `describeContract` is the nearest precedent for the shape — a campaign fact with no
 * home on `HeroState`'s authored siblings above, appended rather than interleaved.
 */
export function describeHero(hero: HeroState): CanonicalValue {
  return {
    hero_id: hero.id,
    definition: hero.definition,
    display_name_key: hero.displayNameKey,
    greed: hero.greed,
    caution: hero.caution,
    pride: hero.pride,
    trust_in_guild: hero.trustInGuild,
    traits: hero.traits,
    relationships: Object.fromEntries(hero.relationships.entries()),
    grievance: hero.grievance,
    believes_guild_promises: hero.believesGuildPromises,
    // `RESOLUTION_SPEC` §2.2, §2.6. `wounds` is written although nothing moves it yet,
    // and that is the lesson of `grievance` above applied before it costs anything: the
    // command that will move it arrives two tasks from now, and a field this projection
    // does not read is a state change a determinism check cannot see.
    capability: {
      grade: hero.capability.grade,
      expertise: Object.fromEntries(hero.capability.expertise.entries())
    },
    wounds: hero.wounds
  };
}

/**
 * **`negotiableTags` is not written here, and that is a gap this comment names rather
 * than hides.** No command in this build ever mutates it — `composeOffer` chooses a
 * `methodTag` from it but never rewrites the set itself — so its omission is invisible
 * today: nothing in `ContractState.negotiableTags` can move between two states this
 * projection could disagree about. The day a command *does* write it, that state
 * change would replay-diverge silently, because a determinism check compares only what
 * this function describes. Nothing here catches that mechanically; this note is the
 * whole guard, which is the point being flagged, not a claim that it is enforced.
 */
export function describeContract(contract: ContractState): CanonicalValue {
  return {
    id: contract.id,
    patron_fee: contract.patronFee,
    risk: contract.risk,
    required_crew: contract.requiredCrew,
    needs: Object.fromEntries(contract.needs.entries()),
    tags: contract.tags.values(),
    status: contract.status,
    offer: describeOffer(contract.offer),
    // Keyed the same way `describeHero`'s `relationships` already is — a
    // `SortedMap` becomes a canonical object (`NEGOTIATION_SPEC` §2.1.1). Not because
    // the map's own order survives into the artifact: `canonicalize` (`canonical-json.ts`)
    // re-sorts every object's keys by UTF-16 code unit regardless of the order they
    // arrive in, so once Task 11 fills this map, hero#10 will sort ahead of hero#2 in
    // the written bytes even though the map itself orders them the other way. That
    // re-sort is deterministic, so nothing here threatens determinism — it just means
    // this object's insertion order is not the reason the output is reproducible; the
    // canonicalizer's own rule is.
    mood_ordinals: Object.fromEntries(contract.moodOrdinals.entries()),
    // `undefined`, not `null`, for a contract nobody has resolved — `canonicalize` drops
    // an undefined key, which is what every other absent-by-nature field here already
    // does (`key_hero` on an uncomposed offer). The distinction `method_tag` draws does
    // not arise: there is no "resolved to nothing" outcome, only "not resolved yet".
    resolution: describeResolution(contract.resolution)
  };
}

/**
 * The stored outcome (`RESOLUTION_SPEC` §2.5), written whole.
 *
 * Every number the debrief screen shows has to be here, because an artifact that
 * described the *grade* alone would let two runs differing in why they got it compare
 * equal — and "why" is the thing this whole system exists to produce (§9's first
 * criterion).
 */
function describeResolution(resolution: ContractResolution | null): CanonicalValue | undefined {
  if (resolution === null) {
    return undefined;
  }

  return {
    grade: resolution.grade,
    coverage: resolution.coverage.map((entry) => ({
      need: entry.need,
      weight: entry.weight,
      required: entry.required,
      supplied: entry.supplied,
      effective: entry.effective,
      verdict: entry.verdict,
      contributors: entry.contributors.map((contributor) => ({
        hero: contributor.hero,
        amount: contributor.amount
      }))
    })),
    contributions: Object.fromEntries(
      resolution.contributions.entries().map(([hero, contribution]) => [
        String(hero),
        {
          amount: contribution.amount,
          commitment: contribution.commitment,
          provenance: contribution.provenance
        }
      ])
    ),
    deficits: resolution.deficits.map((deficit) => ({
      kind: deficit.kind,
      magnitude: deficit.magnitude,
      needs: deficit.needs,
      heroes: deficit.heroes
    })),
    dominant: resolution.dominant ?? undefined,
    consequences: resolution.consequences.map((consequence) => ({
      hero: consequence.hero,
      kind: consequence.kind,
      reason: consequence.reason,
      magnitude: consequence.magnitude
    }))
  };
}

/**
 * `ContractState.offer`'s own projection, nested exactly where `responded_by`/
 * `accepted_by` used to sit flat on the contract — Task 6 moved the fields into
 * `OfferState`, and this is that move followed into the artifact.
 */
function describeOffer(offer: OfferState): CanonicalValue {
  return {
    version: offer.version,
    key_hero: offer.keyHero ?? undefined,
    advance: offer.advance,
    method_tag: offer.methodTag ?? undefined,
    promised_bonus: offer.promisedBonus,
    phase: offer.phase,
    invited: offer.invited.values(),
    commitments: Object.fromEntries(offer.commitments.entries()),
    responded_by: offer.respondedBy.values(),
    accepted_by: offer.acceptedBy.values()
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
    case 'offer_revised':
    case 'offer_locked':
    case 'contract_settled':
    case 'contract_settled_promise_kept':
    case 'contract_settled_promise_broken':
      return { ...base, contract_id: domainEvent.contractId };
  }
}
