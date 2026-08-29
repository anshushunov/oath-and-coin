import { SortedMap } from '../collections/sorted-map.ts';
import { startBattle, runBattle } from '../combat/battle.ts';
import { unitFrom } from '../combat/unit.ts';
import { eatenByTheFormation } from '../combat/effect.ts';
import type { BattleRecord } from '../domain/battle-record.ts';
import { BattleOutcome } from '../domain/battle-event.ts';
import type { BattleUnit } from '../domain/battle-unit.ts';
import type { BattleUnitId } from '../domain/battle-unit-id.ts';
import { compareBattleUnitIds } from '../domain/battle-unit-id.ts';
import { TargetReasons } from '../domain/battle-reasons.ts';
import type { Deployment } from '../domain/deployment.ts';
import {
  ConsequenceKind,
  CoverageVerdict,
  DeficitKind,
  OutcomeIntentKind,
  type ContractResolution,
  type HeroConsequence,
  type NeedCoverage,
  type OutcomeIntent,
  type ResolutionDraft
} from '../domain/outcome.ts';
import { OutcomeReasonCodes, type OutcomeReasonCode } from '../domain/outcome-reason-codes.ts';
import { compareHeroIds, type HeroId } from '../ids/hero-id.ts';
import { toInt32 } from '../integer-division.ts';
import type { ContractState } from '../state/contract-state.ts';
import type { HeroState } from '../state/hero-state.ts';

import { objectiveCoverage } from './battle-coverage.ts';
import type { ContractResolver, ResolutionInput } from './contract-resolver.ts';
import { rankDeficits } from './deficits.ts';
import { reduceMargin } from './margin.ts';
import { gradeFromIntents, termsOf } from './outcome-grade.ts';
import {
  falteredEarlyIntentsFor,
  needReasonFor,
  objectiveIntentsFor,
  type CrewMember,
  type IntentInput
} from './outcome-intent.ts';

/**
 * The exam (`ADR-016`, `COMBAT_SPEC` §6).
 *
 * The second implementation of `ContractResolver`, and the authoritative one for every
 * contract whose author wrote a battle plan. It answers in exactly the shape the abstract
 * one answers in — ordered intents and a `ContractResolution` — so the debrief screen, the
 * save codec and the artifact read it without knowing which resolver produced it
 * (`ADR-014` §2, `ADR-016` §1).
 *
 * **What is shared and what is not.** Everything downstream of `supplied` is the contract
 * loop's own arithmetic, reused rather than reimplemented: the margin (§4.5), the grade
 * (§4.6), the ranked deficits (§4.7), the objective intent (§4.4). What the battle replaces
 * is the one step above them — where `supplied` comes from. That is the whole of
 * `ADR-016` §1 in one sentence, and it is why the two resolvers cannot disagree about what
 * a "weak" need means.
 *
 * **What it does not do: read the campaign.** No `eventId`, no `stateVersion`, no
 * `GameState`. The battle is a function of the board it was given, which is what lets the
 * balance runner fight ten thousand of them without building a campaign (`ADR-014` §3).
 */

/** What a wound costs a hero the battle knocked down (`COMBAT_SPEC` §6.5). */
export const WOUND_DOWNED = 2;

/** What being pulled out of a fight costs each hero who moved in it (§6.5). */
export const RETREAT_MAGNITUDE = 1;

/** The refusal `COMBAT_SPEC` §6.3 names, raised before a single event. */
export const DEPLOYMENT_REQUIRED = 'deployment_required';

