import { compareStrings } from '../collections/comparator.ts';
import { SortedMap } from '../collections/sorted-map.ts';
import type { BattleRecord, BattleState } from '../domain/battle-record.ts';
import { CombatRole } from '../domain/combat-role.ts';

import { bondedAllyInTrouble, decideCombatAction } from './decision.ts';
import type { DoctrineId } from './doctrine.ts';
import { absorbedBy, applyEffect } from './effect.ts';
import { BattleOutcome, CombatAction, type BattleEvent } from './events.ts';
import { isAdjacent, occupantOf, opposing, type Cell, type Column, type Row } from './field.ts';
import { blockersBetween } from './field.ts';
import {
  BLEED,
  GUARD_ABSORB,
  STEADY_BONUS,
  StatusId,
  chillPointsOf,
  healingOf,
  meleeDamageOf,
  rangedDamageOf,
  shortDamageOf,
  STATUS_ROUNDS,
  withStatus,
  type BattleUnit,
  type BattleUnitId,
  type StatusInstance
} from './unit.ts';

/**
 * One battle, from the formation to the outcome (`COMBAT_SPEC` §5, §6.1).
 *
 * **No randomness of any kind** (§9). Not a simplification that will be revisited quietly:
 * `DEC-011` §3 fixes integer arithmetic, `DEC-011` §Проверка asks that the reason a
 * formation wins be explainable "without numerical crutches", and a lab whose outcomes vary
 * by a roll measures its own variance instead of the player's decision. Introducing a roll
 * is a decision of its own (`AGENTS.md` §5), and this file neither takes it nor prepares
 * for it: there is no RNG stream here, because a stream nobody reads is a promise of
 * non-determinism with no benefit (`ADR-003`).
 */

/** Beyond this the battle ends undecided (`COMBAT_SPEC` §6.1). */
export const MAX_ROUNDS = 12;

export type { BattleRecord, BattleState };

/**
 * The two ways a crew leaves a fight it has not won (`DEC-005`, `COMBAT_SPEC` §7.4).
 *
 * Both are set **before** the battle is computed, and that is what keeps the whole thing a
 * function of its input: `belowPercent` is the threshold the player wrote into the plan —
 * the main path — and `signalledAtRound` is the emergency lever he reached for while
 * watching. The lever looks like an interruption and is not one: the presentation runs the
 * battle once, and pressing the button re-runs it with the round filled in. Everything
 * before that round is identical by determinism (§9), so what the player watched is a
 * prefix of what he then gets, rather than two different battles stitched together.
 */
export interface RetreatOrder {
  /**
   * Share of the crew that must still be standing, in per cent of how many set out. Below
   * it the crew withdraws on its own. `0` — the default — is "never on its own".
   */
  readonly belowPercent: number;

  /** The round the player's signal takes effect from, or `null` if he never gave it. */
  readonly signalledAtRound: number | null;
}

const NO_RETREAT: RetreatOrder = Object.freeze({ belowPercent: 0, signalledAtRound: null });

/** Sets a battle up. Refuses two units on one cell before the first event (§11). */
export function startBattle(units: readonly BattleUnit[], doctrine: DoctrineId): BattleState {
  const seen = new Set<string>();

  for (const unit of units) {
    const key = `${unit.side}:${String(unit.cell.row)}:${String(unit.cell.column)}`;

    if (seen.has(key)) {
      throw new Error(
        `Two units stand on ${key}. A battle that began on an illegal board would produce ` +
          'explainable nonsense, so the formation is refused before the first event ' +
          '(COMBAT_SPEC §3.7: cell_taken).'
      );
    }

    seen.add(key);
  }

  return { round: 0, units, doctrine, outcome: null };
}

/**
 * Plays a battle to its end and returns everything it produced.
 *
 * `retreat` is an input like the formation and the doctrine are inputs: the same board,
 * the same order and the same signal give the same events, byte for byte (§12.1 п.2).
 */
