import { SortedMap } from '../collections/sorted-map.ts';
import { cellKey } from '../domain/battle-cell.ts';
import { RETREAT_THRESHOLD_MAX } from '../domain/crew-deployment.ts';
import { SortedSet } from '../collections/sorted-set.ts';
import type { CommitmentState } from '../domain/commitment.ts';
import type { ContentId } from '../ids/content-id.ts';
import { compareHeroIds, type HeroId } from '../ids/hero-id.ts';

import { requireStoredResolutionConsistency } from './contract-resolution.ts';
import {
  ContractStatus,
  OfferPhase,
  type ContractState,
  type OfferState
} from './contract-state.ts';

// Re-exported rather than re-declared: `OfferState` is a field of `ContractState`, so
// its shape lives in `contract-state.ts` beside the type that carries it — the
// alternative, this file and that one each importing the other's type, is the cycle
// `lint:deps`'s `no-circular` rule refuses (found by running into it, not by
// foresight). Every other module still reaches both names through this file, which is
// where `NEGOTIATION_SPEC` §2.1's invariants over that shape live.
export { OfferPhase, type OfferState };

/**
 * Largest number of tags a contract's *effective* tag set may carry once a chosen
 * method tag joins the authored ones (`NEGOTIATION_SPEC` §2.1, §2.4).
 *
 * The same ceiling content states as `MAX_TAGS_PER_CONTRACT`
 * (`packages/content/src/limits.ts`) — one fact, not two numbers that happen to read
 * 6. It is declared here, in the layer that enforces it at runtime
 * ({@link createContractState}), rather than in content, for the reason `TRAIT_SCALE`
 * is declared in `decisions/trait-scale.ts` instead of in content's own `bounds.ts`:
 * `packages/simulation` cannot depend on `packages/content`
 * (`ADR-002`, the `simulation-depends-on-nothing` dependency-cruiser rule), so a
 * constant both layers need has exactly one place it can live — the one neither
 * direction is forbidden from reading. Content imports this constant rather than
 * restating it, the same way `bounds.ts` imports `TRAIT_SCALE` rather than restating
 * it as `TRAIT_MAX`.
 */
export const MAX_TAGS_PER_CONTRACT = 6;

/**
 * The offer every contract starts on (`NEGOTIATION_SPEC` §6.1): version 1, nobody
 * keyed, nothing offered, an empty draft. Whole and complete on its own, so a state
 * built from content never has to assemble the starting shape from a hand-written
 * literal — the one place that number, that phase and those two empty sets are stated
 * is this function.
 */
export function initialOffer(): OfferState {
  return {
    version: 1,
    keyHero: null,
    advance: 0,
    methodTag: null,
    promisedBonus: 0,
    phase: OfferPhase.Draft,
    // Empty, not "every hero": nobody is invited to a package nobody has composed yet
    // (`RESOLUTION_SPEC` §2.5). This is the state the conditional form of the crew-size
    // invariant exists for.
    invited: SortedSet.empty<HeroId>(compareHeroIds),
    respondedBy: SortedSet.empty<HeroId>(compareHeroIds),
    acceptedBy: SortedSet.empty<HeroId>(compareHeroIds),
    commitments: SortedMap.empty<HeroId, CommitmentState>(compareHeroIds),
    // No formation until the crew exists to place (`COMBAT_SPEC` §3.7). `null` rather than
    // an empty placement, because "nobody has been placed" and "everybody was placed
    // nowhere" are different claims and only the first is true here.
    deployment: null
  };
}

/**
 * The tags a hero's decision is actually weighed against: the contract's authored
 * tags, plus the chosen method tag if the current offer has one
 * (`NEGOTIATION_SPEC` §2.4, §4). The method tag joins gates and inclinations exactly
 * like an authored one — no separate code path exists for it, because none should.
 */
export function effectiveTags(contract: ContractState): SortedSet<ContentId> {
  const { methodTag } = contract.offer;
  return methodTag === null ? contract.tags : contract.tags.add(methodTag);
}

