import { COMBAT_ATTRIBUTES, COMBAT_ROLES, NeedId } from '@oath-and-coin/simulation';
import { describe, expect, it } from 'vitest';

import {
  CAPABILITY_EXPERTISE_MAX,
  CAPABILITY_EXPERTISE_MIN,
  COMBAT_ATTRIBUTE_MAX,
  COMBAT_ATTRIBUTE_MIN,
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
  capability: { expertise: { frontline: 70, wilderness: 40 } },
  combat: { might: 78, guard: 80, aim: 55, focus: 55, care: 57 },
  role: 'vanguard',
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

/** The same, for the combat layer `DEC-016` §1 added. */
const heroFighting = (combat: unknown): unknown => ({ ...validHero, combat });

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

  it('refuses needs that are not a map at all', () => {
    expect(() => contractFileSchema.parse(contractWith(60))).toThrow();
    expect(() => contractFileSchema.parse(contractWith(['frontline', 'wilderness']))).toThrow();
  });

  it('refuses a contract with no needs field at all', () => {
    const { needs: _dropped, ...withoutNeeds } = validContract;

    expect(() => contractFileSchema.parse(withoutNeeds)).toThrow();
  });

  it('has a ceiling that happens to equal the vocabulary, and this is the tripwire', () => {
    // The two numbers coincide today and are two different facts: how many needs one
    // contract may ask for, and how many needs exist. `MAX_NEEDS_PER_CONTRACT` is a
    // literal on purpose (`limits.ts`), so this assertion is not a tautology — it
    // reddens the day a fourth `NeedId` is authored, which is exactly when somebody has
    // to decide whether a contract may name four. Derived from `NEED_IDS.length`, that
    // decision would have been taken by a `.length` and by nobody.
    expect(MAX_NEEDS_PER_CONTRACT).toBe(Object.values(NeedId).length);
  });
});

describe("a hero's capability", () => {
  it('accepts expertise in one or more needs', () => {
    expect(heroFileSchema.parse(validHero)).toEqual(
      expect.objectContaining({
        capability: { expertise: { frontline: 70, wilderness: 40 } }
      })
    );
  });

  it('refuses a hero with no capability at all', () => {
    const { capability: _dropped, ...withoutCapability } = validHero;

    expect(() => heroFileSchema.parse(withoutCapability)).toThrow();
  });

  it('refuses a capability that still states a grade', () => {
    // `DEC-016` §3 retired the authored constant, and this is what turns "should not be
    // authored" into "cannot be": a version 4 file carried `grade` here, and reading one
    // under this format would leave a hero whose stated strength and whose attributes
    // disagree — the second truth the record exists to remove.
    expect(() =>
      heroFileSchema.parse(heroWith({ grade: 65, expertise: { frontline: 70 } }))
    ).toThrow(/grade/);
  });

  it('refuses a capability with no expertise', () => {
    expect(() => heroFileSchema.parse(heroWith({}))).toThrow();
  });

  it('keeps an explicit zero, which is not the same as a missing key', () => {
    // §2.2: `expertise.has(need)` means the hero is *answerable* for that need even at
    // zero skill, and answerability decides who can earn `faltered_early` and who is
    // eligible for a wound. A contract that dropped zero-valued entries — or a loader
    // that treated the two forms alike — would erase a fact the arithmetic cannot
    // recover, because on coverage both contribute nothing.
    expect(heroFileSchema.parse(heroWith({ expertise: { frontline: 0 } }))).toEqual(
      expect.objectContaining({ capability: { expertise: { frontline: 0 } } })
    );
  });

  it('accepts a hero answerable for nothing', () => {
    // Not a shape the shipped roster uses, and not one §2.2 forbids either: a hero
    // with no expertise contributes nothing anywhere, which is a legal — if useless —
    // thing to author, and inventing a floor here would be deciding something the
    // spec does not.
    expect(heroFileSchema.parse(heroWith({ expertise: {} }))).toBeTruthy();
  });

  it('refuses an unknown need in expertise', () => {
    expect(() =>
      heroFileSchema.parse(heroWith({ expertise: { swimming: 70 } }))
    ).toThrow(/swimming/);
  });

  it('refuses an unknown key inside capability', () => {
    expect(() =>
      heroFileSchema.parse(heroWith({ expertise: {}, gradee: 10 }))
    ).toThrow(/gradee/);
  });

  it.each([
    ['an expertise below its floor', CAPABILITY_EXPERTISE_MIN - 1],
    ['an expertise past its ceiling', CAPABILITY_EXPERTISE_MAX + 1]
  ])('refuses %s', (_name, expertise) => {
    expect(() =>
      heroFileSchema.parse(heroWith({ expertise: { frontline: expertise } }))
    ).toThrow();
  });

  it('refuses a fractional expertise', () => {
    // Its own case rather than one covered by the grade above: `z.int()` is written
    // twice in this contract, and a test that exercises only one of the two would stay
    // green with the other loosened to `z.number()` — regenerating the schemas along
    // with it, so `schema:check` would agree and the whole gate would pass on a format
    // that admits a fractional expertise into the integer arithmetic of `TDD` §7.4.
    expect(() =>
      heroFileSchema.parse(heroWith({ expertise: { frontline: 10.5 } }))
    ).toThrow();
  });

  it('refuses an expertise that is not a map at all', () => {
    expect(() => heroFileSchema.parse(heroWith({ expertise: 70 }))).toThrow();
    expect(() =>
      heroFileSchema.parse(heroWith({ expertise: ['frontline'] }))
    ).toThrow();
  });

  it('refuses an expertise weight that is not a number', () => {
    expect(() =>
      heroFileSchema.parse(heroWith({ expertise: { frontline: '70' } }))
    ).toThrow();
  });

  it('accepts both extremes of the expertise scale', () => {
    expect(
      heroFileSchema.parse(
        heroWith({
          expertise: { frontline: CAPABILITY_EXPERTISE_MIN, wilderness: CAPABILITY_EXPERTISE_MAX }
        })
      )
    ).toBeTruthy();
    expect(heroFileSchema.parse(heroWith({ expertise: {} }))).toBeTruthy();
  });
});

