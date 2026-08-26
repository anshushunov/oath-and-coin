import { describe, expect, it } from 'vitest';

import { SortedMap } from '../collections/sorted-map.ts';
import { CommitmentState } from '../domain/commitment.ts';
import type { HeroCapability } from '../domain/capability.ts';
import { NeedId, compareNeedIds } from '../domain/need-id.ts';
import {
  CoverageVerdict,
  DeficitKind,
  OutcomeGrade,
  OutcomeIntentKind
} from '../domain/outcome.ts';
import { OutcomeReasonCodes } from '../domain/outcome-reason-codes.ts';
import { heroId } from '../ids/hero-id.ts';

import { coverNeeds } from './needs-coverage.ts';
import { gradeFromIntents, termsOf } from './outcome-grade.ts';
import {
  coverageIntentsFor,
  falteredEarlyIntentsFor,
  objectiveIntentsFor,
  worstCoveredNeed,
  type CrewMember
} from './outcome-intent.ts';

/**
 * `RESOLUTION_SPEC` §4.4 (what the resolver says happened), §4.7's classification of a
 * shortfall, and §4.8's "worst covered".
 */

const needs = (entries: Readonly<Partial<Record<NeedId, number>>>): SortedMap<NeedId, number> =>
  SortedMap.from<NeedId, number>(
    compareNeedIds,
    Object.entries(entries).map(([need, weight]) => [need as NeedId, weight as number] as const)
  );

const capability = (
  grade: number,
  expertise: Readonly<Partial<Record<NeedId, number>>>
): HeroCapability => ({
  grade,
  expertise: SortedMap.from<NeedId, number>(
    compareNeedIds,
    Object.entries(expertise).map(([need, amount]) => [need as NeedId, amount as number] as const)
  )
});

const member = (
  id: number,
  grade: number,
  expertise: Readonly<Partial<Record<NeedId, number>>>,
  commitment: CommitmentState = CommitmentState.Committed
): CrewMember => ({ hero: heroId(id), capability: capability(grade, expertise), commitment });

const inputFor = (
  contractNeeds: SortedMap<NeedId, number>,
  crew: readonly CrewMember[],
  risk = 0
) => ({
  needs: contractNeeds,
  crew,
  context: { risk },
  coverage: coverNeeds(contractNeeds, crew, { risk })
});

describe('what the coverage rows become (§4.4)', () => {
  it('carries the shortfall as the delta, to the point rather than to the sign', () => {
    // One need closed with room to spare, one left short. `effective − required` either
    // way, so the two are the same arithmetic and not two rules.
    //
    // Exact numbers, not `toBeGreaterThan(0)`: at a requirement of 40 the ceiling is
    // 40 × 120 / 100 = 48, so a supply of 100 counts for 48 and the delta is +8; the
    // second need is supplied 10 against 40, so −30. A sign-only assertion is green under
    // `effective − required + 1`, which is the whole formula off by one.
    const input = inputFor(needs({ frontline: 40, wilderness: 40 }), [
      member(0, 100, { frontline: 100, wilderness: 10 })
    ]);
    const [frontline, wilderness] = coverageIntentsFor(input);

    expect(frontline!.kind).toBe(OutcomeIntentKind.NeedCovered);
    expect(frontline!.marginDelta).toBe(8);
    expect(wilderness!.kind).toBe(OutcomeIntentKind.NeedShort);
    expect(wilderness!.marginDelta).toBe(-30);
  });

  it('answers one intent per need, in the vocabulary’s own order', () => {
    const input = inputFor(needs({ wilderness: 20, frontline: 20, undead_knowledge: 20 }), [
      member(0, 100, { frontline: 20 })
    ]);

    expect(coverageIntentsFor(input).map((intent) => intent.need)).toEqual([
      NeedId.Frontline,
      NeedId.UndeadKnowledge,
      NeedId.Wilderness
    ]);
  });

  it('names the reason from the verdict, so the screen’s line follows the arithmetic', () => {
    const input = inputFor(needs({ frontline: 40, wilderness: 40 }), [
      member(0, 100, { frontline: 100, wilderness: 30 }) // 30/40 = 75%: weak, not missing
    ]);
    const [frontline, wilderness] = coverageIntentsFor(input);

    expect(frontline!.reason).toBe(OutcomeReasonCodes.NeedClosed);
    expect(wilderness!.reason).toBe(OutcomeReasonCodes.NeedWeak);
  });

  it('separates a need nobody supplied from one supplied poorly', () => {
    const input = inputFor(needs({ frontline: 40, wilderness: 40 }), [
      member(0, 100, { frontline: 100 })
    ]);
    const [, wilderness] = coverageIntentsFor(input);

    expect(wilderness!.reason).toBe(OutcomeReasonCodes.NeedUncovered);
  });
});

