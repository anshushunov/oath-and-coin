/**
 * THROWAWAY SPIKE (`AGENTS.md` §4, `MVP_PLAN` §6.6). Deleted once measured.
 *
 * The narrowest battle core that can emit the four event kinds the spike has to carry
 * end to end: intent, hit, status, death. No balance, no content, no roles — the point
 * is the seam, not the game.
 */

/** Which side a unit is on. */
export type SpikeSide = 'crew' | 'foe';

/** What a unit does on its turn. Three, because three produce different events. */
export type SpikeAction = 'strike' | 'bolt' | 'chill';

export interface SpikeUnit {
  readonly id: string;
  readonly side: SpikeSide;
  /** 0..8, row = floor(cell / 3): 0 front, 1 support, 2 rear. */
  readonly cell: number;
  readonly hp: number;
  readonly maxHp: number;
  readonly power: number;
  readonly action: SpikeAction;
  readonly alive: boolean;
  /** Ticks remaining under `chill`. A chilled unit skips its turn. */
  readonly chilled: number;
}

export interface SpikeBattleState {
  readonly tick: number;
  readonly units: readonly SpikeUnit[];
}

export type SpikeBattleEvent =
  | {
      readonly kind: 'intent';
      readonly actor: string;
      readonly target: string | null;
      readonly action: SpikeAction | 'skip';
      /** The one-line trace `DEC-011` asks combat decisions to keep. */
      readonly reason: string;
    }
  | { readonly kind: 'hit'; readonly actor: string; readonly target: string; readonly amount: number }
  | { readonly kind: 'status_applied'; readonly target: string; readonly status: 'chilled' }
  | { readonly kind: 'unit_died'; readonly unit: string }
  | { readonly kind: 'tick_ended'; readonly tick: number };

/** Six heroes against six, one action each, no randomness anywhere. */
export function initialSpikeBattle(): SpikeBattleState {
  return {
    tick: 0,
    units: [
      unit('crew:vanguard', 'crew', 0, 40, 9, 'strike'),
      unit('crew:shield', 'crew', 1, 46, 7, 'strike'),
      unit('crew:spear', 'crew', 4, 32, 8, 'strike'),
      unit('crew:archer', 'crew', 6, 24, 10, 'bolt'),
      unit('crew:frost', 'crew', 8, 22, 6, 'chill'),
      unit('foe:brute', 'foe', 0, 44, 10, 'strike'),
      unit('foe:cutter', 'foe', 2, 30, 9, 'strike'),
      unit('foe:hound', 'foe', 3, 26, 8, 'strike'),
      unit('foe:slinger', 'foe', 7, 20, 7, 'bolt'),
      unit('foe:chanter', 'foe', 8, 20, 5, 'chill')
    ]
  };
}

function unit(
  id: string,
  side: SpikeSide,
  cell: number,
  hp: number,
  power: number,
  action: SpikeAction
): SpikeUnit {
  return { id, side, cell, hp, maxHp: hp, power, action, alive: true, chilled: 0 };
}

/** Everything one battle produces, played out to the end. */
export function runSpikeBattle(maxTicks = 8): {
  readonly initial: SpikeBattleState;
  readonly events: readonly SpikeBattleEvent[];
  readonly ticks: number;
} {
  const initial = initialSpikeBattle();
  let state = initial;
  const events: SpikeBattleEvent[] = [];
  let ticks = 0;

  while (ticks < maxTicks && bothSidesStanding(state)) {
    const step = runSpikeTick(state);
    state = step.state;
    events.push(...step.events);
    ticks += 1;
  }

  return { initial, events, ticks };
}

function bothSidesStanding(state: SpikeBattleState): boolean {
  return (['crew', 'foe'] as const).every((side) =>
    state.units.some((one) => one.side === side && one.alive)
  );
}

/** One tick: every living unit acts once, in id order, and the tick closes. */
export function runSpikeTick(state: SpikeBattleState): {
  readonly state: SpikeBattleState;
  readonly events: readonly SpikeBattleEvent[];
} {
  const events: SpikeBattleEvent[] = [];
  const units: Mutable<SpikeUnit>[] = state.units.map((one) => ({ ...one }));
  const order = [...units].sort((a, b) => (a.id < b.id ? -1 : 1)).map((one) => one.id);

  for (const actorId of order) {
    const actor = units.find((one) => one.id === actorId);

    if (actor === undefined || !actor.alive) {
      continue;
    }

    if (actor.chilled > 0) {
      events.push({ kind: 'intent', actor: actor.id, target: null, action: 'skip', reason: 'chilled' });
      actor.chilled -= 1;
      continue;
    }

    const target = chooseTarget(actor, units);

    if (target === null) {
      continue;
    }

    events.push({
      kind: 'intent',
      actor: actor.id,
      target: target.id,
      action: actor.action,
      reason: reasonFor(actor, target)
    });

    const amount = actor.action === 'chill' ? Math.max(1, actor.power - 2) : actor.power;
    target.hp = Math.max(0, target.hp - amount);
    events.push({ kind: 'hit', actor: actor.id, target: target.id, amount });

    if (actor.action === 'chill' && target.hp > 0) {
      target.chilled = 1;
      events.push({ kind: 'status_applied', target: target.id, status: 'chilled' });
    }

    if (target.hp === 0 && target.alive) {
      target.alive = false;
      events.push({ kind: 'unit_died', unit: target.id });
    }
  }

  events.push({ kind: 'tick_ended', tick: state.tick + 1 });

  return { state: { tick: state.tick + 1, units: units.map((one) => ({ ...one })) }, events };
}

/** The spike's one concession to mutation: a working copy inside a tick. */
type Mutable<T> = { -readonly [K in keyof T]: T[K] };

/**
 * The front-most living enemy for melee, the weakest for everything else.
 *
 * Enough geometry to make the events differ; not the access rules — those are what the
 * `Combat System Spec` has to decide, and inventing them here would be a spike answering
 * a question it was not asked.
 */
function chooseTarget(
  actor: SpikeUnit,
  units: readonly Mutable<SpikeUnit>[]
): Mutable<SpikeUnit> | null {
  const enemies = units.filter((one) => one.side !== actor.side && one.alive);

  if (enemies.length === 0) {
    return null;
  }

  if (actor.action === 'strike') {
    return [...enemies].sort((a, b) => a.cell - b.cell || (a.id < b.id ? -1 : 1))[0] ?? null;
  }

  return [...enemies].sort((a, b) => a.hp - b.hp || (a.id < b.id ? -1 : 1))[0] ?? null;
}

function reasonFor(actor: SpikeUnit, target: SpikeUnit): string {
  if (actor.action === 'strike') {
    return 'front_most_enemy';
  }

  return target.hp <= target.maxHp / 2 ? 'weakest_enemy_is_wounded' : 'weakest_enemy';
}
