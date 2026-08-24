/**
 * The set of characters a string may hold if it is going to reach a canonical
 * determinism artifact.
 *
 * This module exists because of a defect external review found in the claim that
 * justified *not* stepping the artifact version. The argument in
 * `FULL_TYPESCRIPT_MIGRATION` §7.2 is that the C# writer and RFC 8785 differ on
 * exactly five kinds of input — non-ASCII text, the `< > & ' +` set, negative zero,
 * control characters and astral-plane characters — and that no artifact can contain
 * any of them. That was true of the content tree as authored. It was **not** true of
 * what the contracts permitted: `display_name_key` was `z.string().min(1)`, so a
 * Cyrillic or control character was accepted, travelled into `HeroState` unchanged
 * and reached the artifact's `display_name_key` field. Two builds could then emit
 * different bytes under the same artifact version — which is the one thing a version
 * is there to prevent.
 *
 * So the domain stops being an observation about today's files and becomes an
 * enforced property, in two places on purpose:
 *
 * - the content contracts reject anything outside it at the door, where an author
 *   gets a diagnostic naming the file and the field;
 * - {@link requireArtifactSafeText} asserts it again at the boundary where strings
 *   enter campaign state, so a string arriving from somewhere other than a content
 *   file — a ruleset version passed by a tool, a key composed in code — cannot slip
 *   past by not having gone through a contract.
 *
 * The alphabet is deliberately narrow rather than "printable ASCII": `'`, `+`, `<`,
 * `>` and `&` are printable ASCII and are exactly where the old encoder escaped and
 * RFC 8785 does not.
 */

/**
 * Lowercase letters, digits, and the four punctuation marks the existing vocabulary
 * uses: `_` in identifiers, `.` in localization keys, `:` in content ids, `/` and `-`
 * in a ruleset version like `m1-negotiation/1`.
 */
export const ARTIFACT_SAFE_TEXT_PATTERN = '^[a-z0-9_.:/-]+$';

const ARTIFACT_SAFE_TEXT = new RegExp(ARTIFACT_SAFE_TEXT_PATTERN);

/** Whether `text` may reach a canonical artifact without making its version a lie. */
export function isArtifactSafeText(text: string): boolean {
  return ARTIFACT_SAFE_TEXT.test(text);
}

/**
 * Asserts that `text` may reach a canonical artifact.
 *
 * @param field What to name in the message — the caller knows whether this is a
 * display name key, a ruleset version or something else.
 * @throws if `text` is empty or holds a character outside {@link ARTIFACT_SAFE_TEXT_PATTERN}.
 */
export function requireArtifactSafeText(field: string, text: string): string {
  if (!isArtifactSafeText(text)) {
    throw new Error(
      `${field} is '${text}', which is outside the character set a canonical artifact may ` +
        `hold (${ARTIFACT_SAFE_TEXT_PATTERN}). Non-ASCII text, control characters and the ` +
        "`< > & ' +` set are the inputs where the frozen corpus records that the C# writer " +
        'and RFC 8785 produce different bytes, so a string like this reaching an artifact ' +
        'would make its version number a false claim about comparability.'
    );
  }

  return text;
}