describe('why a need came up short (§4.7)', () => {
  it('records the classification on the intent rather than leaving it to be derived', () => {
    const input = inputFor(needs({ frontline: 40, wilderness: 40 }), [
      member(0, 100, { frontline: 100, wilderness: 10 })
    ]);

    for (const intent of coverageIntentsFor(input).filter(
      (i) => i.kind === OutcomeIntentKind.NeedShort
    )) {
      expect(intent.gap).not.toBeNull();
    }
  });

  it('leaves a closed need unclassified — there is no gap to explain', () => {
    const input = inputFor(needs({ frontline: 40, wilderness: 40 }), [
      member(0, 100, { frontline: 100, wilderness: 100 })
    ]);

    for (const intent of coverageIntentsFor(input)) {
      expect(intent.gap).toBeNull();
    }
  });

  it('calls it a capability gap when the right people were there and fell short', () => {
    // The hero is answerable for wilderness and brings 40 × 30 / 100 = 12 against 40.
    // At `grade = 100` he would bring 40, which closes it — so the people were right and
    // the skill was not.
    const input = inputFor(needs({ frontline: 40, wilderness: 40 }), [
      member(0, 30, { frontline: 200, wilderness: 40 })
    ]);
    const [, wilderness] = coverageIntentsFor(input);

    expect(wilderness!.gap).toBe(DeficitKind.Capability);
  });

  it('calls it a coverage gap when nobody in the crew answered for it at all', () => {
    // Nobody holds `wilderness`, so raising everyone to `grade = 100` changes nothing:
    // the counterfactual still does not close it.
    const input = inputFor(needs({ frontline: 40, wilderness: 40 }), [
      member(0, 100, { frontline: 100 })
    ]);
    const [, wilderness] = coverageIntentsFor(input);

    expect(wilderness!.gap).toBe(DeficitKind.Coverage);
  });

  it('runs the counterfactual against the contract’s own risk, not against a safe one', () => {
    // Weight 40 at risk 100 is a requirement of 80. The one hero answerable for
    // `wilderness` holds it at 60, so even at `grade = 100` he brings 60 against 80 and
    // it stays open — a coverage gap. Drop the risk and 60 against 40 closes it, which is
    // what a counterfactual passing `{ risk: 0 }` would answer: `capability`. Every other
    // case in this block runs at risk 0, where the two are indistinguishable.
    const input = inputFor(
      needs({ frontline: 40, wilderness: 40 }),
      [member(0, 30, { frontline: 400, wilderness: 60 })],
      100
    );
    const [, wilderness] = coverageIntentsFor(input);

    expect(wilderness!.gap).toBe(DeficitKind.Coverage);
  });

  it('calls it a coverage gap when the one who answers could not close it even at 100', () => {
    // Answerable, but at an expertise of 5 even a perfect grade brings 5 against 40. The
    // counterfactual is what tells this apart from the capability case above — a rule
    // reading "is anyone answerable" would answer `capability` here and be wrong.
    const input = inputFor(needs({ frontline: 40, wilderness: 40 }), [
      member(0, 30, { frontline: 200, wilderness: 5 })
    ]);
    const [, wilderness] = coverageIntentsFor(input);

    expect(wilderness!.gap).toBe(DeficitKind.Coverage);
  });
});

