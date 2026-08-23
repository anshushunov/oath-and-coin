// @vitest-environment jsdom
import { startSession, type SessionState } from '@oath-and-coin/application';
import {
  ScreenState,
  expectedSnapshot,
  snapshotHash,
  type ContractOfferScreenModel
} from '@oath-and-coin/presentation';
import { beforeAll, describe, expect, it } from 'vitest';

import { browserContentSource, browserLocaleCatalogue } from '../../content-source.ts';
import { collectRenderedAttributes, collectRenderedTexts } from '../../rendered-texts.ts';
import { render } from '../../testing/render.tsx';
import { TextSource } from '../../text.tsx';

import { ContractOfferScreen } from './contract-offer-screen.tsx';

/**
 * The second hash, on the browser side of it.
 *
 * `readModelHash` proves that two implementations built the same model. It proves
 * nothing about whether that model reached the markup: a forgotten binding, two
 * swapped blocks or a dropped reason all leave it green. The comparisons below are the
 * ones that see them — `expectedSnapshot` builds the texts a correctly bound screen
 * should produce, this file walks the DOM the screen actually produced, and the two
 * lists come from unrelated code paths on purpose. Nothing in `expectedSnapshot` can
 * know what the components rendered, which is exactly why agreeing means something.
 *
 * The models are not hand-built. They come from `startSession` over the browser
 * content source, on scenarios the frozen corpus records, so the fixtures are the
 * shipped ones and the run reaching them is the run the game makes. A hand-built model
 * would let this file agree with a screen that no scenario can actually produce.
 *
 * There are two matrices because there are two questions. The first is the five
 * *states*, which is what `AGENTS.md` §7 asks a UI task for. The second is the
 * *branches* — a blocked response, a tie-break, a hero whose mood turned the answer,
 * an empty list — and it exists because external review found that the five shipped
 * `screen_*` scenarios reach none of them.
 */

/** The five scenarios whose manifests declare the five states, in state order. */
const SCREEN_SCENARIOS = [
  { scenario: 'screen_loading', state: ScreenState.Loading },
  { scenario: 'screen_empty', state: ScreenState.Empty },
  { scenario: 'screen_error', state: ScreenState.Error },
  { scenario: 'screen_incomplete', state: ScreenState.Incomplete },
  { scenario: 'screen_normal', state: ScreenState.Normal }
] as const;

/**
 * Scenarios carrying the markup branches no `screen_*` scenario produces.
 *
 * The seed is part of each entry rather than a constant: `zero_sum_tie` settles a dead
 * heat on seed 7 and not on 424242. A matrix that fixed the seed would have listed the
 * right scenario and still not tested the branch.
 *
 * **The `wavered` branch — a hero whose mood turned the answer the other factors would
 * have given — has no entry here.** It used to, as `grey_zone_flip` at seed 7. `DEC-008`
 * Task 8 moved the decision rule's benefit term from `contract.patronFee` onto
 * `contract.offer.advance` (`NEGOTIATION_SPEC` §4), and no shipped scenario can give an
 * offer a nonzero advance yet — that needs `composeOffer`, a command `DEC-008` Tasks
 * 10-14 have not built. Every scenario here still starts every contract on
 * `advance = 0`, so `grey_zone_flip`'s pre-mood score, tuned to land inside the grey
 * band under the old `patronFee`-driven benefit, moved outside it, and mood no longer
 * flips the answer. Task 20 restores this branch once a shipped scenario can compose a
 * real offer.
 */
