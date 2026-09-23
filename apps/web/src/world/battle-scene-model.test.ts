import type { BattleScreenModel, BattleUnitLine } from '@oath-and-coin/presentation';
import { describe, expect, it } from 'vitest';

import { describeBattleScene, type BattleShape } from './battle-scene-model.ts';

/**
 * The schematic board, as layout (`COMBAT_SPEC` §10.2, `DEC-007`).
 *
 * What can be wrong here is arithmetic — two tokens in one place, a bar wider than full, a
 * front rank drawn at the back — and none of it needs a renderer to catch. What does need one
 * is whether anything appears on the canvas at all, and that is the browser evidence's job
 * (`world-canvas.tsx` records why at length).
 */

/**
 * A model with the board `units` describes, and nothing else that matters here.
 *
 * Built by hand rather than fought for, deliberately: this file is about *where a token
 * lands given a cell*, and a battle would supply the cells with a fight attached. What has to
 * come from a real record — that the cells are the ones the battle produced — is
 * `battle-screen-model.test.ts`'s claim, not this one.
 */
function aBoard(units: readonly Partial<BattleUnitLine>[]): BattleScreenModel {
  return {
    screen: 'battle',
    state: 'Incomplete',
    titleKey: 'screen.battle.title',
    contractDefinition: 'core:x',
    contractDisplayNameKey: 'contract.x',
    doctrineKey: 'battle.doctrine.hold_the_line',
    round: 1,
    maxRounds: 12,
    units: units.map((unit, index) => ({
      unit: `crew:${String(index)}`,
      side: 'crew',
      heroDefinition: null,
      displayNameKey: null,
      roleKey: 'battle.role.vanguard',
      roleShortKey: 'battle.role.vanguard.short',
      row: 1,
      column: 1,
      health: 20,
      maxHealth: 20,
      standing: true,
      leftKey: null,
      statuses: [],
      ...unit
    })) as readonly BattleUnitLine[],
    intent: null,
    journal: [],
    effect: null,
    retreat: null,
    outcomeKey: null,
    errorCode: null,
    errorDetail: null
  } as unknown as BattleScreenModel;
}

/**
 * A catalogue of exactly the words these boards need, and loud about any other.
 *
 * Its own small map rather than the shipped catalogue: what this file checks is *which key*
 * the scene asks for, and a key it should not have asked for — the full job, or the key
 * itself printed as if it were a word — has to fail here rather than find a text by accident.
 */
const WORDS: ReadonlyMap<string, string> = new Map([
  ['hero.bram', 'Брам'],
  ['hero.kestrel', 'Кестрел'],
  ['battle.role.vanguard.short', 'Фронт'],
  ['battle.role.rear.short', 'Тыл']
]);

function textOf(key: string): string {
  const text = WORDS.get(key);

  if (text === undefined) {
    throw new Error(`The board asked for '${key}', which it has no business drawing.`);
  }

  return text;
}

/** A man who declared something at another, for the line of intent. */
function intentOf(unit: string, targetUnit: string | null): BattleScreenModel['intent'] {
  return {
    unit,
    displayNameKey: null,
    sideKey: 'battle.field.crew',
    roleKey: 'battle.role.vanguard',
    actionKey: 'battle.action.strike',
    targetUnit,
    targetDisplayNameKey: null,
    targetSideKey: targetUnit === null ? null : 'battle.field.foes',
    targetRoleKey: targetUnit === null ? null : 'battle.role.vanguard',
    reasonKey: 'combat.reason.front_of_the_column',
    contraryToDoctrineKey: null
  } as BattleScreenModel['intent'];
}

/** The shapes of one kind, narrowed to it — so a case can read the fields that kind has. */
function of<K extends BattleShape['kind']>(
  shapes: readonly BattleShape[],
  kind: K
): readonly Extract<BattleShape, { kind: K }>[] {
  return shapes.filter((shape): shape is Extract<BattleShape, { kind: K }> => shape.kind === kind);
}

