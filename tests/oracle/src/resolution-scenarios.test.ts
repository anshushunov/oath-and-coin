import { resolve } from 'node:path';

import {
  OutcomeGrade,
  severityOf,
  type ContractResolution,
  type ContractState,
  type HeroState
} from '@oath-and-coin/simulation';
import { loadAndRunScenario } from '@oath-and-coin/content/node';
import { describe, expect, it } from 'vitest';

/**
 * `RESOLUTION_SPEC` §10.4 — the loop, end to end, on files a reader can open.
 *
 * Here rather than in `packages/simulation`, and that is `ADR-002`: the engine may not
 * read a file, so a scenario driven from disk can only be run from this side of the
 * boundary. What the unit tests hold is each rule on its own; what these hold is that the
 * rules compose into a campaign somebody could actually play.
 *
 * **All four run on `scenarios/fixtures/resolution_loop`, not on the shipped tree, and the
 * reason is measured rather than argued.** An earlier note here said the shipped roster
 * cannot crew `escort_the_caravan` at all; that was wrong — it reasoned about the advance
 * and forgot the promise. A sweep of every four-hero subset, every key hero, both method
 * tags and both bonus levels finds exactly **one** crewable package: {bram, doran, ilsa,
 * kestrel}, Ilsa keyed, with a promised bonus. One crewable crew is not two, and the
 * comparison below needs two crews on the *same* job with opposite outcomes.
 *
 * The claim that the shipped content is viable is `content-viability.test.ts`'s and is
 * checked over every contract there; these files are about what the commands do once a
 * crew goes out.
 */

const repositoryRoot = resolve(import.meta.dirname, '..', '..', '..');

function run(scenario: string) {
  const result = loadAndRunScenario({
    repositoryRoot,
    scenarioRoot: resolve(repositoryRoot, 'scenarios'),
    scenario,
    checkpoint: null,
    seed: 424242n
  });

  if (result.kind !== 'ran') {
    throw new Error(`Scenario '${scenario}' did not run: ${result.kind}`);
  }

  return result;
}

const resolutionsOf = (scenario: string): readonly ContractResolution[] =>
  run(scenario)
    .outcome.finalState.contracts.values()
    .map((contract: ContractState) => contract.resolution)
    .filter(
      (resolution: ContractResolution | null): resolution is ContractResolution =>
        resolution !== null
    );

const treasuryOf = (scenario: string) => run(scenario).outcome.finalState.treasury;

/**
 * What locking `the_deep_run` commits: `advance × requiredCrew` (90 × 3), and the point of
 * the fork below. A guild that cannot cover this cannot take that job at all
 * (`NEGOTIATION_SPEC` §3.3's treasury check), whatever it would have paid.
 */
const DEEP_RUN_COMMITMENT = 90 * 3;