/**
 * The one production caller today is the content loader (`initial-state.ts`), which
 * builds every contract of a freshly loaded campaign through here — so every
 * invariant `NEGOTIATION_SPEC` §2.1 states holds for a campaign at the moment it is
 * first assembled from content.
 *
 * **As of `DEC-008` Task 11, it is the door for both engine-side callers that build
 * or rebuild a `ContractState` — `composeOffer` (since Task 10) and
 * `proposeContractToHero`'s post-response contract (since Task 11).** Task 11 also
 * closed the gap that used to sit here: `proposeContractToHero` now refuses anyone
 * but the offer's key hero while `phase = 'draft'`
 * (`RejectionCodes.NotTheKeyHero`, `NEGOTIATION_SPEC` §3.1, §6), so `respondedBy` can
 * no longer gain a hero other than `offer.keyHero` in that phase — the specific
 * violation ("`phase = 'draft'` ⇒ `respondedBy ⊆ {keyHero}`") this build's engine
 * could previously produce is no longer reachable through either engine caller.
 *
 * `snapshot-codec.ts`'s `decodeSnapshot` is **not yet** routed through here —
 * that remains Task 14's, not because a save can still fail this invariant, but
 * because the codec's own wiring (and its error-mapping to `SaveErrorCodes`) is
 * a separate piece of work this task does not do. See `snapshot-codec.ts`'s own
 * comment at that call site.
 *
 * A literal `{ ...contract, offer: revised }` has no invariant to fail on, so until
 * every construction and transition is routed through this door, an invariant a
 * future transition breaks can go unnoticed in memory and survive a save/load round
 * trip too — the round trip is only as strong as what actually calls this function.
 *
 * Returns `contract` itself — this function validates, it does not copy.
 *
 * @throws if `contract` violates any invariant of `NEGOTIATION_SPEC` §2.1. Every
 * message names both values a violated relationship compares: a message with only
 * the one number that happened to be wrong leaves the reader to reconstruct the
 * other half of the comparison from the source.
 */
