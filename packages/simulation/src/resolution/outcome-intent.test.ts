import { describe, expect, it } from 'vitest';

import { SortedMap } from '../collections/sorted-map.ts';
import { CommitmentState } from '../domain/commitment.ts';
import type { HeroCapability } from '../domain/capability.ts';
import { NeedId, compareNeedIds } from '../domain/need-id.ts';
import { DeficitKind, OutcomeIntentKind } from '../domain/outcome.ts';
import { OutcomeReasonCodes } from '../domain/outcome-reason-codes.ts';
import { heroId } from '../ids/hero-id.ts';

import { coverNeeds } from './needs-coverage.ts';
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
  it('carries the shortfall as the delta, signed by which way it went', () => {
    // One need closed with room to spare, one left short. `effective − required` either
    // way, so the two are the same arithmetic and not two rules.
    const input = inputFor(needs({ frontline: 40, wilderness: 40 }), [
      member(0, 100, { frontline: 100, wilderness: 10 })
    ]);
    const intents = coverageIntentsFor(input);

    const [frontline, wilderness] = intents;
    expect(frontline!.kind).toBe(OutcomeIntentKind.NeedCovered);
    expect(frontline!.marginDelta).toBeGreaterThan(0);
    expect(wilderness!.kind).toBe(OutcomeIntentKind.NeedShort);
    expect(wilderness!.marginDelta).toBeLessThan(0);
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

describe('the objective (§4.4)', () => {
  it.each([
    [0, OutcomeIntentKind.ObjectiveTaken, OutcomeReasonCodes.ObjectiveTaken],
    [40, OutcomeIntentKind.ObjectiveTaken, OutcomeReasonCodes.ObjectiveTaken],
    [-1, OutcomeIntentKind.ObjectiveLost, OutcomeReasonCodes.ObjectiveLost]
  ])('a margin of %i is %s', (margin, kind, reason) => {
    const [intent] = objectiveIntentsFor(margin);

    expect(intent!.kind).toBe(kind);
    expect(intent!.reason).toBe(reason);
  });

  it('carries no delta, so the outcome cannot feed the margin it came from', () => {
    for (const margin of [40, 0, -40]) {
      for (const intent of objectiveIntentsFor(margin)) {
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

  it('breaks a tie by the vocabulary’s order', () => {
    const contract = needs({ frontline: 40, wilderness: 40 });
    const crew = [member(0, 100, { frontline: 20, wilderness: 20 })];

    expect(worstCoveredNeed(coverNeeds(contract, crew, { risk: 0 }))).toBe(NeedId.Frontline);
  });

  it('answers null for a contract that asked nothing', () => {
    expect(worstCoveredNeed([])).toBeNull();
  });
});
