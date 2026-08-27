import { describe, expect, it } from 'vitest';

import { SortedMap } from '../collections/sorted-map.ts';
import { CommitmentState } from '../domain/commitment.ts';
import { NeedId, compareNeedIds } from '../domain/need-id.ts';
import { DeficitKind, OutcomeGrade, OutcomeIntentKind } from '../domain/outcome.ts';
import { heroId } from '../ids/hero-id.ts';
import { aContract, aHero, anOffer, heroes } from '../testing/fixtures.ts';

import { draftResolution, type ResolutionInput } from './contract-resolver.ts';
import { reduceMargin } from './margin.ts';

/**
 * `RESOLUTION_SPEC` §9 and §10.1 property 4 — one cause enters the result once.
 *
 * The property this file exists for is the one an implementation is most likely to break
 * by being helpful: a hero who came unwillingly is a fact the outcome states twice, in the
 * feed and in the margin, and it must be *priced* only once. An earlier draft of this
 * check compared `coverNeeds` before and after removing a trait, which proved nothing —
 * `coverNeeds` cannot see a trait by signature, so that comparison was green against every
 * possible implementation, including a broken one.
 *
 * So it is stated in three steps, and the first one is the one that was missing: show the
 * cause changes the answer at all, then that it did not change capability, then that the
 * whole of the change came through the one channel it is allowed.
 */

/** Both needs weak at exactly §4.3's floor, so the crew's willingness alone decides. */
function atTheBoundary(commitment: CommitmentState): ResolutionInput {
  const crew = [0, 1].map((id) => ({
    hero: aHero({
      id: heroId(id),
      capability: {
        grade: 100,
        expertise: SortedMap.from<NeedId, number>(compareNeedIds, [
          [id === 0 ? NeedId.Frontline : NeedId.Wilderness, 60]
        ])
      }
    }),
    commitment
  }));

  return {
    contract: aContract({
      risk: 0,
      requiredCrew: 2,
      needs: SortedMap.from<NeedId, number>(compareNeedIds, [
        [NeedId.Frontline, 100],
        [NeedId.Wilderness, 100]
      ]),
      offer: anOffer({
        keyHero: heroId(0),
        invited: heroes(0, 1),
        respondedBy: heroes(0, 1),
        acceptedBy: heroes(0, 1)
      })
    }),
    crew
  };
}

const baseOf = (draft: ReturnType<typeof draftResolution>) =>
  draft.intents.reduce((sum, intent) => sum + intent.marginDelta, 0);

describe('one cause, counted once (§9, §10.1)', () => {
  const willing = draftResolution(atTheBoundary(CommitmentState.Committed));
  const unwilling = draftResolution(atTheBoundary(CommitmentState.Resentful));

  it('step 1: coming unwillingly changes the outcome at all', () => {
    // Without this the two steps below are green on a resolver that ignores willingness
    // entirely — everything would be identical, including the delta, and a delta of nought
    // would read as a pass.
    expect(willing.resolution.grade).toBe(OutcomeGrade.Failed);
    expect(unwilling.resolution.grade).toBe(OutcomeGrade.Disaster);
  });

  it('step 2: it does not touch what the crew was able to supply', () => {
    // Willingness is not capability. A resolver that scaled a contribution by the mood of
    // the man who brought it would be charging the same fact twice, and this is where that
    // shows.
    expect(unwilling.resolution.coverage).toEqual(willing.resolution.coverage);
  });

  it('step 3: the whole of the difference came through the motive and nowhere else', () => {
    // The base — every intent's delta summed — is identical, so nothing about the mood
    // reached the arithmetic of what was supplied.
    expect(baseOf(unwilling)).toBe(baseOf(willing));

    // And the rest of it: the margin between the two runs moves by exactly as much as
    // moving *only* the mood argument does, on one run's own intents. Stated as two
    // differences rather than by recomputing §4.5 here — a second statement of that
    // formula in the test tree is a second thing to keep in step, and it would go green
    // with the implementation if both drifted together.
    const marginWith = (draft: typeof willing, commitment: CommitmentState) =>
      reduceMargin(draft.intents, [commitment, commitment]);

    expect(
      marginWith(unwilling, CommitmentState.Resentful) -
        marginWith(willing, CommitmentState.Committed)
    ).toBe(
      marginWith(willing, CommitmentState.Resentful) -
        marginWith(willing, CommitmentState.Committed)
    );
  });

  it('states in the feed that they gave way, and charges nothing for saying so', () => {
    // The same fact appears twice on the debrief screen — as a line about a person and as a
    // number about the crew — and it must be paid for once. `faltered_early` therefore
    // carries no delta, and this is the check that keeps it that way.
    const gaveWay = unwilling.intents.filter(
      (intent) => intent.kind === OutcomeIntentKind.FalteredEarly
    );

    expect(gaveWay).toHaveLength(2);
    expect(gaveWay.map((intent) => intent.marginDelta)).toEqual([0, 0]);
  });

  it('prices the channel once, and that price is what the deficit reports', () => {
    // §4.7 measures `commitment_drag` as "how much better the margin would have been with a
    // neutral crew". If the mood were charged anywhere else as well, this counterfactual
    // would come out smaller than the difference it is supposed to be measuring.
    const drag = unwilling.resolution.deficits.find(
      (deficit) => deficit.kind === DeficitKind.Commitment
    );
    const neutral = reduceMargin(unwilling.intents, []);
    const actual = reduceMargin(unwilling.intents, [
      CommitmentState.Resentful,
      CommitmentState.Resentful
    ]);

    expect(drag?.magnitude).toBe(neutral - actual);
    expect(drag?.magnitude).toBeGreaterThan(0);
  });
});
