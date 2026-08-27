import { describe, expect, it } from 'vitest';

import { SortedMap } from '../collections/sorted-map.ts';
import { CommitmentState } from '../domain/commitment.ts';
import { NeedId, compareNeedIds } from '../domain/need-id.ts';
import {
  ConsequenceKind,
  CoverageVerdict,
  DeficitKind,
  OutcomeGrade,
  OutcomeIntentKind
} from '../domain/outcome.ts';
import { OutcomeReasonCodes } from '../domain/outcome-reason-codes.ts';
import { heroId, type HeroId } from '../ids/hero-id.ts';
import { aContract, aHero, anOffer, heroes } from '../testing/fixtures.ts';

import { draftResolution, type ResolutionInput } from './contract-resolver.ts';
import { reduceMargin } from './margin.ts';
import { severityOf } from './outcome-grade.ts';

/**
 * `RESOLUTION_SPEC` §2.5, §4.6 and §5 as one answer: what the whole resolver says about a
 * crew that went out.
 *
 * The named cases below are arithmetic worked through by hand from the spec's own
 * formulas, so a failure here says which number moved rather than "the outcome changed".
 */

/** Everything a crew member is, as far as this layer is concerned. */
function member(
  id: number,
  grade: number,
  expertise: readonly (readonly [NeedId, number])[],
  commitment: CommitmentState = CommitmentState.Committed
): ResolutionInput['crew'][number] {
  return {
    hero: aHero({
      id: heroId(id),
      capability: { grade, expertise: SortedMap.from<NeedId, number>(compareNeedIds, expertise) }
    }),
    commitment
  };
}

function anInput(
  needs: readonly (readonly [NeedId, number])[],
  crew: ResolutionInput['crew'],
  options: { readonly risk?: number; readonly keyHero?: HeroId } = {}
): ResolutionInput {
  const invited = crew.map((crewMember) => crewMember.hero.id);

  return {
    contract: aContract({
      risk: options.risk ?? 0,
      requiredCrew: crew.length,
      needs: SortedMap.from<NeedId, number>(compareNeedIds, needs),
      offer: anOffer({
        keyHero: options.keyHero ?? invited[0] ?? null,
        invited: heroes(...invited.map(Number)),
        respondedBy: heroes(...invited.map(Number)),
        acceptedBy: heroes(...invited.map(Number))
      })
    }),
    crew
  };
}

const kindsOf = (input: ResolutionInput) =>
  draftResolution(input).intents.map((intent) => intent.kind);

/**
 * Every need closed with room to spare. Frontline and wilderness ask 30 each at no risk;
 * one hero of grade 100 brings 100 to both, capped to 36 by the surplus ceiling, so each
 * need contributes `+6` and a committed crew's `+20 %` lifts a base of 12 to 14.
 */
const cleanly = () =>
  anInput(
    [
      [NeedId.Frontline, 30],
      [NeedId.Wilderness, 30]
    ],
    [
      member(0, 100, [
        [NeedId.Frontline, 100],
        [NeedId.Wilderness, 100]
      ])
    ]
  );

/**
 * The job done, with a small side of it nobody in the crew answered for: frontline asks
 * 100 and is closed exactly; undead knowledge asks 5 and is supplied nothing, for a base
 * of `−5` and a margin of `−4` against a total requirement of 105 — inside §4.6's costly
 * band of a tenth.
 */
const costlyWithAnUnheldNeed = () =>
  anInput(
    [
      [NeedId.Frontline, 100],
      [NeedId.UndeadKnowledge, 5]
    ],
    [member(0, 100, [[NeedId.Frontline, 100]])]
  );

/**
 * Frontline closed at 100 against 60 (`+12` after the ceiling); wilderness asks 200 and
 * two heroes supply 90 between them after halving (`−110`). Base `−98`, margin `−79`
 * against a total requirement of 260 — below the costly band, inside the failed one.
 *
 * **The stronger of the two on the failing need is the higher id**, so §5.2's "whoever
 * was on the point" cannot be satisfied by a rule that reads the amounts not at all and
 * answers the lowest id. External review of this task found every fixture here with the
 * two agreeing.
 */