describe('the two boards', () => {
  it('draws all eighteen cells, occupied or not', () => {
    // §4.5's benefit is *about* the empty cell. A board that drew only the occupied ones
    // would hide the thing the whole formation decision turns on.
    expect(of(describeBattleScene(aBoard([]), 0, textOf).shapes, 'battle-cell')).toHaveLength(18);
  });

  it('puts each side’s front rank facing the other', () => {
    // Both sides' row 1 is the rank that meets the enemy (§4.2). Drawn the same way round,
    // the two front ranks would end up at opposite edges of the screen, and "the front cell
    // of that column" would mean a different cell depending on whose column it was.
    const shapes = describeBattleScene(aBoard([]), 0, textOf).shapes;
    const cells = of(shapes, 'battle-cell');
    const crewFront = cells.find((cell) => cell.id === 'cell:crew:1:1');
    const crewRear = cells.find((cell) => cell.id === 'cell:crew:3:1');
    const foeFront = cells.find((cell) => cell.id === 'cell:foe:1:1');
    const foeRear = cells.find((cell) => cell.id === 'cell:foe:3:1');

    expect(crewFront!.y).toBeGreaterThan(crewRear!.y);
    expect(foeFront!.y).toBeLessThan(foeRear!.y);
  });

  it('keeps the two boards apart, so a cell belongs to one side by looking at it', () => {
    const cells = of(describeBattleScene(aBoard([]), 0, textOf).shapes, 'battle-cell');
    const crewRight = Math.max(...cells.filter((c) => c.side === 'crew').map((c) => c.x + c.width));
    const foeLeft = Math.min(...cells.filter((c) => c.side === 'foe').map((c) => c.x));

    expect(foeLeft).toBeGreaterThan(crewRight);
  });
});

describe('one unit becomes a token, a bar and its marks', () => {
  it('draws a token and a bar for every unit, standing or not', () => {
    const shapes = describeBattleScene(
      aBoard([{ standing: true }, { standing: false, leftKey: 'battle.field.downed', column: 2 }]),
      0,
      textOf
    ).shapes;

    expect(of(shapes, 'battle-token')).toHaveLength(2);
    expect(of(shapes, 'battle-health')).toHaveLength(2);
    // A man who went down leaves a hole in the formation. Removing his token would make
    // "he is down" and "he was never there" the same picture.
    expect(of(shapes, 'battle-token').filter((token) => !token.standing)).toHaveLength(1);
  });

  it('fills the bar by the share of health that is left, and never past either end', () => {
    const shapes = describeBattleScene(
      aBoard([
        { health: 20, maxHealth: 20 },
        { health: 5, maxHealth: 20, column: 2 },
        { health: 0, maxHealth: 20, column: 3 }
      ]),
      0,
      textOf
    ).shapes;

    expect(of(shapes, 'battle-health').map((bar) => bar.filled)).toEqual([1, 0.25, 0]);
  });

  it('draws a mark per status rather than a tint, and never two on one spot', () => {
    // §10.2 п.5: the colour channel already carries the side, and a second meaning on it is
    // the case colour blindness breaks outright.
    const shapes = describeBattleScene(
      aBoard([
        {
          statuses: [
            {
              key: 'battle.status.chilled',
              markKey: 'battle.status.chilled.mark',
              remainingRounds: 1
            },
            {
              key: 'battle.status.pinned',
              markKey: 'battle.status.pinned.mark',
              remainingRounds: 1
            }
          ]
        }
      ]),
      0,
      textOf
    ).shapes;

    const marks = of(shapes, 'battle-status-mark');

    expect(marks).toHaveLength(2);
    expect(new Set(marks.map((mark) => mark.x)).size).toBe(2);
  });
});