export function runBattle(initial: BattleState, retreat: RetreatOrder = NO_RETREAT): BattleRecord {
  const events: BattleEvent[] = [
    {
      kind: 'battle_started',
      // Sorted, not in the order the caller handed them over: the event log is compared
      // byte for byte by the determinism property (`COMBAT_SPEC` §12.1 п.2–3), and an
      // opening event that echoed the input array would make two identical battles differ
      // in their first line.
      crew: rosterOf(initial.units, 'crew'),
      foes: rosterOf(initial.units, 'foe'),
      doctrine: initial.doctrine
    }
  ];

  // **Heroes, not everyone standing on the crew's side.** §7.4 says the threshold is a share
  // of the *heroes*, and the contract's own wards stand on that side too: a cart counted as
  // a man makes the crew look less worn down than it is, and external review reproduced a
  // withdrawal that began three rounds late for exactly that reason.
  const setOut = initial.units.filter(isCrewHero).length;
  let state = initial;
  let withdrew = false;

  while (state.outcome === null && state.round < MAX_ROUNDS) {
    const step = runRound(state, withdrawalOf(state, setOut, retreat));
    state = step.state;
    events.push(...step.events);

    if (step.withdrawing) {
      // One round and then it is over. The men who obeyed have left the field and the ones
      // who refused fought the round they refused it in — which is the whole of the drama
      // `DEC-005` asks the lever to produce, and a second round of it would be a battle
      // fought by whoever happens to have a friend on the ground.
      withdrew = true;
      break;
    }
  }

  // A withdrawal outranks whatever the board looks like afterwards, and it has to: a crew
  // that walked off leaves nobody standing, and `outcomeOf` alone would report the same
  // board as a defeat. What happened is the thing the debrief has to be able to say
  // (§6.2.2 gives `retreat` its own column), and it is also the measurement `MVP_PLAN`
  // §6.4 settles `DEC-005` with.
  const outcome = withdrew ? BattleOutcome.Retreated : (state.outcome ?? BattleOutcome.TimedOut);
  events.push({ kind: 'battle_ended', outcome });

  return {
    initial,
    final: { ...state, outcome },
    events,
    rounds: state.round,
    outcome,
    retreatSignalledAtRound: retreat.signalledAtRound
  };
}

/**
 * Whether this round is the crew's last one, and why (`COMBAT_SPEC` §7.4).
 *
 * Two paths and they are not the same fact: the threshold is a standing order the player
 * wrote into the plan before anybody drew a weapon, and the signal is a thing he did while
 * watching. Only the second raises `retreat_signalled` — an event claiming the player
 * pulled a lever he never touched would be the debrief inventing a decision.
 */
function withdrawalOf(
  state: BattleState,
  setOut: number,
  retreat: RetreatOrder
): Withdrawal | null {
  const nextRound = state.round + 1;

  if (retreat.signalledAtRound !== null && nextRound >= retreat.signalledAtRound) {
    return { signalled: true };
  }

  const standing = state.units.filter((unit) => isCrewHero(unit) && unit.standing).length;

  // Cross-multiplied rather than divided, like every other comparison of a share in this
  // package: an integer division would put the boundary on the wrong side of itself.
  return retreat.belowPercent > 0 && standing * 100 < setOut * retreat.belowPercent
    ? { signalled: false }
    : null;
}

/** A hero of the crew, as against a ward the contract put on the same side of the board. */
function isCrewHero(unit: BattleUnit): boolean {
  return unit.side === 'crew' && unit.hero !== null;
}

interface Withdrawal {
  /** `true` when the player's own signal is what ended it, `false` for the threshold. */
  readonly signalled: boolean;
}

/**
 * One round: every standing, unspent unit acts once, in initiative order, then the statuses
 * tick (`COMBAT_SPEC` §5).
 *
 * Initiative is recomputed at the start and frozen for the round, so a unit knocked into
 * another row mid-round acts at its own place in the queue — from the new row. There is no
 * simultaneity: each action resolves fully before the next begins, which `DEC-011` §4 makes
 * the only option by declining to define a conflict-resolution order.
 */
