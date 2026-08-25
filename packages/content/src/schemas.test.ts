import { NeedId } from '@oath-and-coin/simulation';
import { describe, expect, it } from 'vitest';

import {
  CAPABILITY_EXPERTISE_MAX,
  CAPABILITY_EXPERTISE_MIN,
  CAPABILITY_GRADE_MAX,
  CAPABILITY_GRADE_MIN,
  NEED_WEIGHT_MAX,
  NEED_WEIGHT_MIN
} from './bounds.ts';
import { MAX_NEEDS_PER_CONTRACT, MIN_NEEDS_PER_CONTRACT } from './limits.ts';
import { contractFileSchema, heroFileSchema } from './schemas.ts';
import { SUPPORTED_CONTENT_SCHEMA_VERSION } from './versions.ts';

/**
 * The two fields `RESOLUTION_SPEC` §2.2 and §2.3 add to the content format, held at the
 * contract level — where an authored file is refused or accepted, before anything
 * downstream sees it.
 *
 * `content-set.test.ts` covers the loader around these contracts and the shipped tree it
 * reads; this file covers the contracts themselves, because the rules below are shapes a
 * *file* may or may not have and there is no reason to write a temporary content tree to
 * disk to ask about one.
 */

const validHero = {
  schema_version: SUPPORTED_CONTENT_SCHEMA_VERSION,
  id: 'core:bram',
  display_name_key: 'hero.core.bram.name',
  greed: 60,
  caution: 30,
  pride: 45,
  trust_in_guild: 50,
  capability: { grade: 65, expertise: { frontline: 70, wilderness: 40 } },
  traits: [],
  relationships: []
};

const validContract = {
  schema_version: SUPPORTED_CONTENT_SCHEMA_VERSION,
  id: 'core:cleanse_the_crypt',
  display_name_key: 'contract.core.cleanse_the_crypt.name',
  patron_fee: 70,
  risk: 80,
  required_crew: 4,
  needs: { frontline: 30, undead_knowledge: 35 },
  tags: ['target:undead']
};

/** The hero above with `capability` replaced, so a case states only what it is about. */
const heroWith = (capability: unknown): unknown => ({ ...validHero, capability });

/** The contract above with `needs` replaced, for the same reason. */
const contractWith = (needs: unknown): unknown => ({ ...validContract, needs });

describe("a contract's needs", () => {
  it('accepts two of the three the vocabulary offers', () => {
    // The case that rules out `z.record(z.enum(NEED_IDS), …)`: in Zod 4 that form
    // requires *every* member of the enum to be present, so a contract naming two
    // needs of three — the common shape, and the one §2.3 calls the point of the
    // model — would be refused for the one it deliberately does not ask for.
    expect(contractFileSchema.parse(contractWith({ frontline: 60, undead_knowledge: 45 }))).toEqual(
      expect.objectContaining({ needs: { frontline: 60, undead_knowledge: 45 } })
    );
  });

  it('accepts all three', () => {
    expect(
      contractFileSchema.parse(
        contractWith({ frontline: 25, undead_knowledge: 30, wilderness: 20 })
      )
    ).toEqual(
      expect.objectContaining({ needs: { frontline: 25, undead_knowledge: 30, wilderness: 20 } })
    );
  });

  it('refuses one need, naming the floor', () => {
    // One need makes "take the strongest" optimal, which is the kill-criterion
    // `MVP_PLAN` §3.2 names and `RESOLUTION_SPEC` §2.3 refuses to ship.
    expect(() => contractFileSchema.parse(contractWith({ frontline: 60 }))).toThrow(
      new RegExp(String(MIN_NEEDS_PER_CONTRACT))
    );
  });

  it('refuses no needs at all', () => {
    expect(() => contractFileSchema.parse(contractWith({}))).toThrow();
  });

  it('refuses a need of weight zero', () => {
    // Formally a second entry, in fact still one — the same degenerate contract, and
    // the reason the weight floor is 1 rather than 0 (§2.3).
    expect(() =>
      contractFileSchema.parse(contractWith({ frontline: 60, wilderness: 0 }))
    ).toThrow();
  });

  it('refuses a need of negative weight', () => {
    expect(() =>
      contractFileSchema.parse(contractWith({ frontline: 60, wilderness: -5 }))
    ).toThrow();
  });

  it('refuses a need outside the vocabulary', () => {
    // `frontlin` — a misspelling, which is the whole reason needs are a closed engine
    // vocabulary rather than free-form keys: a typo has to be an error, not a need no
    // hero can ever be answerable for.
    expect(() =>
      contractFileSchema.parse(contractWith({ frontlin: 60, wilderness: 5 }))
    ).toThrow(/frontlin/);
  });

  it('refuses a weight past the ceiling', () => {
    expect(() =>
      contractFileSchema.parse(contractWith({ frontline: NEED_WEIGHT_MAX + 1, wilderness: 5 }))
    ).toThrow();
  });

  it('accepts the extreme weights themselves', () => {
    expect(
      contractFileSchema.parse(
        contractWith({ frontline: NEED_WEIGHT_MIN, wilderness: NEED_WEIGHT_MAX })
      )
    ).toBeTruthy();
  });

  it('refuses a fractional weight', () => {
    expect(() =>
      contractFileSchema.parse(contractWith({ frontline: 60.5, wilderness: 5 }))
    ).toThrow();
  });

  it('refuses a contract with no needs field at all', () => {
    const { needs: _dropped, ...withoutNeeds } = validContract;

    expect(() => contractFileSchema.parse(withoutNeeds)).toThrow();
  });

  it('cannot be asked for more needs than the vocabulary has', () => {
    // Not a rule this contract enforces separately — `MAX_NEEDS_PER_CONTRACT` is the
    // size of the vocabulary itself, so a fourth key is already refused as a key. The
    // assertion is here so the ceiling stays derived rather than turning into a
    // literal 3 the day a fourth need is authored.
    expect(MAX_NEEDS_PER_CONTRACT).toBe(Object.values(NeedId).length);
  });
});

