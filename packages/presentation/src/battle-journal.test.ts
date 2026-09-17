import {
  BattleOutcome,
  CombatAction,
  DoctrineId,
  MotiveReasons,
  StatusId,
  TargetReasons,
  type AmountProvenance,
  type BattleEvent
} from '@oath-and-coin/simulation';
import { describe, expect, it } from 'vitest';

import { battleCounterpart, battleWho, sideKeyOf } from './battle-journal.ts';
import { BattleFieldKeys, combatRoleKey } from './keys.ts';

import { fought } from './testing/fought.ts';

/**
 * The second man on a journal line, and the word between the two (`COMBAT_SPEC` §8.1, §10.2).
 *
 * The owner's first play: «непонятно, кто куда бьёт». A line read `Урон Противник Столкновение
 * 10` — who struck, how hard, and nothing about whom. Every event that carries a second man is
 * listed here with the man it carries and the direction it went, and every event that carries
 * none answers `null` rather than inventing one.
 *
 * **The fixtures are typed, and the first version of this file was not.** Review found every
 * awkward row cast through `as never` — and under the cast the provenance carried a field the
 * real type has never had. A fixture the compiler cannot see is one that goes stale in silence
 * the day a field is renamed; these fail to build instead.
 */

const provenance: AmountProvenance = { base: 10, steps: [], final: 10 };

describe('battleCounterpart: who else is on the line, and which way it went', () => {
  it.each<[string, BattleEvent, { unit: string; linkKey: string } | null]>([
    [
      'an intent names its target, pointing at him',
      {
        kind: 'intent_declared',
        actor: 'crew:a',
        action: CombatAction.Strike,
        target: 'foe:a',
        reason: TargetReasons.FrontOfTheColumn,
        contraryTo: null
      },
      { unit: 'foe:a', linkKey: BattleFieldKeys.To }
    ],
    [
      'an intent with nobody in it names nobody',
      {
        kind: 'intent_declared',
        actor: 'crew:a',
        action: CombatAction.Steady,
        target: null,
        reason: TargetReasons.HeldHisGround,
        contraryTo: null
      },
      null
    ],
    [
      'a blow names the man it landed on, pointing at him',
      { kind: 'damage_dealt', actor: 'crew:a', target: 'foe:a', amount: 10, provenance },
      { unit: 'foe:a', linkKey: BattleFieldKeys.To }
    ],
    [
      'a heal names the man it went to, pointing at him',
      { kind: 'healing_done', actor: 'crew:b', target: 'crew:a', amount: 6, provenance },
      { unit: 'crew:a', linkKey: BattleFieldKeys.To }
    ],
    [
      'absorbed damage names whose guard took it, pointing back',
      { kind: 'damage_absorbed', target: 'crew:a', by: 'crew:b', amount: 4 },
      { unit: 'crew:b', linkKey: BattleFieldKeys.From }
    ],
    [
      'a status names who laid it, pointing back',
      {
        kind: 'status_applied',
        target: 'foe:a',
        status: StatusId.Chilled,
        source: 'crew:b',
        rounds: 1,
        refreshed: false
      },
      { unit: 'crew:b', linkKey: BattleFieldKeys.From }
    ],
    [
      'a swap names the partner, with an arrow both ways',
      {
        kind: 'unit_shifted',
        unit: 'crew:a',
        from: { row: 1, column: 1 },
        to: { row: 2, column: 1 },
        forced: false,
        partner: 'crew:b'
      },
      { unit: 'crew:b', linkKey: BattleFieldKeys.With }
    ],
    [
      'a step into an empty cell names nobody — the event carries no shover',
      {
        kind: 'unit_shifted',
        unit: 'foe:a',
        from: { row: 1, column: 1 },
        to: { row: 2, column: 1 },
        forced: true,
        partner: null
      },
      null
    ],
    [
      'a man who held his ground names who tried to move him, pointing back',
      { kind: 'shift_resisted', unit: 'foe:a', by: 'crew:a' },
      { unit: 'crew:a', linkKey: BattleFieldKeys.From }
    ],
    [
      'a man who went down names who put him there, pointing back',
      { kind: 'unit_downed', unit: 'foe:a', by: 'crew:a' },
      { unit: 'crew:a', linkKey: BattleFieldKeys.From }
    ],
    [
      'a status that ran out names nobody else',
      { kind: 'status_expired', target: 'foe:a', status: StatusId.Chilled },
      null
    ],
    ['a pinned man names nobody else', { kind: 'unit_pinned', unit: 'foe:a' }, null],
    ['a spent turn names nobody else', { kind: 'turn_spent', unit: 'crew:a' }, null],
    [
      'a broken doctrine names nobody else',
      {
        kind: 'doctrine_broken',
        unit: 'crew:a',
        doctrine: DoctrineId.HoldTheLine,
        motive: MotiveReasons.StoodByAFriend
      },
      null
    ],
    ['an obeyed retreat names nobody else', { kind: 'retreat_obeyed', unit: 'crew:a' }, null],
    [
      'a refused retreat names nobody else',
      { kind: 'retreat_refused', unit: 'crew:a', motive: MotiveReasons.StoodByAFriend },
      null
    ],
    [
      'the opening names nobody',
      {
        kind: 'battle_started',
        crew: ['crew:a'],
        foes: ['foe:a'],
        doctrine: DoctrineId.HoldTheLine
      },
      null
    ],
    ['a round opening names nobody', { kind: 'round_started', round: 1 }, null],
    ['a retreat signal names nobody', { kind: 'retreat_signalled', round: 2 }, null],
    ['a round closing names nobody', { kind: 'round_ended', round: 1 }, null],
    ['the ending names nobody', { kind: 'battle_ended', outcome: BattleOutcome.CrewStanding }, null]
  ])('%s', (_, event, expected) => {
    expect(battleCounterpart(event)).toEqual(expected);
  });
});

describe('battleWho: what a screen calls a man', () => {
  // Real units off a fought record rather than objects shaped to look like one: a
  // `BattleUnit` carries a combat layer and two sorted maps, and a fixture that typed all of
  // that by hand would be a second definition of the unit.
  const { state, contractId } = fought();
  const units = state.contracts.get(contractId)?.resolution?.battle?.initial.units ?? [];
  const hero = units.find((unit) => unit.hero !== null);
  const foe = units.find((unit) => unit.side === 'foe');

  it('names a hero by his name, and always by his side and his job', () => {
    expect(hero, 'a fight with no hero in it proves nothing here').toBeDefined();

    expect(battleWho(hero!, () => 'hero.core.doran.name')).toEqual({
      displayNameKey: 'hero.core.doran.name',
      sideKey: BattleFieldKeys.Crew,
      roleKey: combatRoleKey(hero!.role)
    });
  });

  it('names a foe by his side and his job, and by no name', () => {
    expect(foe, 'a fight with no foe in it proves nothing here').toBeDefined();
    expect(foe!.hero).toBeNull();

    expect(
      battleWho(foe!, () => {
        throw new Error('a foe has no hero to name');
      })
    ).toEqual({
      displayNameKey: null,
      sideKey: BattleFieldKeys.Foes,
      roleKey: 'battle.role.vanguard'
    });
  });

  it('says one word about a side, the same word the board list says', () => {
    expect(sideKeyOf('crew')).toBe(BattleFieldKeys.Crew);
    expect(sideKeyOf('foe')).toBe(BattleFieldKeys.Foes);
  });
});
