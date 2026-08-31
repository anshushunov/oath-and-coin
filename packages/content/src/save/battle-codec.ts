import {
  BattleObjectiveKind,
  BATTLE_OUTCOMES,
  COMBAT_ACTIONS,
  COMBAT_ROLES,
  COLUMNS,
  DOCTRINE_IDS,
  HERO_ID_MAX,
  HERO_ID_MIN,
  MODIFIER_CODES,
  MOTIVE_REASONS,
  ROWS,
  STATUS_IDS,
  RETREAT_THRESHOLD_MAX,
  SortedMap,
  TARGET_REASONS,
  NEED_IDS,
  compareBattleUnitIds,
  compareHeroIds,
  compareNeedIds,
  compareStrings,
  heroId,
  type BattleEvent,
  type BattleObjective,
  type BattleRecord,
  type BattleState,
  type BattleUnit,
  type BattleUnitId,
  type Cell,
  type ContractBattlePlan,
  type CrewDeployment,
  type HeroId,
  type NeedId,
  type StatusId,
  type StatusInstance
} from '@oath-and-coin/simulation';
import { z } from 'zod';

import { COMBAT_ATTRIBUTE_MAX, COMBAT_ATTRIBUTE_MIN } from '../bounds.ts';
import {
  MAX_ARTIFACT_SAFE_TEXT_LENGTH,
  MAX_BATTLE_EVENTS,
  MAX_BATTLE_UNITS,
  MAX_PROVENANCE_STEPS,
  MAX_RESOLUTION_MAGNITUDE
} from '../limits.ts';

/**
 * The reversible half of a battle record (`COMBAT_SPEC` §8.1, `ADR-016` §4).
 *
 * **Its own module rather than a corner of `snapshot-codec.ts`**, because it is the largest
 * single shape this format carries and because it is the one part of a save that exists for
 * the *screen* rather than for the rules: the debrief reads the feed and the presentation
 * replays it, so a campaign restored from a slot has to be able to show what a campaign in
 * memory shows. Without it, `RESOLUTION_SPEC` §6.4 would route a loaded resolved campaign
 * to a debrief with its middle section missing.
 *
 * **In the save and not in the canonical artifact**, and the asymmetry is `ADR-016` §6
 * rather than an omission: the artifact is read by a person checking a run, and eighty
 * events per contract makes that unreadable. A save is read by the game.
 *
 * Every enum is written from the domain's own frozen list rather than as string literals,
 * so a value renamed there stops round-tripping loudly instead of quietly.
 */

const battleUnitId = z.string().min(1).max(MAX_ARTIFACT_SAFE_TEXT_LENGTH);
const amount = z.int().min(-MAX_RESOLUTION_MAGNITUDE).max(MAX_RESOLUTION_MAGNITUDE);
const rowSchema = z.union(ROWS.map((row) => z.literal(row)));
const columnSchema = z.union(COLUMNS.map((column) => z.literal(column)));

const cellSchema = z.strictObject({ row: rowSchema, column: columnSchema });

const provenanceSchema = z.strictObject({
  base: amount,
  steps: z
    .array(
      z.strictObject({
        code: z.enum(MODIFIER_CODES),
        source: battleUnitId,
        delta: amount
      })
    )
    .max(MAX_PROVENANCE_STEPS),
  final: amount
});

const combatSchema = z.strictObject({
  might: z.int().min(COMBAT_ATTRIBUTE_MIN).max(COMBAT_ATTRIBUTE_MAX),
  guard: z.int().min(COMBAT_ATTRIBUTE_MIN).max(COMBAT_ATTRIBUTE_MAX),
  aim: z.int().min(COMBAT_ATTRIBUTE_MIN).max(COMBAT_ATTRIBUTE_MAX),
  focus: z.int().min(COMBAT_ATTRIBUTE_MIN).max(COMBAT_ATTRIBUTE_MAX),
  care: z.int().min(COMBAT_ATTRIBUTE_MIN).max(COMBAT_ATTRIBUTE_MAX)
});

const unitSchema = z.strictObject({
  id: battleUnitId,
  side: z.enum(['crew', 'foe']),
  hero: z.int().min(HERO_ID_MIN).max(HERO_ID_MAX).nullable(),
  role: z.enum(COMBAT_ROLES),
  cell: cellSchema,
  health: amount,
  maxHealth: amount,
  stability: amount,
  combat: combatSchema,
  statuses: z
    .array(
      z.strictObject({
        key: z.enum(STATUS_IDS),
        value: z.strictObject({ remainingRounds: z.int().min(0).max(64), source: battleUnitId })
      })
    )
    .max(STATUS_IDS.length),
  spent: z.boolean(),
  brokeDoctrine: z.boolean(),
  bonds: z
    .array(z.strictObject({ key: battleUnitId, value: amount }))
    .max(MAX_BATTLE_UNITS),
  standing: z.boolean()
});

