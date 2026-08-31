import {
  StatusId,
  type BattleEvent,
  type BattleOutcome,
  type BattleRecord,
  type BattleSide,
  type BattleUnitId,
  type Cell,
  type CombatRole,
  type HeroId
} from '@oath-and-coin/simulation';

/**
 * The board as it stood after the first `n` events of a battle (`COMBAT_SPEC` §8.1, §10.2).
 *
 * **A fold over the record's own events, and nothing else.** The record carries the opening
 * board, the closing board and every event between them, "so that «replay this battle» needs
 * no second source and no re-derivation" — but a screen showing round four needs a board the
 * record does not store, and there are only two ways to get one: re-run the battle, or read
 * what the battle said it did. Re-running would put a second implementation of the rules in
 * the presentation layer, which is the one thing `ADR-002` forbids outright. So this reads
 * the events, and invents nothing: every number here came out of an event that named it.
 *
 * **What pins it is the closing board.** Folding the whole list has to land on `record.final`
 * — on every field a board can show — and `battle-board.test.ts` asks that of real battles
 * rather than of a fixture. That check is also a statement about the event vocabulary: if the
 * fold cannot reach the final board, then §8.1's list is not enough to replay a battle from,
 * and it is better to know that from a red test than from a screen that quietly drifts.
 *
 * **Statuses are counted down here, because the engine counts them down silently.** A status
 * is applied by an event and removed by one, but the rounds in between tick away inside the
 * round loop with nothing raised. The fold does the same arithmetic on the same signal
 * (`round_ended`), which is why the comparison against `final` is worth taking.
 */

export interface BattleBoardStatus {
  readonly status: StatusId;
  readonly remainingRounds: number;
  readonly source: BattleUnitId;
}

export interface BattleBoardUnit {
  readonly unit: BattleUnitId;
  readonly side: BattleSide;
  /** The hero this is, or `null` for a foe or a ward — the record's own distinction. */
  readonly hero: HeroId | null;
  readonly role: CombatRole;
  readonly cell: Cell;
  readonly health: number;
  readonly maxHealth: number;
  /** Still on the field. The events say which way he left; see {@link BattleBoardUnit.left}. */
  readonly standing: boolean;
  /**
   * How he left the field, or `null` while he is still on it.
   *
   * The distinction `BattleUnit.standing` deliberately does not carry (a flag with three
   * values would make every reader branch on it) and the screen deliberately does: a man
   * knocked down and a man who walked off on the signal are not the same picture, and the
   * debrief costs them differently.
   */
  readonly left: 'downed' | 'withdrew' | null;
  readonly statuses: readonly BattleBoardStatus[];
}

export interface BattleBoard {
  readonly round: number;
  readonly units: readonly BattleBoardUnit[];
  /** `null` until the battle has ended in the events applied so far. */
  readonly outcome: BattleOutcome | null;
}

/**
 * The board after `applied` events, where `0` is the board the battle opened on.
 *
 * Recomputed from the start on every call rather than advanced incrementally. A battle is
 * under a hundred events (the spike measured 82), a fold over them is a fraction of one
 * frame, and an incremental version would hold state that can disagree with the events —
 * which is exactly the drift the whole arrangement exists to prevent.
 */
export function boardAfter(record: BattleRecord, applied: number): BattleBoard {
  const units = new Map<BattleUnitId, BattleBoardUnit>(
    record.initial.units.map((unit) => [
      unit.id,
      {
        unit: unit.id,
        side: unit.side,
        hero: unit.hero,
        role: unit.role,
        cell: unit.cell,
        health: unit.health,
        maxHealth: unit.maxHealth,
        standing: unit.standing,
        left: null,
        statuses: [...unit.statuses.entries()].map(([status, instance]) => ({
          status,
          remainingRounds: instance.remainingRounds,
          source: instance.source
        }))
      }
    ])
  );

  let round = record.initial.round;
  let outcome: BattleOutcome | null = record.initial.outcome;

  for (const event of record.events.slice(0, Math.max(0, applied))) {
    const change = applyToBoard(units, event);

    round = change.round ?? round;
    outcome = change.outcome ?? outcome;
  }

  return { round, units: [...units.values()], outcome };
}

