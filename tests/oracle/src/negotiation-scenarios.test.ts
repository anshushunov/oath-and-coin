import { resolve } from 'node:path';

import { loadAndRunScenario } from '@oath-and-coin/content/node';
import type { ScenarioOutcome } from '@oath-and-coin/content';
import { ReasonCodes } from '@oath-and-coin/simulation';
import { describe, expect, it } from 'vitest';

/**
 * One named, semantic assertion per scenario `NEGOTIATION_SPEC` §10.3 lists —
 * `DEC-008` Task 20's own obligation, and distinct on purpose from
 * `canonical-snapshots.test.ts`: a snapshot proves a run is *reproducible*, never that
 * it demonstrates the rule its scenario is named for. Renaming `action:accept` to
 * `action:decline` in a hand-edited `.canonical.json` would leave the snapshot
 * comparison red, which proves nothing about whether the file still means what its
 * scenario id claims — only these assertions do that, and `ADR-013`'s own text says
 * they "must survive an artifact version change or redden on their own merits."
 *
 * Every scenario here runs at the CLI's own default seed (424242 — see
 * `canonical-snapshots.test.ts`'s header), which is what every number quoted below was
 * measured against.
 */

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
const SEED = 424242n;

function run(scenario: string): ScenarioOutcome {
  const result = loadAndRunScenario({
    repositoryRoot: repoRoot,
    scenario,
    checkpoint: null,
    seed: SEED
  });
  if (result.kind !== 'ran') {
    throw new Error(`'${scenario}' did not reach 'ran' (kind: '${result.kind}').`);
  }
  return result.outcome;
}

describe('offer_revised_resets_answers', () => {
  it('lets the key hero answer again after a revision, and answers differently', () => {
    const outcome = run('offer_revised_resets_answers');
    const [, firstAnswer, , secondAnswer] = outcome.steps;

    // The first answer is a decline nobody carries forward: the second `propose` is
    // not refused as `already_responded`, which is what "resets" means operationally.
    expect(firstAnswer?.applied).toBe(true);
    expect(firstAnswer?.decisions[0]?.selectedAction).toBe('action:decline');
    expect(secondAnswer?.applied).toBe(true);
    expect(secondAnswer?.rejectionCode).toBeNull();
    expect(secondAnswer?.decisions[0]?.selectedAction).toBe('action:accept');

    const contract = outcome.finalState.contracts.get('core:silence_the_cult' as never);
    // Only the most recent answer survives on the revised version — the declined one
    // left no trace an inspector of the final state could still find.
    expect(contract?.offer.respondedBy.values()).toEqual([3]);
    expect(contract?.offer.acceptedBy.values()).toEqual([3]);
  });
});

describe('offer_cycled_back_gives_the_same_answer', () => {
  it('answers A, then B, then A again — and the third answer equals the first', () => {
    const outcome = run('offer_cycled_back_gives_the_same_answer');
    const [, answerA1, , answerB, , answerA2] = outcome.steps;

    expect(answerA1?.decisions[0]?.selectedAction).toBe('action:decline');
    expect(answerB?.decisions[0]?.selectedAction).toBe('action:accept');

    // The point of the scenario: cycling the package back to its first terms
    // reproduces the first decision exactly — same action, same score — because the
    // mood ordinal is pinned to the (hero, contract) pair, not to the offer version
    // (`NEGOTIATION_SPEC` §2.1.1).
    expect(answerA2?.decisions[0]?.selectedAction).toBe(answerA1?.decisions[0]?.selectedAction);
    expect(answerA2?.decisions[0]?.selectedScore).toBe(answerA1?.decisions[0]?.selectedScore);
  });
});

describe('method_choice_flips_the_key_hero', () => {
  it('scores the key hero under one method and gates the same hero under the other', () => {
    const outcome = run('method_choice_flips_the_key_hero');
    const [, underOpen, , underDeception] = outcome.steps;

    const openDecision = underOpen?.decisions[0];
    const deceptionDecision = underDeception?.decisions[0];

    // Under `method:open` the hero has a reasoned, scored refusal.
    expect(openDecision?.selectedScore).not.toBeNull();
    expect(openDecision?.trace.blockedBy).toHaveLength(0);

    // Under `method:deception` the *same* hero, on the *same* contract, is blocked
    // outright by their own principle — the negotiated tag reached the gate exactly
    // as an authored one would (`NEGOTIATION_SPEC` §4).
    expect(deceptionDecision?.selectedScore).toBeNull();
    expect(deceptionDecision?.trace.blockedBy.map((b) => b.reasonCode)).toContain(
      ReasonCodes.PrincipleForbids
    );
  });
});

