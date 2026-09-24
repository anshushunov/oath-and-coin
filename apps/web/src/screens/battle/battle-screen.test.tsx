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

describe('the layout the owner chose (the spec of the kit, §5)', () => {
  /** Whether `later` comes after `earlier` in the document. */
  const follows = (earlier: Element, later: Element): boolean =>
    (earlier.compareDocumentPosition(later) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;

  it('names how the fight ended above the people and the journal, not under them', () => {
    // «Исход боя» was drawn — in the last line of the screen, below eighty lines of journal
    // and in the same size as everything else, so the frame of a finished fight never
    // showed it (§1 of the spec).
    const container = renderScreen(fightAt('end'));
    const outcome = container.querySelector('[data-testid="battle-outcome"]');
    const board = container.querySelector('[data-testid="battle-board"]');
    const journal = container.querySelector('[data-testid="battle-journal"]');

    expect(outcome).not.toBeNull();
    expect(follows(outcome!, board!)).toBe(true);
    expect(follows(outcome!, journal!)).toBe(true);
  });

  it('puts the people and the journal side by side, under the field', () => {
    const container = renderScreen(fightAt('end'));
    const board = container.querySelector('[data-testid="battle-board"]');
    const journal = container.querySelector('[data-testid="battle-journal"]');

    expect(board?.parentElement?.classList.contains('columns')).toBe(true);
    expect(journal?.closest('.columns')).toBe(board?.parentElement);
  });

  it('keeps the journal a feed that sticks to its newest line', () => {
    // §5.3: the journal is the kit's `Feed`, which is what makes it stick to the bottom.
    const container = renderScreen(fightAt('end'));
    const journal = container.querySelector('[data-testid="battle-journal"]');

    expect(journal?.classList.contains('feed')).toBe(true);
    expect(journal?.querySelectorAll('.journal-line')).toHaveLength(fightAt('end').journal.length);
  });
});

describe('the panel of everybody on the field (§5.2)', () => {
  it('draws each man’s health as a bar filled by the share he has left, with the number on it', () => {
    const model = fightAt('end');
    const container = renderScreen(model);

    for (const unit of model.units) {
      const row = container.querySelector(`[data-testid="battle-unit-${unit.unit}"]`);
      const fill = row?.querySelector<HTMLElement>('.bar > i');

      expect(fill, unit.unit).not.toBeNull();
      expect(parseFloat(fill!.style.width), unit.unit).toBeCloseTo(
        (unit.health / unit.maxHealth) * 100
      );
      expect(row?.querySelector('.bar-label')?.textContent, unit.unit).toBe(String(unit.health));
    }
  });

  it('puts every status on a chip, with its word and its mark beside it', () => {
    // Built on the real fight, with two statuses laid by hand: `battle_ready` puts none on
    // anybody at any point, and a case over an empty list of chips would say nothing.
    const model = fightAt('end');
    const [first, ...rest] = model.units;
    const withStatus: BattleScreenModel = {
      ...model,
      units: [
        {
          ...first!,
          statuses: [
            {
              key: 'battle.status.chilled',
              markKey: 'battle.status.chilled.mark',
              remainingRounds: 1
            },
            {
              key: 'battle.status.pinned',
              markKey: 'battle.status.pinned.mark',
              remainingRounds: 2
            }
          ]
        },
        ...rest
      ]
    };
    const container = renderScreen(withStatus);
    const expected = withStatus.units.flatMap((unit) => unit.statuses);

    expect(expected.length).toBeGreaterThan(0);

    const chips = Array.from(container.querySelectorAll('[data-testid="battle-board"] .tag'));

    expect(chips.map((chip) => chip.getAttribute('data-role'))).toEqual(
      expected.map(() => 'status')
    );
    expect(chips.map((chip) => chip.textContent)).toEqual(
      expected.map((status) => textOf(status.key))
    );
  });

  it('edges every line in the colour of its side, and says the side in a word as well', () => {
    const model = fightAt(0);
    const container = renderScreen(model);

    for (const unit of model.units) {
      const row = container.querySelector(`[data-testid="battle-unit-${unit.unit}"]`);

      expect(row?.getAttribute('data-side'), unit.unit).toBe(unit.side === 'crew' ? 'crew' : 'foe');
      expect(collectRenderedTexts(row!)[0], unit.unit).toBe(
        textOf(unit.side === 'crew' ? BattleFieldKeys.Crew : BattleFieldKeys.Foes)
      );
    }
  });
});

describe('the colour of the journal (DEC-018, COMBAT_SPEC §10.2.1)', () => {
  /** The colour a span carries, and the texts inside it. */
  const spans = (line: Element) =>
    Array.from(line.querySelectorAll('[data-tone]')).map((span) => ({
      tone: span.getAttribute('data-tone'),
      texts: collectRenderedTexts(span)
    }));

  it('colours spans of a line and never the line itself', () => {
    const container = renderScreen(fightAt('end'));
    const lines = Array.from(container.querySelectorAll('.journal-line'));

    expect(lines.length).toBeGreaterThan(0);

    for (const line of lines) {
      expect(line.hasAttribute('data-tone')).toBe(false);
      expect(line.closest('[data-tone]')).toBeNull();
    }
  });

  it('colours the number of every blow as harm and of every heal as aid, and the number only', () => {
    const model = fightAt('end');
    const container = renderScreen(model);
    const lines = Array.from(container.querySelectorAll('.journal-line'));
    const kinds = new Map([
      [textOf(BattleEventKeys.DamageDealt), 'harm'],
      [textOf(BattleEventKeys.DamageAbsorbed), 'harm'],
      [textOf(BattleEventKeys.HealingDone), 'aid']
    ]);
    let seen = 0;

    model.journal.forEach((line, index) => {
      const tone = kinds.get(textOf(line.key));

      if (tone === undefined || line.amount === null) {
        return;
      }

      seen += 1;
      expect(
        spans(lines[index]!).filter((span) => span.tone === tone),
        textOf(line.key)
      ).toEqual([{ tone, texts: [String(line.amount)] }]);
    });

    expect(seen).toBeGreaterThan(0);
  });

  it('colours every man on a line by the side word the line carries for him', () => {
    const model = fightAt('end');
    const container = renderScreen(model);
    const lines = Array.from(container.querySelectorAll('.journal-line'));
    const toneOf = (sideKey: string | null) =>
      sideKey === null ? null : sideKey === BattleFieldKeys.Crew ? 'crew' : 'foe';

    model.journal.forEach((line, index) => {
      const sides = spans(lines[index]!)
        .map((span) => span.tone)
        .filter((tone) => tone === 'crew' || tone === 'foe');
      const expected = [toneOf(line.sideKey), toneOf(line.targetSideKey)].filter(
        (tone) => tone !== null
      );

      expect(sides, `${String(index)}: ${textOf(line.key)}`).toEqual(expected);
    });
  });

  it('does not colour by the round, which the line carries and does not print', () => {
    // The first of the two pairs §10.2.1 builds: equal texts, different `round`. A colour
    // read off `round` would tell them apart, and nothing on the line would say why.
    const model = fightAt('end');
    const line = model.journal.find((one) => one.amount !== null)!;
    const pair = { ...model, journal: [line, { ...line, round: line.round + 1 }] };
    const container = renderScreen(pair);
    const [first, second] = Array.from(container.querySelectorAll('.journal-line'));

    expect(second!.outerHTML).toBe(first!.outerHTML);
    expect(spans(first!).length).toBeGreaterThan(0);
  });

  it('colours a named man by his side word, not by his having a name', () => {
    // The second pair: a named man on the foes' side. In M2 only the crew has names, so a
    // colour read off "has a name" agrees with the side on every reachable line — and would
    // paint the first named foe as one of ours, with the colour then the only thing on the
    // line claiming it.
    const model = fightAt('end');
    const line = model.journal.find(
      (one) => one.displayNameKey !== null && one.sideKey === BattleFieldKeys.Crew
    )!;
    const foe = { ...line, sideKey: BattleFieldKeys.Foes };
    const container = renderScreen({ ...model, journal: [foe] });
    const who = spans(container.querySelector('.journal-line')!)[0]!;

    expect(who.texts).toEqual([textOf(line.displayNameKey!)]);
    expect(who.tone).toBe('foe');
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
