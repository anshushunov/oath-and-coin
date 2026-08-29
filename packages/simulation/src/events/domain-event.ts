import type { DoctrineId } from '../domain/doctrine-id.ts';
import type { NeedId } from '../domain/need-id.ts';
import type {
  ConsequenceKind,
  CoverageVerdict,
  DeficitKind,
  OutcomeGrade
} from '../domain/outcome.ts';
import type { ContentId } from '../ids/content-id.ts';
import type { HeroId } from '../ids/hero-id.ts';

/**
 * Everything that happens in a campaign (`ADR-007`). Every event carries its own
 * place in the log, the campaign's logical time when it happened, and — optionally —
 * the id of a stored explanation. The trace itself does not live on the event: only
 * its id does, so the event stays small and the explanation is looked up from state
 * rather than carried around redundantly.
 */
interface DomainEventBase {
  readonly eventId: number;
  readonly logicalTime: number;
  /** `null` when the event explains itself — a tick, not a decision. */
  readonly causalTraceId: number | null;
}

/** A hero accepted a contract offer. */
export interface HeroAcceptedContract extends DomainEventBase {
  readonly kind: 'hero_accepted_contract';
  readonly heroId: HeroId;
  readonly contractId: ContentId;
}

/**
 * A hero declined a contract offer. Declining does not close the offer for other
 * heroes — see `ContractStatus`.
 */
export interface HeroDeclinedContract extends DomainEventBase {
  readonly kind: 'hero_declined_contract';
  readonly heroId: HeroId;
  readonly contractId: ContentId;
}

/**
 * A player revised a contract's offer package (`composeOffer`, `NEGOTIATION_SPEC`
 * §3.3). `causalTraceId` is always `null`: composing an offer is the player's own
 * choice, not a hero's decision, so there is no explanation to store for it — the
 * same reason a tick event would carry none.
 */
export interface OfferRevised extends DomainEventBase {
  readonly kind: 'offer_revised';
  readonly contractId: ContentId;
}

/**
 * The player locked a contract's current offer (`lockOffer`, `NEGOTIATION_SPEC`
 * §3.3). `causalTraceId` is always `null` for the same reason `OfferRevised`'s is:
 * locking is the player's own act on a package a hero has already answered, not a
 * hero deciding anything new — the acceptance being locked against already has its
 * own trace, recorded when it happened.
 */
export interface OfferLocked extends DomainEventBase {
  readonly kind: 'offer_locked';
  readonly contractId: ContentId;
}

/**
 * The player settled a contract whose offer promised no bonus (`settleContract`,
 * `NEGOTIATION_SPEC` §3.3): `pay` is ignored (there was nothing to pay or withhold)
 * and no hero's `grievance` moves. `causalTraceId` is always `null` for the same
 * reason `OfferRevised`'s is: settling is the player's own act, not a hero's
 * decision.
 */
export interface ContractSettled extends DomainEventBase {
  readonly kind: 'contract_settled';
  readonly contractId: ContentId;
}

/**
 * The player settled a contract whose offer promised a bonus, and chose to pay it
 * (`settleContract`, `NEGOTIATION_SPEC` §3.3). `causalTraceId` is always `null`, the
 * same reason `ContractSettled`'s is.
 */
export interface ContractSettledPromiseKept extends DomainEventBase {
  readonly kind: 'contract_settled_promise_kept';
  readonly contractId: ContentId;
}

/**
 * The player settled a contract whose offer promised a bonus, and withheld it
 * (`settleContract`, `NEGOTIATION_SPEC` §3.3): the key hero's
 * `believesGuildPromises` turns `false` and every accepted hero's `grievance` grows
 * — the victim's by more than a witness's (`negotiation/grievance.ts`).
 * `causalTraceId` is always `null`, the same reason `ContractSettled`'s is.
 */
export interface ContractSettledPromiseBroken extends DomainEventBase {
  readonly kind: 'contract_settled_promise_broken';
  readonly contractId: ContentId;
}