const stateSchema = z.strictObject({
  round: z.int().min(0).max(MAX_BATTLE_EVENTS),
  units: z.array(unitSchema).max(MAX_BATTLE_UNITS),
  doctrine: z.enum(DOCTRINE_IDS),
  outcome: z.enum(BATTLE_OUTCOMES).nullable()
});

/**
 * The event union, written out kind by kind.
 *
 * A `discriminatedUnion` and not one wide object with everything optional: each event
 * carries what its own line of the debrief needs and nothing flattened across the others
 * (§8.1), and a wide object would let a save claim a `round_ended` with an `amount` on it.
 */
const eventSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal('battle_started'),
    crew: z.array(battleUnitId).max(MAX_BATTLE_UNITS),
    foes: z.array(battleUnitId).max(MAX_BATTLE_UNITS),
    doctrine: z.enum(DOCTRINE_IDS)
  }),
  z.strictObject({ kind: z.literal('round_started'), round: z.int().min(0).max(MAX_BATTLE_EVENTS) }),
  z.strictObject({
    kind: z.literal('intent_declared'),
    actor: battleUnitId,
    action: z.enum(COMBAT_ACTIONS),
    target: battleUnitId.nullable(),
    reason: z.enum([...TARGET_REASONS, ...MOTIVE_REASONS]),
    contraryTo: z.enum(DOCTRINE_IDS).nullable()
  }),
  z.strictObject({
    kind: z.literal('damage_dealt'),
    actor: battleUnitId,
    target: battleUnitId,
    amount,
    provenance: provenanceSchema
  }),
  z.strictObject({
    kind: z.literal('healing_done'),
    actor: battleUnitId,
    target: battleUnitId,
    amount,
    provenance: provenanceSchema
  }),
  z.strictObject({
    kind: z.literal('damage_absorbed'),
    target: battleUnitId,
    by: battleUnitId,
    amount
  }),
  z.strictObject({
    kind: z.literal('status_applied'),
    target: battleUnitId,
    status: z.enum(STATUS_IDS),
    source: battleUnitId,
    rounds: z.int().min(0).max(64),
    refreshed: z.boolean()
  }),
  z.strictObject({
    kind: z.literal('status_expired'),
    target: battleUnitId,
    status: z.enum(STATUS_IDS)
  }),
  z.strictObject({
    kind: z.literal('unit_shifted'),
    unit: battleUnitId,
    from: cellSchema,
    to: cellSchema,
    forced: z.boolean(),
    partner: battleUnitId.nullable()
  }),
  z.strictObject({ kind: z.literal('shift_resisted'), unit: battleUnitId, by: battleUnitId }),
  z.strictObject({ kind: z.literal('unit_pinned'), unit: battleUnitId }),
  z.strictObject({ kind: z.literal('turn_spent'), unit: battleUnitId }),
  z.strictObject({ kind: z.literal('unit_downed'), unit: battleUnitId, by: battleUnitId }),
  z.strictObject({
    kind: z.literal('doctrine_broken'),
    unit: battleUnitId,
    doctrine: z.enum(DOCTRINE_IDS),
    motive: z.enum(MOTIVE_REASONS)
  }),
  z.strictObject({
    kind: z.literal('retreat_signalled'),
    round: z.int().min(0).max(MAX_BATTLE_EVENTS)
  }),
  z.strictObject({ kind: z.literal('retreat_obeyed'), unit: battleUnitId }),
  z.strictObject({
    kind: z.literal('retreat_refused'),
    unit: battleUnitId,
    motive: z.enum(MOTIVE_REASONS)
  }),
  z.strictObject({ kind: z.literal('round_ended'), round: z.int().min(0).max(MAX_BATTLE_EVENTS) }),
  z.strictObject({ kind: z.literal('battle_ended'), outcome: z.enum(BATTLE_OUTCOMES) })
]);

export const battleRecordSchema = z.strictObject({
  initial: stateSchema,
  final: stateSchema,
  events: z.array(eventSchema).max(MAX_BATTLE_EVENTS),
  rounds: z.int().min(0).max(MAX_BATTLE_EVENTS),
  outcome: z.enum(BATTLE_OUTCOMES),
  retreatSignalledAtRound: z.int().min(1).max(MAX_BATTLE_EVENTS).nullable()
});

export function encodeBattleRecord(record: BattleRecord): unknown {
  return {
    initial: encodeState(record.initial),
    final: encodeState(record.final),
    events: record.events,
    rounds: record.rounds,
    outcome: record.outcome,
    retreatSignalledAtRound: record.retreatSignalledAtRound
  };
}

export function toBattleRecord(raw: z.infer<typeof battleRecordSchema>): BattleRecord {
  return {
    initial: toState(raw.initial),
    final: toState(raw.final),
    // The union is round-tripped as it stands: every member is plain JSON of exactly the
    // shape the domain declares, and the schema above has already refused anything else.
    events: raw.events as readonly BattleEvent[],
    rounds: raw.rounds,
    outcome: raw.outcome,
    retreatSignalledAtRound: raw.retreatSignalledAtRound
  };
}

