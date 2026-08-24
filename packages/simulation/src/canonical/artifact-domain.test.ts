import { describe, expect, it } from 'vitest';

import { canonicalize } from './canonical-json.ts';
import {
  ARTIFACT_SAFE_TEXT_PATTERN,
  isArtifactSafeText,
  requireArtifactSafeText
} from './artifact-domain.ts';

/**
 * The domain the artifact version's stability rests on.
 *
 * The claim in `FULL_TYPESCRIPT_MIGRATION` §7.2 is that the determinism artifact's
 * version need not step from 3 to 4 despite the canonicalizer moving to RFC 8785,
 * because no artifact can contain one of the five inputs the two rules disagree about.
 * External review showed the claim was an observation about today's content files rather
 * than an enforced property. This is where it becomes enforced, so these tests are the
 * ones holding that argument up.
 */

describe('isArtifactSafeText', () => {
  it.each([
    'core:bram',
    'hero.core.bram.name',
    'hero.decision.payment_attractive',
    'm1-negotiation/1',
    'action:accept',
    'rejected.stale_state',
    'offered',
    'hero_accepted_contract'
  ])('accepts %s, which the artifact already carries', (text) => {
    expect(isArtifactSafeText(text)).toBe(true);
  });

  it.each([
    { name: 'Cyrillic', text: 'Мира' },
    { name: 'an astral-plane character', text: '\u{1f4b0}' },
    { name: 'a control character', text: `a${String.fromCharCode(1)}` },
    { name: 'a tab', text: 'a\tb' },
    { name: 'a space', text: 'a b' },
    { name: 'spaces only', text: '   ' },
    { name: 'the empty string', text: '' },
    { name: 'an uppercase letter', text: 'Bram' },
    // The four printable-ASCII characters the old C# encoder escaped and RFC 8785 does
    // not. They are the trap in "just require printable ASCII".
    { name: 'an apostrophe', text: "o'brien" },
    { name: 'a plus', text: 'a+b' },
    { name: 'an ampersand', text: 'a&b' },
    { name: 'an angle bracket', text: 'a<b' }
  ])('refuses $name', ({ text }) => {
    expect(isArtifactSafeText(text)).toBe(false);
  });

  it('names the value and why in its message', () => {
    expect(() => requireArtifactSafeText('displayNameKey', 'Мира')).toThrow(
      /displayNameKey is 'Мира', which is outside the character set/
    );
  });

  it('returns the text it accepted, so it can sit inside an expression', () => {
    expect(requireArtifactSafeText('rulesetVersion', 'm1-negotiation/1')).toBe('m1-negotiation/1');
  });
});

describe('the domain is the one where both canonicalization rules agree', () => {
  it('leaves every character of the alphabet unescaped', () => {
    // The load-bearing property, checked directly rather than argued: for a string inside
    // this domain the canonical writer emits the characters literally, so the old C#
    // writer — which escaped non-ASCII and the `< > & ' +` set and nothing else — would
    // have produced the same bytes. That is what makes the artifact version comparable
    // across the two implementations without a step.
    const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789_.:/-';

    expect(isArtifactSafeText(alphabet)).toBe(true);
    expect(canonicalize(alphabet)).toBe(`"${alphabet}"`);
  });

  it('is stated as a pattern anchored at both ends', () => {
    // An unanchored pattern would accept a string that merely *contains* safe characters,
    // which is the opposite of the guarantee.
    expect(ARTIFACT_SAFE_TEXT_PATTERN.startsWith('^')).toBe(true);
    expect(ARTIFACT_SAFE_TEXT_PATTERN.endsWith('$')).toBe(true);
  });
});
