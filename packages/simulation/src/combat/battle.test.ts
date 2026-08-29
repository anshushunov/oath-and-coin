import { describe, expect, it } from 'vitest';

import { SortedMap } from '../collections/sorted-map.ts';
import { compareStrings } from '../collections/comparator.ts';
import { CombatRole } from '../domain/combat-role.ts';

import { MAX_ROUNDS, runBattle, runRound, startBattle } from './battle.ts';
import { BOND_STRONG } from './decision.ts';
import { DoctrineId } from './doctrine.ts';
import { BattleOutcome } from './events.ts';
import type { BattleSide, Column, Row } from './field.ts';
import { StatusId, unitFrom, type BattleUnit, type BattleUnitId } from './unit.ts';

/**
 * The round, the outcome and the properties `COMBAT_SPEC` §12.1 asks for.
 */

const AVERAGE = { might: 50, guard: 50, aim: 50, focus: 50, care: 50 };

function unit(
  id: string,
  side: BattleSide,
  row: Row,
  column: Column,
  overrides: Partial<BattleUnit> = {}
): BattleUnit {
  return {
    ...unitFrom({
      id,
      side,
      hero: null,
      role: CombatRole.Vanguard,
      cell: { row, column },
      combat: AVERAGE
    }),
    ...overrides
  };
}

const bonds = (entries: readonly (readonly [BattleUnitId, number])[]): SortedMap<string, number> =>
  SortedMap.from(compareStrings, entries);

const kinds = (events: readonly { readonly kind: string }[]): readonly string[] =>
  events.map((event) => event.kind);

describe('a round gives every standing unit exactly one turn', () => {
  it('declares an intent for each of them, and no more', () => {
    const units = [
      unit('crew:a', 'crew', 1, 1),
      unit('crew:b', 'crew', 1, 2),
      unit('foe:a', 'foe', 1, 1),
      unit('foe:b', 'foe', 1, 2)
    ];

    const { events } = runRound(startBattle(units, DoctrineId.HoldTheLine));

    expect(kinds(events).filter((kind) => kind === 'intent_declared')).toHaveLength(4);
  });

  it('skips a spent unit with a turn_spent rather than in silence', () => {
    // §4.1: "nothing to do" must never be a turn that disappears — and neither must a turn
    // somebody else took away.
    const units = [unit('crew:a', 'crew', 1, 1, { spent: true }), unit('foe:a', 'foe', 1, 1)];

    const { events, state } = runRound(startBattle(units, DoctrineId.HoldTheLine));

    expect(kinds(events)).toContain('turn_spent');
    expect(state.units.find((one) => one.id === 'crew:a')?.spent).toBe(false);
  });

  it('orders by focus, then by id — never by the order the crew was assembled in', () => {
    const quick = unit('crew:z_quick', 'crew', 1, 1, { combat: { ...AVERAGE, focus: 90 } });
    const slow = unit('crew:a_slow', 'crew', 1, 2, { combat: { ...AVERAGE, focus: 10 } });
    const foe = unit('foe:a', 'foe', 1, 3);

    const forward = runRound(startBattle([quick, slow, foe], DoctrineId.HoldTheLine));
    const backward = runRound(startBattle([foe, slow, quick], DoctrineId.HoldTheLine));

    expect(forward.events).toEqual(backward.events);

    const first = forward.events.find((event) => event.kind === 'intent_declared');

    expect(first).toMatchObject({ actor: 'crew:z_quick' });
  });
});

describe('a battle ends, and says how', () => {
  it('ends the moment one side has nobody standing', () => {
    const strong = unit('crew:a', 'crew', 1, 1, { combat: { ...AVERAGE, might: 100 } });
    const frail = unit('foe:a', 'foe', 1, 1, { health: 1 });
    const record = runBattle(startBattle([strong, frail], DoctrineId.HoldTheLine));

    expect(record.outcome).toBe(BattleOutcome.CrewStanding);
    expect(kinds(record.events)).toContain('unit_downed');
    expect(record.events.at(-1)).toEqual({
      kind: 'battle_ended',
      outcome: BattleOutcome.CrewStanding
    });
  });

  it('times out rather than running for ever, and says that is what happened', () => {
    // Two units who cannot hurt each other at all: nobody falls, so the only way this ends
    // is the round ceiling.
    const stalemate = [
      unit('crew:a', 'crew', 3, 1, { role: CombatRole.Rear, maxHealth: 9999, health: 9999 }),
      unit('foe:a', 'foe', 3, 1, { role: CombatRole.Rear, maxHealth: 9999, health: 9999 })
    ];

    const record = runBattle(startBattle(stalemate, DoctrineId.HoldTheLine));

    expect(record.rounds).toBe(MAX_ROUNDS);
    expect(record.outcome).toBe(BattleOutcome.TimedOut);
  });

  it('refuses a formation with two units on one cell, before a single event', () => {
    expect(() =>
      startBattle(
        [unit('crew:a', 'crew', 1, 1), unit('crew:b', 'crew', 1, 1)],
        DoctrineId.HoldTheLine
      )
    ).toThrow(/cell_taken/);
  });
});