export function runRound(
  state: BattleState,
  withdrawal: Withdrawal | null = null
): {
  readonly state: BattleState;
  readonly events: readonly BattleEvent[];
  readonly withdrawing: boolean;
} {
  const round = state.round + 1;
  const events: BattleEvent[] = [{ kind: 'round_started', round }];
  let units = state.units;

  if (withdrawal?.signalled === true) {
    events.push({ kind: 'retreat_signalled', round });
  }

  // Decided once, against the board as the order found it — not as each man comes to
  // answer. Asked one at a time, the first to walk off stops being "on the ground", and the
  // friend who would not have left him obeys because by his turn there is nobody left to
  // stay for. Found by the test that expected a refusal and got three obedient men.
  const refusing = new Set(
    withdrawal === null
      ? []
      : units
          .filter(
            (one) => isCrewHero(one) && one.standing && bondedAllyInTrouble(one, units) !== null
          )
          .map((one) => one.id)
  );

  const order = [...units]
    .sort((left, right) => right.combat.focus - left.combat.focus || (left.id < right.id ? -1 : 1))
    .map((unit) => unit.id);

  for (const actorId of order) {
    if (
      units.filter((one) => isCrewHero(one) && one.standing).length === 0 ||
      standingOn(units, 'foe').length === 0
    ) {
      break;
    }

    const actor = byId(units, actorId);

    if (actor === null || !actor.standing) {
      continue;
    }

    // **Only the heroes leave.** A ward is what the crew was hired to keep alive
    // (`COMBAT_SPEC` §6.2), not somebody who takes an order — and marching it off the field
    // intact would close a `protect` objective at full marks the moment the player pulled
    // the lever, which is a lever that wins the contract rather than costing it.
    if (withdrawal !== null && isCrewHero(actor) && !refusing.has(actor.id)) {
      units = replace(units, { ...actor, standing: false });
      events.push({ kind: 'retreat_obeyed', unit: actor.id });
      continue;
    }

    if (withdrawal !== null && isCrewHero(actor)) {
      events.push({
        kind: 'retreat_refused',
        unit: actor.id,
        motive: 'combat.motive.stood_by_a_friend'
      });
    }

    if (actor.spent) {
      units = replace(units, { ...actor, spent: false });
      events.push({ kind: 'turn_spent', unit: actor.id });
      continue;
    }

    const step = takeTurn(units, actor, state.doctrine);
    units = step.units;
    events.push(...step.events);
  }

  const ticked = tickStatuses(units);
  units = ticked.units;
  events.push(...ticked.events);

  events.push({ kind: 'round_ended', round });

  return {
    state: { ...state, round, units, outcome: outcomeOf(units) },
    events,
    withdrawing: withdrawal !== null
  };
}

function takeTurn(
  units: readonly BattleUnit[],
  actor: BattleUnit,
  doctrine: DoctrineId
): { readonly units: readonly BattleUnit[]; readonly events: readonly BattleEvent[] } {
  const decision = decideCombatAction(actor, units, doctrine);
  const events: BattleEvent[] = [
    {
      kind: 'intent_declared',
      actor: actor.id,
      action: decision.action,
      target: decision.target?.id ?? null,
      reason: decision.reason,
      contraryTo: decision.contraryTo
    }
  ];

  let next = units;

  if (decision.contraryTo !== null) {
    next = replace(next, { ...actor, brokeDoctrine: true });
    events.push({
      kind: 'doctrine_broken',
      unit: actor.id,
      doctrine: decision.contraryTo,
      // The union's only member today, and read off the decision rather than assumed, so a
      // second motive arrives as a type error here instead of a wrong label on the screen.
      motive: 'combat.motive.stood_by_a_friend'
    });
  }

  const resolved = resolve(next, byId(next, actor.id) ?? actor, decision.action, decision.target);

  return { units: resolved.units, events: [...events, ...resolved.events] };
}

