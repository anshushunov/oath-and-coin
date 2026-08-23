import { describe, expect, it } from 'vitest';

import {
  GRIEVANCES,
  HERO_SCALE_PROFILES,
  INCLINATION_WEIGHTS,
  METHOD_TAGS,
  MOOD_ORDINALS,
  OFFER_TERM_FLAGS,
  OFFER_TERM_VALUES,
  RELATIONSHIP_WEIGHTS,
  RISKS
} from './generators.ts';

/**
 * Every sweep built on this file's axes (`contract-decision-rule.test.ts`'s
 * sum-identity sweep, `decision-properties.test.ts`'s six §10.1 properties)
 * pins its context count as a product of these axes' own `.length`s. That
 * defends against an axis silently *shrinking*, but not against an axis
 * silently *collapsing a value into a duplicate* — `.length` stays the same
 * either way, and so would every product and every pinned literal derived
 * from it. A duplicate slipped into one axis would quietly narrow the actual
 * coverage while every existing guard kept reading green.
 */
describe('the sweep axes carry no duplicate value', () => {
  it('each exported axis has as many distinct values as elements', () => {
    // Composite/branded values (hero-scale tuples, bigints) are made
    // comparable by `Set` before counting; `Set` already compares numbers,
    // strings and `null` by value.
    const axes: Record<string, readonly string[]> = {
      HERO_SCALE_PROFILES: HERO_SCALE_PROFILES.map((profile) => JSON.stringify(profile)),
      OFFER_TERM_VALUES: OFFER_TERM_VALUES.map(String),
      OFFER_TERM_FLAGS: OFFER_TERM_FLAGS.map(String),
      RISKS: RISKS.map(String),
      INCLINATION_WEIGHTS: INCLINATION_WEIGHTS.map(String),
      RELATIONSHIP_WEIGHTS: RELATIONSHIP_WEIGHTS.map(String),
      GRIEVANCES: GRIEVANCES.map(String),
      METHOD_TAGS: METHOD_TAGS.map((tag) => (tag === null ? 'null' : tag)),
      MOOD_ORDINALS: MOOD_ORDINALS.map(String)
    };

    for (const [name, values] of Object.entries(axes)) {
      expect(new Set(values).size, `${name} contains a duplicate value`).toBe(values.length);
    }

    // Named as a count, not assumed: a caller that only iterated `axes` would
    // not notice this guard itself silently losing an axis.
    expect(Object.keys(axes)).toHaveLength(9);
  });
});
