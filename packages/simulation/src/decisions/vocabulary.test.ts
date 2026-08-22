import { describe, expect, it } from 'vitest';

import { isArtifactSafeText } from '../canonical/artifact-domain.ts';

import { ACTIONS, Actions } from './actions.ts';
import {
  BLOCK_REASON_CODES,
  FACTOR_REASON_CODES,
  REASON_CODES,
  ReasonCodes,
  TIE_BREAK_REASON_CODES
} from './reason-codes.ts';

/**
 * The two closed vocabularies the engine writes into a canonical artifact.
 *
 * `FULL_TYPESCRIPT_MIGRATION` §8.7 lists this as an obligation the C# side did not have:
 * the artifact version stays at 3 only because every string reaching an artifact lives
 * inside `ARTIFACT_SAFE_TEXT_PATTERN`, and external review already found one place where
 * that was an observation about today's files rather than an enforced property
 * (`display_name_key`). Reason codes and action ids reach the artifact by the same road,
 * so they are held to the same set here — before a code with a capital letter, a space
 * or a Cyrillic character can be added by someone who had no reason to know.
 */

describe('every reason code may reach a canonical artifact', () => {
  it.each(REASON_CODES)('%s is artifact-safe', (code) => {
    expect(isArtifactSafeText(code)).toBe(true);
  });

  it('lists every declared code, because the list is derived and not typed twice', () => {
    expect(REASON_CODES).toEqual(Object.values(ReasonCodes));
    expect(new Set(REASON_CODES).size).toBe(REASON_CODES.length);
  });

  it('namespaces every code under hero.decision, so a factor cannot collide with a rejection code', () => {
    for (const code of REASON_CODES) {
      expect(code.startsWith('hero.decision.')).toBe(true);
    }
  });
});

describe('the vocabulary split by the role a code plays in a trace', () => {
  // `snapshot-codec.ts` closes a save's three reason-code fields on these three sets, so
  // a code missing from all of them is a code no save may carry — an engine that produced
  // it would be writing files this build refuses to read. That makes completeness a
  // property worth a check rather than a convention: the sets are typed out by hand,
  // because which role a code plays is a fact about its meaning and there is nothing in
  // the rule to derive it from.

  const everySet = [...FACTOR_REASON_CODES, ...BLOCK_REASON_CODES, ...TIE_BREAK_REASON_CODES];

  it('classifies every declared code, so a new one cannot be silently unsavable', () => {
    const unclassified = REASON_CODES.filter((code) => !everySet.includes(code));

    expect(
      unclassified,
      `declared in ReasonCodes and in none of the three role sets: ${unclassified.join(', ')}. ` +
        'A code no set carries is a code snapshot-codec.ts will refuse in every position.'
    ).toEqual([]);
  });

  it('invents nothing: every member of every set is a declared code', () => {
    const invented = everySet.filter((code) => !REASON_CODES.includes(code));

    expect(invented, `listed in a role set and declared nowhere: ${invented.join(', ')}`).toEqual(
      []
    );
  });

  it('gives each code exactly one role, which is what the split is for', () => {
    // Disjointness is the load-bearing half, not tidiness. The sets exist so that a save
    // cannot file `principle_forbids` — a red line, which `createDecisionResult` requires
    // to come with a null score — as a positive factor with a magnitude attached. A code
    // in two sets is a code back in the single combined vocabulary the split replaced.
    expect(new Set(everySet).size).toBe(everySet.length);
  });
});

describe('every action id may reach a canonical artifact', () => {
  it.each(ACTIONS)('%s is artifact-safe', (action) => {
    expect(isArtifactSafeText(action)).toBe(true);
  });

  it('is exactly the two actions a contract offer can be answered with', () => {
    expect(ACTIONS).toEqual([Actions.Accept, Actions.Decline]);
  });

  it('keeps actions in their own namespace, which no content pack may author', () => {
    for (const action of ACTIONS) {
      expect(action.startsWith('action:')).toBe(true);
    }
  });
});
