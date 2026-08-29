import { describe, expect, it } from 'vitest';

import { afterActionScreenModel } from './after-action-screen-model.ts';
import { readModelHash } from './screen-model.ts';
import { fought } from './testing/fought.ts';

/**
 * `ADR-016` §Проверка, third bullet, as a compiling test rather than as a promise:
 *
 * > `ContractResolution`, произведённая боем, проходит через **реальный**
 * > `afterActionScreenModel` — не «читается без правки», а «читается после названного в §4
 * > расширения и ни одного сверх него».
 *
 * The distinction matters. `ADR-014` §Последствия promised that a battle would not rewrite
 * the debrief screen, and `ADR-016` §4 found that promise slightly false and narrowed it:
 * the shape gains three named things and nothing else. What this file asserts is the
 * narrowed claim — the campaign goes to a fight, comes back, and the same factory that
 * reads an abstract resolution reads this one.
 *
 * The campaign is driven through the **real commands**, not assembled by hand. A resolution
 * built by a fixture would prove that the factory reads a shape somebody typed; what has to
 * be true is that it reads the shape the engine produces.
 */

describe('a resolution a battle produced, read by the debrief screen’s own factory', () => {
  it('is read by the same factory, without a second reading for battles', () => {
    const { state, contractId } = fought();

    const model = afterActionScreenModel(state, contractId);

    // Everything §6.1 lists, filled from a fight rather than from an arithmetic: the step,
    // the chronology, the crew's two numbers and the coverage in three words.
    expect(model.gradeKey).not.toBeNull();
    expect(model.events.length).toBeGreaterThan(0);
    expect(model.contributions).toHaveLength(2);
    expect(model.coverage.map((row) => row.needKey)).toHaveLength(2);
  });

  it('is the battle’s own result and not the abstract resolver’s (ADR-016 §5)', () => {
    // The half the routing rule is *for*: on a contract that goes to a fight, the state the
    // command wrote is the state the battle produced. A mutant routing every contract to
    // the abstract resolver leaves the screen perfectly readable and this assertion red,
    // which is the difference between "the debrief works" and "the debrief is about the
    // fight that happened".
    const { state, contractId } = fought();
    const stored = state.contracts.get(contractId)?.resolution;

    expect(stored?.battle).not.toBeNull();
    expect(stored?.battle?.events.at(-1)?.kind).toBe('battle_ended');
  });

  it('hashes like any other screen, so the browser evidence can measure it', () => {
    const { state, contractId } = fought();

    expect(readModelHash(afterActionScreenModel(state, contractId))).toMatch(/^[0-9a-f]{64}$/u);
  });

  it('leaves the battle log out of the read model, which is where §10.3 puts it', () => {
    // The feed of the *battle* is its own section of the screen (`COMBAT_SPEC` §10.3) and
    // arrives with that section; what this asserts is the boundary the read model already
    // has — the chronology it carries is the campaign's `history`, and eighty battle events
    // do not belong in a hash the browser evidence compares.
    const { state, contractId } = fought();
    const model = afterActionScreenModel(state, contractId);

    expect(model.events.every((line) => !line.key.startsWith('battle.'))).toBe(true);
  });
});
