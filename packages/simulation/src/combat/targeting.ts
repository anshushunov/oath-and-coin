import { TARGET_REASONS, TargetReasons, type TargetReason } from '../domain/battle-reasons.ts';

import {
  COLUMNS,
  ROWS,
  blockersBetween,
  isColumnClearThrough,
  occupantOf,
  opposing,
  type Column,
  type Positioned
} from './field.ts';
import { StatusId, type BattleUnit } from './unit.ts';

/**
 * Who a unit can reach, and by which road (`COMBAT_SPEC` §4.2).
 *
 * Every answer carries the reason it is that answer, because the reason is what the intent
 * line prints and what the trace records — and `DEC-011` requires that line to stay one
 * line. Reaching depth 2 through an open front cell and walking around an empty column
 * into the neighbour are different sentences about the same board, and a screen that could
 * not tell them apart would be showing the player a move without its cause.
 */

export { TARGET_REASONS, TargetReasons };
export type { TargetReason };

export interface Aim {
  readonly target: BattleUnit;
  readonly reason: TargetReason;
}

const standingEnemiesOf = (actor: Positioned, units: readonly BattleUnit[]): BattleUnit[] =>
  units.filter((unit) => unit.standing && unit.side === opposing(actor.side));

/**
 * Melee, from row 1 (`COMBAT_SPEC` §4.2).
 *
 * Down its own column to the first occupied cell; and if that column is empty through, into
 * the nearest neighbouring column instead. A clear-through column therefore protects
 * nobody — it redirects the blow onto the units beside it, which is the half of §4.4 that
 * makes an empty column a decision rather than a shelter.
 */
export function meleeAim(actor: BattleUnit, units: readonly BattleUnit[]): Aim | null {
  const enemy = opposing(actor.side);
  const ownColumn = firstDown(enemy, actor.cell.column, units);

  if (ownColumn !== null) {
    return {
      target: ownColumn,
      reason:
        ownColumn.cell.row === 1
          ? TargetReasons.FrontOfTheColumn
          : TargetReasons.ReachedThroughTheOpenColumn
    };
  }

  if (!isColumnClearThrough(enemy, actor.cell.column, units)) {
    return null;
  }

  // Nearest by lateral distance, and on a tie the lower column index — stated rather than
  // left to array order, because "whichever came first" is a fact about how the crew was
  // assembled and this answer must not be.
  const neighbours = [...COLUMNS]
    .filter((column) => column !== actor.cell.column)
    .sort(
      (left, right) =>
        Math.abs(left - actor.cell.column) - Math.abs(right - actor.cell.column) || left - right
    );

  for (const column of neighbours) {
    const found = firstDown(enemy, column, units);

    if (found !== null) {
      return { target: found, reason: TargetReasons.WalkedAroundTheEmptyColumn };
    }
  }

  return null;
}

/**
 * The short strike, from row 2: depth one of one's **own** column, and nothing else.
 *
 * It does not go deeper and it does not look sideways. That is the price of the second
 * row's flexibility, and it is what makes "row 2 or row 3" a real choice rather than a
 * preference: the support row reaches over its own front rank without paying obstruction,
 * and pays for it by having exactly one cell it can reach at all.
 */
export function shortAim(actor: BattleUnit, units: readonly BattleUnit[]): Aim | null {
  const target = occupantOf(opposing(actor.side), { row: 1, column: actor.cell.column }, units);

  return target === null ? null : { target, reason: TargetReasons.OverTheFrontRank };
}

/**
 * The shot, from row 3: any standing enemy, and the formation decides which is worth it.
 *
 * Chosen by what actually lands rather than by who is weakest, because obstruction is the
 * thing this row is about: a rear enemy behind two of his own is a worse shot than a front
 * one in the open even when he has less health left. Ties fall to the lower remaining
 * health and then to the lower id, so the answer never depends on input order
 * (`COMBAT_SPEC` §12.1 п.3).
 */