describe('promise_carries_a_reluctant_hero', () => {
  it('turns a decline into an accept once a bonus is promised, terms otherwise unchanged', () => {
    const outcome = run('promise_carries_a_reluctant_hero');
    const [, withoutBonus, , withBonus] = outcome.steps;

    expect(withoutBonus?.decisions[0]?.selectedAction).toBe('action:decline');
    expect(withBonus?.decisions[0]?.selectedAction).toBe('action:accept');

    // The promise is what carried the hero, named in the trace as its own reason —
    // not folded into "payment attractive" (`NEGOTIATION_SPEC` §4).
    const reasonCodes =
      withBonus?.decisions[0]?.trace.positiveFactors.map((f) => f.reasonCode) ?? [];
    expect(reasonCodes).toContain(ReasonCodes.PromiseOfABonus);
  });
});

describe('promise_moves_only_the_key_hero', () => {
  it('shows the promise in the key hero’s trace and in nobody else’s', () => {
    const outcome = run('promise_moves_only_the_key_hero');
    const [, keyAnswer, , poll] = outcome.steps;

    const keyReasons =
      keyAnswer?.decisions[0]?.trace.positiveFactors.map((f) => f.reasonCode) ?? [];
    expect(keyReasons).toContain(ReasonCodes.PromiseOfABonus);

    expect(poll?.decisions.length).toBeGreaterThan(0);
    for (const decision of poll?.decisions ?? []) {
      const reasons = [...decision.trace.positiveFactors, ...decision.trace.negativeFactors].map(
        (f) => f.reasonCode
      );
      expect(reasons).not.toContain(ReasonCodes.PromiseOfABonus);
    }
  });
});

describe('promise_kept', () => {
  it('settles contract_settled_promise_kept and touches no hero’s belief or grievance', () => {
    const outcome = run('promise_kept');
    const settle = outcome.steps.at(-1);

    expect(settle?.events.map((e) => e.kind)).toEqual(['contract_settled_promise_kept']);

    for (const [, hero] of outcome.finalState.heroes.entries()) {
      expect(hero.believesGuildPromises, hero.definition).toBe(true);
      expect(hero.grievance, hero.definition).toBe(0);
    }
  });
});

describe('promise_broken', () => {
  it('settles contract_settled_promise_broken, and only the victim stops believing', () => {
    const outcome = run('promise_broken');
    const settle = outcome.steps.at(-1);

    expect(settle?.events.map((e) => e.kind)).toEqual(['contract_settled_promise_broken']);

    const contract = outcome.finalState.contracts.get('core:escort_the_caravan' as never);
    const keyHero = contract?.offer.keyHero;
    expect(keyHero).not.toBeNull();

    const victim = outcome.finalState.heroes.get(keyHero!);
    expect(victim?.believesGuildPromises).toBe(false);
    expect(victim?.grievance).toBeGreaterThan(0);

    // Every other accepted hero witnessed it and carries a smaller grievance, but
    // keeps believing the guild's word — the promise was not made to them.
    for (const heroId of contract?.offer.acceptedBy.values() ?? []) {
      if (heroId === keyHero) {
        continue;
      }
      const witness = outcome.finalState.heroes.get(heroId);
      expect(witness?.believesGuildPromises, witness?.definition).toBe(true);
      expect(witness?.grievance, witness?.definition).toBeGreaterThan(0);
      expect(witness?.grievance, witness?.definition).toBeLessThan(victim?.grievance ?? 0);
    }
  });
});

describe('broken_word_changes_the_next_answer', () => {
  it('names the broken promise as a reason in the very next offer to the same hero', () => {
    const outcome = run('broken_word_changes_the_next_answer');
    const nextAnswer = outcome.steps.at(-1);
    const decision = nextAnswer?.decisions[0];

    const negativeCodes = decision?.trace.negativeFactors.map((f) => f.reasonCode) ?? [];
    expect(negativeCodes).toContain(ReasonCodes.GuildBrokeItsWord);

    // The new offer promises a fresh bonus, and it buys nothing: the hero stopped
    // believing the guild's word on the previous contract, so `trustedBonus` is 0.
    const positiveCodes = decision?.trace.positiveFactors.map((f) => f.reasonCode) ?? [];
    expect(positiveCodes).not.toContain(ReasonCodes.PromiseOfABonus);
  });
});

describe('witness_remembers', () => {
  it('gives every witness the same WITNESS_SHARE-scaled grievance, strictly under the victim’s', () => {
    const outcome = run('witness_remembers');
    const contract = outcome.finalState.contracts.get('core:escort_the_caravan' as never);
    const keyHero = contract?.offer.keyHero;

    const witnessGrievances = (contract?.offer.acceptedBy.values() ?? [])
      .filter((heroId) => heroId !== keyHero)
      .map((heroId) => outcome.finalState.heroes.get(heroId)?.grievance);

    expect(witnessGrievances.length).toBeGreaterThan(1);
    // Every witness carries exactly the same share — the rule is a function of the
    // broken promise's size, not of who happened to be standing there.
    expect(new Set(witnessGrievances).size).toBe(1);

    const victimGrievance = outcome.finalState.heroes.get(keyHero!)?.grievance ?? 0;
    for (const grievance of witnessGrievances) {
      expect(grievance).toBeGreaterThan(0);
      expect(grievance).toBeLessThan(victimGrievance);
    }
  });
});