function resolve(
  units: readonly BattleUnit[],
  actor: BattleUnit,
  action: CombatAction,
  target: BattleUnit | null
): { readonly units: readonly BattleUnit[]; readonly events: readonly BattleEvent[] } {
  switch (action) {
    case CombatAction.Strike:
      return strike(units, actor, target, meleeDamageOf(actor.combat), true);
    case CombatAction.ShortStrike:
      // The short strike reaches over one's own front rank, so nothing is in the way of it
      // by construction (`COMBAT_SPEC` §4.2) — the one action that ignores obstruction.
      return strike(units, actor, target, shortDamageOf(actor.combat), false);
    case CombatAction.Shot:
      return strike(units, actor, target, rangedDamageOf(actor.combat), true);
    case CombatAction.Status:
      return applyStatus(units, actor, target);
    case CombatAction.Support:
      return support(units, actor, target);
    case CombatAction.Shift:
      return shift(units, actor, target);
    case CombatAction.Reposition:
      return reposition(units, actor, target);
    case CombatAction.Steady:
      return {
        units: replace(units, {
          ...actor,
          stability: Math.min(100, actor.stability + STEADY_BONUS),
          spent: false
        }),
        events: []
      };
  }
}

function strike(
  units: readonly BattleUnit[],
  actor: BattleUnit,
  target: BattleUnit | null,
  base: number,
  countObstruction: boolean
): { readonly units: readonly BattleUnit[]; readonly events: readonly BattleEvent[] } {
  if (target === null) {
    return { units, events: [] };
  }

  const guard = target.statuses.get(StatusId.Guarded);
  const provenance = applyEffect({
    base,
    chillPoints: chillPointsOf(actor),
    blockers: countObstruction ? blockersBetween(actor, target, units) : 0,
    absorb: guard === undefined ? null : { amount: GUARD_ABSORB, by: guard.source },
    actor: actor.id
  });

  const events: BattleEvent[] = [
    {
      kind: 'damage_dealt',
      actor: actor.id,
      target: target.id,
      amount: provenance.final,
      provenance
    }
  ];

  const absorbed = absorbedBy(provenance);

  if (absorbed > 0 && guard !== undefined) {
    events.push({
      kind: 'damage_absorbed',
      target: target.id,
      by: guard.source,
      amount: absorbed
    });
  }

  return { units: hurt(units, target, provenance.final, actor.id, events), events };
}

function applyStatus(
  units: readonly BattleUnit[],
  actor: BattleUnit,
  target: BattleUnit | null
): { readonly units: readonly BattleUnit[]; readonly events: readonly BattleEvent[] } {
  if (target === null) {
    return { units, events: [] };
  }

  const status = StatusId.Chilled;
  const applied = withStatus(target, status, actor.id);

  return {
    units: replace(units, applied.unit),
    events: [
      {
        kind: 'status_applied',
        target: target.id,
        status,
        source: actor.id,
        rounds: STATUS_ROUNDS[status],
        refreshed: applied.refreshed
      }
    ]
  };
}

function support(
  units: readonly BattleUnit[],
  actor: BattleUnit,
  target: BattleUnit | null
): { readonly units: readonly BattleUnit[]; readonly events: readonly BattleEvent[] } {
  if (target === null) {
    return { units, events: [] };
  }

  const provenance = applyEffect({
    base: healingOf(actor.combat),
    chillPoints: chillPointsOf(actor),
    blockers: 0,
    absorb: null,
    actor: actor.id
  });

  const healed = Math.min(target.maxHealth, target.health + provenance.final);
  const guarded = withStatus({ ...target, health: healed }, StatusId.Guarded, actor.id);

  return {
    units: replace(units, guarded.unit),
    events: [
      {
        kind: 'healing_done',
        actor: actor.id,
        target: target.id,
        amount: healed - target.health,
        provenance
      },
      {
        kind: 'status_applied',
        target: target.id,
        status: StatusId.Guarded,
        source: actor.id,
        rounds: 1,
        refreshed: guarded.refreshed
      }
    ]
  };
}

