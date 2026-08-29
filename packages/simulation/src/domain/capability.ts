import type { SortedMap } from '../collections/sorted-map.ts';

import type { HeroCombatLayer } from './combat-attributes.ts';
import type { NeedId } from './need-id.ts';

/**
 * What a hero can do — the layer `DEC-013` separates from `greed`, `caution`, `pride` and
 * `trustInGuild` (`RESOLUTION_SPEC` §2.2).
 *
 * `grade` is how good he is at all, the analogue of Current Ability in Football Manager.
 * **Since `DEC-016` §3 it is derived, not authored:** `gradeFrom(combat, equipment)`
 * computes it, content states the five combat attributes instead, and the save stores those
 * rather than this number. It is still a field here because the coverage arithmetic reads
 * it (`needs-coverage.ts`) and `DEC-013` §1 promised the substitution would change no
 * consumer — it has exactly one producer, and `hero-state.test.ts` holds the invariant.
 *
 * `expertise` is how good he is at one particular need — the analogue of position and role
 * — and it stays authored: it is about the needs of a contract, not about a fight, and
 * deriving it from combat attributes would claim a good fighter is automatically a good
 * negotiator (`DEC-016` §3).
 *
 * **A missing key and an explicit zero are different, and the difference is mechanical:**
 * `expertise.has(need)` means the hero is *answerable* for that need even at zero skill;
 * a missing key means it is not his business. Answerability decides which need can earn
 * him `faltered_early` and who is eligible for a `Wound` (`RESOLUTION_SPEC` §4.4, §5.2).
 * On the arithmetic of coverage the two forms are identical — both contribute nothing —
 * which is exactly why the distinction has to be stored rather than inferred from a
 * number.
 */
export interface HeroCapability {
  /** 0..100 — see {@link CAPABILITY_GRADE_MIN} / {@link CAPABILITY_GRADE_MAX}. */
  readonly grade: number;

  /** Values 0..100, keyed by `compareNeedIds`. */
  readonly expertise: SortedMap<NeedId, number>;
}

/**
 * The range a derived `grade` is clamped into (`DEC-016` §3).
 *
 * **Here rather than in `packages/content/src/bounds.ts`, and the move is the decision
 * showing through.** Those constants are the ranges an *author* may write, and `grade` is
 * no longer one of them — nothing in `content/` states it any more. What survives is a
 * property of the derivation, so it lives beside the derivation.
 *
 * Its own pair rather than borrowed from the trait scale, for the reason `DEC-013` §2
 * gives and `DEC-016` §2 repeats: the numbers coincide, the quantities do not, and one
 * shared constant would tie a change in how greedy a hero may be to a change in how strong
 * a crew is.
 */
export const CAPABILITY_GRADE_MIN = 0;
export const CAPABILITY_GRADE_MAX = 100;

export type { HeroCombatLayer };
