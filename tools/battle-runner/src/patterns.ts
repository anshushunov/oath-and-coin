import {
  CombatRole,
  SortedMap,
  compareNeedIds,
  NeedId,
  type AuthoredCombatant,
  type BattleObjective,
  type ContractBattlePlan,
  type HeroCombatLayer
} from '@oath-and-coin/simulation';

/**
 * The enemy patterns the geometry measurements are taken against, and the held-out set the
 * dominance question is asked on (`COMBAT_SPEC` §12.5, `MVP_PLAN` §6.4).
 *
 * **In code, under git, and frozen before balancing.** `AGENTS.md` §11 puts inputs in the
 * repository and outputs in a run's artifacts, and `MVP_PLAN` §6.4 adds the reason this
 * particular input has to be frozen *first*: a held-out set assembled after the numbers were
 * tuned proves only how it was assembled.
 *
 * **The held-out set is separate and is not measured by anything else.** Every metric except
 * the dominance one reads {@link CORE_PATTERNS}; the dominance one reads
 * {@link HELD_OUT_PATTERNS} and nothing else. Two authorial counters would satisfy "no
 * dominant crew" without an interesting preparation existing, which is the failure §6.4
 * names.
 */

const attributes = (overrides: Partial<HeroCombatLayer> = {}): HeroCombatLayer => ({
  might: 50,
  guard: 50,
  aim: 50,
  focus: 50,
  care: 50,
  ...overrides
});

const foe = (
  key: string,
  role: CombatRole,
  row: 1 | 2 | 3,
  column: 1 | 2 | 3,
  combat: HeroCombatLayer
): AuthoredCombatant => ({ id: `foe:${key}`, role, cell: { row, column }, combat });

/**
 * A plan whose only objective is to put the whole pattern down.
 *
 * The geometry questions — does a formation decide anything, do six beat four, does a rear
 * unit lose effect as its own side crowds the board — are about *the fight*, not about what
 * a contract asked for. One objective naming every foe is the plainest way to ask them
 * without a contract's own weighting deciding the answer.
 */
export function subdueEverything(foes: readonly AuthoredCombatant[]): ContractBattlePlan {
  return {
    objectives: SortedMap.from<NeedId, BattleObjective>(compareNeedIds, [
      [
        NeedId.Frontline,
        { kind: 'subdue', targets: foes.map((one) => one.id) } satisfies BattleObjective
      ],
      [NeedId.Wilderness, { kind: 'hold', rounds: 6 } satisfies BattleObjective]
    ]),
    foes,
    wards: []
  };
}

/** Four kinds of enemy, each punishing something different about a shape. */
export const CORE_PATTERNS: Readonly<Record<string, readonly AuthoredCombatant[]>> = Object.freeze({
  /** Everything in the front rank: an open column is a road they will take. */
  ram: Object.freeze([
    foe('v1', CombatRole.Vanguard, 1, 1, attributes({ might: 80, guard: 80 })),
    foe('v2', CombatRole.Vanguard, 1, 2, attributes({ might: 80, guard: 80 })),
    foe('v3', CombatRole.Vanguard, 1, 3, attributes({ might: 80, guard: 80 })),
    foe('s1', CombatRole.Support, 2, 2, attributes({ care: 80, guard: 60 }))
  ]),

  /** Three rear units and almost no melee: they out-shoot anybody firing through his own. */
  archers: Object.freeze([
    foe('v1', CombatRole.Vanguard, 1, 2, attributes({ might: 65, guard: 75 })),
    foe('r1', CombatRole.Rear, 3, 1, attributes({ aim: 95, guard: 55 })),
    foe('r2', CombatRole.Rear, 3, 2, attributes({ aim: 95, guard: 55 })),
    foe('r3', CombatRole.Rear, 3, 3, attributes({ aim: 95, guard: 55 }))
  ]),

  /** Two of them, whose work is knocking people out of the rows their actions live in. */
  breakers: Object.freeze([
    foe('b1', CombatRole.Breaker, 1, 1, attributes({ might: 95, guard: 60 })),
    foe('b2', CombatRole.Breaker, 1, 3, attributes({ might: 95, guard: 60 })),
    foe('v1', CombatRole.Vanguard, 1, 2, attributes({ might: 70, guard: 80 })),
    foe('s1', CombatRole.Support, 2, 2, attributes({ care: 80, guard: 60 }))
  ]),

  /** A deep line: whatever reaches the back has come through two ranks to get there. */
  column: Object.freeze([
    foe('v1', CombatRole.Vanguard, 1, 2, attributes({ might: 75, guard: 85 })),
    foe('b1', CombatRole.Breaker, 2, 2, attributes({ might: 80, guard: 65 })),
    foe('r1', CombatRole.Rear, 3, 2, attributes({ aim: 85, guard: 50 })),
    foe('v2', CombatRole.Vanguard, 1, 1, attributes({ might: 70, guard: 80 }))
  ])
});

/**
 * The held-out set (`MVP_PLAN` §6.4), chosen at the same time as the core one and read by
 * exactly one measurement.
 *
 * Three shapes of threat that are *kinds* rather than counters: nothing here was built
 * against a crew, which is the property that makes "no crew dominates it" mean something.
 */
export const HELD_OUT_PATTERNS: Readonly<Record<string, readonly AuthoredCombatant[]>> =
  Object.freeze({
    /** A single very hard thing, and two who keep it standing. */
    champion: Object.freeze([
      foe('v1', CombatRole.Vanguard, 1, 2, attributes({ might: 100, guard: 100 })),
      foe('s1', CombatRole.Support, 2, 2, attributes({ care: 100, guard: 70 })),
      foe('s2', CombatRole.Support, 2, 1, attributes({ care: 100, guard: 70 }))
    ]),

    /** Many weak ones spread wide: no column is open and none of them is worth a shot. */
    swarm: Object.freeze([
      foe('v1', CombatRole.Vanguard, 1, 1, attributes({ might: 55, guard: 45 })),
      foe('v2', CombatRole.Vanguard, 1, 2, attributes({ might: 55, guard: 45 })),
      foe('v3', CombatRole.Vanguard, 1, 3, attributes({ might: 55, guard: 45 })),
      foe('v4', CombatRole.Vanguard, 2, 1, attributes({ might: 55, guard: 45 })),
      foe('v5', CombatRole.Vanguard, 2, 3, attributes({ might: 55, guard: 45 }))
    ]),

    /** Nothing at the front at all: their whole strength is behind an empty rank. */
    ambush: Object.freeze([
      foe('r1', CombatRole.Rear, 3, 1, attributes({ aim: 90, guard: 60 })),
      foe('r2', CombatRole.Rear, 3, 3, attributes({ aim: 90, guard: 60 })),
      foe('b1', CombatRole.Breaker, 2, 2, attributes({ might: 90, guard: 60 }))
    ])
  });