describe('every man carries a word on his token (the owner, 2026-09-23)', () => {
  const named = aBoard([
    { unit: 'crew:0', displayNameKey: 'hero.bram', heroDefinition: 'core:bram' as never }
  ]);

  it('gives each token its label as a shape of its own, under an id of its own', () => {
    const shapes = describeBattleScene(named, 0, textOf).shapes;
    const label = of(shapes, 'battle-label');
    const token = of(shapes, 'battle-token')[0]!;

    expect(label.map((one) => one.label)).toEqual(['Брам']);
    expect(label[0]!.id).not.toBe(token.id);
    expect(label[0]!.side).toBe('crew');
  });

  it('labels a man with no name by the short word for his job — not the key, not the full word', () => {
    // In M2 a foe has no name: `displayNameKey` is `null` and the job is all there is. The
    // full word («Столкновение») does not fit a token, and the key printed as a word would
    // put `battle.role.vanguard` on the board — the catalogue above refuses both.
    const label = of(
      describeBattleScene(aBoard([{ unit: 'foe:0', side: 'foe' }]), 0, textOf).shapes,
      'battle-label'
    )[0]!;

    expect(label.label).toBe('Фронт');
    expect(label.side).toBe('foe');
  });

  it('keeps the label on its token, clear of the marks and the bar under it', () => {
    const shapes = describeBattleScene(
      aBoard([
        {
          displayNameKey: 'hero.bram',
          heroDefinition: 'core:bram' as never,
          statuses: [
            {
              key: 'battle.status.chilled',
              markKey: 'battle.status.chilled.mark',
              remainingRounds: 1
            }
          ]
        }
      ]),
      0,
      textOf
    ).shapes;
    const token = of(shapes, 'battle-token')[0]!;
    const label = of(shapes, 'battle-label')[0]!;
    const mark = of(shapes, 'battle-status-mark')[0]!;
    const bar = of(shapes, 'battle-health')[0]!;

    expect(label.x).toBeGreaterThanOrEqual(token.x);
    expect(label.x + label.width).toBeLessThanOrEqual(token.x + token.width);
    expect(label.y).toBeGreaterThanOrEqual(token.y);
    expect(label.y + label.height).toBeLessThanOrEqual(mark.y);
    expect(label.y + label.height).toBeLessThanOrEqual(bar.y);
  });

  it('labels a man who is down: a hole in the line still has a name', () => {
    const shapes = describeBattleScene(
      aBoard([{ standing: false, leftKey: 'battle.field.downed' }]),
      0,
      textOf
    ).shapes;

    expect(of(shapes, 'battle-label')).toHaveLength(1);
  });

  it('stacks two men in one cell rather than drawing one word over the other', () => {
    // Measured, not supposed: in the combat loop's `finished.png` two downed men — Брам and
    // Кестрел — stand in one cell, and the board draws one token over the other. Two labels
    // at one spot would be two correct words painted into one smudge.
    const shapes = describeBattleScene(
      aBoard([
        {
          unit: 'crew:0',
          displayNameKey: 'hero.bram',
          heroDefinition: 'core:bram' as never,
          standing: false,
          leftKey: 'battle.field.downed',
          row: 1,
          column: 2
        },
        {
          unit: 'crew:1',
          displayNameKey: 'hero.kestrel',
          heroDefinition: 'core:kestrel' as never,
          standing: false,
          leftKey: 'battle.field.downed',
          row: 1,
          column: 2
        }
      ]),
      0,
      textOf
    ).shapes;
    const [first, second] = of(shapes, 'battle-label');
    const token = of(shapes, 'battle-token')[0]!;
    const mark = Math.min(...of(shapes, 'battle-health').map((bar) => bar.y));

    expect([first!.label, second!.label]).toEqual(['Брам', 'Кестрел']);
    // Apart vertically, and both still on the token above the bar.
    expect(first!.y + first!.height <= second!.y || second!.y + second!.height <= first!.y).toBe(
      true
    );

    for (const label of [first!, second!]) {
      expect(label.y).toBeGreaterThanOrEqual(token.y);
      expect(label.y + label.height).toBeLessThanOrEqual(mark);
    }
  });
});

describe('the line of intent (COMBAT_SPEC §10.2, DIRECTION §4.4)', () => {
  // The crew's front man, column 1, and the foe's front man, column 1: across the gap.
  const facing = (intent: BattleScreenModel['intent']): BattleScreenModel => ({
    ...aBoard([
      { unit: 'crew:0', side: 'crew' },
      { unit: 'foe:0', side: 'foe' }
    ]),
    intent
  });

  it('joins the man who declared it to the man it is aimed at', () => {
    const shapes = describeBattleScene(facing(intentOf('crew:0', 'foe:0')), 0, textOf).shapes;
    const intent = of(shapes, 'battle-intent');

    expect(intent).toHaveLength(1);
    expect(intent[0]!.actor).toBe('crew:0');
    expect(intent[0]!.target).toBe('foe:0');
  });

  it('runs from the edge of the actor’s token to the edge of the target’s, pointing at him', () => {
    // From edge to edge rather than centre to centre: a line through the middle of a token
    // runs across the word on it, and the arrowhead would sit on the target's own name.
    const shapes = describeBattleScene(facing(intentOf('crew:0', 'foe:0')), 0, textOf).shapes;
    const intent = of(shapes, 'battle-intent')[0]!;
    const tokens = of(shapes, 'battle-token');
    const actor = tokens.find((token) => token.id === 'token:crew:0')!;
    const target = tokens.find((token) => token.id === 'token:foe:0')!;
    const on = (x: number, y: number, box: typeof actor): boolean =>
      x >= box.x - 0.001 &&
      x <= box.x + box.width + 0.001 &&
      y >= box.y - 0.001 &&
      y <= box.y + box.height + 0.001;

    expect(on(intent.fromX, intent.fromY, actor)).toBe(true);
    expect(on(intent.toX, intent.toY, target)).toBe(true);
    // Pointing the right way: the crew stands left of the foe, so the line runs rightwards.
    expect(intent.toX).toBeGreaterThan(intent.fromX);
  });

  it('draws no line for an intent aimed at nobody', () => {
    const shapes = describeBattleScene(facing(intentOf('crew:0', null)), 0, textOf).shapes;

    expect(of(shapes, 'battle-intent')).toHaveLength(0);
  });

  it('draws no line before anybody has declared anything', () => {
    expect(of(describeBattleScene(facing(null), 0, textOf).shapes, 'battle-intent')).toHaveLength(
      0
    );
  });

  it('draws no line to a man the board does not have, rather than to a corner', () => {
    const shapes = describeBattleScene(facing(intentOf('crew:0', 'foe:9')), 0, textOf).shapes;

    expect(of(shapes, 'battle-intent')).toHaveLength(0);
  });
});

