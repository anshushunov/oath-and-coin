/**
 * The characters a string may hold if its hash is going to be compared against the
 * frozen C# corpus.
 *
 * This module exists because of a defect the second external review of Task 11 found
 * in the claim that justified *not* stepping a version. The journal argued (§12.4) that
 * the five inputs where the old C# writer and RFC 8785 produce different bytes —
 * non-ASCII text, the `< > & ' +` set, negative zero, control characters and
 * astral-plane characters — cannot reach a read model, because every string in the
 * projection comes from a content id, a localization key or a closed engine
 * vocabulary. That was true of the values the shipped tree produces. It was **not**
 * true of what the code permits: {@link failedScreen} takes any non-empty `errorCode`,
 * and `failedScreen('A+B', 'detail')` hashes to a value the C# writer would not have
 * produced, because it escapes `+` as `+` and RFC 8785 does not.
 *
 * The reviewer reproduced it with that exact input. So the domain stops being an
 * observation about today's callers and becomes an enforced property, checked over the
 * whole projection rather than over the one field that was loose today — a field added
 * later would otherwise reopen the same hole silently.
 *
 * This is a *different*, wider alphabet than the simulation's
 * `ARTIFACT_SAFE_TEXT_PATTERN`, and the difference is deliberate. That one is
 * lowercase-only, because everything reaching a determinism artifact is an identifier
 * or a key. A read model legitimately carries `Normal`, `Moderate`, `Supported` and
 * `CONTENT_ROOT_NOT_FOUND` — uppercase by design, and outside the byte-level
 * disagreement between the two canonicalizations. Reusing the narrower pattern here
 * would reject the corpus's own recorded values.
 */

/**
 * Printable ASCII, minus the five characters where the two canonicalizations disagree.
 *
 * Control characters (below `0x20`), `DEL` and everything above `0x7e` are out because
 * the old writer escapes them and RFC 8785 does not — the same five classes the corpus
 * records in `jcs-compatibility-vectors.json`. `<`, `>`, `&`, `'` and `+` are printable
 * ASCII and are exactly where the old encoder's HTML-safe default escaped.
 */
export const CORPUS_COMPARABLE_TEXT_PATTERN = '^[ !"#$%()*,\\-./0-9:;=?@A-Z\\[\\\\\\]^_`a-z{|}~]*$';

const CORPUS_COMPARABLE_TEXT = new RegExp(CORPUS_COMPARABLE_TEXT_PATTERN, 'u');

/** Whether `text` hashes the same under this repository's canonicalization and the C# one. */
export function isCorpusComparableText(text: string): boolean {
  return CORPUS_COMPARABLE_TEXT.test(text);
}

/**
 * Asserts that `text` may be hashed as part of a read model.
 *
 * @param field The JSON path inside the projection, so a rejection names where the
 * string came from rather than only what was wrong with it.
 * @throws if `text` holds a character outside {@link CORPUS_COMPARABLE_TEXT_PATTERN}.
 */
export function requireCorpusComparableText(field: string, text: string): string {
  if (!isCorpusComparableText(text)) {
    throw new Error(
      `${field} is '${text}', which holds a character outside the set the frozen corpus and ` +
        'this repository canonicalize identically. Non-ASCII text, control characters and the ' +
        "`< > & ' +` set are where the C# writer escapes and RFC 8785 does not, so hashing a " +
        'string like this would produce a read-model hash the corpus could never have recorded ' +
        'and no comparison against it would mean anything.'
    );
  }

  return text;
}