describe('the properties COMBAT_SPEC §12.1 states', () => {
  const crew = [
    unit('crew:van', 'crew', 1, 2),
    unit('crew:sup', 'crew', 2, 2, { role: CombatRole.Support }),
    unit('crew:rear', 'crew', 3, 1, { role: CombatRole.Rear })
  ];
  const foes = [
    unit('foe:van', 'foe', 1, 2),
    unit('foe:break', 'foe', 1, 1, { role: CombatRole.Breaker }),
    unit('foe:rear', 'foe', 3, 3, { role: CombatRole.Rear })
  ];

  it('is deterministic: the same board answers the same way twice', () => {
    const once = runBattle(startBattle([...crew, ...foes], DoctrineId.HoldTheLine));
    const twice = runBattle(startBattle([...crew, ...foes], DoctrineId.HoldTheLine));

    expect(JSON.stringify(once.events)).toBe(JSON.stringify(twice.events));
  });

  it('does not depend on the order the units were handed in', () => {
    const forward = runBattle(startBattle([...crew, ...foes], DoctrineId.HoldTheLine));
    const shuffled = runBattle(
      startBattle(
        [foes[2]!, crew[1]!, foes[0]!, crew[2]!, foes[1]!, crew[0]!],
        DoctrineId.HoldTheLine
      )
    );

    expect(JSON.stringify(forward.events)).toBe(JSON.stringify(shuffled.events));
  });

  it('can take every number apart: base plus every delta is the final', () => {
    const record = runBattle(startBattle([...crew, ...foes], DoctrineId.BreakThemFirst));
    let checked = 0;

    for (const event of record.events) {
      if (event.kind !== 'damage_dealt' && event.kind !== 'healing_done') {
        continue;
      }

      const { provenance } = event;
      const sum = provenance.steps.reduce((total, step) => total + step.delta, provenance.base);

      expect(sum, JSON.stringify(event)).toBe(provenance.final);
      checked += 1;
    }

    // A vacuous pass is the failure this guards against: a battle that produced no numbers
    // would satisfy the loop above and prove nothing.
    expect(checked).toBeGreaterThan(0);
  });

  it('answers differently under a different doctrine — otherwise the order is decoration', () => {
    const holding = runBattle(startBattle([...crew, ...foes], DoctrineId.HoldTheLine));
    const breaking = runBattle(startBattle([...crew, ...foes], DoctrineId.BreakThemFirst));

    expect(JSON.stringify(holding.events)).not.toBe(JSON.stringify(breaking.events));
  });
});

describe('displacement, and what it costs the man behind', () => {
  it('shoves a weaker unit one cell toward its own rear', () => {
    const breaker = unit('crew:b', 'crew', 1, 2, {
      role: CombatRole.Breaker,
      combat: { ...AVERAGE, might: 100 }
    });
    const shovable = unit('foe:v', 'foe', 1, 2, { combat: { ...AVERAGE, guard: 10 } });
    const { events, state } = runRound(startBattle([breaker, shovable], DoctrineId.BreakThemFirst));

    expect(kinds(events)).toContain('unit_shifted');
    expect(state.units.find((one) => one.id === 'foe:v')?.cell).toEqual({ row: 2, column: 2 });
  });

  it('costs the ally behind his next action when the cell is taken', () => {
    const breaker = unit('crew:b', 'crew', 1, 2, {
      role: CombatRole.Breaker,
      combat: { ...AVERAGE, might: 100, focus: 99 }
    });
    const front = unit('foe:front', 'foe', 1, 2, { combat: { ...AVERAGE, guard: 10, focus: 1 } });
    const behind = unit('foe:behind', 'foe', 2, 2, { combat: { ...AVERAGE, focus: 1 } });

    const { state, events } = runRound(
      startBattle([breaker, front, behind], DoctrineId.BreakThemFirst)
    );

    // They changed places, and **both** paid for it — the third of §4.5's benefits, read
    // from the losing side: a crowded formation is the one that holds displacement worst.
    const shoved = state.units.find((one) => one.id === 'foe:front');
    const displaced = state.units.find((one) => one.id === 'foe:behind');

    expect(shoved?.cell).toEqual({ row: 2, column: 2 });
    expect(displaced?.cell).toEqual({ row: 1, column: 2 });
    // The half a check on the cells alone cannot see, and a live mutant found it: a swap
    // that moved both and charged neither passed every assertion above. The price *is* the
    // benefit of an empty cell, so a swap that is free makes §4.5 say nothing.
    //
    // Read off the events rather than off the flag at the end of the round: the flag is
    // consumed the moment each of them comes to act, so by then it is `false` on both
    // whether they were charged or not. What survives is the shape of the round — one
    // intent, from the breaker, and two turns nobody took.
    expect(kinds(events).filter((kind) => kind === 'intent_declared')).toHaveLength(1);
    expect(kinds(events).filter((kind) => kind === 'turn_spent')).toHaveLength(2);
  });

  it('pins a unit already at the back wall instead of losing the shove', () => {
    const breaker = unit('crew:b', 'crew', 1, 2, {
      role: CombatRole.Breaker,
      combat: { ...AVERAGE, might: 100 }
    });
    const cornered = unit('foe:r', 'foe', 3, 2, { combat: { ...AVERAGE, guard: 10 } });
    const { events } = runRound(startBattle([breaker, cornered], DoctrineId.BreakThemFirst));

    expect(kinds(events)).toContain('unit_pinned');
  });

  it('is resisted when might does not beat stability, and the turn is still spent', () => {
    const breaker = unit('crew:b', 'crew', 1, 2, {
      role: CombatRole.Breaker,
      combat: { ...AVERAGE, might: 10 }
    });
    const solid = unit('foe:v', 'foe', 1, 2, { combat: { ...AVERAGE, guard: 90 } });
    const { events } = runRound(startBattle([breaker, solid], DoctrineId.BreakThemFirst));

    expect(kinds(events)).toContain('shift_resisted');
    expect(kinds(events)).not.toContain('unit_shifted');
  });
});