const failedOnThePoint = () =>
  anInput(
    [
      [NeedId.Frontline, 60],
      [NeedId.Wilderness, 200]
    ],
    [
      member(0, 100, [[NeedId.Frontline, 100]]),
      member(1, 100, [[NeedId.Wilderness, 20]]),
      member(2, 100, [[NeedId.Wilderness, 80]])
    ]
  );

/**
 * One need held by a man who is answerable for it at an expertise of nought, and one
 * closed by somebody else — with a third hero who is answerable for nothing at all.
 *
 * §2.2's distinction, reached through the whole resolver: an explicit zero means the need
 * was his business and he brought nothing to it; an absent key means it never was. The
 * wilderness need is therefore *held*, is the worse covered of the two, and its point is
 * the man who brought nothing. Base `−140`, margin `−112` against a requirement of 200 —
 * a catastrophe, so the lost trust lands on the third man as key hero.
 */
const heldAtNought = () =>
  anInput(
    [
      [NeedId.Frontline, 100],
      [NeedId.Wilderness, 100]
    ],
    [
      member(0, 100, [[NeedId.Frontline, 60]]),
      member(1, 100, [[NeedId.Wilderness, 0]]),
      member(2, 100, [])
    ],
    { keyHero: heroId(2) }
  );

/**
 * Two heroes answerable for the same unclosed need, only one of whom came unwillingly.
 *
 * The fixture provenance needs: `faltered_early` is the one intent kind carrying *both* a
 * hero and a need, so it is the only place "an intent about this man" and "an intent about
 * a need this man holds" can disagree. Frontline closes at 100; wilderness is weak at 90
 * against 100 (`−10`), and a motive of `+10` from two committed against one fragile lifts
 * the base to `−9` — inside the costly band of a tenth of 200.
 */
const oneOfTwoGaveWay = () =>
  anInput(
    [
      [NeedId.Frontline, 100],
      [NeedId.Wilderness, 100]
    ],
    [
      member(0, 100, [[NeedId.Wilderness, 60]]),
      member(1, 100, [[NeedId.Wilderness, 60]], CommitmentState.Fragile),
      member(2, 100, [[NeedId.Frontline, 100]])
    ]
  );

/**
 * Half of one need and none of the other: base `−150`, margin `−120` against a total
 * requirement of 200 — past §4.6's failed band. The key hero is the one who brought
 * nothing, so the wound and the lost trust land on different people.
 */
const catastrophically = () =>
  anInput(
    [
      [NeedId.Frontline, 100],
      [NeedId.Wilderness, 100]
    ],
    [member(0, 100, [[NeedId.Frontline, 50]]), member(1, 100, [])],
    { keyHero: heroId(1) }
  );

/**
 * Both needs weak at exactly the floor: base `−80` against a total requirement of 200.
 * A committed crew reads `−64` and fails; a resentful one reads `−96` and is a
 * catastrophe. The one fixture where the crew's willingness, and nothing else, decides
 * which step the outcome lands on.
 */
const atTheMotiveBoundary = (commitment: CommitmentState) =>
  anInput(
    [
      [NeedId.Frontline, 100],
      [NeedId.Wilderness, 100]
    ],
    [
      member(0, 100, [[NeedId.Frontline, 60]], commitment),
      member(1, 100, [[NeedId.Wilderness, 60]], commitment)
    ]
  );

describe('the four steps, worked through (§4.6, §5.3)', () => {
  it('calls it clean when every need closed and the margin held', () => {
    const { resolution } = draftResolution(cleanly());

    expect(resolution.grade).toBe(OutcomeGrade.Clean);
    expect(resolution.coverage.map((row) => [row.need, row.required, row.effective])).toEqual([
      [NeedId.Frontline, 30, 36],
      [NeedId.Wilderness, 30, 36]
    ]);
  });

  it('calls it costly when one need went unanswered, however small', () => {
    const { resolution } = draftResolution(costlyWithAnUnheldNeed());

    expect(resolution.grade).toBe(OutcomeGrade.Costly);
    expect(resolution.coverage.map((row) => row.verdict)).toEqual([
      CoverageVerdict.Closed,
      CoverageVerdict.Uncovered
    ]);
  });

  it('calls it failed when the margin fell past a tenth of what was asked', () => {
    expect(draftResolution(failedOnThePoint()).resolution.grade).toBe(OutcomeGrade.Failed);
  });

  it('calls it a catastrophe past a third', () => {
    expect(draftResolution(catastrophically()).resolution.grade).toBe(OutcomeGrade.Disaster);
  });
});