export function createContractState(contract: ContractState): ContractState {
  const { offer } = contract;

  // version ≥ 1 — `initialOffer` starts every contract on 1 and `composeOffer` only
  // ever adds to it (`NEGOTIATION_SPEC` §2.1, §6.1); a version below that is not a
  // package any command in this protocol could have produced. Checked first and
  // independently of every other field: unlike the checks below, nothing else in
  // this function reads `offer.version` at all, so this is the one invariant that
  // was previously enforced nowhere but the save schema's own `z.int().min(1)`
  // (`snapshot-codec.ts`) — a state built or revised in memory, never round-tripped
  // through a save, had no check on it whatsoever.
  if (offer.version < 1) {
    throw new Error(
      `Contract '${contract.id}' offer has version ${String(offer.version)}, which is below 1; ` +
        'every contract starts on version 1 and a revision only ever adds to it.'
    );
  }

  // acceptedBy ⊆ respondedBy — a hero cannot have accepted a version it never
  // answered.
  for (const acceptedHeroId of offer.acceptedBy.values()) {
    if (!offer.respondedBy.has(acceptedHeroId)) {
      throw new Error(
        `Contract '${contract.id}' offer accepts hero#${String(acceptedHeroId)}, but its ` +
          `respondedBy does not include hero#${String(acceptedHeroId)}; acceptedBy ` +
          `(${String(offer.acceptedBy.size)} hero(es)) must be a subset of respondedBy ` +
          `(${String(offer.respondedBy.size)} hero(es)).`
      );
    }
  }

  // acceptedBy.size ≤ requiredCrew — places are exactly the seats the contract
  // declared, not "however many said yes".
  if (offer.acceptedBy.size > contract.requiredCrew) {
    throw new Error(
      `Contract '${contract.id}' offer has ${String(offer.acceptedBy.size)} accepted hero(es), ` +
        `but the contract has ${String(contract.requiredCrew)} seats (requiredCrew); acceptedBy.size ` +
        'must not exceed the number of seats.'
    );
  }

  // status = 'crewed' ⇔ acceptedBy.size = requiredCrew — both directions, checked
  // before the draft/responder rule below so a contract that is inconsistent about
  // *being crewed* is reported as that, rather than as an unrelated draft violation
  // its own empty defaults happen to also trip.
  const seatsFilled = offer.acceptedBy.size === contract.requiredCrew;
  const isCrewed = contract.status === ContractStatus.Crewed;
  if (isCrewed !== seatsFilled) {
    throw new Error(
      `Contract '${contract.id}' has status '${contract.status}', but its offer has ` +
        `${String(offer.acceptedBy.size)} of ${String(contract.requiredCrew)} seats ` +
        "(requiredCrew) filled; status must be 'crewed' exactly when acceptedBy.size equals " +
        'requiredCrew, in both directions.'
    );
  }

  // phase = 'draft' ⇒ respondedBy ⊆ {keyHero} — in a draft, only the key hero has
  // been asked.
  if (offer.phase === OfferPhase.Draft) {
    for (const respondedHeroId of offer.respondedBy.values()) {
      if (respondedHeroId !== offer.keyHero) {
        throw new Error(
          `Contract '${contract.id}' offer is in phase 'draft', but hero#${String(respondedHeroId)} ` +
            `is in respondedBy while the key hero is ` +
            `${offer.keyHero === null ? 'null' : `hero#${String(offer.keyHero)}`}; a draft may ` +
            'only have been answered by its key hero.'
        );
      }
    }
  }

  // promisedBonus > 0 ⇒ keyHero ≠ null — a promise needs a named recipient.
  if (offer.promisedBonus > 0 && offer.keyHero === null) {
    throw new Error(
      `Contract '${contract.id}' offer promises a bonus of ${String(offer.promisedBonus)}, but ` +
        'keyHero is null; a promise needs someone to promise it to.'
    );
  }

  // 0 ≤ advance ≤ patronFee
  if (offer.advance < 0 || offer.advance > contract.patronFee) {
    throw new Error(
      `Contract '${contract.id}' offer has advance ${String(offer.advance)}, which is outside ` +
        `0..${String(contract.patronFee)} (patronFee); advance must stay within the patron fee.`
    );
  }

  // 0 ≤ promisedBonus ≤ patronFee
  if (offer.promisedBonus < 0 || offer.promisedBonus > contract.patronFee) {
    throw new Error(
      `Contract '${contract.id}' offer promises a bonus of ${String(offer.promisedBonus)}, ` +
        `which is outside 0..${String(contract.patronFee)} (patronFee); promisedBonus must stay ` +
        'within the patron fee.'
    );
  }

  // phase = 'settled' ⇒ status = 'crewed' — a settled offer belongs to a filled crew.
  if (offer.phase === OfferPhase.Settled && contract.status !== ContractStatus.Crewed) {
    throw new Error(
      `Contract '${contract.id}' offer is in phase 'settled', but the contract's status is ` +
        `'${contract.status}', not 'crewed'; a settled offer must belong to a crewed contract.`
    );
  }

  // The chosen method tag must not push the contract's effective tags past the
  // ceiling every contract's tags are already held to.
  const effectiveTagCount = effectiveTags(contract).size;
  if (effectiveTagCount > MAX_TAGS_PER_CONTRACT) {
    throw new Error(
      `Contract '${contract.id}' would carry ${String(effectiveTagCount)} tags once its chosen ` +
        `method tag joins the ${String(contract.tags.size)} already authored, past the ceiling ` +
        `of ${String(MAX_TAGS_PER_CONTRACT)} (MAX_TAGS_PER_CONTRACT); the offer cannot choose a ` +
        "method tag that pushes the contract's effective tags past that ceiling."
    );
  }

  // commitments.keys() === acceptedBy, in both directions (`RESOLUTION_SPEC` §2.4,
  // §2.5). Without the equality, `commitments.get(hero)` returns `undefined` for a hero
  // the crew demonstrably contains, and the resolver would have to invent a state for
  // him — which is exactly the guess recording the commitment at answer time exists to
  // avoid.
  const committed = offer.commitments.keys();
  if (committed.length !== offer.acceptedBy.size) {
    throw new Error(
      `Contract '${contract.id}' offer records ${String(committed.length)} commitment(s) for ` +
        `${String(offer.acceptedBy.size)} acceptance(s); every acceptance carries exactly one ` +
        'commitment state, recorded at the moment the answer was given.'
    );
  }

  for (const heroId of committed) {
    if (!offer.acceptedBy.has(heroId)) {
      throw new Error(
        `Contract '${contract.id}' offer records a commitment for hero#${String(heroId)}, who is ` +
          'not among those who accepted; a commitment is a fact about an acceptance.'
      );
    }
  }

  // The crew this package asks (`RESOLUTION_SPEC` §2.5), conditional on there being a
  // package at all. The condition is not a softening: `initialOffer` builds every
  // contract of a freshly loaded campaign with `keyHero: null`, so the unconditional
  // form would mean a state assembled from content cannot pass its own constructor —
  // measured, not feared, and the reason the spec's first edition was amended.
  if (offer.keyHero === null) {
    if (offer.invited.size > 0) {
      throw new Error(
        `Contract '${contract.id}' offer invites ${String(offer.invited.size)} hero(es) but has ` +
          'no key hero; a package nobody has composed yet has nobody to invite.'
      );
    }
  } else {
    if (offer.invited.size !== contract.requiredCrew) {
      throw new Error(
        `Contract '${contract.id}' offer invites ${String(offer.invited.size)} hero(es), but the ` +
          `contract has ${String(contract.requiredCrew)} seats (requiredCrew); a composed package ` +
          'invites exactly as many heroes as the job has places.'
      );
    }

    if (!offer.invited.has(offer.keyHero)) {
      throw new Error(
        `Contract '${contract.id}' offer is negotiated with hero#${String(offer.keyHero)} as its ` +
          'key hero, but that hero is not among the invited; a package is discussed with somebody ' +
          'it asks.'
      );
    }
  }

  // respondedBy ⊆ invited — an answer from somebody this package never asked is a
  // state no command produces. Distinct from the draft rule further down: that one
  // bounds *when* a non-key hero may answer, this one bounds *who* may answer at all.
  for (const respondedHeroId of offer.respondedBy.values()) {
    if (!offer.invited.has(respondedHeroId)) {
      throw new Error(
        `Contract '${contract.id}' offer records an answer from hero#${String(respondedHeroId)}, ` +
          `who is not among the ${String(offer.invited.size)} invited hero(es); only an invited ` +
          'hero is ever asked.'
      );
    }
  }

  requireDeploymentConsistency(contract);
  requireStoredResolutionConsistency(contract);

  return contract;
}

