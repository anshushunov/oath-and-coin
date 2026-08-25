import type { SortedMap } from '../collections/sorted-map.ts';

import type { NeedId } from './need-id.ts';

/**
 * What a hero can do — the layer `DEC-013` separates from `greed`, `caution`, `pride` and
 * `trustInGuild` (`RESOLUTION_SPEC` §2.2).
 *
 * `grade` is how good he is at all, the analogue of Current Ability in Football Manager:
 * an authored constant today, a derivative of attributes, skills and equipment when
 * `BQ-013` closes, and nothing downstream has to change for that to happen. `expertise`
 * is how good he is at one particular need — the analogue of position and role.
 *
 * **A missing key and an explicit zero are different, and the difference is mechanical:**
 * `expertise.has(need)` means the hero is *answerable* for that need even at zero skill;
 * a missing key means it is not his business. Answerability decides which need can earn
 * him `faltered_early` and who is eligible for a `Wound` (`RESOLUTION_SPEC` §4.4, §5.2).
 * On the arithmetic of coverage the two forms are identical — both contribute nothing —
 * which is exactly why the distinction has to be stored rather than inferred from a
 * number.
 *
 * Bounds live in their own constants rather than being borrowed from the trait scale
 * (`DEC-013` §2). The numbers coincide; raising one must not raise the other, or a change
 * to the range of greed silently changes how strong a crew is.
 */
export interface HeroCapability {
  /** 0..100 — see `CAPABILITY_GRADE_MIN` / `CAPABILITY_GRADE_MAX` in the content bounds. */
  readonly grade: number;

  /** Values 0..100, keyed by `compareNeedIds`. */
  readonly expertise: SortedMap<NeedId, number>;
}