function encodeState(state: BattleState): unknown {
  return {
    round: state.round,
    units: state.units.map((unit) => ({
      id: unit.id,
      side: unit.side,
      hero: unit.hero,
      role: unit.role,
      cell: unit.cell,
      health: unit.health,
      maxHealth: unit.maxHealth,
      stability: unit.stability,
      combat: unit.combat,
      statuses: unit.statuses.entries().map(([key, value]) => ({ key, value })),
      spent: unit.spent,
      brokeDoctrine: unit.brokeDoctrine,
      bonds: unit.bonds.entries().map(([key, value]) => ({ key, value })),
      standing: unit.standing
    })),
    doctrine: state.doctrine,
    outcome: state.outcome
  };
}

function toState(raw: z.infer<typeof stateSchema>): BattleState {
  return {
    round: raw.round,
    units: raw.units.map(
      (unit): BattleUnit => ({
        id: unit.id,
        side: unit.side,
        hero: unit.hero === null ? null : heroId(unit.hero),
        role: unit.role,
        cell: unit.cell,
        health: unit.health,
        maxHealth: unit.maxHealth,
        stability: unit.stability,
        combat: unit.combat,
        // Rebuilt through the comparator rather than trusted in file order, for the reason
        // every map in this codec is: enumeration order is a property of the domain, and
        // the order a file happens to carry is the writer's.
        statuses: SortedMap.from<StatusId, StatusInstance>(
          compareStrings,
          unit.statuses.map((entry) => [entry.key, entry.value] as const)
        ),
        spent: unit.spent,
        brokeDoctrine: unit.brokeDoctrine,
        bonds: SortedMap.from<BattleUnitId, number>(
          compareBattleUnitIds,
          unit.bonds.map((entry) => [entry.key, entry.value] as const)
        ),
        standing: unit.standing
      })
    ),
    doctrine: raw.doctrine,
    outcome: raw.outcome
  };
}

/**
 * The contract's authored battle plan, and the formation the player set (`COMBAT_SPEC` §3.7,
 * §6.2).
 *
 * Both are in the save for the same reason the record is: a loaded campaign has to be the
 * campaign that was saved. The plan in particular is what decides which resolver settles a
 * contract (`ADR-014` §1), so a save that dropped it would restore a battle contract as a
 * delegated one.
 */
const objectiveSchema = z.discriminatedUnion('kind', [
  z.strictObject({
    kind: z.literal(BattleObjectiveKind.Subdue),
    targets: z.array(battleUnitId).max(MAX_BATTLE_UNITS)
  }),
  z.strictObject({ kind: z.literal(BattleObjectiveKind.Protect), ward: battleUnitId }),
  z.strictObject({
    kind: z.literal(BattleObjectiveKind.Hold),
    rounds: z.int().min(1).max(MAX_BATTLE_EVENTS)
  })
]);

const combatantSchema = z.strictObject({
  id: battleUnitId,
  role: z.enum(COMBAT_ROLES),
  cell: cellSchema,
  combat: combatSchema
});

export const contractBattlePlanSchema = z.strictObject({
  objectives: z
    .array(z.strictObject({ key: z.enum(NEED_IDS), value: objectiveSchema }))
    .max(NEED_IDS.length),
  foes: z.array(combatantSchema).max(MAX_BATTLE_UNITS),
  wards: z.array(combatantSchema).max(MAX_BATTLE_UNITS)
});

export const crewDeploymentSchema = z.strictObject({
  placement: z
    .array(
      z.strictObject({
        key: z.int().min(HERO_ID_MIN).max(HERO_ID_MAX),
        value: cellSchema
      })
    )
    .max(MAX_BATTLE_UNITS),
  doctrine: z.enum(DOCTRINE_IDS),
  retreatBelowPercent: z.int().min(0).max(RETREAT_THRESHOLD_MAX)
});

export function encodeBattlePlan(plan: ContractBattlePlan): unknown {
  return {
    objectives: plan.objectives.entries().map(([key, value]) => ({ key, value })),
    foes: plan.foes,
    wards: plan.wards
  };
}

export function toBattlePlan(
  raw: z.infer<typeof contractBattlePlanSchema>
): ContractBattlePlan {
  return {
    objectives: SortedMap.from<NeedId, BattleObjective>(
      compareNeedIds,
      raw.objectives.map((entry) => [entry.key, entry.value] as const)
    ),
    foes: raw.foes,
    wards: raw.wards
  };
}

export function encodeCrewDeployment(deployment: CrewDeployment): unknown {
  return {
    placement: deployment.placement.entries().map(([key, value]) => ({ key, value })),
    doctrine: deployment.doctrine,
    retreatBelowPercent: deployment.retreatBelowPercent
  };
}

export function toCrewDeployment(
  raw: z.infer<typeof crewDeploymentSchema>
): CrewDeployment {
  return {
    placement: SortedMap.from<HeroId, Cell>(
      compareHeroIds,
      raw.placement.map((entry) => [heroId(entry.key), entry.value] as const)
    ),
    doctrine: raw.doctrine,
    retreatBelowPercent: raw.retreatBelowPercent
  };
}
