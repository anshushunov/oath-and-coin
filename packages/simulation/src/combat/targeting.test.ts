import { describe, expect, it } from 'vitest';

import { CombatRole } from '../domain/combat-role.ts';

import { blockersBetween, type BattleSide, type Column, type Row } from './field.ts';
import {
  TargetReasons,
  meleeAim,
  rangedAim,
  shiftAim,
  shortAim,
  statusAim,
  supportAim
} from './targeting.ts';
import { StatusId, rangedDamageOf, unitFrom, withStatus, type BattleUnit } from './unit.ts';

/**
 * `COMBAT_SPEC` §4.2, case by case — including the cases `DEC-011` listed as *not*
 * accepted, which is what this file exists to close.
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

describe('melee walks its own column, then round an empty one', () => {
  const attacker = unit('crew:a', 'crew', 1, 2);

  it('strikes the enemy front cell of its own column when there is one', () => {
    const front = unit('foe:front', 'foe', 1, 2);
    const aim = meleeAim(attacker, [attacker, front]);

    expect(aim?.target.id).toBe('foe:front');
    expect(aim?.reason).toBe(TargetReasons.FrontOfTheColumn);
  });

  it('reaches depth two when the front cell is empty — the corridor of §4.4', () => {
    const support = unit('foe:support', 'foe', 2, 2);
    const aim = meleeAim(attacker, [attacker, support]);

    expect(aim?.target.id).toBe('foe:support');
    expect(aim?.reason).toBe(TargetReasons.ReachedThroughTheOpenColumn);
  });

  it('reaches the rear when both cells in front of it are empty', () => {
    const rear = unit('foe:rear', 'foe', 3, 2);

    expect(meleeAim(attacker, [attacker, rear])?.target.id).toBe('foe:rear');
  });

  it('goes round a column that is clear through, into the nearest neighbour', () => {
    const left = unit('foe:left', 'foe', 2, 1);
    const right = unit('foe:right', 'foe', 3, 3);
    const aim = meleeAim(attacker, [attacker, left, right]);

    // Both neighbours are one column away, so the tie falls to the lower index — stated by
    // the rule rather than left to the order the crew was assembled in.
    expect(aim?.target.id).toBe('foe:left');
    expect(aim?.reason).toBe(TargetReasons.WalkedAroundTheEmptyColumn);
  });

  it('prefers the nearer neighbour over the further one', () => {
    const attackerLeft = unit('crew:a', 'crew', 1, 1);
    const middle = unit('foe:middle', 'foe', 1, 2);
    const far = unit('foe:far', 'foe', 1, 3);

    expect(meleeAim(attackerLeft, [attackerLeft, middle, far])?.target.id).toBe('foe:middle');
  });

  it('has nobody to strike when no enemy stands at all', () => {
    expect(meleeAim(attacker, [attacker])).toBeNull();
  });

  it('walks past the fallen, who occupy nothing', () => {
    const fallen = unit('foe:fallen', 'foe', 1, 2, { standing: false });
    const behind = unit('foe:behind', 'foe', 2, 2);

    expect(meleeAim(attacker, [attacker, fallen, behind])?.target.id).toBe('foe:behind');
  });
});

describe('the short strike reaches one cell and no other', () => {
  const support = unit('crew:s', 'crew', 2, 2);

  it('reaches the enemy front cell of its own column', () => {
    const front = unit('foe:front', 'foe', 1, 2);

    expect(shortAim(support, [support, front])?.reason).toBe(TargetReasons.OverTheFrontRank);
  });

  it('has no target when that cell is empty — it neither goes deeper nor sideways', () => {
    const deeper = unit('foe:deep', 'foe', 2, 2);
    const beside = unit('foe:beside', 'foe', 1, 1);

    expect(shortAim(support, [support, deeper, beside])).toBeNull();
  });
});

describe('the shot is chosen by what lands, not by who is weakest', () => {
  const shooter = unit('crew:r', 'crew', 3, 2, { role: CombatRole.Rear });
  const effectOf = (actor: BattleUnit, _target: BattleUnit, blockers: number): number =>
    Math.max(1, rangedDamageOf(actor.combat) - blockers * 3);

  it('passes over a hurt enemy behind cover for a healthier one in the open', () => {
    const hurtBehindCover = unit('foe:rear', 'foe', 3, 1, { health: 3 });
    const cover = [unit('foe:front', 'foe', 1, 1), unit('foe:support', 'foe', 2, 1)];
    const inTheOpen = unit('foe:open', 'foe', 1, 3, { health: 8 });
    const all = [shooter, hurtBehindCover, ...cover, inTheOpen];

    // Three blockers in front of the rear enemy — two of his own and one column of angle —
    // against one for the open one. The hurt man is the weaker target and the worse shot,
    // and that is the whole reason a rear unit cares where the enemy stands rather than
    // only how hurt he is.
    expect(blockersBetween(shooter, hurtBehindCover, all)).toBe(3);
    expect(blockersBetween(shooter, inTheOpen, all)).toBe(1);
    // The cover itself is reachable at the same one blocker, so the tie falls to the lower
    // remaining health — which is what puts the open man ahead of it.
    expect(blockersBetween(shooter, cover[0]!, all)).toBe(1);
    expect(rangedAim(shooter, all, effectOf)?.target.id).toBe('foe:open');
  });

  it('breaks a tie on the lower remaining health, then on the id', () => {
    const hurt = unit('foe:hurt', 'foe', 1, 2, { health: 4 });
    const whole = unit('foe:whole', 'foe', 1, 2, { health: 20 });
    // Deliberately built as two units claiming one cell, which the board would refuse:
    // what is under test is the ordering, and posing it on two legal cells would add an
    // obstruction difference and stop it being a tie at all.
    const all = [shooter, hurt, whole];

    expect(rangedAim(shooter, all, () => 5)?.target.id).toBe('foe:hurt');
  });

  it('does not depend on the order the units arrived in', () => {
    const first = unit('foe:a', 'foe', 1, 1);
    const second = unit('foe:b', 'foe', 1, 3);
    const forward = rangedAim(shooter, [shooter, first, second], effectOf);
    const backward = rangedAim(shooter, [second, first, shooter], effectOf);

    expect(forward?.target.id).toBe(backward?.target.id);
  });
});

describe('support, status and displacement each name their own reason', () => {
  it('support goes to the worst hurt by share, not by points', () => {
    const healer = unit('crew:h', 'crew', 2, 2, { role: CombatRole.Support });
    const big = unit('crew:big', 'crew', 1, 1, { health: 20, maxHealth: 50 });
    const small = unit('crew:small', 'crew', 1, 3, { health: 8, maxHealth: 16 });

    // Two fifths against one half: the big man is the worse hurt, and he is also the one
    // with *more* health left in points — which is exactly the comparison a rule reading
    // raw health would get backwards.
    expect(supportAim(healer, [healer, big, small])?.target.id).toBe('crew:big');
    expect(supportAim(healer, [healer, big, small])?.reason).toBe(TargetReasons.TheWorstHurt);
  });

  it('support has nobody to help when it stands alone', () => {
    const healer = unit('crew:h', 'crew', 2, 2, { role: CombatRole.Support });

    expect(supportAim(healer, [healer])).toBeNull();
  });

  it('a status goes to the enemy hardest to shift', () => {
    const caster = unit('crew:c', 'crew', 3, 2, { role: CombatRole.Rear });
    const strong = unit('foe:strong', 'foe', 1, 1, { combat: { ...AVERAGE, might: 90 } });
    const weak = unit('foe:weak', 'foe', 1, 3, { combat: { ...AVERAGE, might: 10 } });

    expect(statusAim(caster, [caster, strong, weak])?.target.id).toBe('foe:strong');
  });

  it('has nobody to aim a status at when the hardest to shift already carries it', () => {
    const caster = unit('crew:c', 'crew', 3, 2, { role: CombatRole.Rear });
    const strong = withStatus(
      unit('foe:strong', 'foe', 1, 1, { combat: { ...AVERAGE, might: 90 } }),
      StatusId.Chilled,
      'crew:c'
    ).unit;
    const weak = unit('foe:weak', 'foe', 1, 3, { combat: { ...AVERAGE, might: 10 } });

    // **Null with a weaker enemy standing right there, and that is the point.** A turn that
    // changes nothing is not a turn (owner's decision, 2026-08-31): the status is aimed at
    // the hardest to move, and when he already carries it there is nothing this action can
    // do that is worth the round. Redirecting it onto the next man instead was measured
    // over the same 630 battles and moved no outcome at all — the refreshes went away and
    // 159 of 210 battles still ran into the ceiling — because the freed turn went on
    // chilling somebody else rather than on hitting anybody.
    expect(statusAim(caster, [caster, strong, weak])).toBeNull();
  });

  it('displacement borrows the reach of the row it is thrown from', () => {
    const fromFront = unit('crew:b', 'crew', 1, 2, { role: CombatRole.Breaker });
    const fromSupport = unit('crew:b', 'crew', 2, 2, { role: CombatRole.Breaker });
    const deep = unit('foe:deep', 'foe', 2, 2);

    // Row 1 reaches through the open front cell; row 2 does not go deeper at all, and the
    // difference is the reason displacement has no access rule of its own.
    expect(shiftAim(fromFront, [fromFront, deep])?.target.id).toBe('foe:deep');
    expect(shiftAim(fromSupport, [fromSupport, deep])).toBeNull();
  });
});
