import { CombatRole } from '../domain/combat-role.ts';

import { CombatAction } from '../domain/combat-action.ts';

import { DOCTRINE_PREFERENCE, type DoctrineId } from './doctrine.ts';
import { MotiveReasons, type MotiveReason } from './events.ts';
import { effectPercent, type Row } from './field.ts';
import {
  TargetReasons,
  meleeAim,
  rangedAim,
  shiftAim,
  shortAim,
  statusAim,
  supportAim,
  type Aim,
  type TargetReason
} from './targeting.ts';
import { chillPointsOf, rangedDamageOf, type BattleUnit } from './unit.ts';

/**
 * What a hero does on his turn, and why (`COMBAT_SPEC` §5.1, §7.2, §7.3).
 *
 * `DEC-001` and `DEC-002`: the player gives no order here. What he gave was a doctrine, a
 * crew and a formation, and this is where those become behaviour. `DEC-010` already settled
 * the *model* of a hero's decision, so this is a new set of actions and factors on that
 * core rather than a second core.
 *
 * **Deterministic end to end.** Every preference and every tie is decided by a stated rule
 * (§5.1's two tables), so the same board answers the same way whatever order the units were
 * assembled in — the property `COMBAT_SPEC` §12.1 п.3 holds.
 */

/**
 * How strong a bond has to be before a hero will break formation over it
 * (`COMBAT_SPEC` §7.3).
 *
 * **12, not the 40 the spec's first edition named.** Relationship weights are authored
 * within `RELATIONSHIP_WEIGHT_MIN..MAX`, which is −20..20, so a threshold of 40 was
 * unreachable by any content this game can hold — the control `DIRECTION_2026-08` §4.8
 * calls the most important thing the lab has to prove would never have fired once. Found
 * while wiring the rule to the shipped roster; the number here is the one that has content
 * on both sides of it (`core:mira` holds `core:ilsa` at 14, `core:doran` holds `core:bram`
 * at 10), which is what makes the reaction rare rather than absent.
 */
export const BOND_STRONG = 12;

/** How far a bonded ally has to fall before the reaction fires, in percent of his health. */
export const HELP_THRESHOLD = 40;

export interface CombatDecision {
  readonly action: CombatAction;
  readonly target: BattleUnit | null;
  readonly reason: TargetReason | MotiveReason;
  /** The doctrine this went against, or `null` when it followed it. */
  readonly contraryTo: DoctrineId | null;
}

/** An action a unit could take right now, with what it would be aimed at. */
interface Available {
  readonly action: CombatAction;
  readonly aim: Aim | null;
}

/** Where each role belongs. A home, not a pass (`COMBAT_SPEC` §3.3). */
const HOME_ROW: Readonly<Record<CombatRole, Row>> = Object.freeze({
  [CombatRole.Vanguard]: 1,
  [CombatRole.Support]: 2,
  [CombatRole.Rear]: 3,
  [CombatRole.Breaker]: 1
});

/**
 * Everything this unit could do from the cell it is standing in (`COMBAT_SPEC` §4.1).
 *
 * By the **current** row and not by the role, which is what makes "knock him off his row"
 * a mechanic: a `Vanguard` shoved into the rear has `Reposition` and `Steady` and nothing
 * else, because none of his own actions belong to that row.
 */
export function availableActions(
  actor: BattleUnit,
  units: readonly BattleUnit[]
): readonly Available[] {
  const found: Available[] = [];
  const carry = (action: CombatAction, aim: Aim | null): void => {
    if (aim !== null) {
      found.push({ action, aim });
    }
  };

  if (actor.cell.row === 1) {
    carry(CombatAction.Strike, meleeAim(actor, units));
  }

  if (actor.cell.row === 2) {
    carry(CombatAction.ShortStrike, shortAim(actor, units));
    carry(CombatAction.Support, supportAim(actor, units));
  }

  if (actor.cell.row === 3) {
    carry(CombatAction.Shot, rangedAim(actor, units, shotEffect));
    carry(CombatAction.Status, statusAim(actor, units));
  }

  if (actor.role === CombatRole.Breaker && actor.cell.row !== 3) {
    carry(CombatAction.Shift, shiftAim(actor, units));
  }

  if (actor.cell.row !== HOME_ROW[actor.role]) {
    // Only when he is out of place. Otherwise `hold_the_line`, which reaches for this
    // first, would have everybody shuffling every round instead of fighting.
    found.push({ action: CombatAction.Reposition, aim: null });
  }

  // Always last and always present: "nothing to do" must never be a turn that disappears
  // without a reason (§4.1).
  found.push({ action: CombatAction.Steady, aim: null });

  return found;
}

/**
 * The hero this one would break formation for, or `null` (`COMBAT_SPEC` §7.3).
 *
 * The one motive in M2, and the one place a scale that is not `combat` reaches a battle at
 * all. It changes **which** action is chosen and appears in no `AmountProvenance`
 * (`DEC-016` §4) — the numbers move, because a man who steps out to shield a friend is not
 * striking, and that is the difference between "motive has no effect" and "motive is not a
 * coefficient".
 */