describe('crew_overflows_the_seats', () => {
  it('answers every hero, but seats only requiredCrew of the ones who accepted', () => {
    const outcome = run('crew_overflows_the_seats');
    const poll = outcome.steps.at(-1);
    const contract = outcome.finalState.contracts.get('fixture:crew_job' as never);

    expect(contract?.requiredCrew).toBe(2);
    expect(contract?.offer.acceptedBy.values()).toHaveLength(2);

    const acceptedByPoll = (poll?.decisions ?? []).filter(
      (d) => d.selectedAction === 'action:accept'
    );
    // More heroes said yes than the two seats could hold.
    expect(acceptedByPoll.length).toBeGreaterThan(
      contract!.requiredCrew - 1 /* the key already took one */
    );

    const seated = new Set(contract?.offer.acceptedBy.values());
    const respondedButNotSeated = (contract?.offer.respondedBy.values() ?? []).filter(
      (heroId) => !seated.has(heroId)
    );
    expect(respondedButNotSeated.length).toBeGreaterThan(0);
  });
});

describe('crew_not_filled_reopens_the_draft', () => {
  it('leaves the crew unfilled after a poll, then lets composeOffer return it to draft', () => {
    const outcome = run('crew_not_filled_reopens_the_draft');
    const poll = outcome.steps[3];
    const reopen = outcome.steps[4];
    const finalPropose = outcome.steps.at(-1);

    expect(poll?.applied).toBe(true);

    const contract = outcome.finalState.contracts.get('core:escort_the_caravan' as never);
    expect(contract?.requiredCrew).toBe(4);
    // Fewer heroes accepted than there were seats for.
    expect(contract?.offer.acceptedBy.values().length).toBeLessThan(contract!.requiredCrew);

    expect(reopen?.applied).toBe(true);
    expect(reopen?.events.map((e) => e.kind)).toEqual(['offer_revised']);
    expect(contract?.offer.phase).toBe('draft');
    // The revision cleared every answer the unfilled poll had collected.
    expect(contract?.offer.respondedBy.values()).toEqual([contract?.offer.keyHero]);
    expect(finalPropose?.decisions[0]?.selectedAction).toBe('action:accept');
  });
});

describe('single_seat_contract_settles_without_a_poll', () => {
  it('fills the crew from the key hero alone, refuses the poll, and still settles', () => {
    const outcome = run('single_seat_contract_settles_without_a_poll');
    const [, keyAnswer, lock, poll, settle] = outcome.steps;

    expect(keyAnswer?.decisions[0]?.selectedAction).toBe('action:accept');
    expect(lock?.applied).toBe(true);

    // The one refusal this scenario legitimately contains — declared in
    // `EXPECTED_REFUSALS` so `restored-read-model.test.ts` does not read it as a
    // scenario file disagreeing with the protocol.
    expect(poll?.applied).toBe(false);
    expect(poll?.rejectionCode).toBe('rejected.crew_already_filled');

    expect(settle?.applied).toBe(true);
    expect(settle?.events.map((e) => e.kind)).toEqual(['contract_settled_promise_kept']);
  });
});

describe('gated_then_scored_then_gated', () => {
  it('spends zero mood ordinals on a gated decision and exactly one on the scored one between them', () => {
    const outcome = run('gated_then_scored_then_gated');
    const poll = outcome.steps.at(-1);

    expect(poll?.decisions.map((d) => d.selectedScore)).toEqual([null, expect.any(Number), null]);
    expect(poll?.decisions.map((d) => d.trace.blockedBy.length > 0)).toEqual([true, false, true]);

    const contract = outcome.finalState.contracts.get('fixture:warded_job' as never);
    // `moodOrdinals` records an entry only for a decision that actually drew a mood
    // (`NEGOTIATION_SPEC` §2.1.1) — a gated decision spends nothing and leaves none.
    // The key hero (captain) drew one composing/proposing the offer; the middle,
    // scored poll answer (second_hand) drew the other. Neither gated hero appears.
    expect(contract?.moodOrdinals.keys()).toEqual([0, 2]);
  });
});

describe('promise_size_changes_the_price_of_breaking_it', () => {
  it('costs more grievance to break a large promise than a token one, same structure otherwise', () => {
    const outcome = run('promise_size_changes_the_price_of_breaking_it');

    const tinyVictim = outcome.finalState.heroes.get(1 as never); // fixture:tiny_victim
    const bigVictim = outcome.finalState.heroes.get(0 as never); // fixture:big_victim

    expect(tinyVictim?.believesGuildPromises).toBe(false);
    expect(bigVictim?.believesGuildPromises).toBe(false);

    expect(tinyVictim?.grievance).toBeGreaterThan(0);
    // The rule from `NEGOTIATION_SPEC` §3.3, on live data rather than only on the unit
    // properties: `BreakingAPromiseCostsMoreThanNeverPromising`'s sibling claim —
    // breaking a bigger promise costs strictly more than breaking a token one.
    expect(bigVictim?.grievance).toBeGreaterThan(tinyVictim?.grievance ?? 0);
  });
});