export function rangedAim(
  actor: BattleUnit,
  units: readonly BattleUnit[],
  effectOf: (actor: BattleUnit, target: BattleUnit, blockers: number) => number
): Aim | null {
  const candidates = standingEnemiesOf(actor, units).map((target) => ({
    target,
    effect: effectOf(actor, target, blockersBetween(actor, target, units))
  }));

  if (candidates.length === 0) {
    return null;
  }

  const best = [...candidates].sort(
    (left, right) =>
      right.effect - left.effect ||
      left.target.health - right.target.health ||
      (left.target.id < right.target.id ? -1 : 1)
  )[0];

  return best === undefined ? null : { target: best.target, reason: TargetReasons.ClearestShot };
}

/** The ally with the smallest share of his health left (`COMBAT_SPEC` §5.1). */
export function supportAim(actor: BattleUnit, units: readonly BattleUnit[]): Aim | null {
  const allies = units.filter(
    (unit) => unit.standing && unit.side === actor.side && unit.id !== actor.id
  );

  const worst = [...allies].sort(
    (left, right) =>
      // Compared as fractions by cross-multiplication rather than by dividing: every
      // division in this package truncates, and two units at 3/10 and 7/24 would compare
      // equal under a truncated ratio.
      left.health * right.maxHealth - right.health * left.maxHealth || (left.id < right.id ? -1 : 1)
  )[0];

  return worst === undefined ? null : { target: worst, reason: TargetReasons.TheWorstHurt };
}

/**
 * The enemy hardest to shift is the one worth a status — **unless he already carries it**
 * (`COMBAT_SPEC` §5.1, §3.5).
 *
 * A turn that changes nothing is not a turn, and a refresh changes nothing: §3.5 makes the
 * status refresh rather than stack, so a second caster in the same round buys a duration the
 * target already has. `break_them_first` ranks the status above every attack — the only
 * doctrine that does, and it has to, or one of the four statuses would be out of reach of the
 * whole game — so without this rule its casters spend every round re-applying the same chill
 * to the same man. That is what the owner played in the lab, and his report of it was that his
 * men "hit for nought": in his whole log not one of them struck at all.
 *
 * **Nought, not the next man down the list, and the difference was measured** over the frozen
 * set at all three doctrines (630 battles). Skipping to the next un-chilled enemy removes every
 * refresh and moves no outcome whatever: 159 of 210 battles under this doctrine still run into
 * the round ceiling, because the freed turn goes on chilling somebody else rather than on
 * hitting anybody. Dropping the action instead frees the turn for a shot and takes that to 135.
 * The action is aimed at the hardest to move by rule; when he is already cold, this action has
 * nothing left to do that is worth the round.
 */
export function statusAim(actor: BattleUnit, units: readonly BattleUnit[]): Aim | null {
  const best = [...standingEnemiesOf(actor, units)].sort(
    (left, right) => right.combat.might - left.combat.might || (left.id < right.id ? -1 : 1)
  )[0];

  return best === undefined || best.statuses.has(StatusId.Chilled)
    ? null
    : { target: best, reason: TargetReasons.TheHardestToMove };
}

/**
 * Displacement reaches by the rule of the row the actor is standing in
 * (`COMBAT_SPEC` §4.2).
 *
 * Not an access rule of its own, and that is deliberate: two different reaches for a strike
 * and a shove would mean a `Breaker` hits what a `Vanguard` beside him cannot, from the
 * same cell. Among whoever is reachable, the one least able to keep his footing.
 */
export function shiftAim(actor: BattleUnit, units: readonly BattleUnit[]): Aim | null {
  const reach = actor.cell.row === 1 ? meleeAim(actor, units) : shortAim(actor, units);

  if (reach === null) {
    return null;
  }

  return { target: reach.target, reason: TargetReasons.TheEasiestToMove };
}

function firstDown(
  side: Positioned['side'],
  column: Column,
  units: readonly BattleUnit[]
): BattleUnit | null {
  for (const row of ROWS) {
    const found = occupantOf(side, { row, column }, units);

    if (found !== null) {
      return found;
    }
  }

  return null;
}