/**
 * Displacement (`COMBAT_SPEC` §4.6).
 *
 * `might` against `stability`, strictly greater, integer, no roll. Toward the target's own
 * rear; into an occupied cell it is a swap and **both** lose their next action; against the
 * back wall it pins instead — a shove that lands is never a shove that vanished.
 */
function shift(
  units: readonly BattleUnit[],
  actor: BattleUnit,
  target: BattleUnit | null
): { readonly units: readonly BattleUnit[]; readonly events: readonly BattleEvent[] } {
  if (target === null) {
    return { units, events: [] };
  }

  if (actor.combat.might <= target.stability) {
    return { units, events: [{ kind: 'shift_resisted', unit: target.id, by: actor.id }] };
  }

  if (target.cell.row === 3) {
    const pinned = withStatus(target, StatusId.Pinned, actor.id);

    return {
      units: replace(units, { ...pinned.unit, spent: true }),
      events: [
        { kind: 'unit_pinned', unit: target.id },
        {
          kind: 'status_applied',
          target: target.id,
          status: StatusId.Pinned,
          source: actor.id,
          rounds: 1,
          refreshed: pinned.refreshed
        }
      ]
    };
  }

  const to: Cell = { row: (target.cell.row + 1) as Row, column: target.cell.column };
  const partner = occupantOf(target.side, to, units);
  const from = target.cell;

  if (partner === null) {
    return torn(units, { ...target, cell: to }, actor, [
      { kind: 'unit_shifted', unit: target.id, from, to, forced: true, partner: null }
    ]);
  }

  const swapped = replace(replace(units, { ...target, cell: to, spent: true }), {
    ...partner,
    cell: from,
    spent: true
  });

  return torn(swapped, byId(swapped, target.id) ?? target, actor, [
    { kind: 'unit_shifted', unit: target.id, from, to, forced: true, partner: partner.id },
    {
      kind: 'unit_shifted',
      unit: partner.id,
      from: to,
      to: from,
      forced: true,
      partner: target.id
    }
  ]);
}

/**
 * A man shoved out of his place, and the wound it leaves (`COMBAT_SPEC` §3.5).
 *
 * **This is `bleeding`'s only source, and it had none at all before.** §3.5 gave the status
 * two rounds, `BLEED` damage and a branch in `tickStatuses`; an audit over 630 battles — the
 * whole frozen set at all three doctrines — counted it nought times, so all three were code
 * no battle could reach. It is also the only status that outlives the round it was applied
 * in, which made the countdown in `tickStatuses` unreachable with it.
 *
 * **On the displacement, and the owner's first two choices were measured before this one was
 * written.** Every melee blow of a breaker bleeding takes `DEC-011`'s refuting check from
 * three winning formations to two (§13.1) — the outcome that decision pre-accepts, and the
 * owner had already chosen that matrix over a corridor once; a shorter bleed does not help,
 * because the count is the frequency and not the duration. Put on the breaker's `Status`
 * action instead, it occurs in neither the frozen set nor §13.1's matrix: §4.1 gives that
 * action to row 3 only and a breaker's home rows are 1 and 2, so no sensible formation puts
 * him there. A path exists — shove a breaker into row 3 and under `break_them_first` he will
 * take it — so the objection is nought coverage rather than unreachability, which is a
 * weaker claim and the one the audit can actually make. Here it is the shove itself that
 * tears — which is what the role is for — the matrix keeps its three winners, and the status
 * occurs 239 times in 630 battles.
 */