/** Everything the board learns from one event. Mutates the map; returns what is not a unit. */
function applyToBoard(
  units: Map<BattleUnitId, BattleBoardUnit>,
  event: BattleEvent
): { readonly round?: number; readonly outcome?: BattleOutcome } {
  switch (event.kind) {
    case 'round_started':
      return { round: event.round };

    case 'round_ended':
      countStatusesDown(units);
      return { round: event.round };

    case 'battle_ended':
      return { outcome: event.outcome };

    case 'damage_dealt':
      change(units, event.target, (unit) => ({
        ...unit,
        health: Math.max(0, unit.health - event.amount)
      }));
      return {};

    case 'healing_done':
      change(units, event.target, (unit) => ({
        ...unit,
        health: Math.min(unit.maxHealth, unit.health + event.amount)
      }));
      return {};

    case 'unit_shifted':
      change(units, event.unit, (unit) => ({ ...unit, cell: event.to }));

      // A swap moves two men with one event, and the partner's own cell is the one this unit
      // came from. Without this the board draws two tokens in one cell — which the fold's
      // comparison against `final` catches, and a reading of the code does not.
      if (event.partner !== null) {
        change(units, event.partner, (unit) => ({ ...unit, cell: event.from }));
      }

      return {};

    case 'unit_downed':
      change(units, event.unit, (unit) => ({ ...unit, standing: false, left: 'downed' }));
      return {};

    case 'retreat_obeyed':
      change(units, event.unit, (unit) => ({ ...unit, standing: false, left: 'withdrew' }));
      return {};

    case 'status_applied':
      change(units, event.target, (unit) => ({
        ...unit,
        statuses: [
          ...unit.statuses.filter((one) => one.status !== event.status),
          { status: event.status, remainingRounds: event.rounds, source: event.source }
        ].sort(byStatusId)
      }));
      return {};

    case 'status_expired':
      change(units, event.target, (unit) => ({
        ...unit,
        statuses: unit.statuses.filter((one) => one.status !== event.status)
      }));
      return {};

    // Everything else is about what somebody meant to do, or about a turn being used up.
    // The board does not draw either: the intent line does, and it reads the event itself.
    case 'battle_started':
    case 'intent_declared':
    case 'damage_absorbed':
    case 'shift_resisted':
    case 'unit_pinned':
    case 'turn_spent':
    case 'doctrine_broken':
    case 'retreat_signalled':
    case 'retreat_refused':
      return {};
  }
}

function change(
  units: Map<BattleUnitId, BattleBoardUnit>,
  id: BattleUnitId,
  to: (unit: BattleBoardUnit) => BattleBoardUnit
): void {
  const unit = units.get(id);

  if (unit !== undefined) {
    units.set(id, to(unit));
  }
}

/**
 * One round off every status, on the same signal the engine uses.
 *
 * A status that reaches nought is left where it is: the engine raises `status_expired` for
 * it, and removing it here as well would make the two disagree about which event did the
 * removing the day the engine's order changes.
 */
function countStatusesDown(units: Map<BattleUnitId, BattleBoardUnit>): void {
  for (const [id, unit] of units) {
    units.set(id, {
      ...unit,
      statuses: unit.statuses.map((one) => ({
        ...one,
        remainingRounds: Math.max(0, one.remainingRounds - 1)
      }))
    });
  }
}

const byStatusId = (left: BattleBoardStatus, right: BattleBoardStatus): number =>
  STATUS_ORDER.indexOf(left.status) - STATUS_ORDER.indexOf(right.status);

/** Declaration order, so two boards with the same statuses are the same board. */
const STATUS_ORDER: readonly StatusId[] = Object.freeze(Object.values(StatusId));
