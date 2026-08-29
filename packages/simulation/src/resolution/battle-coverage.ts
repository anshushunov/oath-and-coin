import type { SortedMap } from '../collections/sorted-map.ts';
import { BattleOutcome } from '../domain/battle-event.ts';
import type { BattleObjective } from '../domain/battle-objective.ts';
import type { BattleRecord } from '../domain/battle-record.ts';
import type { BattleUnit } from '../domain/battle-unit.ts';
import type { BattleUnitId } from '../domain/battle-unit-id.ts';
import type { NeedId } from '../domain/need-id.ts';
import type { NeedCoverage } from '../domain/outcome.ts';
import { compareHeroIds, type HeroId } from '../ids/hero-id.ts';
import { divideTowardZero, multiplyInt32, toInt32 } from '../integer-division.ts';

import { SURPLUS_CAP_PERCENT, requiredFor, verdictFor } from './needs-coverage.ts';

/**
 * How a battle fills in a contract's coverage table (`COMBAT_SPEC` §6.2, §6.2.1,
 * `ADR-016` §1).
 *
 * The battle produces `supplied` and **nothing else about the verdict**: `required` is the
 * contract's own weight raised by its own risk ({@link requiredFor}), and `closed`/`weak`/
 * `uncovered` are read by {@link verdictFor}. A battle with a scale of its own would hand
 * the debrief screen two answers to reconcile, and §6.2 exists to say there is one.
 *
 * **Progress is defined by credited increments, not measured and attributed afterwards.**
 * `NeedCoverage` carries two numbers per hero and the screen adds the second column up by
 * hand (`DEC-014`); a row whose `supplied` is not exactly `Σ counted` is a number nobody
 * can explain. So every increment is handed to somebody as it is earned, and the equality
 * holds by construction rather than by arithmetic that happens to agree.
 *
 * **Where an increment goes when nobody it could go to is a hero.** Three cases, and all
 * three land on the same rule as the leftover of an uneven division: the crew's
 * lowest-numbered hero. A ward's own killing blow, the remainder of `required / N`, and a
 * round nobody was left standing for are all increments the battle earned and the roster
 * cannot place; dropping them instead would make `supplied` disagree with what happened,
 * and inventing a fourth column for them would put a number on the screen with no name
 * beside it. `COMBAT_SPEC` §6.2.1 states the rule for the remainder; the other two are the
 * same rule reaching the same place.
 *
 * **What §6.2.1 says about `protect` and what this does.** The spec gives half the credit
 * "подзащитному". The ward is authored by the contract and is not one of the player's
 * heroes, so it has no line on a table keyed by `HeroId`; that half goes to the heroes who
 * were still standing when it ended, equally. Named here rather than left as a silent
 * divergence — the alternative was a ward that has to be a hero, which no contract author
 * can name before the player has chosen a crew.
 */

/** Everything the battle side of coverage reads. */
export interface ObjectiveCoverageInput {
  readonly record: BattleRecord;

  /** The contract's authored weights (`RESOLUTION_SPEC` §2.3). */
  readonly needs: SortedMap<NeedId, number>;

  /** The contract's authored mapping from each of those needs to a battle objective. */
  readonly objectives: SortedMap<NeedId, BattleObjective>;

  /** The contract's own risk, which raises every requirement (`RESOLUTION_SPEC` §4.2). */
  readonly risk: number;
}

export function objectiveCoverage(input: ObjectiveCoverageInput): readonly NeedCoverage[] {
  const heroes = heroesOf(input.record);

  return input.needs.entries().map(([need, weight]) => {
    const objective = input.objectives.get(need);

    if (objective === undefined) {
      throw new Error(
        `Contract need '${need}' has no battle objective. The mapping is authored data and the ` +
          "content loader holds it to exactly the contract's own needs, so a need without one " +
          'means a battle was run for a contract this build should have refused to load ' +
          '(COMBAT_SPEC §6.2).'
      );
    }

    const required = requiredFor(weight, input.risk);
    const ledger = new Ledger(heroes);

    switch (objective.kind) {
      case 'subdue':
        subdue(input.record, objective.targets, required, ledger);
        break;
      case 'protect':
        protect(input.record, objective.ward, required, ledger);
        break;
      case 'hold':
        hold(input.record, objective.rounds, required, ledger);
        break;
    }

    const supplied = ledger.supplied();

    return {
      need,
      weight,
      required,
      supplied,
      effective: Math.min(
        supplied,
        divideTowardZero(multiplyInt32(required, SURPLUS_CAP_PERCENT), 100)
      ),
      verdict: verdictFor(supplied, required),
      contributors: ledger.contributors()
    } satisfies NeedCoverage;
  });
}