function torn(
  units: readonly BattleUnit[],
  target: BattleUnit,
  actor: BattleUnit,
  events: readonly BattleEvent[]
): { readonly units: readonly BattleUnit[]; readonly events: readonly BattleEvent[] } {
  // No guard on `target.standing`, and its absence is deliberate: a shove deals no damage,
  // and the only caller picks its target among men who are on their feet — so "he went down
  // from the shove" is not a state this function can be handed. A guard for it was written
  // first and a mutant deleting it stayed green, which is what dead code looks like from the
  // outside (`AGENTS.md` §8).
  const bleeding = withStatus(target, StatusId.Bleeding, actor.id);

  return {
    units: replace(units, bleeding.unit),
    events: [
      ...events,
      {
        kind: 'status_applied',
        target: target.id,
        status: StatusId.Bleeding,
        source: actor.id,
        rounds: STATUS_ROUNDS[StatusId.Bleeding],
        refreshed: bleeding.refreshed
      }
    ]
  };
}

/**
 * A step back toward the row this unit's own actions live in (`COMBAT_SPEC` §4.6).
 *
 * One action into an empty cell; a swap with an ally costs the ally his next one, so a
 * crowded formation reacts at half the speed of a loose one — §4.5's second benefit, and
 * the one that holds whatever the enemy happens to be.
 */
function reposition(
  units: readonly BattleUnit[],
  actor: BattleUnit,
  toward: BattleUnit | null
): { readonly units: readonly BattleUnit[]; readonly events: readonly BattleEvent[] } {
  // Toward whoever the decision named, and toward his own row when it named nobody. The
  // first is the personality reaction stepping to a friend (`COMBAT_SPEC` §7.3), the second
  // is a man knocked out of the row his own actions live in going back to it (§4.1). One
  // action, two reasons to take it, and the decision says which by naming a target or not.
  const step = toward === null ? towardHome(actor) : towardCell(actor, toward.cell);

  if (step === null || !isAdjacent(actor.cell, step)) {
    return { units, events: [] };
  }

  const partner = occupantOf(actor.side, step, units);
  const from = actor.cell;

  if (partner === null) {
    return {
      units: replace(units, { ...actor, cell: step }),
      events: [
        { kind: 'unit_shifted', unit: actor.id, from, to: step, forced: false, partner: null }
      ]
    };
  }

  return {
    units: replace(replace(units, { ...actor, cell: step }), {
      ...partner,
      cell: from,
      spent: true
    }),
    events: [
      { kind: 'unit_shifted', unit: actor.id, from, to: step, forced: false, partner: partner.id },
      {
        kind: 'unit_shifted',
        unit: partner.id,
        from: step,
        to: from,
        forced: false,
        partner: actor.id
      }
    ]
  };
}

/** One orthogonal step toward the row this unit's own actions live in. */
function towardHome(actor: BattleUnit): Cell {
  const home = HOME_ROW[actor.role];

  return {
    row: (actor.cell.row + (home < actor.cell.row ? -1 : 1)) as Row,
    column: actor.cell.column
  };
}

/**
 * One orthogonal step toward `target` — the row first, then the column.
 *
 * The row first because rows are what actions belong to (§4.1): standing beside a friend in
 * the wrong row helps nobody, and closing the row is what puts a man where he can reach him.
 * Diagonals do not exist (`DEC-011` §4), so a step is one or the other.
 */
function towardCell(actor: BattleUnit, target: Cell): Cell | null {
  if (actor.cell.row !== target.row) {
    return {
      row: (actor.cell.row + (target.row < actor.cell.row ? -1 : 1)) as Row,
      column: actor.cell.column
    };
  }

  if (actor.cell.column !== target.column) {
    return {
      row: actor.cell.row,
      column: (actor.cell.column + (target.column < actor.cell.column ? -1 : 1)) as Column
    };
  }

  return null;
}

const HOME_ROW: Readonly<Record<CombatRole, Row>> = Object.freeze({
  [CombatRole.Vanguard]: 1,
  [CombatRole.Support]: 2,
  [CombatRole.Rear]: 3,
  [CombatRole.Breaker]: 1
});