describe('what the resolver says happened, in order (§3.3, §4.6)', () => {
  it('answers with the coverage, then the objective, then the closing intent', () => {
    expect(kindsOf(cleanly())).toEqual([
      OutcomeIntentKind.NeedCovered,
      OutcomeIntentKind.NeedCovered,
      OutcomeIntentKind.ObjectiveTaken,
      OutcomeIntentKind.ContractResolved
    ]);
  });

  it('puts who gave way before the objective, and the cost after it', () => {
    // The order §4.6 fixes: coverage → its intents → margin → grade → the objective →
    // the consequences → `contract_resolved`. Giving way is read off the verdicts, so it
    // belongs with the coverage; the objective and the cost both follow the grade.
    expect(kindsOf(atTheMotiveBoundary(CommitmentState.Resentful))).toEqual([
      OutcomeIntentKind.NeedShort,
      OutcomeIntentKind.NeedShort,
      OutcomeIntentKind.FalteredEarly,
      OutcomeIntentKind.FalteredEarly,
      OutcomeIntentKind.ObjectiveLost,
      OutcomeIntentKind.ConsequenceSuffered,
      OutcomeIntentKind.ConsequenceSuffered,
      OutcomeIntentKind.ContractResolved
    ]);
  });

  it('closes with `contract_resolved` on every outcome there is', () => {
    for (const input of [
      cleanly(),
      costlyWithAnUnheldNeed(),
      failedOnThePoint(),
      catastrophically()
    ]) {
      expect(draftResolution(input).intents.at(-1)?.kind).toBe(OutcomeIntentKind.ContractResolved);
    }
  });

  it('never produces fewer than the objective and the closing intent', () => {
    expect(draftResolution(cleanly()).intents.length).toBeGreaterThanOrEqual(2);
  });

  it.each([
    [cleanly, OutcomeGrade.Clean, OutcomeReasonCodes.ObjectiveTaken],
    [costlyWithAnUnheldNeed, OutcomeGrade.Costly, OutcomeReasonCodes.ObjectiveTaken],
    [failedOnThePoint, OutcomeGrade.Failed, OutcomeReasonCodes.ObjectiveLost],
    [catastrophically, OutcomeGrade.Disaster, OutcomeReasonCodes.ObjectiveLost]
  ])('closes %#: on %s the reason is the objective’s own', (fixture, grade, reason) => {
    // `ADR-015`: §2.1 declares no code for the closing intent, so it carries the code of
    // the objective at its own grade. The choice reaches no event and no provenance —
    // which is exactly why it needs stating here: without this table a constant in either
    // branch of `resolvedIntentFor` passes the whole suite, and the rule would be one
    // that is written down and never checked.
    const { intents, resolution } = draftResolution(fixture());
    const closing = intents.at(-1);

    expect(resolution.grade).toBe(grade);
    expect(closing?.kind).toBe(OutcomeIntentKind.ContractResolved);
    expect(closing?.reason).toBe(reason);
  });

  it('reads the objective off the step, not off the sign of the margin', () => {
    // A crew four points short of a hundred still did the job, and §5.3 pays it in full.
    // Reading the sign would put "the objective was lost" in the feed at exactly the
    // outcomes the patron pays for as taken (owner's decision, 2026-08-27).
    const { intents } = draftResolution(costlyWithAnUnheldNeed());

    expect(intents.map((intent) => intent.kind)).toContain(OutcomeIntentKind.ObjectiveTaken);
    expect(reduceMargin(intents, [CommitmentState.Committed])).toBeLessThan(0);
  });

  it('carries no campaign identifier on any intent', () => {
    // `eventId`, `stateVersion` and `commandId` are the command's business. Keeping them
    // out is what lets this run on a synthetic crew and be batch-run for balancing.
    for (const intent of draftResolution(failedOnThePoint()).intents) {
      expect(intent).not.toHaveProperty('eventId');
      expect(intent).not.toHaveProperty('stateVersion');
    }
  });

  it('gives every derived intent a margin delta of nought', () => {
    // §4.4: an outcome must not feed the margin it was derived from.
    const derived = draftResolution(catastrophically()).intents.filter(
      (intent) =>
        intent.kind !== OutcomeIntentKind.NeedCovered && intent.kind !== OutcomeIntentKind.NeedShort
    );

    expect(derived).not.toHaveLength(0);
    expect(derived.map((intent) => intent.marginDelta)).toEqual(derived.map(() => 0));
  });
});

