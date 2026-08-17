import { describe, expect, it } from 'vitest';

import { isArtifactSafeText } from '../canonical/artifact-domain.ts';

import { ACTIONS, Actions } from './actions.ts';
import { REASON_CODES, ReasonCodes } from './reason-codes.ts';

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
