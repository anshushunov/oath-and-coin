import type { SortedSet } from '../collections/sorted-set.ts';
import type { ContentId } from '../ids/content-id.ts';
import type { HeroId } from '../ids/hero-id.ts';

/**
 * Lifecycle of a contract offer. Deliberately two members and not three.
 *
 * A hero declining does not close the offer for everyone else — it adds that hero to
 * {@link ContractState.respondedBy} instead. A third `declined` status would make the
 * first refusal remove the offer for every other hero, which would make the
 * two-autonomous-decisions scenario this milestone exists to demonstrate impossible.
 *
 * `crewed` is the state that matters for a contract needing more than one hero: it
 * means every seat in {@link ContractState.acceptedBy} is filled, not merely that one
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
  readonly payment: number;
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
   * Heroes who have already responded — accepted or declined — so the same hero is
   * never asked twice.
   */
  readonly respondedBy: SortedSet<HeroId>;
  /** Heroes who accepted and joined the crew — a subset of {@link respondedBy}. */
  readonly acceptedBy: SortedSet<HeroId>;
}
