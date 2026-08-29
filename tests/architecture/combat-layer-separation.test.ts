import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

/**
 * `BQ-013`'s one direct instruction, made mechanical: **не смешивать боевой слой с
 * мотивационными шкалами `greed`/`caution`/`pride`** (`DEC-016` §2).
 *
 * The separation `DEC-013` §2 built is about *ranges* — two pairs of bound constants that
 * cannot be raised by one edit. That is real and it is not this. This is about *reads*: the
 * thing `MVP_PLAN` names as the failure is somebody one day getting a hero's strength out of
 * how greedy he is, and no type stops that, because both layers are plain numbers on the
 * same `HeroState`.
 *
 * **A source-text check, and the crudeness is the point.** The alternative — asserting on
 * behaviour — cannot state the rule: "the combat rules do not read greed" is a claim about
 * every input, and a test can only sample. Reading the sources states it directly, reddens
 * on the edit rather than on a case somebody remembered to write, and names the file.
 *
 * **Here rather than in `packages/simulation`**, and not by preference:
 * `simulation-depends-on-nothing` forbids that package every import outside itself,
 * `node:fs` included, and it has no exemption for test files (`.dependency-cruiser.cjs`
 * records why that exemption was removed). A check that needs to read files belongs where
 * reading files is legal.
 *
 * The mirror direction is checked too. A decision rule that started reading `might` would
 * mean a hero's willingness to go depended on how hard he hits — the same confusion running
 * the other way, and `RESOLUTION_SPEC` §10.1's single-counting property would stop being
 * true.
 */

const repoRoot = resolve(import.meta.dirname, '..', '..');

/** The motivational scales (`DEC-010`, `NEGOTIATION_SPEC` §2.2) — what a hero *wants*. */
const MOTIVE_FIELDS = ['greed', 'caution', 'pride', 'trustInGuild', 'grievance'] as const;

/** The combat layer (`DEC-016` §1) — what he *is* in a fight. */
const COMBAT_FIELDS = ['might', 'guard', 'aim', 'focus', 'care'] as const;

/**
 * Where each side's rules live.
 *
 * `combat/` is the whole of the combat layer's arithmetic; `decisions/` is the whole of the
 * rule that answers "will he go" (`HERO_DECISION_SPEC`). Directories rather than files, so a
 * module added to either is covered the day it lands rather than the day somebody remembers
 * to list it.
 */
const COMBAT_RULES = 'packages/simulation/src/combat';
const DECISION_RULES = 'packages/simulation/src/decisions';

describe('the combat layer and the motivational scales are read by different rules', () => {
  it('has rules on both sides to check, so the directories are not silently empty', () => {
    // Without this the whole file passes vacuously the day a directory is renamed: no
    // sources, no mentions, green. The same shape `orphaned-data.test.ts` guards against.
    expect(sourcesUnder(COMBAT_RULES).length).toBeGreaterThan(0);
    expect(sourcesUnder(DECISION_RULES).length).toBeGreaterThan(0);
  });

  it.each(MOTIVE_FIELDS)('no combat rule reads `%s`', (field) => {
    expect(mentions(COMBAT_RULES, field)).toEqual([]);
  });

  it.each(COMBAT_FIELDS)('no decision rule reads `%s`', (field) => {
    expect(mentions(DECISION_RULES, field)).toEqual([]);
  });
});

/**
 * Files under `directory` whose text reads `field` as a property.
 *
 * Punctuation-anchored rather than the bare word, because the bare word appears in prose:
 * `focus` and `care` are ordinary English, and a comment explaining *why* a rule does not
 * read greed would fail a check that looked for the word alone. What is being caught is a
 * read, and every shape a read takes carries a mark the prose does not:
 *
 * | shape | mark |
 * |---|---|
 * | `hero.greed` | a dot before |
 * | `{ greed: … }`, `greed: number` | a colon after |
 * | `const { greed, other } = hero` | a comma after |
 * | `const { greed } = hero` | a brace on either side |
 *
 * **The brace case is here because a mutant survived without it.** `const { greed } = hero`
 * carries no dot, no colon and no comma, and the first version of this check let it
 * through — the one shape that reads a scale while looking least like it. `AGENTS.md` §8: a
 * green mutant is closed by a check that reddens on it, not by calling the mutant
 * unrealistic.
 *
 * Test files are excluded: a test may legitimately construct a hero with both layers set,
 * which is not a rule reading one from the other.
 */
function mentions(directory: string, field: string): readonly string[] {
  const read = new RegExp(
    String.raw`(\.${field}\b|\b${field}\s*[:,]|\{\s*${field}\b|\b${field}\s*\})`,
    'u'
  );

  return sourcesUnder(directory).filter((file) =>
    read.test(readFileSync(join(repoRoot, directory, file), 'utf8'))
  );
}

function sourcesUnder(directory: string): readonly string[] {
  return readdirSync(join(repoRoot, directory))
    .filter((name) => name.endsWith('.ts') && !name.endsWith('.test.ts'))
    .sort();
}
