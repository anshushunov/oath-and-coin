import { describe, expect, it } from 'vitest';

import {
  BATTLE_LOADING_SCREEN,
  battleFailedScreen,
  battleScreenModel,
  createBattleScreenModel,
  type BattleScreenContent
} from './battle-screen-model.ts';
import { readModelHash } from './screen-model.ts';
import { ScreenState } from './screen-state.ts';
import { parseContentId } from '@oath-and-coin/simulation';

import { fought, resolvedWithoutBattle } from './testing/fought.ts';

/**
 * The battle screen as a position in a finished record (`COMBAT_SPEC` §10.2).
 *
 * Built from a campaign that went to a fight through the **real commands**, never from a
 * record somebody typed: what has to be true is that this reads the shape the engine
 * produces.
 */

const battle = fought();

const at = (applied: number) => battleScreenModel(battle.state, battle.contractId, { applied });

const events = battle.state.contracts.get(battle.contractId)?.resolution?.battle?.events ?? [];

describe('the five states are five positions and not five moods', () => {
  it('is Incomplete while the feed is inside the battle', () => {
    expect(at(0).state).toBe(ScreenState.Incomplete);
    expect(at(1).state).toBe(ScreenState.Incomplete);
    expect(at(events.length - 1).state).toBe(ScreenState.Incomplete);
  });

  it('is Normal once every event has been applied, and only then carries an outcome', () => {
    const finished = at(events.length);

    expect(finished.state).toBe(ScreenState.Normal);
    expect(finished.outcomeKey).not.toBeNull();
    expect(at(events.length - 1).outcomeKey).toBeNull();
  });

  it('is Empty on a contract that was never going to fight', () => {
    // Not an error and not a battle waiting to start: `ADR-016` §5 routes a contract with no
    // plan to the abstract resolver, and there is nothing here to watch — ever.
    const abstract = resolvedWithoutBattle();
    const model = battleScreenModel(abstract.state, abstract.contractId, { applied: 0 });

    expect(model.state).toBe(ScreenState.Empty);
    expect(model.units).toHaveLength(0);
    expect(model.retreat).toBeNull();
  });

  it('is Loading and Error only as the two constants, which carry no fight at all', () => {
    expect(BATTLE_LOADING_SCREEN.state).toBe(ScreenState.Loading);
    expect(BATTLE_LOADING_SCREEN.units).toHaveLength(0);
    expect(battleFailedScreen('CONTENT_ROOT_NOT_FOUND', 'nowhere').state).toBe(ScreenState.Error);
  });

  it('refuses a contract the campaign does not carry, because that is a routing bug', () => {
    expect(() =>
      battleScreenModel(battle.state, parseContentId('core:no_such_contract'), { applied: 0 })
    ).toThrow(/no such contract/u);
  });
});

describe('what moves as the feed moves', () => {
  it('shows nobody’s intent before anybody has declared one', () => {
    expect(at(0).intent).toBeNull();
  });

  it('shows the last intent declared, and not the first', () => {
    const declarations = events
      .map((event, index) => ({ event, index }))
      .filter(({ event }) => event.kind === 'intent_declared');

    expect(declarations.length).toBeGreaterThan(1);

    const first = declarations[0]!;
    const second = declarations[1]!;

    expect(at(first.index + 1).intent?.unit).toBe(
      first.event.kind === 'intent_declared' ? first.event.actor : null
    );
    expect(at(second.index + 1).intent?.unit).toBe(
      second.event.kind === 'intent_declared' ? second.event.actor : null
    );
  });

  it('grows the journal by exactly one line per event applied', () => {
    for (const applied of [0, 1, 5, events.length]) {
      expect(at(applied).journal, `after ${String(applied)}`).toHaveLength(
        Math.min(applied, events.length)
      );
    }
  });

  it('counts the round the battle itself counts, not the events', () => {
    expect(at(events.length).round).toBe(
      battle.state.contracts.get(battle.contractId)?.resolution?.battle?.rounds
    );
  });

  it('clamps a position past the end rather than answering with a half-built screen', () => {
    expect(at(events.length + 500)).toEqual(at(events.length));
  });
});