export const battleResolver: ContractResolver = (input) => {
  const deployment = input.deployment;

  if (deployment === undefined) {
    // Named, and thrown rather than answered with an empty draft: a battle resolver that
    // invented a formation would be answering a question nobody asked, and §6.3 says so in
    // as many words. The command routes by `contract.battle` and cannot reach this; a
    // batch runner or a test handing over a half-built input can, and should hear about it.
    throw new Error(
      `${DEPLOYMENT_REQUIRED}: contract '${input.contract.id}' goes to a battle, and a battle ` +
        'needs a formation, a doctrine and an enemy pattern. Allowing one without would mean ' +
        'inventing where the crew stood (COMBAT_SPEC §6.3).'
    );
  }

  const crew = input.crew.map(asCrewMember);
  const record = runBattle(startBattle(unitsFor(input, deployment), deployment.crew.doctrine), {
    belowPercent: deployment.crew.retreatBelowPercent,
    signalledAtRound: deployment.retreatSignalledAtRound
  });

  // 1. What the fight supplied (§6.2.1), read as the contract's own coverage table.
  const coverage = objectiveCoverage({
    record,
    needs: input.contract.needs,
    objectives: deployment.plan.objectives,
    risk: input.contract.risk
  });

  // 2. One intent per need, carrying the geometry code where geometry is what happened.
  const covered = coverageIntentsFor(coverage, crew, record);
  const gaveWay = falteredEarlyIntentsFor(battleIntentInput(input, crew, coverage));

  // 3–4. The margin and the step, by the contract loop's own arithmetic (§4.5, §4.6).
  const margin = reduceMargin(covered, crew.map(willingness));
  const totalRequired = coverage.reduce((sum, row) => toInt32(sum + row.required), 0);
  const grade = gradeFromIntents({ intents: covered, margin, totalRequired });

  // 5–6. The objective follows the step; what it cost the people is the battle's own
  //      answer rather than the grade's (see `consequencesOf`).
  const objective = objectiveIntentsFor(grade);
  const consequences = consequencesOf(record, grade, input.contract);

  const intents: readonly OutcomeIntent[] = [
    ...covered,
    ...gaveWay,
    ...objective,
    ...consequences.map(sufferedIntentFor),
    resolvedIntentFor(grade)
  ];

  const { ranked, dominant } = rankDeficits({ intents: covered, crew });

  return {
    intents,
    resolution: {
      grade,
      coverage,
      contributions: contributionsOf(crew, coverage, intents),
      deficits: ranked,
      dominant,
      consequences,
      battle: record
    } satisfies ContractResolution
  } satisfies ResolutionDraft;
};

/**
 * The board the battle is fought on (`COMBAT_SPEC` §3.1, §3.2).
 *
 * Three sources and one rule about ids: a hero becomes `crew:<his id>`, and the contract's
 * own units keep the ids the loader built (`foe:` / `ward:`). Nothing here can collide,
 * which is what makes `subdue` naming `foe:wight` unambiguous.
 *
 * **Bonds are resolved here and nowhere else.** The combat core reads a bond by battle id
 * and has never heard of a `ContentId`, so the hero's own `relationships` are translated
 * once, at set-up. It is the single thread by which something that is not the combat layer
 * reaches a battle at all (`DEC-016` §4).
 */
function unitsFor(input: ResolutionInput, deployment: Deployment): readonly BattleUnit[] {
  const idOf = (hero: HeroId): BattleUnitId => `crew:${String(hero)}`;
  const byDefinition = new Map(input.crew.map((member) => [member.hero.definition, member.hero]));

  const heroes = input.crew.map((member) => {
    const cell = deployment.crew.placement.get(member.hero.id);

    if (cell === undefined) {
      throw new Error(
        `Hero hero#${String(member.hero.id)} went out on contract '${input.contract.id}' and the ` +
          'formation gives him no cell. `placeCrew` refuses that state and so does ' +
          '`createContractState` (COMBAT_SPEC §3.7: unplaced_hero), so this input was not ' +
          'built by a command.'
      );
    }

    return unitFrom({
      id: idOf(member.hero.id),
      side: 'crew',
      hero: member.hero.id,
      role: member.hero.role,
      cell,
      combat: member.hero.combat,
      bonds: bondsOf(member.hero, byDefinition, idOf)
    });
  });

  const wards = deployment.plan.wards.map((ward) =>
    unitFrom({
      id: ward.id,
      side: 'crew',
      hero: null,
      role: ward.role,
      cell: ward.cell,
      combat: ward.combat
    })
  );

  const foes = deployment.plan.foes.map((foe) =>
    unitFrom({
      id: foe.id,
      side: 'foe',
      hero: null,
      role: foe.role,
      cell: foe.cell,
      combat: foe.combat
    })
  );

  return [...heroes, ...wards, ...foes];
}

function bondsOf(
  hero: HeroState,
  byDefinition: ReadonlyMap<HeroState['definition'], HeroState>,
  idOf: (hero: HeroId) => BattleUnitId
): SortedMap<BattleUnitId, number> {
  return SortedMap.from<BattleUnitId, number>(
    compareBattleUnitIds,
    hero.relationships.entries().flatMap(([definition, weight]) => {
      const other = byDefinition.get(definition);

      // A bond toward somebody who stayed home is not a bond in this battle. Dropped
      // rather than kept at zero: the reaction reads "is there somebody I care about on
      // the ground", and a man who is not here cannot be on it.
      return other === undefined ? [] : [[idOf(other.id), weight] as const];
    })
  );
}