describe("a hero's capability", () => {
  it('accepts a grade and expertise in one or more needs', () => {
    expect(heroFileSchema.parse(validHero)).toEqual(
      expect.objectContaining({
        capability: { grade: 65, expertise: { frontline: 70, wilderness: 40 } }
      })
    );
  });

  it('refuses a hero with no capability at all', () => {
    const { capability: _dropped, ...withoutCapability } = validHero;

    expect(() => heroFileSchema.parse(withoutCapability)).toThrow();
  });

  it('refuses a capability with no grade', () => {
    expect(() => heroFileSchema.parse(heroWith({ expertise: { frontline: 70 } }))).toThrow();
  });

  it('refuses a capability with no expertise', () => {
    expect(() => heroFileSchema.parse(heroWith({ grade: 65 }))).toThrow();
  });

  it('keeps an explicit zero, which is not the same as a missing key', () => {
    // §2.2: `expertise.has(need)` means the hero is *answerable* for that need even at
    // zero skill, and answerability decides who can earn `faltered_early` and who is
    // eligible for a wound. A contract that dropped zero-valued entries — or a loader
    // that treated the two forms alike — would erase a fact the arithmetic cannot
    // recover, because on coverage both contribute nothing.
    expect(heroFileSchema.parse(heroWith({ grade: 65, expertise: { frontline: 0 } }))).toEqual(
      expect.objectContaining({ capability: { grade: 65, expertise: { frontline: 0 } } })
    );
  });

  it('accepts a hero answerable for nothing', () => {
    // Not a shape the shipped roster uses, and not one §2.2 forbids either: a hero
    // with no expertise contributes nothing anywhere, which is a legal — if useless —
    // thing to author, and inventing a floor here would be deciding something the
    // spec does not.
    expect(heroFileSchema.parse(heroWith({ grade: 40, expertise: {} }))).toBeTruthy();
  });

  it('refuses an unknown need in expertise', () => {
    expect(() =>
      heroFileSchema.parse(heroWith({ grade: 65, expertise: { swimming: 70 } }))
    ).toThrow(/swimming/);
  });

  it('refuses an unknown key inside capability', () => {
    expect(() =>
      heroFileSchema.parse(heroWith({ grade: 65, expertise: {}, gradee: 10 }))
    ).toThrow(/gradee/);
  });

  it.each([
    ['a grade below its floor', CAPABILITY_GRADE_MIN - 1],
    ['a grade past its ceiling', CAPABILITY_GRADE_MAX + 1]
  ])('refuses %s', (_name, grade) => {
    expect(() => heroFileSchema.parse(heroWith({ grade, expertise: { frontline: 10 } }))).toThrow();
  });

  it.each([
    ['an expertise below its floor', CAPABILITY_EXPERTISE_MIN - 1],
    ['an expertise past its ceiling', CAPABILITY_EXPERTISE_MAX + 1]
  ])('refuses %s', (_name, expertise) => {
    expect(() =>
      heroFileSchema.parse(heroWith({ grade: 50, expertise: { frontline: expertise } }))
    ).toThrow();
  });

  it('refuses a fractional grade', () => {
    expect(() =>
      heroFileSchema.parse(heroWith({ grade: 50.5, expertise: { frontline: 10 } }))
    ).toThrow();
  });

  it('accepts both extremes of both scales', () => {
    expect(
      heroFileSchema.parse(
        heroWith({
          grade: CAPABILITY_GRADE_MAX,
          expertise: { frontline: CAPABILITY_EXPERTISE_MIN, wilderness: CAPABILITY_EXPERTISE_MAX }
        })
      )
    ).toBeTruthy();
    expect(
      heroFileSchema.parse(heroWith({ grade: CAPABILITY_GRADE_MIN, expertise: {} }))
    ).toBeTruthy();
  });
});

describe('the content format version', () => {
  it('is 4, and a file still declaring 3 is refused', () => {
    // `capability` and `needs` are *required*, so a file authored under 3 is not a
    // legal file under 4 — the version has to move, and this is the assertion that
    // says the two facts travel together (`RESOLUTION_SPEC` §2.8).
    expect(SUPPORTED_CONTENT_SCHEMA_VERSION).toBe(4);
    expect(() => heroFileSchema.parse({ ...validHero, schema_version: 3 })).toThrow();
    expect(() => contractFileSchema.parse({ ...validContract, schema_version: 3 })).toThrow();
  });
});
