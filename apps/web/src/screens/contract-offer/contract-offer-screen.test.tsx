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
import { collectRenderedTexts } from '../../rendered-texts.ts';
import { render } from '../../testing/render.tsx';
import { TextSource } from '../../text.tsx';

import { ContractOfferScreen } from './contract-offer-screen.tsx';

/**
 * The second hash, on the browser side of it.
 *
 * `readModelHash` proves that two implementations built the same model. It proves
 * nothing about whether that model reached the markup: a forgotten binding, two
 * swapped blocks or a dropped reason all leave it green. The comparison below is the
 * one that sees them — `expectedSnapshot` builds the texts a correctly bound screen
 * should produce, this file walks the DOM the screen actually produced, and the two
 * lists come from unrelated code paths on purpose. Nothing in `expectedSnapshot` can
 * know what the components rendered, which is exactly why agreeing means something.
 *
 * The models are not hand-built. They come from `startSession` over the browser
 * content source, on the five scenarios the corpus records as the five screen states,
 * so the fixtures are the shipped ones and the run reaching them is the run the game
 * makes. A hand-built model would let this file agree with a screen that no scenario
 * can actually produce.
 */

/** The five scenarios whose manifests declare the five states, in state order. */
const SCREEN_SCENARIOS = [
  { scenario: 'screen_loading', state: ScreenState.Loading },
  { scenario: 'screen_empty', state: ScreenState.Empty },
  { scenario: 'screen_error', state: ScreenState.Error },
  { scenario: 'screen_incomplete', state: ScreenState.Incomplete },
  { scenario: 'screen_normal', state: ScreenState.Normal }
] as const;

/** The seed the scenario runner's CLI defaults to, and the one the corpus records. */
const SEED = 424242n;

let catalogue: ReadonlyMap<string, string>;

beforeAll(() => {
  catalogue = browserLocaleCatalogue('ru');
});

function sessionFor(scenario: string): SessionState {
  return startSession({
    content: browserContentSource(),
    scenario,
    // The scenarios name their one checkpoint after themselves. Stated rather than
    // left to the manifest's default, because a checkpoint is an input to a run
    // (`ADR-008`) and a test that let it be inferred would stop noticing if it moved.
    checkpoint: scenario,
    seed: SEED
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
    // Without this the loop below could pass while two scenarios landed on the same
    // screen: agreeing with `expectedSnapshot` says the markup matches the model, not
    // that the model is the one the run was supposed to produce.
    expect(SCREEN_SCENARIOS.map(({ scenario }) => sessionFor(scenario).screen.state)).toEqual(
      SCREEN_SCENARIOS.map(({ state }) => state)
    );
  });

  it.each(SCREEN_SCENARIOS)(
    '$scenario renders exactly the texts the snapshot expects, in order',
    ({ scenario }) => {
      const { screen } = sessionFor(scenario);
      const rendered = collectRenderedTexts(renderScreen(screen));

      expect(rendered).toEqual(expectedSnapshot(screen, catalogue));
    }
  );

  it.each(SCREEN_SCENARIOS)('$scenario agrees on the rendered-ui hash', ({ scenario }) => {
    // The same claim as above, in the form the runtime harness actually compares
    // (`ADR-008`, and Task 15's `report.json`). Kept beside the list comparison rather
    // than instead of it: a hash says they differ, the list says where.
    const { screen } = sessionFor(scenario);

    expect(snapshotHash(collectRenderedTexts(renderScreen(screen)))).toBe(
      snapshotHash(expectedSnapshot(screen, catalogue))
    );
  });
});

describe('what never reaches a label', () => {
  it('shows no raw content id, on any of the five states', () => {
    // `TDD` §11.1 from the other end. The snapshot comparison above already fails if a
    // definition is rendered, but only because `expectedSnapshot` leaves it out —
    // this states the rule itself, so an edit that taught both sides to show one would
    // still have to answer for it.
    for (const { scenario } of SCREEN_SCENARIOS) {
      const { screen } = sessionFor(scenario);
      const rendered = collectRenderedTexts(renderScreen(screen));

      for (const identifier of rawIdentifiersOf(screen)) {
        expect(rendered, `${scenario} must not show '${identifier}'`).not.toContain(identifier);
      }
    }
  });

  it('shows no error detail, on the state that has one', () => {
    // The detail is assembled in code and carries a machine's own path. In the Godot
    // original it arrived as a tooltip, which neither hash covers, so nothing could
    // have noticed it was the one unlocalized player-facing string on the screen.
    const { screen, errorDetail } = sessionFor('screen_error');
    const rendered = collectRenderedTexts(renderScreen(screen));

    expect(errorDetail).not.toBeNull();
    expect(screen.errorDetail).not.toBeNull();
    expect(rendered.join('')).not.toContain('does-not-exist');
  });
});

describe('a catalogue that cannot answer', () => {
  it('fails the render rather than putting the key on the screen', () => {
    const { screen } = sessionFor('screen_normal');
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