/** Statuses lose a round; `bleeding` bites on the way out, and names who caused it. */
function tickStatuses(units: readonly BattleUnit[]): {
  readonly units: readonly BattleUnit[];
  readonly events: readonly BattleEvent[];
} {
  const events: BattleEvent[] = [];
  let next = units;

  for (const unit of [...units].sort((left, right) => (left.id < right.id ? -1 : 1))) {
    const current = byId(next, unit.id);

    if (current === null || !current.standing) {
      continue;
    }

    let updated = current;
    const bleeding = current.statuses.get(StatusId.Bleeding);

    if (bleeding !== undefined) {
      const provenance = applyEffect({
        base: BLEED,
        chillPoints: 0,
        blockers: 0,
        absorb: null,
        actor: bleeding.source
      });

      events.push({
        kind: 'damage_dealt',
        actor: bleeding.source,
        target: current.id,
        amount: provenance.final,
        provenance
      });

      next = hurt(next, current, provenance.final, bleeding.source, events);
      updated = byId(next, current.id) ?? current;
    }

    // Rebuilt rather than edited in place: a `SortedMap` has no removal, and an expiry is a
    // removal. Built from the surviving entries in the map's own key order, which is what
    // keeps enumeration — and therefore the artifact — a property of the state.
    const surviving: (readonly [StatusId, StatusInstance])[] = [];

    for (const [status, instance] of updated.statuses.entries()) {
      if (instance.remainingRounds <= 1) {
        events.push({ kind: 'status_expired', target: updated.id, status });
      } else {
        surviving.push([status, { ...instance, remainingRounds: instance.remainingRounds - 1 }]);
      }
    }

    updated = { ...updated, statuses: SortedMap.from(compareStrings, surviving) };

    next = replace(next, updated);
  }

  return { units: next, events };
}

function hurt(
  units: readonly BattleUnit[],
  target: BattleUnit,
  amount: number,
  by: BattleUnitId,
  events: BattleEvent[]
): readonly BattleUnit[] {
  const health = Math.max(0, target.health - amount);
  const standing = health > 0;

  if (target.standing && !standing) {
    events.push({ kind: 'unit_downed', unit: target.id, by });
  }

  return replace(units, { ...target, health, standing });
}

/**
 * Who is left, and therefore whether it is over (`COMBAT_SPEC` §6.1).
 *
 * **The crew's side is counted by its heroes.** A ward is what the crew was hired to keep
 * alive, not somebody holding the line: a fight where every hero is down and the cart is
 * still upright is a fight the crew lost, and counting the cart would leave it running until
 * the round ceiling with nobody on one side able to act.
 */
function outcomeOf(units: readonly BattleUnit[]): BattleOutcome | null {
  const crew = units.filter((unit) => isCrewHero(unit) && unit.standing).length;
  const foes = standingOn(units, 'foe').length;

  if (foes === 0) {
    return BattleOutcome.CrewStanding;
  }

  if (crew === 0) {
    return BattleOutcome.FoesStanding;
  }

  return null;
}

function rosterOf(units: readonly BattleUnit[], side: 'crew' | 'foe'): readonly BattleUnitId[] {
  return units
    .filter((unit) => unit.side === side)
    .map((unit) => unit.id)
    .sort((left, right) => (left < right ? -1 : 1));
}

function standingOn(units: readonly BattleUnit[], side: 'crew' | 'foe'): readonly BattleUnit[] {
  return units.filter((unit) => unit.standing && unit.side === side);
}

function byId(units: readonly BattleUnit[], id: BattleUnitId): BattleUnit | null {
  return units.find((unit) => unit.id === id) ?? null;
}

function replace(units: readonly BattleUnit[], unit: BattleUnit): readonly BattleUnit[] {
  return units.map((current) => (current.id === unit.id ? unit : current));
}

export { opposing };