describe('the personality reaction, which is what the lab is for', () => {
  const hurtFriend = unit('crew:friend', 'crew', 1, 2, { health: 5, maxHealth: 35 });
  // In the column the loyal one can reach with a short strike, so his doctrine has
  // something else to prefer — otherwise the doctrine would choose support anyway and
  // there would be nothing for the motive to overrule.
  const foe = unit('foe:a', 'foe', 1, 2);

  it('breaks the doctrine to help a bonded ally, and says so', () => {
    const loyal = unit('crew:loyal', 'crew', 2, 2, {
      role: CombatRole.Support,
      bonds: bonds([['crew:friend', BOND_STRONG]])
    });

    const { events } = runRound(startBattle([loyal, hurtFriend, foe], DoctrineId.BreakThemFirst));

    const broken = events.find((event) => event.kind === 'doctrine_broken');

    expect(broken).toMatchObject({
      unit: 'crew:loyal',
      doctrine: DoctrineId.BreakThemFirst,
      motive: 'combat.motive.stood_by_a_friend'
    });
  });

  it('does not break it for somebody it barely knows — the same board, one number apart', () => {
    // The control `DIRECTION_2026-08` §4.8 asks for, in its smallest form: two heroes with
    // identical attributes, identical role and identical cell, and the only difference
    // between the two runs is what one of them thinks of a third man.
    const distant = unit('crew:loyal', 'crew', 2, 2, {
      role: CombatRole.Support,
      bonds: bonds([['crew:friend', BOND_STRONG - 1]])
    });

    const { events } = runRound(startBattle([distant, hurtFriend, foe], DoctrineId.BreakThemFirst));

    expect(kinds(events)).not.toContain('doctrine_broken');
  });

  it('is not a breach when the doctrine would have helped him anyway', () => {
    // The case a mutant survived without: the bond qualifies and the friend is losing, so
    // the reaction *fires* — and `spare_the_people` already ranks support first, so the
    // action it chooses is the action the doctrine chose. Nothing was broken, and a rule
    // that announced a breach here would put "вопреки доктрине" on a screen beside a hero
    // doing exactly what he was told.
    const loyal = unit('crew:loyal', 'crew', 2, 2, {
      role: CombatRole.Support,
      bonds: bonds([['crew:friend', BOND_STRONG]])
    });

    const { events } = runRound(startBattle([loyal, hurtFriend, foe], DoctrineId.SpareThePeople));

    expect(kinds(events)).not.toContain('doctrine_broken');
    // And it did help him — otherwise this would pass for the wrong reason, by the
    // reaction not firing at all.
    expect(events).toContainEqual(
      expect.objectContaining({ kind: 'healing_done', actor: 'crew:loyal', target: 'crew:friend' })
    );
  });

  it('fires once in a battle and not again', () => {
    const loyal = unit('crew:loyal', 'crew', 2, 2, {
      role: CombatRole.Support,
      bonds: bonds([['crew:friend', 20]]),
      combat: { ...AVERAGE, care: 0 }
    });
    const record = runBattle(startBattle([loyal, hurtFriend, foe], DoctrineId.BreakThemFirst));

    expect(record.events.filter((event) => event.kind === 'doctrine_broken')).toHaveLength(1);
  });
});

describe('statuses expire, and bleeding names who caused it', () => {
  it('takes a status off after its rounds and says so', () => {
    const caster = unit('crew:c', 'crew', 3, 2, { role: CombatRole.Rear });
    const victim = unit('foe:v', 'foe', 1, 2);
    // `break_them_first` is the doctrine that puts control ahead of damage, and therefore
    // the only one under which a status is ever applied at all (`doctrine.ts`).
    const first = runRound(startBattle([caster, victim], DoctrineId.BreakThemFirst));

    expect(kinds(first.events)).toContain('status_applied');
    expect(
      first.events.filter(
        (event) => event.kind === 'status_expired' && event.status === StatusId.Chilled
      )
    ).toHaveLength(1);
  });
});