describe('the strongest crew is not the right crew (§9, §10.4)', () => {
  // The refuting check on the whole coverage model. If it ever stops holding, coverage has
  // collapsed back into "bring the biggest numbers" — the kill-criterion `MVP_PLAN` §3.2
  // names — and the answer is to say so, not to adjust these fixtures until it passes.

  /** What the crew that actually went out is worth, added up from the campaign itself. */
  function crewOf(scenario: string) {
    const state = run(scenario).outcome.finalState;
    const [contract] = state.contracts
      .values()
      .filter((candidate: ContractState) => candidate.resolution !== null);

    return {
      contractId: contract!.id,
      grade: contract!.resolution!.grade,
      coverage: contract!.resolution!.coverage,
      sumOfGrades: contract!.offer.acceptedBy
        .values()
        .reduce((total: number, hero) => total + state.heroes.get(hero)!.capability.grade, 0)
    };
  }

  it('sends the crew with the larger sum of grades to the worse outcome', () => {
    // Both halves asserted from the runs themselves, not from the fixture files: which
    // crew is "stronger" is read off the campaign's own heroes, and the two are checked to
    // be answering the *same* job. Without either, a later edit to the fixture tree could
    // leave this green while the losing crew had quietly become the weaker one — or while
    // the two were doing different work (external review).
    const strong = crewOf('resolution-strongest-loses');
    const fitting = crewOf('resolution-fitting-crew-wins');

    expect(strong.contractId).toBe(fitting.contractId);
    expect(strong.sumOfGrades).toBeGreaterThan(fitting.sumOfGrades);
    expect([strong.sumOfGrades, fitting.sumOfGrades]).toEqual([180, 150]);

    expect(severityOf(strong.grade)).toBeGreaterThan(severityOf(fitting.grade));
    expect([strong.grade, fitting.grade]).toEqual([OutcomeGrade.Failed, OutcomeGrade.Clean]);
  });

  it('says why: two men who answer for the same need leave the other unanswered', () => {
    // Not merely a worse grade — a worse grade *for the reason the model exists*. Both
    // frontline specialists close their own need twice over and nobody holds the second.
    const strong = crewOf('resolution-strongest-loses');

    expect(
      strong.coverage.map((row) => [row.need, row.supplied, row.required, row.verdict])
    ).toEqual([
      // 81 and 81 brought, 121 counted: the second man on the same need is worth half
      // (§4.3). The exact number is asserted, not merely the verdict — with the halving
      // dropped this reads 162, and the whole answer to "take another of the same" is
      // that it does not add up.
      ['frontline', 121, 50, 'closed'],
      ['wilderness', 0, 50, 'uncovered']
    ]);
  });

  it('pays a failed contract a share of the fee, and the crew its advance in full', () => {
    // The one place in the corpus where §5.3's table is exercised at anything but 100 %:
    // every other scenario that settles comes back `clean` or `costly`, and both of those
    // pay the whole fee. 400 − 60 × 2 + 40 % of 100 = 320.
    //
    // **The fee is 100 for a reason a mutant found.** At 60 the share truncates to 24 at
    // both 40 % and 41 %, so this number agreed with a drifted `PARTIAL_FEE_PERCENT` — the
    // same trap the unit table fell into. At 100 the two are 40 and 41.
    expect(run('resolution-strongest-loses').outcome.finalState.treasury).toBe(320);
  });
});

describe('both branches of the liquidity fork are live (§10.4)', () => {
  it.each(['resolution-keep-promise', 'resolution-break-promise'])(
    '%s reaches a second resolution',
    (scenario) => {
      // "Viable" means the campaign keeps going, not that it goes well. A branch that
      // ended at the first settlement would make the choice a dead end rather than a fork.
      expect(resolutionsOf(scenario)).toHaveLength(2);
    }
  );

  it('keeping the word leaves too little to lock the larger job', () => {
    expect(treasuryOf('resolution-keep-promise')).toBeLessThan(DEEP_RUN_COMMITMENT);
  });

  it('breaking it pays for the larger job, and the crew remembers', () => {
    const broken = run('resolution-break-promise').outcome.finalState;

    expect(broken.treasury).toBeGreaterThanOrEqual(DEEP_RUN_COMMITMENT);

    // The cost that is not money. Both directions asserted: the man the promise was made
    // to carries more than the witness, and the two who were never on that crew carry
    // nothing (`NEGOTIATION_SPEC` §3.3).
    expect(
      broken.heroes
        .values()
        .map((hero: HeroState) => [hero.definition, hero.grievance, hero.believesGuildPromises])
    ).toEqual([
      ['fixture:banner', 0, true],
      ['fixture:blade', 18, false],
      ['fixture:scout', 7, true],
      ['fixture:tracker', 0, true]
    ]);
  });

  it('costs the branch that kept its word nothing but the scale of the next job', () => {
    // The other half of the same fork, and what stops the pair from reading as "keeping
    // your word is strictly worse": nobody resents anything, and the smaller job still
    // gets done — at a price (§4.6's costly band), because one man cannot hold two needs.
    const kept = run('resolution-keep-promise').outcome.finalState;

    expect(kept.heroes.values().map((hero: HeroState) => hero.grievance)).toEqual([0, 0, 0, 0]);

    // «С ценой» при **положительном** разрыве: у малой работы закрыт передний край и не
    // закрыт маленький угол, база +1. Единственный из четырёх сценариев, где §4.6's «все
    // потребности закрыты» — единственное, что отделяет исход от «Чисто»; мутант, который
    // читает только знак разрыва, краснеет здесь и больше нигде в петле.
    const haul = kept.contracts.get('fixture:the_short_haul' as never)!.resolution!;

    expect(haul.coverage.map((row) => [row.need, row.verdict])).toEqual([
      ['frontline', 'closed'],
      ['wilderness', 'uncovered']
    ]);
    expect(resolutionsOf('resolution-keep-promise').map((resolution) => resolution.grade)).toEqual([
      OutcomeGrade.Clean,
      OutcomeGrade.Costly
    ]);
  });
});