/**
 * One intent per need, and the geometry code where geometry is what happened
 * (`COMBAT_SPEC` §6.4 п.2, §10.3).
 *
 * **Selective, never causal** (§8.3). "They came through the open column" is a fact about
 * the events; "you lost because of the open column" is a counterfactual, and there is no
 * counterfactual model. The codes are named the first way on purpose, and this is where
 * that discipline is either kept or lost.
 *
 * The order is a priority and it is stated rather than scored: a road to the rear outranks
 * an obstructed shot, because one is a thing the enemy did and the other is a thing the
 * crew's own shape cost it, and a player can act on the first more directly.
 */
function coverageIntentsFor(
  coverage: readonly NeedCoverage[],
  crew: readonly CrewMember[],
  record: BattleRecord
): readonly OutcomeIntent[] {
  const throughTheOpenColumn = record.events.some(
    (event) =>
      event.kind === 'intent_declared' &&
      event.reason === TargetReasons.ReachedThroughTheOpenColumn &&
      record.initial.units.find((unit) => unit.id === event.actor)?.side === 'foe'
  );

  const ownFormationAte = record.events.some(
    (event) =>
      (event.kind === 'damage_dealt' || event.kind === 'healing_done') &&
      record.initial.units.find((unit) => unit.id === event.actor)?.side === 'crew' &&
      eatenByTheFormation(event.provenance) > 0
  );

  const held = record.outcome !== BattleOutcome.FoesStanding;

  return coverage.map((row) => {
    const closed = row.verdict === CoverageVerdict.Closed;

    return {
      kind: closed ? OutcomeIntentKind.NeedCovered : OutcomeIntentKind.NeedShort,
      hero: null,
      need: row.need,
      marginDelta: toInt32(row.effective - row.required),
      reason:
        geometryReasonFor({ closed, held, throughTheOpenColumn, ownFormationAte }) ??
        needReasonFor(row.verdict),
      gap: closed ? null : gapFor(row, crew),
      consequence: null,
      magnitude: 0
    };
  });
}

function geometryReasonFor(what: {
  readonly closed: boolean;
  readonly held: boolean;
  readonly throughTheOpenColumn: boolean;
  readonly ownFormationAte: boolean;
}): OutcomeReasonCode | null {
  if (what.closed) {
    return what.held ? OutcomeReasonCodes.HeldTheLine : null;
  }

  if (what.throughTheOpenColumn) {
    return OutcomeReasonCodes.ReachedThroughTheOpenColumn;
  }

  return what.ownFormationAte ? OutcomeReasonCodes.BlockedByOwnFormation : null;
}

/**
 * Which of the two shortfall diagnoses a battle earned (`RESOLUTION_SPEC` §4.7).
 *
 * **Answerability, not the abstract resolver's counterfactual, and the difference is
 * named.** Over there the question is "would these people have closed it at a grade of a
 * hundred", which is answerable because coverage is a function of `grade`. A battle's
 * `supplied` is not: it comes out of a fight, and "re-fight it with perfect heroes" is a
 * second battle rather than a second sum. What survives the translation is the half that
 * still means something — was anybody in this crew answerable for this need at all — and
 * that is exactly the line between the two diagnoses `RESOLUTION_SPEC` §4.7 draws.
 */
function gapFor(row: NeedCoverage, crew: readonly CrewMember[]): DeficitKind {
  return crew.some((member) => member.capability.expertise.has(row.need))
    ? DeficitKind.Capability
    : DeficitKind.Coverage;
}

/**
 * What the battle cost the people who fought it (`COMBAT_SPEC` §6.5).
 *
 * **The battle's own facts, not §5.1's grade-driven allocation, and that is `ADR-014`
 * §Контекст arriving where it matters most.** The contract loop has to *choose* who was
 * hurt, because nothing happened to anybody in particular; a battle knows. A wound goes to
 * every hero who was knocked down and to nobody else, and a retreat costs every hero who
 * took a turn — the price `DEC-005` says the lever has to have.
 *
 * `TrustLost` is the one thing kept from §5.1, and only at a catastrophe: it is about the
 * guild's word rather than about the fight, and the key hero is who it was given to.
 * `Grudge` is not produced by a battle at all, and that is a declared boundary: §5.1 ties
 * it to `faltered_early`, which is a statement about *coverage*, and a man who fought and
 * did not close his need has already been answered for by the wound or by nothing.
 */
