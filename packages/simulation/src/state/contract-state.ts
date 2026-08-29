import type { SortedMap } from '../collections/sorted-map.ts';
import type { SortedSet } from '../collections/sorted-set.ts';
import type { CommitmentState } from '../domain/commitment.ts';
import type { ContractBattlePlan } from '../domain/contract-battle-plan.ts';
import type { CrewDeployment } from '../domain/crew-deployment.ts';
import type { NeedId } from '../domain/need-id.ts';
import type { ContractResolution } from '../domain/outcome.ts';
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
   * Who this package asks (`RESOLUTION_SPEC` §2.5). Exactly `requiredCrew` heroes once
   * a package has been composed, and empty before that — `keyHero` is `null` until the
   * first `composeOffer`, and there is nobody to invite to a package nobody has made.
   *
   * Part of the package rather than beside it, for the reason `respondedBy` is: a
   * revision names a new crew, and an answer from somebody the new package does not ask
   * is not an answer this package ever received.
   *
   * A fixed size is the rule, not a convenience (`RESOLUTION_SPEC` §7 of the product
   * spec): with a variable one, inviting spare heroes is always weakly better, and the
   * choice the whole loop is about — *these* people, not more people — stops being a
   * choice.
   */
  readonly invited: SortedSet<HeroId>;
  /**
   * Heroes who have answered this exact version — accepted or declined. Lives inside
   * the offer, not beside it (`ContractState.offer`): a revision is a new version with
   * a new, empty `respondedBy`, so an answer to a package a player has since changed
   * cannot outlive the change — there is nowhere left for it to be stored.
   */
  readonly respondedBy: SortedSet<HeroId>;
  /** Heroes who accepted this version and joined the crew — a subset of {@link respondedBy}. */
  readonly acceptedBy: SortedSet<HeroId>;
  /**
   * How each acceptance was given — freely, bought, or resented (`RESOLUTION_SPEC`
   * §2.4). Keyed by exactly the heroes in {@link acceptedBy}.
   *
   * **Recorded at the moment of the answer, never recomputed at resolution.** The
   * `DecisionContext` a hero answers on carries the crew as it stood *then*, and the
   * crew grows between the key hero's yes and the contract's resolution — so the same
   * rule run again later gives a different answer. A key hero who agreed alone, and only
   * because of a promised bonus, would look freely committed once the rest of the crew
   * had joined him.
   *
   * Cleared with {@link respondedBy} on every revision, and for the same reason: a
   * commitment is a fact about the package that was answered.
   */
  readonly commitments: SortedMap<HeroId, CommitmentState>;
  /**
   * Where the crew stands, under which doctrine, and when it pulls out
   * (`COMBAT_SPEC` §2, §3.7). `null` until `placeCrew` records it, and on every contract
   * that never goes to a battle at all.
   *
   * Part of the package for the reason `commitments` is: it is a decision about *this*
   * version of the offer, and a revision that changed who is going has a formation that
   * refers to people who are not. Cleared with `respondedBy` on every revision.
   */
  readonly deployment: CrewDeployment | null;
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
   * What the job asks for, and how much of each (`RESOLUTION_SPEC` §2.3): two or three
   * needs from the engine's own vocabulary, every weight strictly positive.
   *
   * Authored content, carried through unchanged — a contract's needs never move during
   * a campaign. Keyed by `compareNeedIds`, so the order in the canonical artifact is the
   * vocabulary's and not the author's.
   */
  readonly needs: SortedMap<NeedId, number>;
  /**
   * Content ids a hero's traits latch onto (`HERO_DECISION_SPEC` §1.5). Identifiers,
   * not the trait definitions the tags happen to name — same reason as
   * `HeroState.traits`.
   */
  readonly tags: SortedSet<ContentId>;
  /**
   * The mutually-exclusive method tags a player may choose between when composing an
   * offer (`NEGOTIATION_SPEC` §2.4) — exactly `NEGOTIABLE_TAGS_COUNT` (2) entries, or
   * absent/empty for a contract that trades on money and promise only. `composeOffer`
   * (`commands/compose-offer.ts`) is this field's one reader today: absent and empty
   * both mean "nothing negotiable", so a chosen `methodTag` is only ever legal when it
   * is a member of this set.
   *
   * **Optional on the type, not on the data.** Every contract this build can produce
   * carries a real set — the content loader fills it from `ContractDefinition.negotiableTags`
   * (`initial-state.ts`), a revision carries its contract's existing set forward
   * (`composeOffer`), and `snapshot-codec.ts` round-trips it (an `.optional()` schema
   * key rather than a required one, so this addition did not have to move
   * `SAVE_SCHEMA_VERSION`). The type is optional only so that hand-built `ContractState`
   * literals elsewhere in the tree — tests and fixtures predating this field — are not
   * forced to supply it; reading code should treat absence exactly like an empty set,
   * never as "unknown".
   *
   * **Not (yet) in the canonical artifact.** `determinism-artifact.ts`'s `describeContract`
   * does not project this field — adding it would be a real shape change, and this task
   * is explicitly told not to move `ARTIFACT_VERSION` or re-record `scenarios/*.canonical.json`
   * (`ADR-013`, Task 20). A scenario that never composes an offer with a `methodTag`
   * cannot observe the omission; one that does is Task 20's problem to pick up.
   */
  readonly negotiableTags?: SortedSet<ContentId>;
  readonly status: ContractStatus;
  /**
   * What its author says about the fight this contract leads to, or `null` for one that
   * never goes to a battle (`ADR-016` §1, `COMBAT_SPEC` §6.2).
   *
   * **This field is the routing rule.** `ADR-014` §1 requires a contract to know before it
   * is sent which resolver settles it, and a plan is what says so: with one, the battle
   * resolver; without, the abstract one. Authored content, carried through unchanged and
   * never moved by any command.
   */
  readonly battle: ContractBattlePlan | null;
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
  /**
   * What happened when the crew went out, once it has (`RESOLUTION_SPEC` §2.5). `null`
   * until `resolveContract` writes it, and never written twice.
   *
   * Everything the debrief screen needs that the event history does not already carry —
   * and deliberately not the chronology, which lives in `history` and which one stored
   * result could not reconstruct.
   */
  readonly resolution: ContractResolution | null;
}
