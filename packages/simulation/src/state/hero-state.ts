import type { SortedMap } from '../collections/sorted-map.ts';
import type { ContentId } from '../ids/content-id.ts';
import type { HeroId } from '../ids/hero-id.ts';

/**
 * A hero's decision-relevant state (`TDD` §8). Four scales are a deliberate minimum:
 * `MVP_PLAN` §5.2 sketches six to eight, and which model hero AI uses was closed by
 * `DEC-010`.
 */
export interface HeroState {
  readonly id: HeroId;
  /** The content definition this hero instance was created from. */
  readonly definition: ContentId;
  /**
   * Localization key for the hero's display name (`TDD` §11.1) — never a literal,
   * player-facing string.
   */
  readonly displayNameKey: string;
  readonly greed: number;
  readonly caution: number;
  readonly pride: number;
  readonly trustInGuild: number;
  /**
   * Trait ids the hero carries, in the order content authored them. Identifiers, not
   * trait definitions: state must stay serializable and must never pull the content it
   * was built from along with it (`TDD` §11.1).
   */
  readonly traits: readonly ContentId[];
  /**
   * This hero's opinion of other heroes, keyed by the other hero's content id. A
   * sorted map rather than the definition's array-of-pairs shape, because the decision
   * rule looks a bond up by id instead of scanning a list for it — and sorted, like
   * every collection in state, for deterministic enumeration order.
   */
  readonly relationships: SortedMap<ContentId, number>;
  /**
   * Whether this hero still trusts a promise the guild makes (`NEGOTIATION_SPEC` §2.2).
   * `true` for every hero at campaign start. `settleContract` turns it `false` for the
   * hero a broken promise victimized, and nothing in this package turns it back —
   * `trustedBonus` (`NEGOTIATION_SPEC` §4) reads it and stops crediting a promise the
   * moment it is `false`. Not the same lever as {@link trustInGuild}: `NEGOTIATION_SPEC`
   * §2.2 explains why one broken promise needs both a switch that disables a specific
   * mechanic and a named, growing cost, rather than one shared dial doing both jobs.
   */
  readonly believesGuildPromises: boolean;
  /**
   * How much this hero resents the guild's broken word (`NEGOTIATION_SPEC` §2.2, §3.3),
   * `0..GRIEVANCE_MAX` (`negotiation/grievance.ts`). `0` for every hero at campaign
   * start; `settleContract` is the only transition that raises it, and no command wires
   * that yet — this field is declared and seeded here, not moved.
   */
  readonly grievance: number;
}