describe('what the outcome cost the people (§5.1, §5.2)', () => {
  it('wounds whoever was on the point of the worst need somebody held', () => {
    // Hero 2 carried 80 of the wilderness need against hero 1's 20 — and is the higher of
    // the two ids, so "always the lowest id" answers the other man.
    expect(draftResolution(failedOnThePoint()).resolution.consequences).toEqual([
      {
        hero: heroId(2),
        kind: ConsequenceKind.Wound,
        reason: OutcomeReasonCodes.WoundOnThePoint,
        magnitude: 1
      }
    ]);
  });

  it('wounds the man who was answerable at nought, not the one whose need closed', () => {
    // §2.2 through the whole resolver: a key present at an expertise of nought means the
    // need was his business. A rule reading "somebody supplied something" would pass the
    // wilderness need over as unheld and wound hero 0, whose own need was the better
    // covered of the two.
    expect(
      draftResolution(heldAtNought()).resolution.consequences.map((consequence) => [
        consequence.hero,
        consequence.kind
      ])
    ).toEqual([
      [heroId(1), ConsequenceKind.Wound],
      [heroId(2), ConsequenceKind.TrustLost]
    ]);
  });

  it('wounds the man who held the one need anybody held, not nobody', () => {
    // The unanswered need is covered at nought and would be the worst of all — and has
    // nobody to wound. Owner's decision, 2026-08-27: pass over it (§5.2).
    expect(
      draftResolution(costlyWithAnUnheldNeed()).resolution.consequences.map(
        (consequence) => consequence.hero
      )
    ).toEqual([heroId(0)]);
  });

  it('costs a catastrophe a wound and the key hero’s trust, on different people', () => {
    expect(
      draftResolution(catastrophically()).resolution.consequences.map((consequence) => [
        consequence.hero,
        consequence.kind
      ])
    ).toEqual([
      [heroId(0), ConsequenceKind.Wound],
      [heroId(1), ConsequenceKind.TrustLost]
    ]);
  });

  it('writes each consequence into the feed as its own intent', () => {
    const suffered = draftResolution(catastrophically()).intents.filter(
      (intent) => intent.kind === OutcomeIntentKind.ConsequenceSuffered
    );

    expect(
      suffered.map((intent) => [intent.hero, intent.consequence, intent.magnitude, intent.reason])
    ).toEqual([
      [heroId(0), ConsequenceKind.Wound, 1, OutcomeReasonCodes.WoundOnThePoint],
      [heroId(1), ConsequenceKind.TrustLost, 1, OutcomeReasonCodes.TrustLostInDisaster]
    ]);
  });

  it('answers a crew that gave way with a grudge, not with the guild’s standing', () => {
    // The wiring §5.1 turns on: who gave way is read off the coverage, and it is what
    // decides the second record of a catastrophe. A resolver that never handed the
    // faltering along would produce two records of the right shape and the wrong kind.
    expect(
      draftResolution(atTheMotiveBoundary(CommitmentState.Resentful)).resolution.consequences.map(
        (consequence) => [consequence.hero, consequence.kind]
      )
    ).toEqual([
      [heroId(0), ConsequenceKind.Wound],
      [heroId(0), ConsequenceKind.Grudge]
    ]);
  });

  it('costs a clean outcome nobody, and says so with no intent at all', () => {
    const { intents, resolution } = draftResolution(cleanly());

    expect(resolution.consequences).toEqual([]);
    expect(intents.map((intent) => intent.kind)).not.toContain(
      OutcomeIntentKind.ConsequenceSuffered
    );
  });
});

