import type { SortedMap } from '../collections/sorted-map.ts';
import type { SortedSet } from '../collections/sorted-set.ts';
import type { ContentId } from '../ids/content-id.ts';
import type { HeroId } from '../ids/hero-id.ts';

/**
 * Lifecycle of a single offer version (`NEGOTIATION_SPEC` §2.1). Three members, and
 * deliberately not folded into {@link ContractStatus}'s own two: status answers "is the
 * crew filled", phase answers "where is the negotiation", and a version can be
 * `crewed` while still `locked` (waiting on a decision to settle) — the two axes move
 * independently, so one is not a special case of the other.
 *
 * Declared here, beside {@link ContractState}, rather than in `offer-state.ts` — which
 * holds the invariants over this shape, not the shape itself — because `ContractState`
 * needs it as a field's type and `offer-state.ts` needs `ContractState` for the
 * functions that build and validate one; two files each needing the other's type is
 * exactly the cycle `lint:deps`'s `no-circular` rule exists to catch, proven here by
 * running into it. `offer-state.ts` re-exports both names, so every other module still
 * reaches them the one way this package's index does.
 */
export const OfferPhase = Object.freeze({
  Draft: 'draft',
  Locked: 'locked',
  Settled: 'settled'
});

export type OfferPhase = (typeof OfferPhase)[keyof typeof OfferPhase];

/** A single version of a contract's negotiation package (`NEGOTIATION_SPEC` §2.1). */
export interface OfferState {
  /** 1 on the contract's first offer, +1 on every revision (`composeOffer`). */
  readonly version: number;
  /** Who the current package is negotiated with; `null` until the first revision. */
  readonly keyHero: HeroId | null;
  /** Money offered to every hero who accepts — a term, not a per-hero ledger entry. */
  readonly advance: number;
  /** The negotiated tag this version has chosen, if any; `null` picks none. */
  readonly methodTag: ContentId | null;
  /** Extra pay promised to {@link keyHero} alone; `0` means no promise stands. */
  readonly promisedBonus: number;
  readonly phase: OfferPhase;
  /**
   * Heroes who have answered this exact version — accepted or declined. Lives inside
   * the offer, not beside it (`ContractState.offer`): a revision is a new version with
   * a new, empty `respondedBy`, so an answer to a package a player has since changed
   * cannot outlive the change — there is nowhere left for it to be stored.
   */
  readonly respondedBy: SortedSet<HeroId>;
  /** Heroes who accepted this version and joined the crew — a subset of {@link respondedBy}. */
  readonly acceptedBy: SortedSet<HeroId>;
}

/**
 * Lifecycle of a contract offer. Deliberately two members and not three.
 *
 * A hero declining does not close the offer for everyone else — it adds that hero to
 * {@link OfferState.respondedBy} instead. A third `declined` status would make the
 * first refusal remove the offer for every other hero, which would make the
 * two-autonomous-decisions scenario this milestone exists to demonstrate impossible.
 *
 * `crewed` is the state that matters for a contract needing more than one hero: it
 * means every seat in {@link OfferState.acceptedBy} is filled, not merely that one
 * hero among several said yes.
 */
export const ContractStatus = Object.freeze({
  Offered: 'offered',
  Crewed: 'crewed'
});

export type ContractStatus = (typeof ContractStatus)[keyof typeof ContractStatus];

/** A contract offer's terms and lifecycle state. */
export interface ContractState {
  readonly id: ContentId;
  readonly patronFee: number;
  readonly risk: number;
  /** How many heroes must accept before this offer is crewed (`HERO_DECISION_SPEC` §1.5). */
  readonly requiredCrew: number;
  /**
   * Content ids a hero's traits latch onto (`HERO_DECISION_SPEC` §1.5). Identifiers,
   * not the trait definitions the tags happen to name — same reason as
   * `HeroState.traits`.
   */
  readonly tags: SortedSet<ContentId>;
  readonly status: ContractStatus;
  /**
   * This contract's current negotiation package and its lifecycle
   * (`NEGOTIATION_SPEC` §2.1). `respondedBy`/`acceptedBy` live inside it, not beside
   * it: a revised package is a new `OfferState` with empty answer sets, so an answer
   * to a version the player has since changed cannot exist — there is nowhere left to
   * keep it. Built and revalidated only through `createContractState`
   * (`offer-state.ts`).
   */
  readonly offer: OfferState;
  /**
   * The decision ordinal each hero first drew a mood on, for this contract, keyed by
   * hero id (`NEGOTIATION_SPEC` §2.1.1). Written once and never cleared by a revised
   * offer, so re-answering a later version of the same package reuses the recorded
   * ordinal instead of drawing a fresh mood. Filled by the engine (`pollCrew` and
   * `proposeContractToHero`); empty at construction.
   */
  readonly moodOrdinals: SortedMap<HeroId, bigint>;
}