/**
 * The seven events one resolution raises (`RESOLUTION_SPEC` §3.4), one per intent the
 * resolver produced and in that order.
 *
 * **`causalTraceId` is always `null` on every one of them.** A resolution is not a hero's
 * decision, so there is no choice for a trace to explain (`ADR-007`); the explanation
 * lives in the stored `ContractResolution` and in each contribution's provenance. That is
 * enforced rather than intended — `fromEvents` refuses an event carrying one.
 *
 * **Each carries what its own line on the debrief screen needs, and nothing flattened
 * across the others.** A `need_covered` has no hero and an `objective_taken` has no need;
 * an event writing `null` into a field it never had would be the log stating a fact the
 * resolution never produced.
 */

/** One of the contract's needs came out closed (`RESOLUTION_SPEC` §4.4). */
export interface NeedCovered extends DomainEventBase {
  readonly kind: 'need_covered';
  readonly contractId: ContentId;
  readonly need: NeedId;
  readonly verdict: CoverageVerdict;
}

/**
 * One of the contract's needs did not close, and which of the two coverage diagnoses it
 * earned (`RESOLUTION_SPEC` §4.7). `gap` is classified when the shortfall is created and
 * travels with it: a reader who wanted to work it out later would need the crew, which
 * an event log does not carry.
 */
export interface NeedShort extends DomainEventBase {
  readonly kind: 'need_short';
  readonly contractId: ContentId;
  readonly need: NeedId;
  readonly verdict: CoverageVerdict;
  readonly gap: DeficitKind;
}

/**
 * A hero whose agreement was less than freely given gave way early, on a need he was
 * answerable for (`RESOLUTION_SPEC` §4.4). At most one per hero.
 */
export interface HeroFalteredEarly extends DomainEventBase {
  readonly kind: 'hero_faltered_early';
  readonly contractId: ContentId;
  readonly heroId: HeroId;
  readonly need: NeedId;
}

/**
 * The job was done, or it was not (`RESOLUTION_SPEC` §4.4, §5.3). Read off the grade
 * rather than off the sign of the margin: "costly" reaches below zero on purpose and the
 * patron pays it in full, so the sign would put "the objective was lost" in the feed at
 * exactly the outcomes that were paid for as taken.
 */
export interface ObjectiveTaken extends DomainEventBase {
  readonly kind: 'objective_taken';
  readonly contractId: ContentId;
}

export interface ObjectiveLost extends DomainEventBase {
  readonly kind: 'objective_lost';
  readonly contractId: ContentId;
}

/** What the outcome cost one person, and how much (`RESOLUTION_SPEC` §5.1, §5.2). */
export interface HeroSufferedConsequence extends DomainEventBase {
  readonly kind: 'hero_suffered_consequence';
  readonly contractId: ContentId;
  readonly heroId: HeroId;
  readonly consequence: ConsequenceKind;
  readonly magnitude: number;
}

/**
 * The crew was placed on the board, under a doctrine and a threshold (`COMBAT_SPEC` §3.7).
 *
 * A campaign event and not a battle one: this is a decision the *player* made before the
 * fight, it changes the package the crew goes out on, and `history` is where the campaign's
 * own chronology lives. What happens inside the battle stays in `ContractResolution.battle`
 * (`ADR-016` §6).
 *
 * The formation itself is not on the event, and that is `RESOLUTION_SPEC` §3.3's rule about
 * where a fact lives: it is written onto the package, the package is in the save and in the
 * artifact, and an event carrying a second copy would be a second place it could drift.
 */
export interface CrewPlaced extends DomainEventBase {
  readonly kind: 'crew_placed';
  readonly contractId: ContentId;
  readonly doctrine: DoctrineId;
}

/**
 * The contract came back, and on which step (`RESOLUTION_SPEC` §3.3). Always the last
 * event of a resolution, and its effect is what writes the result onto the contract —
 * inside the transition rather than after the last one.
 */