/**
 * The two numbers per hero, kept as they are earned.
 *
 * `amount` is the raw battle number — damage on the named foes, healing and shielding given
 * to the ward, rounds spent in the line — and `counted` is the share of the requirement it
 * bought. The same pair of meanings `DEC-014` gives the contract loop, which is why the
 * debrief screen needs no second reading for a battle.
 */
class Ledger {
  private readonly amounts = new Map<HeroId, number>();
  private readonly counted = new Map<HeroId, number>();
  private readonly heroes: readonly HeroId[];

  // Written out rather than as a parameter property: `erasableSyntaxOnly` is on for the
  // whole workspace (`FULL_TYPESCRIPT_MIGRATION` §8.3), because Node executes these sources
  // by stripping types and a parameter property has a runtime effect to strip.
  constructor(heroes: readonly HeroId[]) {
    this.heroes = heroes;
  }

  /** Whoever the crew's lowest-numbered hero is — where an unplaceable increment lands. */
  get fallback(): HeroId | null {
    return this.heroes[0] ?? null;
  }

  raw(hero: HeroId | null, value: number): void {
    if (hero === null || value === 0) {
      return;
    }

    this.amounts.set(hero, toInt32((this.amounts.get(hero) ?? 0) + value));
  }

  credit(hero: HeroId | null, value: number): void {
    const to = hero !== null && this.heroes.includes(hero) ? hero : this.fallback;

    if (to === null || value === 0) {
      return;
    }

    this.counted.set(to, toInt32((this.counted.get(to) ?? 0) + value));
  }

  /**
   * Splits `value` between `among` as evenly as integers allow, the leftover to the lowest
   * id — §6.2.1's rule, applied wherever a division does not come out.
   */
  split(value: number, among: readonly HeroId[]): void {
    const receivers = [...among].sort(compareHeroIds);

    if (receivers.length === 0) {
      this.credit(this.fallback, value);
      return;
    }

    const share = divideTowardZero(value, receivers.length);

    for (const hero of receivers) {
      this.credit(hero, share);
    }

    this.credit(receivers[0] ?? null, toInt32(value - multiplyInt32(share, receivers.length)));
  }

  supplied(): number {
    return [...this.counted.values()].reduce((sum, value) => toInt32(sum + value), 0);
  }

  /**
   * Every hero of the crew, in id order, including the ones who did nothing.
   *
   * All of them, because the debrief lists the crew and a hero missing from the table reads
   * as a man who was not there — the same reason `contributions.keys() === acceptedBy` is
   * an invariant of the contract loop (`RESOLUTION_SPEC` §2.5).
   */
  contributors(): NeedCoverage['contributors'] {
    return this.heroes.map((hero) => ({
      hero,
      amount: this.amounts.get(hero) ?? 0,
      counted: this.counted.get(hero) ?? 0
    }));
  }
}

/** Each of the named foes that went down, credited to whoever put him down (§6.2.1). */
function subdue(
  record: BattleRecord,
  targets: readonly BattleUnitId[],
  required: number,
  ledger: Ledger
): void {
  const share = divideTowardZero(required, Math.max(targets.length, 1));
  let felled = 0;

  for (const event of record.events) {
    if (event.kind === 'damage_dealt' && targets.includes(event.target)) {
      ledger.raw(heroOf(record, event.actor), event.amount);
    }

    if (event.kind === 'unit_downed' && targets.includes(event.unit)) {
      // `by` already names the source of a `bleeding` rather than the round that ticked it
      // (`COMBAT_SPEC` §3.5), so no second rule is needed here for that case.
      ledger.credit(heroOf(record, event.by), share);
      felled += 1;
    }
  }

  // The leftover of an uneven division belongs to a finished job, not to a partial one: a
  // crew that put two of three down has not earned the point that only exists because
  // three does not divide the requirement.
  if (felled === targets.length && targets.length > 0) {
    ledger.credit(ledger.fallback, toInt32(required - multiplyInt32(share, targets.length)));
  }
}

