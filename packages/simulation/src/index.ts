/**
 * The simulation package's public surface.
 *
 * Everything else in this package is reachable only through here, which is what
 * lets the boundary rule mean something: `content-depends-only-on-simulation`
 * checks direction, and a single entry point is what keeps a consumer from
 * reaching past the contract into a file that happened to be convenient.
 *
 * Grown by the task that adds each part, not written ahead: Task 6 brings
 * identity, canonicalization and the trait scale; Tasks 7-9 bring the RNG, state
 * and the decision rule.
 */

export {
  CONTENT_ID_PATTERN,
  compareContentIds,
  contentIdName,
  contentIdNamespace,
  parseContentId,
  tryParseContentId,
  type ContentId
} from './ids/content-id.ts';

export { compareHeroIds, heroId, type HeroId } from './ids/hero-id.ts';

export { compareNumbers, compareStrings, type Comparator } from './collections/comparator.ts';
export { SortedMap } from './collections/sorted-map.ts';
export { SortedSet } from './collections/sorted-set.ts';

export {
  canonicalBytes,
  canonicalSha256,
  canonicalize,
  type CanonicalValue
} from './canonical/canonical-json.ts';
export { Sha256, sha256Hex, toHex } from './canonical/sha256.ts';
export { utf8Bytes } from './canonical/utf8.ts';

export { TRAIT_SCALE } from './decisions/trait-scale.ts';
