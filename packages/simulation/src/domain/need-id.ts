import { byDeclarationOrder, type Comparator } from '../collections/comparator.ts';

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
 * Declaration order, not alphabet — the single comparator every `SortedMap<NeedId, …>`
 * is built with (`RESOLUTION_SPEC` §2.1).
 *
 * Two collections keyed by need are enumerated into the canonical artifact — a contract's
 * `needs` and a hero's `expertise` — so a second ordering anywhere would make the artifact
 * a function of which comparator a call site happened to pass rather than of the state.
 *
 * Built from {@link NEED_IDS} by a general rule rather than written out here, and that is
 * what makes the rule testable at all: on today's three literals declaration order and
 * ordinal order coincide, so no assertion over *these* needs can tell this comparator from
 * `compareStrings` by its ordering. `comparator.test.ts` exercises `byDeclarationOrder` on
 * a vocabulary chosen to disagree with the alphabet, `need-id.test.ts` holds the
 * coincidence with a tripwire that reddens the day a new literal breaks it, and the
 * throw-on-unknown below is what kills the `compareStrings` substitution outright — that
 * one answers `1` where this one refuses.
 */
export const compareNeedIds: Comparator<NeedId> = byDeclarationOrder(NEED_IDS);
