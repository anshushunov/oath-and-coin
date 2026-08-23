import type { SortedMap } from '../collections/sorted-map.ts';
import type { ContentId } from '../ids/content-id.ts';
import type { HeroId } from '../ids/hero-id.ts';
import type { ContractState } from '../state/contract-state.ts';
import type { HeroState } from '../state/hero-state.ts';

import type { HeldTrait } from './held-trait.ts';

/**
 * Everything a single decision is computable from (`HERO_DECISION_SPEC` §2.1).
 * Assembled by the caller, never fetched: the rule holds no reference to `GameState`,
 * so a test can pose a question without building a world.
 *
 * `contract.offer` and `hero.believesGuildPromises`/`hero.grievance` are already part
 * of {@link ContractState} and {@link HeroState} (`DEC-008` Tasks 6, 7) — this shape
 * needed no new field for the decision rule to read the advance, the promised bonus,
 * the chosen method tag and a broken word (`NEGOTIATION_SPEC` §4).
 */
export interface DecisionContext {
  readonly hero: HeroState;
  readonly contract: ContractState;
  /** The hero's own traits, already resolved. Strictly sorted by id — asserted, not assumed. */
  readonly traits: readonly HeldTrait[];
  /**
   * Content ids of the heroes who have already accepted this contract, keyed by their
   * runtime id — the only way the rule can match `ContractState.acceptedBy` against
   * relationships, which are authored against content ids.
   */
  readonly crew: SortedMap<HeroId, ContentId>;
  readonly campaignSeed: bigint;
  readonly decisionOrdinal: bigint;
  readonly traceId: number;
}