export interface ContractResolved extends DomainEventBase {
  readonly kind: 'contract_resolved';
  readonly contractId: ContentId;
  readonly grade: OutcomeGrade;
}

/**
 * A discriminated union rather than an abstract base class with subtypes, and the
 * discriminant is the exact string the canonical artifact writes.
 *
 * The C# version needed a `switch` in the artifact projection that *threw* for an
 * unmapped event type, so that adding one failed loudly instead of silently
 * serializing under a name derived from its class. That runtime guard is unnecessary
 * here and is replaced by a stronger one: every `switch` over this union has to
 * handle a new member or the build fails — `switch-exhaustiveness-check` and
 * `noImplicitReturns` see to it — and the projection cannot even reach the payload
 * fields without narrowing on `kind` first.
 */
/**
 * Which hero an event is about, or `null` for the ones that are about nobody.
 *
 * **An exhaustive `switch` in one place, and that is the whole point of it existing.**
 * Every reader that needs this used to write out the kinds that name no hero as a list of
 * `!==` comparisons, which is the shape that misses whatever is added next: the seven
 * resolution events landed in this union and the compiler caught the reader only because
 * three of the new kinds happen to lack a `heroId`. A `switch` with no `default` fails to
 * build the day a kind is added, at the one site that has to decide.
 *
 * Beside the union rather than beside a reader: it is a fact about the events, and two
 * readers each deciding it separately is two answers that can disagree.
 */
export function heroNamedBy(domainEvent: DomainEvent): HeroId | null {
  switch (domainEvent.kind) {
    case 'hero_accepted_contract':
    case 'hero_declined_contract':
    case 'hero_faltered_early':
    case 'hero_suffered_consequence':
      return domainEvent.heroId;
    case 'offer_revised':
    case 'offer_locked':
    case 'crew_placed':
    case 'need_covered':
    case 'need_short':
    case 'objective_taken':
    case 'objective_lost':
    case 'contract_resolved':
    case 'contract_settled':
    case 'contract_settled_promise_kept':
    case 'contract_settled_promise_broken':
      return null;
  }
}

/**
 * Whether this event is a hero answering an offer — the two kinds that move
 * `respondedBy` and `acceptedBy`.
 *
 * Stated positively, for the reason {@link heroNamedBy} is stated at all: a reader
 * enumerating everything that is *not* an answer is a reader that silently admits the next
 * kind into a window it has no business in.
 */
export function isAnswerToAnOffer(
  domainEvent: DomainEvent
): domainEvent is HeroAcceptedContract | HeroDeclinedContract {
  // An exhaustive `switch` and not `kind === a || kind === b`, for the same reason
  // {@link heroNamedBy} is one: the boolean form compiles happily the day a kind is added
  // and quietly calls it "not an answer". Written out, it does not.
  switch (domainEvent.kind) {
    case 'hero_accepted_contract':
    case 'hero_declined_contract':
      return true;
    case 'offer_revised':
    case 'offer_locked':
    case 'crew_placed':
    case 'need_covered':
    case 'need_short':
    case 'hero_faltered_early':
    case 'objective_taken':
    case 'objective_lost':
    case 'hero_suffered_consequence':
    case 'contract_resolved':
    case 'contract_settled':
    case 'contract_settled_promise_kept':
    case 'contract_settled_promise_broken':
      return false;
  }
}

export type DomainEvent =
  | HeroAcceptedContract
  | HeroDeclinedContract
  | OfferRevised
  | OfferLocked
  | CrewPlaced
  | NeedCovered
  | NeedShort
  | HeroFalteredEarly
  | ObjectiveTaken
  | ObjectiveLost
  | HeroSufferedConsequence
  | ContractResolved
  | ContractSettled
  | ContractSettledPromiseKept
  | ContractSettledPromiseBroken;
