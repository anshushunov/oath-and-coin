import type { ContentId } from '../ids/content-id.ts';

/**
 * What a trait contributes, extracted from content by the caller.
 *
 * The decision rule never sees a content definition: this package must not
 * reference the content package (`ADR-002`). What the rule needs is the tag, the
 * kind and the weight — so those travel, and file paths, localization keys and
 * schema versions stay on the other side of the boundary.
 */
export interface HeldTrait {
  readonly id: ContentId;
  readonly tag: ContentId;
  /** A red line closes the decision instead of contributing to it (`HERO_DECISION_SPEC` §1.3). */
  readonly isPrinciple: boolean;
  /** Always 0 for a principle — see {@link isPrinciple}. */
  readonly weight: number;
}
