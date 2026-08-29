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
    retreat: null,
    outcomeKey: null,
    errorCode: null,
    errorDetail: null
  } as unknown as BattleScreenModel;
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
    expect(of(describeBattleScene(aBoard([]), 0).shapes, 'battle-cell')).toHaveLength(18);
  });

  it('puts each side’s front rank facing the other', () => {
    // Both sides' row 1 is the rank that meets the enemy (§4.2). Drawn the same way round,
    // the two front ranks would end up at opposite edges of the screen, and "the front cell
    // of that column" would mean a different cell depending on whose column it was.
    const shapes = describeBattleScene(aBoard([]), 0).shapes;
    const cells = of(shapes, 'battle-cell');
    const crewFront = cells.find((cell) => cell.id === 'cell:crew:1:1');
    const crewRear = cells.find((cell) => cell.id === 'cell:crew:3:1');
    const foeFront = cells.find((cell) => cell.id === 'cell:foe:1:1');
    const foeRear = cells.find((cell) => cell.id === 'cell:foe:3:1');

    expect(crewFront!.y).toBeGreaterThan(crewRear!.y);
    expect(foeFront!.y).toBeLessThan(foeRear!.y);
  });

  it('keeps the two boards apart, so a cell belongs to one side by looking at it', () => {
    const cells = of(describeBattleScene(aBoard([]), 0).shapes, 'battle-cell');
    const crewRight = Math.max(...cells.filter((c) => c.side === 'crew').map((c) => c.x + c.width));
    const foeLeft = Math.min(...cells.filter((c) => c.side === 'foe').map((c) => c.x));

    expect(foeLeft).toBeGreaterThan(crewRight);
  });
});

describe('one unit becomes a token, a bar and its marks', () => {
  it('draws a token and a bar for every unit, standing or not', () => {
    const shapes = describeBattleScene(
      aBoard([{ standing: true }, { standing: false, leftKey: 'battle.field.downed', column: 2 }]),
      0
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
      0
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
      0
    ).shapes;

    const marks = of(shapes, 'battle-status-mark');

    expect(marks).toHaveLength(2);
    expect(new Set(marks.map((mark) => mark.x)).size).toBe(2);
  });
});

describe('the popup number, and what the second input actually reaches', () => {
  const withBlow = (): BattleScreenModel => ({
    ...aBoard([{}]),
    journal: [
      {
        key: 'battle.event.damage_dealt',
        unit: 'crew:0',
        displayNameKey: null,
        detailKey: null,
        amount: 7,
        round: 1
      }
    ]
  });

  it('shows nothing when nothing has landed', () => {
    expect(of(describeBattleScene(aBoard([{}]), 0).shapes, 'battle-popup')).toHaveLength(0);
  });

  it('shows the last number the journal carried, over the man it happened to', () => {
    const popup = of(describeBattleScene(withBlow(), 0).shapes, 'battle-popup');

    expect(popup).toHaveLength(1);
    expect(popup[0]!.amount).toBe(7);
    expect(popup[0]!.healing).toBe(false);
  });

  it('rises and ages with the phase, which is the whole of what `advance` moves', () => {
    // Without this the scene would draw one frame per event and §10.2 п.1's second input
    // would be decoration with a comment over it.
    const early = of(describeBattleScene(withBlow(), 0).shapes, 'battle-popup')[0]!;
    const late = of(describeBattleScene(withBlow(), 1).shapes, 'battle-popup')[0]!;

    expect(late.y).toBeLessThan(early.y);
    expect(late.age).toBeGreaterThan(early.age);
  });

  it('clamps a phase outside its own range rather than drawing a number off the board', () => {
    const below = of(describeBattleScene(withBlow(), -5).shapes, 'battle-popup')[0]!;
    const above = of(describeBattleScene(withBlow(), 9).shapes, 'battle-popup')[0]!;

    expect(below.age).toBe(0);
    expect(above.age).toBe(1);
  });
});

describe('the description is data and nothing else', () => {
  it('is a function of the model and the phase alone', () => {
    const model = aBoard([{}, { column: 2 }]);

    expect(describeBattleScene(model, 0.5)).toEqual(describeBattleScene(model, 0.5));
  });

  it('gives every shape an id nothing else has, so a renderer can label them', () => {
    const shapes = describeBattleScene(aBoard([{}, { column: 2 }]), 0).shapes;

    expect(new Set(shapes.map((shape) => shape.id)).size).toBe(shapes.length);
  });
});