export function friendInTrouble(
  actor: BattleUnit,
  units: readonly BattleUnit[]
): BattleUnit | null {
  return actor.brokeDoctrine ? null : bondedAllyInTrouble(actor, units);
}

/**
 * The same question without the once-a-battle gate: **is somebody he holds dear on the
 * ground right now.**
 *
 * Two callers and two different rules on purpose. Breaking the doctrine happens once per
 * battle (§7.3), because a second breach would make the measured share of battles with a
 * breach uninterpretable. Refusing the retreat signal (§7.4) is not that rule and must not
 * inherit its counter: a man who stepped out for a friend an hour ago and would still not
 * leave him is answering the same question, and a spent flag would have him walk off the
 * field with the friend still down — the one thing `DEC-005` says the signal cannot make
 * him do.
 */
export function bondedAllyInTrouble(
  actor: BattleUnit,
  units: readonly BattleUnit[]
): BattleUnit | null {
  const candidates = units.filter(
    (unit) =>
      unit.standing &&
      unit.side === actor.side &&
      unit.id !== actor.id &&
      (actor.bonds.get(unit.id) ?? 0) >= BOND_STRONG &&
      unit.health * 100 < unit.maxHealth * HELP_THRESHOLD
  );

  // The one he holds dearest, then the worse hurt, then the lower id — three rules, so the
  // answer never depends on how the crew was assembled.
  return (
    [...candidates].sort(
      (left, right) =>
        (actor.bonds.get(right.id) ?? 0) - (actor.bonds.get(left.id) ?? 0) ||
        left.health * right.maxHealth - right.health * left.maxHealth ||
        (left.id < right.id ? -1 : 1)
    )[0] ?? null
  );
}

/**
 * What this unit does now.
 *
 * Three steps in order (§5.1): what is available at all, then the motive if it fires, then
 * the doctrine's own ranking. The motive is checked before the doctrine and not after,
 * which is what "even against the doctrine" means mechanically.
 */
export function decideCombatAction(
  actor: BattleUnit,
  units: readonly BattleUnit[],
  doctrine: DoctrineId
): CombatDecision {
  const available = availableActions(actor, units);
  const byDoctrine = firstPreferred(available, doctrine);
  const friend = friendInTrouble(actor, units);

  if (friend !== null) {
    const helping = helpFor(friend, available);

    if (helping !== null && helping.action !== byDoctrine.action) {
      return {
        action: helping.action,
        target: helping.aim?.target ?? friend,
        reason: MotiveReasons.StoodByAFriend,
        contraryTo: doctrine
      };
    }
  }

  return {
    action: byDoctrine.action,
    target: byDoctrine.aim?.target ?? null,
    // An action with no target still names why it was taken. `Reposition` and `Steady` are
    // the two, and giving them a borrowed reason — or none — would put a line on the
    // debrief that explains a different turn than the one that happened.
    reason: byDoctrine.aim?.reason ?? reasonForTargetless(byDoctrine.action),
    contraryTo: null
  };
}

function reasonForTargetless(action: CombatAction): TargetReason {
  return action === CombatAction.Reposition
    ? TargetReasons.BackToHisRow
    : TargetReasons.HeldHisGround;
}

/**
 * The action that helps `friend`, if this unit has one.
 *
 * Support if he can reach him with it, otherwise a step back toward his own row so that he
 * can. Nothing else counts as help: striking somebody at random because a friend is hurt is
 * a mood, not a decision, and it would make the breach unreadable on the screen.
 */
function helpFor(friend: BattleUnit, available: readonly Available[]): Available | null {
  const support = available.find(
    (option) => option.action === CombatAction.Support && option.aim?.target.id === friend.id
  );

  if (support !== undefined) {
    return support;
  }

  return available.find((option) => option.action === CombatAction.Reposition) ?? null;
}

function firstPreferred(available: readonly Available[], doctrine: DoctrineId): Available {
  for (const action of DOCTRINE_PREFERENCE[doctrine]) {
    const found = available.find((option) => option.action === action);

    if (found !== undefined) {
      return found;
    }
  }

  // Unreachable by construction — `Steady` is in every preference list and in every set of
  // available actions — and thrown rather than defaulted, because a silent fallback here
  // would be a turn taken for a reason nobody stated.
  throw new Error(
    `No action for a unit under '${doctrine}'. Every doctrine ranks 'steady' and every unit ` +
      'has it available, so this means one of the two lists has stopped being complete.'
  );
}

/** What a shot would land for, used to choose between shots (`COMBAT_SPEC` §5.1). */
function shotEffect(actor: BattleUnit, target: BattleUnit, blockers: number): number {
  void target;

  return Math.floor(
    (rangedDamageOf(actor.combat) * effectPercent(blockers, chillPointsOf(actor))) / 100
  );
}
