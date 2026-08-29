import type { SortedMap } from '../collections/sorted-map.ts';
import type { HeroCapability } from '../domain/capability.ts';
import type { HeroCombatLayer } from '../domain/combat-attributes.ts';
import type { CombatRole } from '../domain/combat-role.ts';
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
   * What this hero can do (`DEC-013`, `RESOLUTION_SPEC` §2.2) — a layer of its own,
   * beside the four scales above rather than among them. The scales say what he wants;
   * this says what he is good at, and no rule reads both.
   *
   * Copied from the hero's definition at campaign start and never moved by any command.
   *
   * **`capability.grade` is no longer copied — it is computed** (`DEC-016` §3, `BQ-013`
   * closed). `gradeFrom({@link combat}, equipment)` is its single producer, and the promise
   * `DEC-013` §1 made — that the substitution would change no consumer — is kept: the
   * coverage arithmetic still reads `capability.grade` and knows nothing about where it
   * came from.
   */
  readonly capability: HeroCapability;
  /**
   * What this hero is made of in a fight (`DEC-016` §1, `COMBAT_SPEC` §3.6).
   *
   * Its own field, beside the four scales above rather than among them, and no rule reads
   * both: the scales say whether he goes, this says how he fights. `BQ-013`'s instruction
   * — "не смешивать с мотивационными шкалами" — is held by `combat/vocabulary.test.ts`
   * rather than by this comment.
   *
   * Authored by content and never moved by a command in M2: wounds and equipment are the
   * two things that would move it, and neither is in this milestone's scope
   * (`COMBAT_SPEC` §14, `BQ-007`).
   */
  readonly combat: HeroCombatLayer;
  /**
   * Which of the four jobs he holds (`COMBAT_SPEC` §3.3). Authored, like {@link combat},
   * and never moved by a command in M2.
   */
  readonly role: CombatRole;
  /**
   * How many wounds this hero has taken (`RESOLUTION_SPEC` §2.6). `0` at campaign
   * start; a `Wound` consequence adds its magnitude.
   *
   * **No domain ceiling, and nothing reads it.** That is the declared boundary of M1,
   * not a mechanic somebody forgot (`R-08`): wounds accumulate and are visible, and
   * healing, a cap and any effect on a decision are M2's. A ceiling invented here would
   * be a balance decision taken inside an implementation.
   */
  readonly wounds: number;
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
