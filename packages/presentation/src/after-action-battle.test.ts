import {
  DoctrineId,
  forecastReadiness,
  placeCrew,
  resolutionInputFor
} from '@oath-and-coin/simulation';
import { describe, expect, it } from 'vitest';

import { afterActionScreenModel } from './after-action-screen-model.ts';
import { contractOfferScreenModel } from './contract-offer-screen-model-factory.ts';
import { readModelHash } from './screen-model.ts';
import { aContract } from './testing/fixtures.ts';
import {
  KEY,
  SECOND,
  campaign,
  fought,
  placedCampaign,
  resolvedWithoutBattle
} from './testing/fought.ts';

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

describe('the section and the column COMBAT_SPEC §10.3 adds', () => {
  it('carries the battle’s own feed, in the order the fight raised it', () => {
    const { state, contractId } = fought();
    const model = afterActionScreenModel(state, contractId);
    const record = state.contracts.get(contractId)?.resolution?.battle;

    expect(model.battle).not.toBeNull();
    expect(model.battle?.feed).toHaveLength(record?.events.length ?? -1);
    expect(model.battle?.feed.at(0)?.key).toBe('battle.event.battle_started');
    expect(model.battle?.feed.at(-1)?.key).toBe('battle.event.battle_ended');
    expect(model.battle?.rounds).toBe(record?.rounds);
    expect(model.battle?.outcomeKey).toBe(`battle.outcome.${String(record?.outcome)}`);
  });

  it('leaves the section off a contract that never went to a fight', () => {
    const abstract = resolvedWithoutBattle();

    expect(afterActionScreenModel(abstract.state, abstract.contractId).battle).toBeNull();
  });

  it('puts what the forecast promised beside every objective it forecast', () => {
    const { state, contractId } = fought();
    const model = afterActionScreenModel(state, contractId);

    expect(model.coverage.length).toBeGreaterThan(0);
    expect(model.coverage.every((row) => row.forecastVerdictKey !== null)).toBe(true);
  });

  it('promises the same thing after the fight that it promised before it', () => {
    // **The claim that makes recomputing honest** (`ADR-016` §4 closes the result at three
    // additions, and a stored forecast is not one of them). A forecast taken from the
    // campaign as it stands after a battle is only the forecast the player saw if nothing
    // the forecast reads has moved — and nothing has: `capability.grade` and `combat` are
    // copied at campaign start and no command moves either, the commitment is recorded when
    // a hero answers, and the formation is on the package. Wounds and retreats do move, and
    // are read by nothing.
    //
    // A mutant that made a wound reach `capability.grade` reddens this, which is the whole
    // point of asking it here rather than writing it in a comment.
    const before = campaign();
    const placed = placeCrew(before, {
      commandId: 1,
      contractId: aContract().id,
      expectedStateVersion: before.metadata.stateVersion,
      placement: [
        { hero: KEY, cell: { row: 1, column: 1 } },
        { hero: SECOND, cell: { row: 3, column: 2 } }
      ],
      doctrine: DoctrineId.HoldTheLine,
      retreatBelowPercent: 0
    });

    const contractBefore = placed.state.contracts.get(aContract().id)!;
    const promisedBefore = forecastReadiness(
      resolutionInputFor(placed.state, contractBefore, null)
    );

    const { state, contractId } = fought();
    const afterwards = afterActionScreenModel(state, contractId);

    expect(afterwards.coverage.map((row) => row.forecastVerdictKey)).toEqual(
      promisedBefore.objectives.map((one) => `outcome.verdict.${one.verdict}`)
    );
  });

  it('promises on the offer screen exactly what the debrief says was promised', () => {
    // **The half external review found missing.** The column is only honest if the player
    // was shown the same thing before he sent anybody — `DIRECTION_2026-08` §4.8 asks that
    // knowing a person change a *preparation*, and a forecast that first appears in the
    // debrief cannot change one. Until this case existed, the two sides of the comparison
    // were two internal computations and nothing checked that either reached a screen.
    const placed = placedCampaign();
    const offered = contractOfferScreenModel(placed, [], aContract().id);

    expect(offered.forecast, 'a locked battle contract must forecast').not.toBeNull();

    const { state, contractId } = fought();
    const debrief = afterActionScreenModel(state, contractId);

    expect(offered.forecast?.objectives.map((one) => [one.needKey, one.verdictKey])).toEqual(
      debrief.coverage.map((row) => [row.needKey, row.forecastVerdictKey])
    );
  });

  it('names the bond before the crew is sent, which is §13.2 п.3 itself', () => {
    // The one line the whole vocabulary exists for. It has to be on the *offer* screen: a
    // warning that somebody may break formation for a friend is only actionable while the
    // formation can still be changed.
    const offered = contractOfferScreenModel(placedCampaign(), [], aContract().id);

    expect(offered.forecast?.reasons.map((reason) => reason.key)).toContain(
      'forecast.bond_may_break_the_doctrine'
    );
  });

  it('says which round the player pulled them out at, and nothing when he did not', () => {
    const { state, contractId } = fought();

    expect(afterActionScreenModel(state, contractId).battle?.retreatSignalledAtRound).toBeNull();
  });
});