describe('what each hero is recorded as having brought (§2.5, §6.1)', () => {
  it('accounts for every member of the crew, including one who brought nothing', () => {
    // §2.5: `contributions.keys() === acceptedBy`, in both directions. A hero the debrief
    // screen looks up and does not find is a hole where a number should be.
    const { contributions } = draftResolution(catastrophically()).resolution;

    expect(contributions.keys()).toEqual([heroId(0), heroId(1)]);
    expect(contributions.get(heroId(1))?.amount).toBe(0);
  });

  it('names a reason once, however many of his needs earned it', () => {
    // One hero answerable for both needs, both closed. Undeduplicated, the screen would
    // print "the need closed" twice under one man's name and read as two separate facts.
    const { contributions } = draftResolution(cleanly()).resolution;

    expect(contributions.get(heroId(0))?.provenance).toEqual([OutcomeReasonCodes.NeedClosed]);
  });

  it('records what each one personally brought, across every need he answered for', () => {
    // Before the halving (§4.3) — what the man is worth rather than what his position in
    // the queue made of it. The counted shares live on the need's own row, and hero 2's
    // 80 counts in full while hero 1's 20 counts as 10, so this list and that one cannot
    // be the same numbers by accident.
    const { coverage, contributions } = draftResolution(failedOnThePoint()).resolution;

    expect(contributions.values().map((contribution) => contribution.amount)).toEqual([
      100, 20, 80
    ]);
    expect(coverage[1]?.contributors).toEqual([
      { hero: heroId(2), amount: 80, counted: 80 },
      { hero: heroId(1), amount: 20, counted: 10 }
    ]);
  });

  it('counts a man answerable at nought as a contributor who brought nothing', () => {
    // The two ways of bringing nothing, told apart at the level the screen reads (§2.2):
    // hero 1 holds the wilderness need at nought and appears on it; hero 2 holds nothing
    // and appears nowhere. Both are recorded in `contributions` — the crew went out — and
    // only the first one's need is part of his story.
    const { coverage, contributions } = draftResolution(heldAtNought()).resolution;

    expect(coverage[1]?.contributors).toEqual([{ hero: heroId(1), amount: 0, counted: 0 }]);
    expect(contributions.keys()).toEqual([heroId(0), heroId(1), heroId(2)]);
    expect(contributions.get(heroId(1))?.provenance).toEqual([
      OutcomeReasonCodes.NeedUncovered,
      OutcomeReasonCodes.WoundOnThePoint
    ]);
    expect(contributions.get(heroId(2))?.provenance).toEqual([
      OutcomeReasonCodes.TrustLostInDisaster
    ]);
  });

  it('gives the reason for giving way to the man who gave way, and to nobody beside him', () => {
    // `faltered_early` is the one intent naming a hero *and* a need, so it is the only
    // place "about this man" and "about a need this man holds" can disagree. Two heroes
    // answer for the wilderness need and only one of them came unwillingly: drop the
    // "names nobody" half of the rule and the steady man is told he gave way too.
    const { contributions } = draftResolution(oneOfTwoGaveWay()).resolution;

    expect(contributions.get(heroId(0))?.provenance).toEqual([OutcomeReasonCodes.NeedWeak]);
    expect(contributions.get(heroId(1))?.provenance).toEqual([
      OutcomeReasonCodes.NeedWeak,
      OutcomeReasonCodes.FalteredEarly,
      OutcomeReasonCodes.GrudgeAfterFaltering
    ]);
    expect(contributions.get(heroId(2))?.provenance).toEqual([OutcomeReasonCodes.NeedClosed]);
  });

  it('records how willingly each one came', () => {
    const { contributions } = draftResolution(
      atTheMotiveBoundary(CommitmentState.Resentful)
    ).resolution;

    expect(contributions.values().map((contribution) => contribution.commitment)).toEqual([
      CommitmentState.Resentful,
      CommitmentState.Resentful
    ]);
  });

  it('names, for each hero, the reasons that are actually about him', () => {
    // Provenance is what lets the screen say where a number came from (`GDD` §21.4). A
    // hero is answerable for the needs his expertise names and for nothing else, so the
    // verdict on somebody else's need is not part of his story — and the wound is, because
    // it named him.
    const { contributions } = draftResolution(failedOnThePoint()).resolution;

    expect(contributions.get(heroId(0))?.provenance).toEqual([OutcomeReasonCodes.NeedClosed]);
    expect(contributions.get(heroId(1))?.provenance).toEqual([OutcomeReasonCodes.NeedUncovered]);
    expect(contributions.get(heroId(2))?.provenance).toEqual([
      OutcomeReasonCodes.NeedUncovered,
      OutcomeReasonCodes.WoundOnThePoint
    ]);
  });
});