/** What the ward has left, credited to the men who kept him on his feet (§6.2.1). */
function protect(record: BattleRecord, ward: BattleUnitId, required: number, ledger: Ledger): void {
  const final = record.final.units.find((unit) => unit.id === ward);

  if (final === undefined || final.maxHealth === 0) {
    return;
  }

  const perPoint = divideTowardZero(required, final.maxHealth);
  const total = multiplyInt32(perPoint, final.health);
  const given = new Map<HeroId, number>();

  for (const event of record.events) {
    const helper =
      event.kind === 'healing_done' && event.target === ward
        ? heroOf(record, event.actor)
        : event.kind === 'damage_absorbed' && event.target === ward
          ? heroOf(record, event.by)
          : null;

    if (helper !== null && (event.kind === 'healing_done' || event.kind === 'damage_absorbed')) {
      ledger.raw(helper, event.amount);
      given.set(helper, toInt32((given.get(helper) ?? 0) + event.amount));
    }
  }

  const helped = [...given.values()].reduce((sum, value) => toInt32(sum + value), 0);
  const stillThere = record.final.units
    .filter((unit) => unit.side === 'crew' && unit.standing && unit.hero !== null)
    .map((unit) => unit.hero!)
    .sort(compareHeroIds);

  if (helped === 0) {
    // Nobody healed or shielded him, so there is no proportion to divide by. §6.2.1 gives
    // the whole of it to the protectee in that case; the protectee is not a hero, so it
    // goes to the men who were still standing over him.
    ledger.split(total, stillThere);
    return;
  }

  const proportional = divideTowardZero(total, 2);
  let handed = 0;

  for (const [hero, amount] of [...given.entries()].sort(([left], [right]) =>
    compareHeroIds(left, right)
  )) {
    const share = divideTowardZero(multiplyInt32(proportional, amount), helped);
    ledger.credit(hero, share);
    handed = toInt32(handed + share);
  }

  ledger.credit(ledger.fallback, toInt32(proportional - handed));
  ledger.split(toInt32(total - proportional), stillThere);
}

/** Each round the crew stood, split between the men who were still standing (§6.2.1). */
function hold(record: BattleRecord, rounds: number, required: number, ledger: Ledger): void {
  if (rounds <= 0) {
    return;
  }

  const share = divideTowardZero(required, rounds);
  const stood = roundsStood(record);
  // §6.2.2: a crew that won by elimination is credited the rounds it never had to fight —
  // there is nobody left to dispute the ground. Only on its own victory: a timeout, a
  // retreat and a defeat are all credited with what was actually stood through.
  const counted =
    record.outcome === BattleOutcome.CrewStanding
      ? [
          ...stood.slice(0, rounds),
          ...Array.from({ length: Math.max(0, rounds - stood.length) }, () =>
            standingHeroesAtTheEnd(record)
          )
        ]
      : stood.slice(0, rounds);

  for (const heroes of counted) {
    ledger.split(share, heroes);
  }

  for (const hero of counted.flat()) {
    ledger.raw(hero, 1);
  }

  if (counted.length === rounds) {
    ledger.credit(ledger.fallback, toInt32(required - multiplyInt32(share, rounds)));
  }
}

/**
 * Who was still standing at the end of each round, replayed from the events.
 *
 * Replayed rather than stored: a per-round snapshot on the record would be a second copy of
 * the board, and the events already say every way a hero leaves it — knocked down, or
 * walked off on the signal (`COMBAT_SPEC` §7.4).
 */
function roundsStood(record: BattleRecord): readonly (readonly HeroId[])[] {
  const gone = new Set<BattleUnitId>();
  const rounds: (readonly HeroId[])[] = [];

  const heroUnits = record.initial.units.filter(
    (unit) => unit.side === 'crew' && unit.hero !== null
  );

  for (const event of record.events) {
    if (event.kind === 'unit_downed' || event.kind === 'retreat_obeyed') {
      gone.add(event.unit);
    }

    if (event.kind === 'round_ended') {
      rounds.push(
        heroUnits
          .filter((unit) => !gone.has(unit.id))
          .map((unit) => unit.hero!)
          .sort(compareHeroIds)
      );
    }
  }

  return rounds;
}

function standingHeroesAtTheEnd(record: BattleRecord): readonly HeroId[] {
  return record.final.units
    .filter((unit) => unit.side === 'crew' && unit.standing && unit.hero !== null)
    .map((unit) => unit.hero!)
    .sort(compareHeroIds);
}

function heroesOf(record: BattleRecord): readonly HeroId[] {
  return record.initial.units
    .filter(
      (unit): unit is BattleUnit & { hero: HeroId } => unit.side === 'crew' && unit.hero !== null
    )
    .map((unit) => unit.hero)
    .sort(compareHeroIds);
}

function heroOf(record: BattleRecord, id: BattleUnitId): HeroId | null {
  return record.initial.units.find((unit) => unit.id === id)?.hero ?? null;
}