/**
 * `COMBAT_SPEC` §3.7's two refusals, as invariants of the package rather than as checks
 * inside one command.
 *
 * A formation is only ever built by `placeCrew`, which refuses the same two shapes with
 * named codes — but a save is external data and a hand-built state is a test's, and both
 * reach this door. `cell_taken` and `unplaced_hero` are the codes the command answers with;
 * here they are the reason a state cannot exist.
 */
function requireDeploymentConsistency(contract: ContractState): void {
  const { deployment, acceptedBy } = { ...contract.offer, acceptedBy: contract.offer.acceptedBy };

  if (deployment === null) {
    return;
  }

  // A formation on a contract that never fights (`ADR-014` §1). `placeCrew` refuses it with
  // a named code; this is the same refusal from the side a save arrives on, and without it
  // a decoded campaign can carry a plan nothing will ever read.
  if (contract.battle === null) {
    throw new Error(
      `Contract '${contract.id}' carries a formation and no battle plan; a contract without a ` +
        'plan is settled by the abstract resolver and never sees a board ' +
        '(COMBAT_SPEC §3.7: not_a_battle_contract).'
    );
  }

  const placed = deployment.placement.keys();

  if (placed.length !== acceptedBy.size) {
    throw new Error(
      `Contract '${contract.id}' places ${String(placed.length)} hero(es) of the ` +
        `${String(acceptedBy.size)} who accepted; a formation names every one of them and ` +
        'nobody else (COMBAT_SPEC §3.7: unplaced_hero).'
    );
  }

  for (const heroId of placed) {
    if (!acceptedBy.has(heroId)) {
      throw new Error(
        `Contract '${contract.id}' places hero#${String(heroId)}, who did not accept it; a ` +
          'formation is a fact about the crew that is going (COMBAT_SPEC §3.7).'
      );
    }
  }

  const taken = new Set<string>();

  for (const cell of deployment.placement.values()) {
    const key = cellKey(cell);

    if (taken.has(key)) {
      throw new Error(
        `Contract '${contract.id}' puts two heroes on cell ${key}; a cell holds at most one ` +
          'unit (COMBAT_SPEC §3.1, §3.7: cell_taken).'
      );
    }

    taken.add(key);
  }

  for (const ward of contract.battle?.wards ?? []) {
    if (taken.has(cellKey(ward.cell))) {
      throw new Error(
        `Contract '${contract.id}' puts a hero on cell ${cellKey(ward.cell)}, where the ` +
          `contract's own '${ward.id}' already stands (COMBAT_SPEC §3.7: cell_taken).`
      );
    }
  }

  if (
    !Number.isInteger(deployment.retreatBelowPercent) ||
    deployment.retreatBelowPercent < 0 ||
    deployment.retreatBelowPercent > RETREAT_THRESHOLD_MAX
  ) {
    throw new Error(
      `Contract '${contract.id}' sets a retreat threshold of ` +
        `${String(deployment.retreatBelowPercent)}, outside 0..${String(RETREAT_THRESHOLD_MAX)}; ` +
        'it is a share of the crew (COMBAT_SPEC §7.4).'
    );
  }
}