const BRANCH_SCENARIOS = [
  {
    scenario: 'two_principles_blocked',
    checkpoint: 'final',
    seed: 424242n,
    branch: 'a response blocked outright, and heroes carrying no principles at all',
    covers: (model: ContractOfferScreenModel) =>
      model.responses.some((response) => response.blockedByDisplayNameKey !== null) &&
      model.roster.some((hero) => hero.principleKeys.length === 0)
  },
  {
    scenario: 'zero_sum_tie',
    checkpoint: 'final',
    seed: 7n,
    branch: 'a tie-break, and a contract with no tags',
    covers: (model: ContractOfferScreenModel) =>
      model.responses.some((response) => response.tieBreakCode !== null) &&
      model.contract !== null &&
      model.contract.tagKeys.length === 0
  },
  {
    scenario: 'two_principles_blocked',
    checkpoint: 'final',
    seed: 7n,
    branch: 'heroes carrying no inclinations',
    covers: (model: ContractOfferScreenModel) =>
      model.roster.some((hero) => hero.inclinationKeys.length === 0)
  }
] as const;

/** The seed the scenario runner's CLI defaults to, and the one the corpus records. */
const SEED = 424242n;

let catalogue: ReadonlyMap<string, string>;

beforeAll(() => {
  catalogue = browserLocaleCatalogue('ru');
});

function sessionFor(scenario: string, checkpoint: string, seed: bigint): SessionState {
  return startSession({
    content: browserContentSource(),
    scenario,
    // Stated rather than left to the manifest's default, because a checkpoint is an
    // input to a run (`ADR-008`) and a test that let it be inferred would stop noticing
    // if it moved.
    checkpoint,
    seed
  });
}

function renderScreen(model: ContractOfferScreenModel): HTMLElement {
  return render(
    <TextSource catalogue={catalogue}>
      <ContractOfferScreen model={model} />
    </TextSource>
  );
}

describe('the five states the shipped scenarios reach', () => {
  it('are all five, and each is the one its manifest declares', () => {
    // Without this the loops below could pass while two scenarios landed on the same
    // screen: agreeing with `expectedSnapshot` says the markup matches the model, not
    // that the model is the one the run was supposed to produce.
    expect(
      SCREEN_SCENARIOS.map(({ scenario }) => sessionFor(scenario, scenario, SEED).screen.state)
    ).toEqual(SCREEN_SCENARIOS.map(({ state }) => state));
  });

  it.each(SCREEN_SCENARIOS)(
    '$scenario renders exactly the texts the snapshot expects, in order',
    ({ scenario }) => {
      const { screen } = sessionFor(scenario, scenario, SEED);

      expect(collectRenderedTexts(renderScreen(screen))).toEqual(
        expectedSnapshot(screen, catalogue)
      );
    }
  );

  it.each(SCREEN_SCENARIOS)('$scenario agrees on the rendered-ui hash', ({ scenario }) => {
    // The same claim as above, in the form the runtime harness actually compares
    // (`ADR-008`, and Task 15's `report.json`). Kept beside the list comparison rather
    // than instead of it: a hash says they differ, the list says where.
    const { screen } = sessionFor(scenario, scenario, SEED);

    expect(snapshotHash(collectRenderedTexts(renderScreen(screen)))).toBe(
      snapshotHash(expectedSnapshot(screen, catalogue))
    );
  });
});

describe('the markup branches the five states never reach', () => {
  it.each(BRANCH_SCENARIOS)(
    '$scenario at seed $seed carries $branch',
    ({ scenario, checkpoint, seed, covers }) => {
      // Asserted rather than believed. Which branch a scenario exercises is a property
      // of the corpus, and an edit that made one of these stop carrying its branch
      // would leave the comparison below green over a model that tests nothing — the
      // matrix would keep its size and lose its point.
      expect(covers(sessionFor(scenario, checkpoint, seed).screen)).toBe(true);
    }
  );

  it.each(BRANCH_SCENARIOS)(
    '$scenario at seed $seed renders exactly the texts the snapshot expects, in order',
    ({ scenario, checkpoint, seed }) => {
      const { screen } = sessionFor(scenario, checkpoint, seed);

      expect(collectRenderedTexts(renderScreen(screen))).toEqual(
        expectedSnapshot(screen, catalogue)
      );
    }
  );
});