describe('the retreat button (DEC-005, COMBAT_SPEC §7.4)', () => {
  it('cannot be pressed before the first round has started', () => {
    // A signal at round nought is one given before the battle began, which `resolveContract`
    // refuses by name (§11). The button says so rather than offering a press the engine
    // would throw back.
    expect(at(0).retreat?.atRound).toBeNull();
  });

  it('signals for the round the feed is standing in, once one has started', () => {
    const firstRound = events.findIndex((event) => event.kind === 'round_started') + 1;
    const model = at(firstRound);

    expect(model.retreat?.atRound).toBe(model.round);
    expect(model.round).toBeGreaterThanOrEqual(1);
  });

  it('cannot be pressed once the fight is over, because there is nothing to withdraw from', () => {
    expect(at(events.length).retreat?.atRound).toBeNull();
  });

  it('carries its cost whether or not it can be pressed', () => {
    // §10.2: "a separate button with its price on it". A price that appeared only when the
    // button was live would be a price the player reads *after* deciding to look for it.
    for (const applied of [0, 1, events.length]) {
      expect(at(applied).retreat?.costKey, `after ${String(applied)}`).toBeTruthy();
    }
  });
});

describe('what the screen may not be handed', () => {
  it('refuses a unit with an id and no name to show for it', () => {
    const model = at(events.length);
    const named = model.units.find((unit) => unit.heroDefinition !== null);

    expect(named, 'no crewman in this fixture is a hero').toBeDefined();
    expect(() =>
      createBattleScreenModel({
        ...(model as BattleScreenContent),
        units: model.units.map((unit) =>
          unit === named ? { ...unit, displayNameKey: null } : unit
        )
      })
    ).toThrow(/half a hero/u);
  });

  it('refuses a unit that is both standing and gone', () => {
    const model = at(events.length);

    expect(() =>
      createBattleScreenModel({
        ...(model as BattleScreenContent),
        units: model.units.map((unit, index) =>
          index === 0 ? { ...unit, standing: true, leftKey: 'battle.field.downed' } : unit
        )
      })
    ).toThrow(/standing and gone/u);
  });

  it('refuses a fight with no retreat lever on it', () => {
    // `DEC-005` gives the player one thing to do during a battle and `MVP_PLAN` §6.4 decides
    // that decision by how often he reaches for it. A screen without the button takes the
    // measurement away, and a spread of a correct model is all it took.
    expect(() =>
      createBattleScreenModel({ ...(at(1) as BattleScreenContent), retreat: null })
    ).toThrow(/one lever a player has/u);
  });

  it('refuses a live retreat button on a fight that is over', () => {
    const finished = at(events.length);

    expect(() =>
      createBattleScreenModel({
        ...(finished as BattleScreenContent),
        retreat: { ...finished.retreat!, atRound: 3 }
      })
    ).toThrow(/finished battle offers no retreat/u);
  });

  it('refuses a retreat that is both offered and already given', () => {
    const playing = at(events.findIndex((event) => event.kind === 'round_started') + 1);

    expect(playing.retreat?.atRound).not.toBeNull();
    expect(() =>
      createBattleScreenModel({
        ...(playing as BattleScreenContent),
        retreat: { ...playing.retreat!, givenAtRound: 1 }
      })
    ).toThrow(/still a choice or already a fact/u);
  });

  it('refuses an outcome on a fight that has not finished', () => {
    expect(() =>
      createBattleScreenModel({
        ...(at(1) as BattleScreenContent),
        outcomeKey: 'battle.outcome.crew_standing'
      })
    ).toThrow(/exactly when the state is Normal/u);
  });

  it('refuses a spread that claims to be another screen', () => {
    const foreign = { screen: 'contract_board' } as unknown as Record<string, never>;

    expect(
      createBattleScreenModel({ ...(BATTLE_LOADING_SCREEN as BattleScreenContent), ...foreign })
        .screen
    ).toBe('battle');
  });
});

describe('the read-model hash', () => {
  it('answers for every position, and answers differently for different ones', () => {
    const hashes = new Set([0, 1, 2, events.length].map((applied) => readModelHash(at(applied))));

    expect(hashes.size).toBe(4);

    for (const hash of hashes) {
      expect(hash).toMatch(/^[0-9a-f]{64}$/u);
    }
  });

  it('is a function of the position alone, so two readings of one frame agree', () => {
    expect(readModelHash(at(7))).toBe(readModelHash(at(7)));
  });
});
