import type { Comparator } from '../collections/comparator.ts';

/**
 * What a contract needs done, and the vocabulary a hero's expertise is expressed in
 * (`RESOLUTION_SPEC` §2.1, §2.2, §2.3).
 *
 * A closed engine vocabulary, like `ReasonCodes` and `Actions`: content authors a
 * *weight* per need, never a need. The literals are stable strings because they reach a
 * canonical artifact and become localization keys, so renaming one is a save-format and
 * a text change, not a rename.
 *
 * Three of them rather than one is the whole point of the coverage model. One need makes
 * "take the strongest" optimal and puts the kill-criterion of `MVP_PLAN` §3.2 back on the
 * table; independent needs with weights are what make "the strongest crew" and "the right
 * crew" different answers (`DEC-013`).
 *
 * `packages/simulation/src/domain/` imports no state and no rules, which is what keeps
 * `ContractState → ContractResolution → CommitmentState → DecisionContext → ContractState`
 * from closing into the cycle `lint:deps` rejects (`RESOLUTION_SPEC` §2.7).
 */
export const NeedId = Object.freeze({
  Frontline: 'frontline',
  UndeadKnowledge: 'undead_knowledge',
  Wilderness: 'wilderness'
});

export type NeedId = (typeof NeedId)[keyof typeof NeedId];

/**
 * Every need above, in declaration order — derived from the object rather than typed a
 * second time, for the reason `REASON_CODES` gives at length: a hand-written twin needs a
 * test to stop the two drifting, and `Object.values` on a frozen object is that test's
 * job done by construction.
 */
export const NEED_IDS: readonly NeedId[] = Object.freeze(Object.values(NeedId));

/**
 * Position in {@link NEED_IDS}, computed once. `indexOf` inside the comparator would be
 * correct and would also make every sort quadratic in a vocabulary that is about to be
 * walked for every hero of every crew of every batch run.
 */
const POSITION: ReadonlyMap<NeedId, number> = new Map(NEED_IDS.map((need, index) => [need, index]));

/**
 * Declaration order, not alphabet — the single comparator every `SortedMap<NeedId, …>`
 * is built with (`RESOLUTION_SPEC` §2.1).
 *
 * Two collections keyed by need are enumerated into the canonical artifact — a contract's
 * `needs` and a hero's `expertise` — so a second ordering anywhere would make the artifact
 * a function of which comparator a call site happened to pass rather than of the state.
 *
 * Ordering by position rather than by string is deliberate even though today the two
 * agree, because they agree only by accident of spelling: `frontline`,
 * `undead_knowledge`, `wilderness` are in the same order both ways. Declaration order is
 * the property meant here — a need is where the designer put it — and `need-id.test.ts`
 * carries a tripwire that reddens the day a new literal breaks the coincidence, rather
 * than leaving the difference to be discovered by a moved artifact hash.
 */
export const compareNeedIds: Comparator<NeedId> = (left, right) =>
  positionOf(left) - positionOf(right);

/**
 * Throws rather than sorting an unknown value last. The type says this cannot happen, and
 * the type is checked at compile time only: a decoded save or a content file is where an
 * invented need would come from, and both cross the boundary as data. Sorting it to the
 * end would be a silent answer — one campaign's collections ordered by a rule nobody
 * wrote, and two unknown needs would compare *equal*, which `SortedMap.from` reads as a
 * duplicate key.
 */
function positionOf(need: NeedId): number {
  const position = POSITION.get(need);

  if (position === undefined) {
    throw new Error(`Unknown need id ${String(need)}.`);
  }

  return position;
}