describe('what never reaches a player', () => {
  it('shows no raw content id, on any run either matrix drives', () => {
    // `TDD` §11.1 from the other end. The snapshot comparisons above already fail if a
    // definition is rendered, but only because `expectedSnapshot` leaves it out — this
    // states the rule itself, so an edit that taught both sides to show one would still
    // have to answer for it.
    //
    // Substring rather than equality, and attributes as well as text: a label reading
    // `id: core:bram` is the same leak as one reading `core:bram`, and a `title` or an
    // `aria-label` carrying it is the leak neither hash can see.
    for (const run of everyRun()) {
      const { screen } = sessionFor(run.scenario, run.checkpoint, run.seed);
      const shown = shownStrings(renderScreen(screen));

      for (const identifier of rawIdentifiersOf(screen)) {
        expect(
          shown.filter((value) => value.includes(identifier)),
          `${run.scenario} must not show '${identifier}'`
        ).toEqual([]);
      }
    }
  });

  it('shows no part of the error detail, on the state that has one', () => {
    // The detail is assembled in code and carries a machine's own path. In the Godot
    // original it arrived as a tooltip, which neither hash covers, so nothing could
    // have noticed it was the one unlocalized player-facing string on the screen.
    //
    // The whole recorded value is looked for, not a fragment of it, and in attributes
    // as well as in text: `title` is that tooltip's browser spelling, and a walk over
    // text nodes is blind to it.
    const { screen, errorDetail } = sessionFor('screen_error', 'screen_error', SEED);
    const shown = shownStrings(renderScreen(screen));

    expect(errorDetail).not.toBeNull();
    expect(screen.errorDetail).toBe(errorDetail);

    const detail = screen.errorDetail ?? '';
    expect(detail).not.toBe('');
    expect(shown.filter((value) => value.includes(detail))).toEqual([]);

    // And the machine-specific fragment on its own, so a detail that grew a prefix
    // between runs cannot make the assertion above vacuously true.
    expect(shown.filter((value) => value.includes('does-not-exist'))).toEqual([]);
  });
});

describe('a catalogue that cannot answer', () => {
  it('fails the render rather than putting the key on the screen', () => {
    const { screen } = sessionFor('screen_normal', 'screen_normal', SEED);
    const incomplete = new Map(catalogue);
    incomplete.delete(screen.titleKey);

    expect(() =>
      render(
        <TextSource catalogue={incomplete}>
          <ContractOfferScreen model={screen} />
        </TextSource>
      )
    ).toThrow(/screen[.]contract_offer[.]title/u);
  });
});

/** Every run either matrix drives, so a leak rule is stated over all of them at once. */
function everyRun(): readonly {
  readonly scenario: string;
  readonly checkpoint: string;
  readonly seed: bigint;
}[] {
  return [
    ...SCREEN_SCENARIOS.map(({ scenario }) => ({ scenario, checkpoint: scenario, seed: SEED })),
    ...BRANCH_SCENARIOS.map(({ scenario, checkpoint, seed }) => ({ scenario, checkpoint, seed }))
  ];
}

/** Everything a rendered screen puts in front of a browser: its texts and its attributes. */
function shownStrings(container: HTMLElement): readonly string[] {
  return [...collectRenderedTexts(container), ...collectRenderedAttributes(container)];
}

/** Every content id the model carries for bookkeeping and no screen may show. */
function rawIdentifiersOf(model: ContractOfferScreenModel): readonly string[] {
  const identifiers: string[] = [];

  if (model.contract !== null) {
    identifiers.push(model.contract.definition);
  }

  for (const hero of model.roster) {
    identifiers.push(hero.definition);
  }

  for (const response of model.responses) {
    identifiers.push(response.heroDefinition);

    if (response.blockedByEntity !== null) {
      identifiers.push(response.blockedByEntity);
    }

    for (const reason of response.reasons) {
      identifiers.push(reason.sourceEntity);
    }
  }

  return identifiers;
}
