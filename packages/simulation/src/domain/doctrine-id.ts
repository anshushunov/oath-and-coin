import { byDeclarationOrder, type Comparator } from '../collections/comparator.ts';

/**
 * The one group order a player gives before a battle (`COMBAT_SPEC` §7.2).
 *
 * The **name** of a doctrine is here rather than beside its preference order
 * (`combat/doctrine.ts`) for the same reason a cell is (`domain/battle-cell.ts`): the
 * doctrine a player chose is stored on the contract's package and has to survive a save,
 * so `state/` must be able to name one. The order it implies over actions is a rule, and
 * rules stay in `combat/`.
 */
export const DoctrineId = Object.freeze({
  HoldTheLine: 'hold_the_line',
  BreakThemFirst: 'break_them_first',
  SpareThePeople: 'spare_the_people'
});

export type DoctrineId = (typeof DoctrineId)[keyof typeof DoctrineId];

export const DOCTRINE_IDS: readonly DoctrineId[] = Object.freeze(Object.values(DoctrineId));

export const compareDoctrineIds: Comparator<DoctrineId> = byDeclarationOrder(DOCTRINE_IDS);
