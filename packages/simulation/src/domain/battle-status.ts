import type { BattleUnitId } from './battle-unit-id.ts';

/**
 * The four statuses of `COMBAT_SPEC` §3.5, as names and as the shape one takes on a unit.
 *
 * How long each lasts and what each does are rules and live in `combat/unit.ts`; what a
 * status *is* has to be nameable by `state/`, because a battle record is stored on the
 * contract's resolution (§6.4) and every unit in it carries its statuses.
 */
export const StatusId = Object.freeze({
  Chilled: 'chilled',
  Bleeding: 'bleeding',
  Guarded: 'guarded',
  Pinned: 'pinned'
});

export type StatusId = (typeof StatusId)[keyof typeof StatusId];

export const STATUS_IDS: readonly StatusId[] = Object.freeze(Object.values(StatusId));

/**
 * A status on a unit, **with the unit that put it there**.
 *
 * The source is in the state and not only in the event that applied it, and that is a
 * repair rather than a flourish: `bleeding` deals damage at the end of a round, and the
 * event for that damage has to name an `actor`; `guarded` absorbs a blow, and the
 * absorption has to name a `by`. Both facts are gone by then unless the state remembers
 * them — external review found the hole, and §8.3 could not have built a single aggregate
 * without it.
 */
export interface StatusInstance {
  readonly remainingRounds: number;
  readonly source: BattleUnitId;
}
