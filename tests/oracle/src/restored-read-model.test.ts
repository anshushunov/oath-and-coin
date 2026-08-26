import { readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { restoreDecidedSteps } from '@oath-and-coin/application';
import { decodeSnapshot, encodeSnapshot, type ScenarioOutcome } from '@oath-and-coin/content';
import { loadAndRunScenario } from '@oath-and-coin/content/node';
import { contractOfferScreenModel } from '@oath-and-coin/presentation';
import type { ContentId } from '@oath-and-coin/simulation';
import { describe, expect, it } from 'vitest';

/**
 * The screen a reloaded campaign draws, measured against the screen a continuous run of
 * the same commands draws — on every shipped scenario that reaches a state, at both
 * recorded seeds.
 *
 * The claim: after a reload there is no step list any more, only history and traces, and
 * the screen has to be rebuilt out of them. The two sides are not the same computation —
 * the live artifact carries `selectedScore` verbatim, while `restoreDecidedSteps` has to
 * recover it from the trace's factors, and the read model is where that recovered number
 * becomes a visible sentence ("wavered", and which reasons rank above which). A
 * `pollCrew` step widens the gap further: live, it is *one* step holding six decisions,
 * each naming its own hero; restored, it is *six* steps of one decision each, named by
 * the step. Both must draw the identical screen.
 *
 * **The fixture is the shipped `scenarios/` corpus, not `migration/oracle/v1` any more.**
 * `ADR-013` retired the frozen corpus's replay in two steps: byte parity first (2026-08-22),
 * then the replay itself (2026-08-23), once `DEC-008`'s key-hero rule made the corpus's
 * recorded commands invalid input — every one of them is a bare `propose_contract_to_hero`
 * against a package nobody composed, and the engine now refuses all of them
 * (`rejected.not_the_key_hero`). A corpus is frozen by definition and cannot gain a
 * `compose_offer`, so it stopped being a replayable input at all. What replaced it is the
 * corpus this repository authors and can keep faithful: 43 runnable scenarios, two seeds.
 *
 * **What this file does *not* claim**, stated because the same misreading has been caught
 * twice in this slice: this is not an external oracle. Both screens are computed by this
 * build. What makes the comparison worth running is that they are computed by *different
 * code paths* from *different inputs* — a live step list versus an event log and a trace
 * store that survived a round trip through the save codec. An external expected value —
 * one this build did not itself compute — is what `canonical-snapshots.test.ts` supplies
 * instead, comparing a fresh run against the file `scenarios/*.canonical.json` already
 * ships, which is `DEC-008` Task 20's own addition.
 */

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');

/** Both seeds the runner and the browser evidence use. */
const SEEDS = [7n, 424242n] as const;

/** Every scenario the repository ships, read off the directory rather than listed here. */
const SCENARIOS: readonly string[] = readdirSync(join(repoRoot, 'scenarios'))
  .filter((name) => name.endsWith('.manifest.json'))
  .map((name) => name.slice(0, name.indexOf('.')))
  .sort();

/**
 * The refusals a scenario is *supposed* to contain, by name.
 *
 * `expected_outcome: "success"` tolerates a refused command on purpose — a scenario whose
 * whole point is a rejection is still a scenario that ran — so "did every command apply"
 * cannot be asserted flatly. But the tolerance was also blanket, and that is what let
 * `accept_by_comrade` ship for one commit with its last two commands silently refused as
 * `rejected.stale_state`: its `poll_crew` moves `stateVersion` by one *per event*, five
 * heroes answered, and the two commands after it still declared the version the poll had
 * begun on. Nothing was red. It had five decisions, a screen, and a checkpoint.
 *
 * So the tolerance is now itemised. A scenario listed here may contain exactly the
 * refusals named; every other scenario must apply every command; and a refusal nobody
 * declared is a scenario file disagreeing with the protocol, reported as that.
 */
const EXPECTED_REFUSALS: Readonly<Record<string, readonly string[]>> = {
  // The one scenario built on a refusal: the same hero is offered the same package
  // twice, and the second answer is refused because nobody is asked twice.
  duplicate_response_attempt: ['rejected.already_responded'],
  // `requiredCrew = 1`: the key hero's own draft acceptance already fills the crew, so
  // the `poll_crew` this scenario names on purpose is refused before it can ask anyone
  // (`NEGOTIATION_SPEC` §3.1) — the scenario's whole point.
  single_seat_contract_settles_without_a_poll: ['rejected.crew_already_filled'],
  // Both single-seat contracts here hit the same refusal once each, for the same
  // reason as above — this scenario compares two settlements, not two polls.
  promise_size_changes_the_price_of_breaking_it: [
    'rejected.crew_already_filled',
    'rejected.crew_already_filled'
  ]
};

function ran(scenario: string, seed: bigint): ScenarioOutcome | null {
  const result = loadAndRunScenario({ repositoryRoot: repoRoot, scenario, checkpoint: null, seed });

  // `screen_loading` never reads content and `screen_error` never loads it: neither
  // reaches a state, so neither has a screen to rebuild.
  if (result.kind !== 'ran') {
    return null;
  }

  const refused = result.outcome.steps
    .filter((step) => !step.applied)
    .map((step) => step.rejectionCode ?? 'unknown');

  expect(
    refused,
    `'${scenario}' at seed ${String(seed)} refused a command it does not declare. A scenario ` +
      'may expect refusals — name them in EXPECTED_REFUSALS — but an undeclared one is the ' +
      'file disagreeing with the protocol, most often an `expected_state_version` that did ' +
      'not follow a command producing more than one event.'
  ).toEqual(EXPECTED_REFUSALS[scenario] ?? []);

  return result.outcome;
}

/**
 * The contract the screen is focused on: the one the run's first step named.
 *
 * Stated to the restored side and withheld from the live one, which is the asymmetry
 * that makes the comparison hold the fallback resolution to the same answer as the
 * explicit one — `contractOfferScreenModel` falls back to "the contract the first step
 * answered", and after a reload the first step is a different step (a rejected command
 * and a `compose_offer` leave no decision event behind, so neither survives).
 */
function focusOf(outcome: ScenarioOutcome): ContentId | undefined {
  return outcome.steps[0]?.command.contract;
}

describe('the screen a reloaded campaign draws', () => {
  it('agrees with the screen of a run that never stopped, on every shipped scenario', () => {
    // Named as numbers so a silently shrinking corpus does not read as success. 45
    // scenarios ship — 27 from before `DEC-008` Task 20, the 14 `NEGOTIATION_SPEC` §10.3
    // names individually, and the four negotiation-phase scenarios Task 21 adds for the
    // browser evidence run (`screen_draft`, `screen_locked`, `screen_settlement_due`,
    // `screen_word_broken`); `screen_loading` and `screen_error` reach no state, leaving
    // 43 that run, at two seeds each.
    expect(SCENARIOS).toHaveLength(45);

    let ranCount = 0;
    let blockedSeen = 0;
    let scoredSeen = 0;
    let polledStepsSeen = 0;

    for (const seed of SEEDS) {
      for (const scenario of SCENARIOS) {
        const outcome = ran(scenario, seed);
        if (outcome === null) {
          continue;
        }

        ranCount += 1;

        const reloaded = decodeSnapshot(
          JSON.parse(JSON.stringify(encodeSnapshot(outcome.finalState)))
        );
        const steps = restoreDecidedSteps(reloaded);

        // The whole campaign, not only the screen drawn from it. The screen is a lossy
        // projection by design — it shows no `offer.phase`, no `acceptedBy`, no treasury
        // — so a codec that dropped any of them would leave the comparison below green.
        // This is the round trip the retired `save-round-trip.test.ts` held, restored
        // over strictly more: it ran the frozen corpus's own drafts, and these 50 states
        // include locked and polled offers, which no corpus record could ever contain.
        expect(reloaded, `${scenario}/seed-${String(seed)}`).toEqual(outcome.finalState);

        // Live, this counts the shape the two sides disagree about: one `pollCrew` step
        // holding several decisions. Restored, that same poll is one step per decision,
        // so the count has to be taken here or it would not be taken at all.
        for (const step of outcome.steps) {
          if (step.decisions.length > 1) {
            polledStepsSeen += 1;
          }
        }

        for (const step of steps) {
          if (step.decisions.length === 0) {
            throw new Error(
              `a step restored from '${scenario}'/seed-${String(seed)} carries no decision, but ` +
                'every event in the history of a campaign was produced by one'
            );
          }

          for (const decision of step.decisions) {
            // **On the restored score, which is the one this file exists for.** Live,
            // `selectedScore` arrives from the engine verbatim and asserting it here
            // would be asking the engine to agree with itself; restored, it has been
            // recomputed out of the trace's factors, and a blocked trace has both factor
            // lists empty — so a recovery that summed unconditionally would answer `0`
            // where the answer is "there is no score", and under "accept at score ≥ 0"
            // that reads as consent (`TDD` §8).
            //
            // The screen comparison below cannot see it: a blocked response shows no
            // score at all, so `0`-instead-of-`null` never reaches the markup and both
            // sides would draw the same thing while disagreeing about the number behind
            // it. Task 11a moved this loop onto the live side by mistake and review
            // moved it back.
            const blocked = decision.trace.blockedBy.length > 0;
            expect(decision.selectedScore === null, `${scenario}/seed-${String(seed)}`).toBe(
              blocked
            );

            if (blocked) {
              blockedSeen += 1;
            } else {
              scoredSeen += 1;
            }
          }
        }

        const model = contractOfferScreenModel(reloaded, steps, focusOf(outcome));
        const live = contractOfferScreenModel(outcome.finalState, outcome.steps);

        expect(model, `${scenario}/seed-${String(seed)}`).toEqual(live);
      }
    }

    // Every side of the rule named by a number. A set with no blocked decision left, or
    // one where no scenario ever polled a crew, would pass the loop above in silence —
    // and those two shapes are exactly what this file exists to keep under the
    // comparison. `polledStepsSeen` is the one Task 11a added: it is the only shape where
    // the two sides genuinely disagree about what a *step* is. All four numbers grew with
    // `DEC-008` Task 20's fourteen scenarios, most of which negotiate a real offer:
    // `blockedSeen` grew with the scenarios that gate a hero on a negotiated method tag,
    // and `polledStepsSeen` with the new scenarios whose `pollCrew` step actually applies
    // (a refused one, as in `single_seat_contract_settles_without_a_poll`, carries no
    // decision and does not count here). `ranCount` and `scoredSeen` grew again with
    // Task 21's four negotiation-phase scenarios (`screen_draft`, `screen_locked`,
    // `screen_settlement_due`, `screen_word_broken`) — eight more runs (two seeds each)
    // and one scored `proposeContractToHero` decision apiece, eight in total.
    // `blockedSeen` and `polledStepsSeen` are unchanged: none of the four gates its key
    // hero on a method tag, and none reaches `pollCrew` — the whole point of
    // `screen_settlement_due` and `screen_word_broken` is a crew filled without one
    // (`NEGOTIATION_SPEC` §3.1, `requiredCrew = 1`).
    expect(ranCount).toBe(86);
    expect(blockedSeen).toBe(16);
    // 180, not 234, since the resolution engine's Task 3: `pollCrew` asks the crew the
    // package invited rather than the whole remaining roster (`DEC-012` as amended,
    // `RESOLUTION_SPEC` §8), so every polled scenario produces exactly as many scored
    // decisions as it has seats — fifty-four fewer across the corpus, and every one of
    // them a question about a hero the player never asked.
    expect(scoredSeen).toBe(180);
    // 20, not 26, for the same reason: three scenarios whose crew is now filled by the
    // invited heroes alone reach `pollCrew` with nobody left to ask, so the step is
    // refused and carries no decision to count.
    expect(polledStepsSeen).toBe(20);
  });
});
