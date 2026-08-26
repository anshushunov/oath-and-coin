import { describe, expect, it } from 'vitest';

import { SortedMap } from '../collections/sorted-map.ts';
import { CommitmentState } from '../domain/commitment.ts';
import { NeedId, compareNeedIds } from '../domain/need-id.ts';
import { DeficitKind, OutcomeIntentKind, type OutcomeIntent } from '../domain/outcome.ts';
import { OutcomeReasonCodes } from '../domain/outcome-reason-codes.ts';
import { heroId } from '../ids/hero-id.ts';

import { DOMINANCE_MARGIN_PERCENT, rankDeficits } from './deficits.ts';
import type { CrewMember } from './outcome-intent.ts';

/**
 * `RESOLUTION_SPEC` §4.7 — the three ways a crew can come up short, priced in the one
 * currency they are comparable in, and which of them (if any) may be called the reason.
 */

const short = (need: NeedId, delta: number, gap: DeficitKind): OutcomeIntent => ({
  kind: OutcomeIntentKind.NeedShort,
  hero: null,
  need,
  marginDelta: delta,
  reason: OutcomeReasonCodes.NeedWeak,
  gap,
  consequence: null,
  magnitude: 0
});

const covered = (need: NeedId, delta: number): OutcomeIntent => ({
  kind: OutcomeIntentKind.NeedCovered,
  hero: null,
  need,
  marginDelta: delta,
  reason: OutcomeReasonCodes.NeedClosed,
  gap: null,
  consequence: null,
  magnitude: 0
});

const member = (id: number, commitment: CommitmentState, needs: readonly NeedId[]): CrewMember => ({
  hero: heroId(id),
  capability: {
    grade: 50,
    expertise: SortedMap.from<NeedId, number>(
      compareNeedIds,
      needs.map((need) => [need, 50] as const)
    )
  },
  commitment
});

const willingCrew = (size = 4): readonly CrewMember[] =>
  Array.from({ length: size }, (_unused, index) =>
    member(index, CommitmentState.Committed, [NeedId.Frontline, NeedId.Wilderness])
  );

const kindsOf = (input: Parameters<typeof rankDeficits>[0]) =>
  rankDeficits(input).ranked.map((deficit) => deficit.kind);

describe('what a deficit is worth (§4.7)', () => {
  it('prices each kind as the margin it cost, so the three can be compared at all', () => {
    // A crew that is entirely committed has a motive of +20, so the margin is
    // `base + abs(base) × 20 / 100`. Base is −40: −30 from a coverage miss and −10 from a
    // capability one, giving an actual margin of −40 + 8 = −32. Take the coverage miss
    // away and the base is −10 → −8; take the capability miss away and it is −30 → −24.
    // So the two cost 24 and 8 — and they are now in the same units, which is the whole
    // point of measuring them counterfactually rather than in their own.
    const { ranked } = rankDeficits({
      intents: [
        short(NeedId.Frontline, -30, DeficitKind.Coverage),
        short(NeedId.Wilderness, -10, DeficitKind.Capability)
      ],
      crew: willingCrew()
    });

    expect(ranked.map((deficit) => [deficit.kind, deficit.magnitude])).toEqual([
      [DeficitKind.Coverage, 24],
      [DeficitKind.Capability, 8]
    ]);
  });

  it('ranks by what each cost, largest first', () => {
    expect(
      kindsOf({
        intents: [
          short(NeedId.Wilderness, -10, DeficitKind.Capability),
          short(NeedId.Frontline, -30, DeficitKind.Coverage)
        ],
        crew: willingCrew()
      })
    ).toEqual([DeficitKind.Coverage, DeficitKind.Capability]);
  });

  it('names the needs and the heroes each deficit came from', () => {
    const { ranked } = rankDeficits({
      intents: [short(NeedId.Wilderness, -30, DeficitKind.Coverage)],
      crew: [
        member(1, CommitmentState.Committed, [NeedId.Wilderness]),
        member(2, CommitmentState.Committed, [NeedId.Frontline])
      ]
    });

    expect(ranked[0]!.needs).toEqual([NeedId.Wilderness]);
    // Only the hero answerable for the need this deficit is about.
    expect(ranked[0]!.heroes).toEqual([heroId(1)]);
  });

  it('answers in a canonical order, whatever order the crew and the intents arrived in', () => {
    // Two needs and three answerable heroes, all handed over backwards. The result reaches
    // the determinism artifact, so "whatever order the caller assembled its list in" is
    // not an acceptable answer — and every other case here passes data already sorted,
    // where dropping the sorts is invisible.
    const { ranked } = rankDeficits({
      intents: [
        short(NeedId.Wilderness, -20, DeficitKind.Coverage),
        short(NeedId.Frontline, -20, DeficitKind.Coverage)
      ],
      crew: [
        member(5, CommitmentState.Committed, [NeedId.Wilderness]),
        member(3, CommitmentState.Committed, [NeedId.Frontline]),
        member(1, CommitmentState.Committed, [NeedId.Wilderness])
      ]
    });

    expect(ranked[0]!.needs).toEqual([NeedId.Frontline, NeedId.Wilderness]);
    expect(ranked[0]!.heroes).toEqual([heroId(1), heroId(3), heroId(5)]);
  });

  it('leaves a deficit with nothing to answer for out of the list entirely', () => {
    expect(
      kindsOf({
        intents: [covered(NeedId.Frontline, 20), covered(NeedId.Wilderness, 20)],
        crew: willingCrew()
      })
    ).toEqual([]);
  });

  it('answers an empty list and no dominant when everything closed', () => {
    const { ranked, dominant } = rankDeficits({
      intents: [covered(NeedId.Frontline, 20)],
      crew: willingCrew()
    });

    expect(ranked).toEqual([]);
    expect(dominant).toBeNull();
  });
});

