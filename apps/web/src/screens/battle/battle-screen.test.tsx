// @vitest-environment jsdom
import {
  createSessionController,
  type SaveStorePort,
  type SessionController
} from '@oath-and-coin/application';
import { RULESET_VERSION } from '@oath-and-coin/content';
import {
  BattleEventKeys,
  BattleFieldKeys,
  ScreenState,
  expectedSnapshot,
  snapshotHash,
  type BattleScreenModel
} from '@oath-and-coin/presentation';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import {
  browserContentSource,
  browserLocaleCatalogue,
  browserUiTextCatalogue,
  shippedContentVersion
} from '../../content-source.ts';
import { collectRenderedTexts } from '../../rendered-texts.ts';
import { render } from '../../testing/render.tsx';
import { TextSource } from '../../text.tsx';

import { BattleScreen, type BattleControls } from './battle-screen.tsx';

/**
 * The battle screen's text, held to the comparison every other screen is held to.
 *
 * **The canvas is replaced with nothing, and that is the limit of this file.** jsdom stubs
 * `getContext` to `null`, so nothing here can say whether the board is drawn; the browser
 * suite (`tests/e2e/battle.spec.ts`) says that. What jsdom *can* read is the text dub beside
 * the canvas — the list under the board and the journal — and that text is what the owner's
 * first play found unreadable: no cell on any man, no target on any blow.
 *
 * `expectedSnapshot` builds the texts a correctly bound screen owes and this file walks the
 * DOM one actually produced; neither side can see the other. The models are runs of the
 * shipped `battle_ready` scenario through the live controller, so a screen agreeing with a
 * model no campaign can produce would still be red here.
 */

vi.mock('../../world/world-canvas.tsx', () => ({
  WorldCanvas: () => null
}));

const SEED = 424242n;

let catalogue: ReadonlyMap<string, string>;

beforeAll(() => {
  catalogue = new Map([...browserLocaleCatalogue('ru'), ...browserUiTextCatalogue('ru')]);
});

function noSaveStore(): SaveStorePort {
  const refuse = (): never => {
    throw new Error('This test drives a screen, not a save slot.');
  };

  return { read: refuse, write: refuse, list: refuse, clear: refuse } as unknown as SaveStorePort;
}

function controllerFor(scenario: string, checkpoint: string): SessionController {
  const controller = createSessionController({
    request: {
      content: browserContentSource(),
      scenario,
      checkpoint,
      seed: SEED
    },
    saves: noSaveStore(),
    now: () => '1970-01-01T00:00:00.000Z',
    expected: { rulesetVersion: RULESET_VERSION, contentVersion: shippedContentVersion() }
  });

  void controller.start();

  return controller;
}

/**
 * The fight `battle_ready` is one press away from, at `applied` events in — the same
 * arrangement the lab uses: the resolver runs the battle and the screen shows it before
 * the campaign commits it (`COMBAT_SPEC` §6.3).
 */
function fightAt(applied: number | 'end'): BattleScreenModel {
  const controller = controllerFor('battle_ready', 'battle_ready');
  const contractId = controller.store.snapshot().focusedContract;

  if (contractId === null) {
    throw new Error('battle_ready left no contract focused.');
  }

  const record = controller.previewBattle(contractId, null);

  if (record === null) {
    throw new Error('battle_ready produced no battle to show.');
  }

  const model = controller.battleScreen(
    contractId,
    record,
    applied === 'end' ? record.events.length : applied,
    true
  );

  if (model === null) {
    throw new Error('battle_ready produced no campaign to build a screen from.');
  }

  return model;
}

const INERT: BattleControls = {
  togglePause: () => undefined,
  toggleSpeed: () => undefined,
  skip: () => undefined,
  replay: () => undefined,
  retreat: () => undefined
};

/** The text `key` resolves to, or a loud failure — the same rule the screen itself follows. */
function textOf(key: string): string {
  const text = catalogue.get(key);

  if (text === undefined) {
    throw new Error(`Neither catalogue answers '${key}'.`);
  }

  return text;
}

function renderScreen(model: BattleScreenModel): HTMLElement {
  return render(
    <TextSource catalogue={catalogue}>
      <BattleScreen model={model} controls={INERT} />
    </TextSource>
  );
}

const POSITIONS = [
  {
    state: ScreenState.Incomplete,
    describe: 'the opening frame of a fight',
    model: () => fightAt(0)
  },
  {
    state: ScreenState.Normal,
    describe: 'a fight the feed has reached the end of',
    model: () => fightAt('end')
  }
] as const;

describe('the two positions a fight can be watched at', () => {
  it.each(POSITIONS)('$describe is $state', ({ state, model }) => {
    expect(model().state).toBe(state);
  });

  it.each(POSITIONS)('$describe renders exactly the texts the snapshot expects', ({ model }) => {
    const screen = model();

    expect(collectRenderedTexts(renderScreen(screen))).toEqual(expectedSnapshot(screen, catalogue));
  });

  it.each(POSITIONS)('$describe agrees on the rendered-ui hash', ({ model }) => {
    const screen = model();

    expect(snapshotHash(collectRenderedTexts(renderScreen(screen)))).toBe(
      snapshotHash(expectedSnapshot(screen, catalogue))
    );
  });
});

describe('what the owner could not read from the first play', () => {
  it('puts a cell on every man in the list under the board', () => {
    // «непонятно, как стоят». The list carried side, name, job, health and statuses, and no
    // cell — the geometry of `COMBAT_SPEC` §4 rests on `(row, column)` and the list said
    // neither. Read off the page rather than off the model, on the words the shipped
    // catalogue gives the spec's two — through the key, so a reworded translation is not a
    // red test (`AGENTS.md` §6: texts are not keys of logic, and not of tests either).
    const container = renderScreen(fightAt(0));
    const rows = Array.from(container.querySelectorAll('[data-testid^="battle-unit-"]'));

    expect(rows.length).toBeGreaterThan(0);

    for (const row of rows) {
      const texts = collectRenderedTexts(row);

      expect(texts, texts.join(' | ')).toContain(textOf(BattleFieldKeys.Row));
      expect(texts, texts.join(' | ')).toContain(textOf(BattleFieldKeys.Column));
    }
  });

  it('says whom every blow in the journal landed on', () => {
    // «кто куда бьёт». A blow's line read `Урон Противник Столкновение 10`: the striker
    // and the number, and nobody struck. The arrow is the word between the two men.
    const container = renderScreen(fightAt('end'));
    const lines = Array.from(container.querySelectorAll('.journal-line')).map((line) =>
      collectRenderedTexts(line)
    );
    const blow = textOf(BattleEventKeys.DamageDealt);
    const to = textOf(BattleFieldKeys.To);
    const blows = lines.filter((line) => line[0] === blow);

    expect(blows.length).toBeGreaterThan(0);

    for (const line of blows) {
      expect(line, line.join(' | ')).toContain(to);
      // The arrow is followed by somebody, never by the number.
      expect(line[line.indexOf(to) + 1]).not.toMatch(/^\d+$/u);
    }
  });
});