describe('who gave way early (§4.4)', () => {
  const shortContract = needs({ frontline: 40, wilderness: 40 });

  it('names a hero whose yes was fragile and whose need did not close', () => {
    const crew = [member(0, 100, { frontline: 100, wilderness: 10 }, CommitmentState.Fragile)];
    const intents = falteredEarlyIntentsFor(inputFor(shortContract, crew));

    expect(intents).toHaveLength(1);
    expect(intents[0]!.kind).toBe(OutcomeIntentKind.FalteredEarly);
    expect(intents[0]!.hero).toBe(heroId(0));
    expect(intents[0]!.reason).toBe(OutcomeReasonCodes.FalteredEarly);
  });

  it('says nothing about a hero who went willingly, however badly it went', () => {
    const crew = [member(0, 100, { frontline: 100, wilderness: 10 }, CommitmentState.Committed)];

    expect(falteredEarlyIntentsFor(inputFor(shortContract, crew))).toEqual([]);
  });

  it('says nothing about a reluctant hero whose own needs all closed', () => {
    // He answers only for `frontline`, and `frontline` closed. The contract went badly
    // elsewhere; that is not a thing he gave way on.
    const crew = [
      member(0, 100, { frontline: 100 }, CommitmentState.Resentful),
      member(1, 100, { wilderness: 10 })
    ];

    expect(falteredEarlyIntentsFor(inputFor(shortContract, crew))).toEqual([]);
  });

  it('emits at most one per hero, whatever the size of the wreck', () => {
    // Answerable for both needs, both short. Three appearances in the feed would read as
    // "this man is the reason", which §4.4 refuses to say.
    const crew = [member(0, 10, { frontline: 40, wilderness: 40 }, CommitmentState.Resentful)];
    const intents = falteredEarlyIntentsFor(inputFor(shortContract, crew));

    expect(intents).toHaveLength(1);
  });

  it('carries the worst-covered of his own needs, not the worst of the contract', () => {
    // He answers for `frontline` (badly) and not for `wilderness` (worse). The line the
    // screen shows has to be about something he was actually responsible for.
    const crew = [
      member(0, 10, { frontline: 40 }, CommitmentState.Fragile),
      member(1, 100, { wilderness: 1 })
    ];
    const intents = falteredEarlyIntentsFor(inputFor(shortContract, crew));

    expect(intents[0]!.need).toBe(NeedId.Frontline);
  });

  it('picks the worst of two of his own, not simply the first', () => {
    // Both needs are his and both are open: `frontline` supplied 20 of 40 (half),
    // `wilderness` supplied 4 of 40 (a tenth). The worse one sorts *second* by
    // `compareNeedIds`, so an implementation answering `own[0].need` — or the first short
    // one it meets — picks `frontline` and is wrong. The single-need case above cannot
    // tell those apart.
    const crew = [member(0, 100, { frontline: 20, wilderness: 4 }, CommitmentState.Fragile)];
    const intents = falteredEarlyIntentsFor(inputFor(shortContract, crew));

    expect(intents[0]!.need).toBe(NeedId.Wilderness);
  });

  it('counts an explicit zero as answerable, the way §2.2 says it is', () => {
    // An absent key means "not his business"; a key holding zero means "his business, and
    // he is worth nothing at it" (`RESOLUTION_SPEC` §2.2). The second man is answerable
    // for `wilderness` at zero, so a wrecked `wilderness` is something he gave way on. An
    // implementation filtering his own needs by `expertise > 0` drops him silently.
    const crew = [
      member(0, 100, { frontline: 100 }),
      member(1, 100, { wilderness: 0 }, CommitmentState.Resentful)
    ];
    const intents = falteredEarlyIntentsFor(inputFor(shortContract, crew));

    expect(intents).toHaveLength(1);
    expect(intents[0]!.hero).toBe(heroId(1));
    expect(intents[0]!.need).toBe(NeedId.Wilderness);
  });

  it('carries no margin of its own', () => {
    const crew = [member(0, 100, { frontline: 100, wilderness: 10 }, CommitmentState.Fragile)];

    for (const intent of falteredEarlyIntentsFor(inputFor(shortContract, crew))) {
      expect(intent.marginDelta).toBe(0);
    }
  });

  it('walks the crew in hero-id order, whatever order it arrived in', () => {
    const crew = [
      member(3, 100, { wilderness: 10 }, CommitmentState.Fragile),
      member(1, 100, { wilderness: 10 }, CommitmentState.Resentful)
    ];

    expect(falteredEarlyIntentsFor(inputFor(shortContract, crew)).map((i) => i.hero)).toEqual([
      heroId(1),
      heroId(3)
    ]);
  });
});