describe('what unwillingness costs (§4.7, §4.5)', () => {
  it('makes a crew of bought consent a deficit of its own', () => {
    // The reason `Fragile` is priced below zero at all (§4.5): at nought, "the yes was
    // bought rather than given" could never be named, and it is one of the three diagnoses
    // this system exists to be able to give.
    expect(
      kindsOf({
        intents: [short(NeedId.Frontline, -40, DeficitKind.Capability)],
        crew: Array.from({ length: 4 }, (_unused, index) =>
          member(index, CommitmentState.Fragile, [NeedId.Frontline])
        )
      })
    ).toContain(DeficitKind.Commitment);
  });

  it('says nothing about a crew whose willingness helped', () => {
    // A committed crew's motive is positive, so the neutral counterfactual is *worse*
    // than what happened: the magnitude is negative and §4.7 drops it.
    expect(
      kindsOf({
        intents: [short(NeedId.Frontline, -40, DeficitKind.Capability)],
        crew: willingCrew()
      })
    ).not.toContain(DeficitKind.Commitment);
  });

  it('drops a drag that helped, even though someone did come unwillingly', () => {
    // Three committed against one fragile is a motive of +12 — still positive. So the
    // crew *does* contain a reluctant hero (the early return does not fire) and the
    // counterfactual is still worse than what happened: the magnitude is −4 and §4.7 drops
    // it. This is the case that holds the "non-positive is not a small deficit, it is the
    // absence of one" rule; the willing-crew case above never reaches the arithmetic.
    const crew = [
      member(0, CommitmentState.Committed, [NeedId.Frontline]),
      member(1, CommitmentState.Committed, [NeedId.Frontline]),
      member(2, CommitmentState.Committed, [NeedId.Frontline]),
      member(3, CommitmentState.Fragile, [NeedId.Frontline])
    ];

    expect(
      kindsOf({ intents: [short(NeedId.Frontline, -40, DeficitKind.Capability)], crew })
    ).not.toContain(DeficitKind.Commitment);
  });

  it('names the heroes who came unwillingly, and only them', () => {
    const { ranked } = rankDeficits({
      intents: [short(NeedId.Frontline, -40, DeficitKind.Capability)],
      crew: [
        member(0, CommitmentState.Resentful, [NeedId.Frontline]),
        member(1, CommitmentState.Committed, [NeedId.Frontline]),
        member(2, CommitmentState.Fragile, [NeedId.Frontline]),
        member(3, CommitmentState.Resentful, [NeedId.Frontline])
      ]
    });
    const drag = ranked.find((deficit) => deficit.kind === DeficitKind.Commitment);

    expect(drag?.heroes).toEqual([heroId(0), heroId(2), heroId(3)]);
    // Not about any one need — it is about the people.
    expect(drag?.needs).toEqual([]);
  });

  it('names them in hero-id order even when the crew arrived backwards', () => {
    // Same reason as the coverage case: the list reaches the artifact. Handed in
    // descending order, so "keep the order given" answers 5, 3, 1.
    const { ranked } = rankDeficits({
      intents: [short(NeedId.Frontline, -40, DeficitKind.Capability)],
      crew: [
        member(5, CommitmentState.Resentful, [NeedId.Frontline]),
        member(3, CommitmentState.Fragile, [NeedId.Frontline]),
        member(1, CommitmentState.Resentful, [NeedId.Frontline])
      ]
    });
    const drag = ranked.find((deficit) => deficit.kind === DeficitKind.Commitment);

    expect(drag?.heroes).toEqual([heroId(1), heroId(3), heroId(5)]);
  });
});