describe('what went wrong, and whether it may be named (§4.7)', () => {
  it('prices the shortfall in margin and names where it came from', () => {
    // Without the wilderness shortfall the base is `+12` and the margin `+14`; what
    // happened was `−79`. So the coverage gap cost 93 — and the two heroes it names are
    // the ones who were answerable for that need at all.
    const { deficits, dominant } = draftResolution(failedOnThePoint()).resolution;

    expect(deficits).toEqual([
      {
        kind: DeficitKind.Coverage,
        magnitude: 93,
        needs: [NeedId.Wilderness],
        heroes: [heroId(1), heroId(2)]
      }
    ]);
    expect(dominant).toBe(DeficitKind.Coverage);
  });

  it('says nothing went wrong when nothing did', () => {
    const { deficits, dominant } = draftResolution(cleanly()).resolution;

    expect(deficits).toEqual([]);
    expect(dominant).toBeNull();
  });

  it('makes a crew that came unwillingly a deficit of its own', () => {
    const { deficits } = draftResolution(atTheMotiveBoundary(CommitmentState.Resentful)).resolution;

    expect(deficits.map((deficit) => deficit.kind)).toContain(DeficitKind.Commitment);
  });
});

describe('the properties the outcome has to have (§10.1)', () => {
  it('does not depend on the order the crew was handed over', () => {
    const input = failedOnThePoint();

    expect(draftResolution({ ...input, crew: [...input.crew].reverse() })).toEqual(
      draftResolution(input)
    );
  });

  it('reads a hero’s capability and his willingness, and nothing else about him', () => {
    // Whatever a hero wanted, feared or refused was spent when he answered; by the time
    // the crew is out, the resolver knows what he can do and how willingly he came. A
    // principle that would have kept him home does not reduce the contribution of the man
    // who went.
    const plain = failedOnThePoint();
    const opinionated: ResolutionInput = {
      ...plain,
      crew: plain.crew.map((crewMember) => ({
        ...crewMember,
        hero: {
          ...crewMember.hero,
          greed: 99,
          caution: 99,
          pride: 99,
          trustInGuild: 1,
          grievance: 40,
          believesGuildPromises: false,
          wounds: 3
        }
      }))
    };

    expect(draftResolution(opinionated)).toEqual(draftResolution(plain));
  });

  it('moves the step the crew’s willingness decides, and moves it the right way', () => {
    // §10.1 property 2, stated where the resolver can be seen to obey it: the same two
    // heroes, the same coverage, and a step apart. A resolver ignoring the motive gives the
    // same answer twice; one that dropped `abs(base)` gives them the wrong way round.
    expect(draftResolution(atTheMotiveBoundary(CommitmentState.Committed)).resolution.grade).toBe(
      OutcomeGrade.Failed
    );
    expect(draftResolution(atTheMotiveBoundary(CommitmentState.Resentful)).resolution.grade).toBe(
      OutcomeGrade.Disaster
    );
  });

  it('cannot overturn a step from the extremes of willingness alone, given slack', () => {
    // §10.1 property 3. The declared slack is the whole of §4.5's band: the motive moves
    // the margin by at most a fifth of the base either way, so a fixture sitting further
    // than that from both of its neighbouring thresholds keeps its step whatever the crew
    // felt. Asserted together with the margins actually differing — equal steps are also
    // what a resolver that ignored the motive entirely would answer.
    const committed = draftResolution(cleanly());
    const resentful = draftResolution({
      ...cleanly(),
      crew: cleanly().crew.map((crewMember) => ({
        ...crewMember,
        commitment: CommitmentState.Resentful
      }))
    });

    expect(resentful.resolution.grade).toBe(committed.resolution.grade);
    expect(reduceMargin(resentful.intents, [CommitmentState.Resentful])).toBeLessThan(
      reduceMargin(committed.intents, [CommitmentState.Committed])
    );
  });

  it('never makes the outcome worse when a hero got better at his job', () => {
    // §10.1 property 1, as an enumeration rather than a fuzzer: this package may not touch
    // global randomness (`ADR-003`), and an enumeration names the same case on every run.
    let checked = 0;

    for (const [first, second] of NEED_WEIGHTS) {
      for (const risk of RISKS) {
        for (const crew of CREW_SHAPES) {
          for (const boost of BOOSTS) {
            for (let index = 0; index < crew.length; index++) {
              const input = anInput(
                [
                  [NeedId.Frontline, first],
                  [NeedId.Wilderness, second]
                ],
                crew.map((shape, at) => member(at, shape.grade, shape.expertise, shape.commitment)),
                { risk }
              );
              const better: ResolutionInput = {
                ...input,
                crew: input.crew.map((crewMember, at) =>
                  at === index ? improved(crewMember, boost) : crewMember
                )
              };

              expect(severityOf(draftResolution(better).resolution.grade)).toBeLessThanOrEqual(
                severityOf(draftResolution(input).resolution.grade)
              );
              checked++;
            }
          }
        }
      }
    }

    // The sweep is a real one, not an empty loop that passed by saying nothing.
    //
    // **Two assertions, and the first version of this had only the second one** — which
    // proved nothing at all: `checked` was compared against a product of the same tables
    // the loops walked, so emptying any axis made both sides zero and the property test
    // passed over no cases whatever (external review of this task). The literal is what
    // catches that; the product is what catches an axis quietly shrinking while the
    // literal is dutifully updated to match.
    expect(checked).toBe(216);
    expect(checked).toBe(NEED_WEIGHTS.length * RISKS.length * BOOSTS.length * CREW_SIZE_TOTAL);
  });
});