describe('the popup number, and what the second input actually reaches', () => {
  const withBlow = (): BattleScreenModel => ({
    ...aBoard([{}]),
    effect: { unit: 'crew:0', amount: 7, healing: false }
  });

  it('shows nothing when nothing has landed', () => {
    expect(of(describeBattleScene(aBoard([{}]), 0, textOf).shapes, 'battle-popup')).toHaveLength(0);
  });

  it('draws the number over the man it happened to, not over the man who did it', () => {
    // The journal names the *actor* for a blow (`unitNamedBy`), so a scene reading it put
    // the number over whoever struck. Two men, and the effect names the second: the popup
    // must be over the second one's cell.
    const board: BattleScreenModel = {
      ...aBoard([
        { unit: 'crew:0', column: 1 },
        { unit: 'crew:1', column: 3 }
      ]),
      effect: { unit: 'crew:1', amount: 4, healing: false }
    };

    const popup = of(describeBattleScene(board, 0, textOf).shapes, 'battle-popup')[0]!;
    const struck = of(describeBattleScene(board, 0, textOf).shapes, 'battle-token').find(
      (token) => token.id === 'token:crew:1'
    )!;

    expect(popup.id).toBe('popup:crew:1');
    expect(popup.x).toBeGreaterThan(struck.x);
    expect(popup.x).toBeLessThan(struck.x + struck.width + 40);
  });

  it('shows the last number that landed, over the man it happened to', () => {
    const popup = of(describeBattleScene(withBlow(), 0, textOf).shapes, 'battle-popup');

    expect(popup).toHaveLength(1);
    expect(popup[0]!.amount).toBe(7);
    expect(popup[0]!.healing).toBe(false);
  });

  it('rises and ages with the phase, which is the whole of what `advance` moves', () => {
    // Without this the scene would draw one frame per event and §10.2 п.1's second input
    // would be decoration with a comment over it.
    const early = of(describeBattleScene(withBlow(), 0, textOf).shapes, 'battle-popup')[0]!;
    const late = of(describeBattleScene(withBlow(), 1, textOf).shapes, 'battle-popup')[0]!;

    expect(late.y).toBeLessThan(early.y);
    expect(late.age).toBeGreaterThan(early.age);
  });

  it('clamps a phase outside its own range rather than drawing a number off the board', () => {
    const below = of(describeBattleScene(withBlow(), -5, textOf).shapes, 'battle-popup')[0]!;
    const above = of(describeBattleScene(withBlow(), 9, textOf).shapes, 'battle-popup')[0]!;

    expect(below.age).toBe(0);
    expect(above.age).toBe(1);
  });
});

describe('the description is data and nothing else', () => {
  it('is a function of the model and the phase alone', () => {
    const model = aBoard([{}, { column: 2 }]);

    expect(describeBattleScene(model, 0.5, textOf)).toEqual(
      describeBattleScene(model, 0.5, textOf)
    );
  });

  it('gives every shape an id nothing else has, so a renderer can label them', () => {
    const shapes = describeBattleScene(aBoard([{}, { column: 2 }]), 0, textOf).shapes;

    expect(new Set(shapes.map((shape) => shape.id)).size).toBe(shapes.length);
  });
});