describe('which one may be called the reason (§4.7)', () => {
  /**
   * Two coverage shortfalls, and a crew whose motive is **exactly zero** — two committed
   * against two resentful, `20 + 20 − 20 − 20 = 0`. That makes every magnitude equal to
   * the delta it removed, so the table below is a test of dominance and cannot quietly
   * become a second test of §4.5's arithmetic. It also keeps `commitment_drag` out of the
   * list: at a neutral motive the counterfactual costs nothing.
   */
  const twoDeficits = (first: number, second: number) => ({
    intents: [
      short(NeedId.Frontline, -first, DeficitKind.Coverage),
      short(NeedId.Wilderness, -second, DeficitKind.Capability)
    ],
    crew: [
      member(0, CommitmentState.Committed, [NeedId.Frontline]),
      member(1, CommitmentState.Committed, [NeedId.Frontline]),
      member(2, CommitmentState.Resentful, [NeedId.Wilderness]),
      member(3, CommitmentState.Resentful, [NeedId.Wilderness])
    ]
  });

  it('has the fixture it claims: a neutral crew, so magnitudes are the deltas', () => {
    // Asserted rather than assumed. If this ever stops holding, the dominance table below
    // is measuring something else and should fail loudly here first.
    const { ranked } = rankDeficits(twoDeficits(100, 80));

    expect(ranked.map((deficit) => deficit.magnitude)).toEqual([100, 80]);
  });

  it.each([
    // §4.7's rule: `first × 100 >= second × (100 + 25)`. Against a leader of 100 the
    // boundary sits at 80 — a leader a quarter larger than its runner-up.
    [80, DeficitKind.Coverage],
    [81, null]
  ])('a runner-up of %i against a leader of 100 gives %s', (second, expected) => {
    // The plan's own table put this boundary at 75/76. That reading measured the gap as a
    // share of the *leader* (100 − 76 = 24 per cent); §4.7 measures it as a share of the
    // *runner-up*, which is what "exceeds it by 25 per cent" means and what the formula
    // computes. The spec is the source of truth (plan, Global Constraints).
    expect(rankDeficits(twoDeficits(100, second)).dominant).toBe(expected);
  });

  it('lets a single deficit be the reason without anything to compare it to', () => {
    const { ranked, dominant } = rankDeficits({
      intents: [short(NeedId.Frontline, -40, DeficitKind.Coverage)],
      crew: willingCrew()
    });

    expect(ranked).toHaveLength(1);
    expect(dominant).toBe(DeficitKind.Coverage);
  });

  it('refuses to name a reason when two are close, rather than inventing one', () => {
    // The three classes are not mutually exclusive — a weak hero both fails to close a
    // need and goes unwillingly. A model obliged to name the main cause starts making one
    // up; `null` is a precise answer, not a shrug.
    expect(rankDeficits(twoDeficits(100, 95)).dominant).toBeNull();
  });

  it('states the margin by which one must beat the next', () => {
    expect(DOMINANCE_MARGIN_PERCENT).toBe(25);
  });
});