function consequencesOf(
  record: BattleRecord,
  grade: ContractResolution['grade'],
  contract: ContractState
): readonly HeroConsequence[] {
  const heroOf = (id: BattleUnitId): HeroId | null =>
    record.initial.units.find((unit) => unit.id === id)?.hero ?? null;

  const downed = new Set<HeroId>();
  const moved = new Set<HeroId>();

  for (const event of record.events) {
    if (event.kind === 'unit_downed') {
      const hero = heroOf(event.unit);
      if (hero !== null) {
        downed.add(hero);
      }
    }

    if (event.kind === 'intent_declared') {
      const hero = heroOf(event.actor);
      if (hero !== null) {
        moved.add(hero);
      }
    }
  }

  const wounds: HeroConsequence[] = [...downed].sort(compareHeroIds).map((hero) => ({
    hero,
    kind: ConsequenceKind.Wound,
    reason: OutcomeReasonCodes.WoundOnThePoint,
    magnitude: WOUND_DOWNED
  }));

  const retreats: HeroConsequence[] =
    record.outcome === BattleOutcome.Retreated
      ? [...moved].sort(compareHeroIds).map((hero) => ({
          hero,
          kind: ConsequenceKind.Retreat,
          reason: OutcomeReasonCodes.ObjectiveLost,
          magnitude: RETREAT_MAGNITUDE
        }))
      : [];

  const trust: HeroConsequence[] =
    termsOf(grade).maxConsequences >= 2 && contract.offer.keyHero !== null
      ? [
          {
            hero: contract.offer.keyHero,
            kind: ConsequenceKind.TrustLost,
            reason: OutcomeReasonCodes.TrustLostInDisaster,
            magnitude: 1
          }
        ]
      : [];

  return [...wounds, ...retreats, ...trust];
}

const willingness = (crewMember: CrewMember) => crewMember.commitment;

function asCrewMember(crewMember: ResolutionInput['crew'][number]): CrewMember {
  return {
    hero: crewMember.hero.id,
    capability: crewMember.hero.capability,
    commitment: crewMember.commitment
  };
}

function battleIntentInput(
  input: ResolutionInput,
  crew: readonly CrewMember[],
  coverage: readonly NeedCoverage[]
): IntentInput {
  return { needs: input.contract.needs, crew, context: { risk: input.contract.risk }, coverage };
}

function sufferedIntentFor(consequence: HeroConsequence): OutcomeIntent {
  return {
    kind: OutcomeIntentKind.ConsequenceSuffered,
    hero: consequence.hero,
    need: null,
    marginDelta: 0,
    reason: consequence.reason,
    gap: null,
    consequence: consequence.kind,
    magnitude: consequence.magnitude
  };
}

function resolvedIntentFor(grade: ContractResolution['grade']): OutcomeIntent {
  return {
    kind: OutcomeIntentKind.ContractResolved,
    hero: null,
    need: null,
    marginDelta: 0,
    reason: termsOf(grade).objectiveTaken
      ? OutcomeReasonCodes.ObjectiveTaken
      : OutcomeReasonCodes.ObjectiveLost,
    gap: null,
    consequence: null,
    magnitude: 0
  };
}

/**
 * The same table the abstract resolver fills, for the same reason (`RESOLUTION_SPEC` §2.5):
 * every hero who went out has a line, including one who brought nothing.
 */
function contributionsOf(
  crew: readonly CrewMember[],
  coverage: readonly NeedCoverage[],
  intents: readonly OutcomeIntent[]
): ContractResolution['contributions'] {
  return SortedMap.from(
    compareHeroIds,
    crew.map((crewMember) => [
      crewMember.hero,
      {
        amount: coverage.reduce(
          (sum, row) =>
            toInt32(
              sum + (row.contributors.find((one) => one.hero === crewMember.hero)?.amount ?? 0)
            ),
          0
        ),
        commitment: crewMember.commitment,
        provenance: [
          ...new Set(
            intents
              .filter(
                (intent) =>
                  intent.hero === crewMember.hero ||
                  (intent.hero === null &&
                    intent.need !== null &&
                    crewMember.capability.expertise.has(intent.need))
              )
              .map((intent) => intent.reason)
          )
        ]
      }
    ])
  );
}