/** Two-need contracts at even weights, at very uneven ones, and at a small remainder. */
const NEED_WEIGHTS: readonly (readonly [number, number])[] = [
  [30, 30],
  [100, 5],
  [60, 200],
  [100, 100]
];

const RISKS: readonly number[] = [0, 40, 100];

/** How much better one hero gets: a step that cannot cross a threshold, and two that can. */
const BOOSTS: readonly number[] = [1, 17, 50];

interface CrewShape {
  readonly grade: number;
  readonly expertise: readonly (readonly [NeedId, number])[];
  readonly commitment: CommitmentState;
}

const CREW_SHAPES: readonly (readonly CrewShape[])[] = [
  [{ grade: 100, expertise: [[NeedId.Frontline, 60]], commitment: CommitmentState.Committed }],
  [
    { grade: 70, expertise: [[NeedId.Frontline, 50]], commitment: CommitmentState.Fragile },
    { grade: 40, expertise: [[NeedId.Wilderness, 90]], commitment: CommitmentState.Resentful }
  ],
  [
    {
      grade: 50,
      expertise: [
        [NeedId.Frontline, 40],
        [NeedId.Wilderness, 40]
      ],
      commitment: CommitmentState.Committed
    },
    { grade: 90, expertise: [[NeedId.Wilderness, 30]], commitment: CommitmentState.Fragile },
    { grade: 20, expertise: [[NeedId.Frontline, 100]], commitment: CommitmentState.Resentful }
  ]
];

const CREW_SIZE_TOTAL = CREW_SHAPES.reduce((total, crew) => total + crew.length, 0);

/** The same hero, better at everything he was already answerable for, capped at a hundred. */
function improved(
  crewMember: ResolutionInput['crew'][number],
  boost: number
): ResolutionInput['crew'][number] {
  const { capability } = crewMember.hero;

  return {
    ...crewMember,
    hero: {
      ...crewMember.hero,
      capability: {
        ...capability,
        expertise: SortedMap.from<NeedId, number>(
          compareNeedIds,
          capability.expertise
            .entries()
            .map(([need, value]) => [need, Math.min(100, value + boost)] as const)
        )
      }
    }
  };
}