describe('the objective (§4.4, §5.3)', () => {
  it.each([
    [OutcomeGrade.Clean, OutcomeIntentKind.ObjectiveTaken, OutcomeReasonCodes.ObjectiveTaken],
    [OutcomeGrade.Costly, OutcomeIntentKind.ObjectiveTaken, OutcomeReasonCodes.ObjectiveTaken],
    [OutcomeGrade.Failed, OutcomeIntentKind.ObjectiveLost, OutcomeReasonCodes.ObjectiveLost],
    [OutcomeGrade.Disaster, OutcomeIntentKind.ObjectiveLost, OutcomeReasonCodes.ObjectiveLost]
  ])('%s is %s', (grade, kind, reason) => {
    const [intent] = objectiveIntentsFor(grade);

    expect(intent!.kind).toBe(kind);
    expect(intent!.reason).toBe(reason);
  });

  it('says the objective was taken on a costly outcome the crew came up short on', () => {
    // The case the two readings disagree on, and the reason the rule moved off the sign of
    // the margin (external review of task 6). A margin of −1 against a requirement of 100
    // is `costly`: §5.3 pays that crew the full fee, so the feed cannot tell the player
    // they lost the objective. Read off the sign, this intent said exactly that.
    const grade = gradeFromIntents({
      intents: [
        {
          kind: OutcomeIntentKind.NeedShort,
          hero: null,
          need: NeedId.Frontline,
          marginDelta: -1,
          reason: OutcomeReasonCodes.NeedWeak,
          gap: DeficitKind.Capability,
          consequence: null,
          magnitude: 0
        }
      ],
      margin: -1,
      totalRequired: 100
    });

    expect(grade).toBe(OutcomeGrade.Costly);
    expect(objectiveIntentsFor(grade)[0]!.kind).toBe(OutcomeIntentKind.ObjectiveTaken);
  });

  it('agrees with the terms table at every grade, so the feed and the payout cannot part', () => {
    for (const grade of Object.values(OutcomeGrade)) {
      const taken = objectiveIntentsFor(grade)[0]!.kind === OutcomeIntentKind.ObjectiveTaken;

      expect(taken).toBe(termsOf(grade).objectiveTaken);
    }
  });

  it('carries no delta, so the outcome cannot feed the margin it came from', () => {
    for (const grade of Object.values(OutcomeGrade)) {
      for (const intent of objectiveIntentsFor(grade)) {
        expect(intent.marginDelta).toBe(0);
      }
    }
  });
});

describe('worst covered (§4.8)', () => {
  it('compares shares rather than shortfalls', () => {
    // `frontline` is 20 short of 200 (90% covered); `wilderness` is 10 short of 20 (50%).
    // By absolute shortfall the first is worse; by share — which is what §4.8 asks — the
    // second is, and a crew that half-missed a small need failed it harder.
    const contract = needs({ frontline: 200, wilderness: 20 });
    const crew = [member(0, 100, { frontline: 180, wilderness: 10 })];

    expect(worstCoveredNeed(coverNeeds(contract, crew, { risk: 0 }))).toBe(NeedId.Wilderness);
  });

  it('breaks a tie by the vocabulary’s order, not by the order it was handed', () => {
    // Built by hand and handed over *backwards*: `coverNeeds` already answers in
    // `compareNeedIds` order, so a tie fed from it is won by "keep the first" and by the
    // tie-break alike, and the two are indistinguishable. Reversed, only the tie-break
    // answers `frontline`.
    const tied = [
      { need: NeedId.Wilderness, weight: 40, required: 40, supplied: 20, effective: 20 },
      { need: NeedId.Frontline, weight: 40, required: 40, supplied: 20, effective: 20 }
    ].map((row) => ({ ...row, verdict: CoverageVerdict.Weak, contributors: [] }));

    expect(worstCoveredNeed(tied)).toBe(NeedId.Frontline);
  });

  it('answers null for a contract that asked nothing', () => {
    expect(worstCoveredNeed([])).toBeNull();
  });
});
