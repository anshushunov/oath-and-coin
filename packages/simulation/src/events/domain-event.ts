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
export type DomainEvent =
  | HeroAcceptedContract
  | HeroDeclinedContract
  | OfferRevised
  | OfferLocked
  | ContractSettled
  | ContractSettledPromiseKept
  | ContractSettledPromiseBroken;