describe("a hero's combat layer", () => {
  it('requires all five attributes', () => {
    const { combat: _dropped, ...withoutCombat } = validHero;

    expect(() => heroFileSchema.parse(withoutCombat)).toThrow();

    for (const attribute of COMBAT_ATTRIBUTES) {
      const { [attribute]: _missing, ...rest } = validHero.combat;

      expect(() => heroFileSchema.parse(heroFighting(rest)), attribute).toThrow(
        new RegExp(attribute)
      );
    }
  });

  it('refuses an unknown attribute', () => {
    expect(() => heroFileSchema.parse(heroFighting({ ...validHero.combat, cunning: 40 }))).toThrow(
      /cunning/
    );
  });

  it.each([
    ['below its floor', COMBAT_ATTRIBUTE_MIN - 1],
    ['past its ceiling', COMBAT_ATTRIBUTE_MAX + 1],
    ['fractional', 50.5]
  ])('refuses an attribute %s', (_name, value) => {
    expect(() =>
      heroFileSchema.parse(heroFighting({ ...validHero.combat, might: value }))
    ).toThrow();
  });

  it('accepts both extremes', () => {
    for (const value of [COMBAT_ATTRIBUTE_MIN, COMBAT_ATTRIBUTE_MAX]) {
      expect(
        heroFileSchema.parse(
          heroFighting({ might: value, guard: value, aim: value, focus: value, care: value })
        ),
        String(value)
      ).toBeTruthy();
    }
  });

  it('refuses a role outside the engine vocabulary', () => {
    // The vocabulary is the engine's, like `NEED_IDS`: content states a role, never
    // invents one. A file naming `warlord` would otherwise reach the combat rules as a
    // role no `switch` handles.
    expect(() => heroFileSchema.parse({ ...validHero, role: 'warlord' })).toThrow(/role/);
  });

  it('accepts every role the engine declares', () => {
    for (const role of COMBAT_ROLES) {
      expect(heroFileSchema.parse({ ...validHero, role }), role).toBeTruthy();
    }
  });
});

describe('the content format version', () => {
  it('is 6, and a file still declaring an older one is refused', () => {
    // `combat` and `role` are *required* and `capability.grade` is *refused*, so a file
    // authored under 4 is not a legal file under 5 and the reverse is false as well —
    // the version has to move, and this is the assertion that says the two facts travel
    // together (`RESOLUTION_SPEC` §2.8, `DEC-016` §Последствия). Six adds a contract's
    // optional `battle` block, and the number moves for the reason `negotiable_tags` moved
    // it: the field decides which resolver settles the contract (`ADR-014` §1), so a file
    // checked against 5 was checked without knowing that question existed.
    expect(SUPPORTED_CONTENT_SCHEMA_VERSION).toBe(6);
    expect(() => heroFileSchema.parse({ ...validHero, schema_version: 4 })).toThrow();
    expect(() => contractFileSchema.parse({ ...validContract, schema_version: 4 })).toThrow();
  });
});
