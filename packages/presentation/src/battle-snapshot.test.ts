import { describe, expect, it } from 'vitest';

import { afterActionScreenModel } from './after-action-screen-model.ts';
import { battleScreenModel } from './battle-screen-model.ts';
import { BattleFieldKeys } from './keys.ts';
import { expectedSnapshot } from './rendered-ui-snapshot.ts';
import type { ScreenModel } from './screen-model.ts';

import { fought } from './testing/fought.ts';

/**
 * The texts a battle screen and a debrief owe for the two things the owner's first play
 * could not read: whom a line is about besides its subject, and where a man stands.
 *
 * Held here rather than in the browser suite because the browser suite compares the page
 * against *this* projection — so a projection that forgot the target would agree with a page
 * that forgot it too, and both would be green. What these assert is that the projection says
 * the thing at all, in the order a reader parses it.
 */

/**
 * A catalogue answering every key the snapshot asks for, with the key itself marked as resolved.
 *
 * Found by asking: the snapshot is run against a catalogue that has nothing in it, and the key
 * it refuses on is read out of its error. That couples this helper to the wording of
 * `resolveText`'s message — deliberately, and the coupling fails loud rather than green: a
 * reworded message leaves `match` empty and the error is rethrown, so the test breaks on its
 * first line instead of passing on an empty catalogue.
 */
function everyKeyOf(model: ScreenModel): ReadonlyMap<string, string> {
  const keys: string[] = [];
  const catalogue = () => new Map(keys.map((key) => [key, `text(${key})`]));

  for (;;) {
    try {
      expectedSnapshot(model, catalogue());
      return catalogue();
    } catch (cause) {
      const match = /key '([^']+)'/u.exec(cause instanceof Error ? cause.message : '');

      if (match?.[1] === undefined || keys.includes(match[1])) {
        throw cause;
      }

      keys.push(match[1]);
    }
  }
}

/** Where `run` appears in `texts` as a contiguous run, or `-1`. */
function indexOfRun(texts: readonly string[], run: readonly string[]): number {
  for (let start = 0; start + run.length <= texts.length; start += 1) {
    if (run.every((text, offset) => texts[start + offset] === text)) {
      return start;
    }
  }

  return -1;
}

const { state, contractId } = fought();
const events = state.contracts.get(contractId)?.resolution?.battle?.events ?? [];
const watched = battleScreenModel(state, contractId, { applied: events.length });
const debrief = afterActionScreenModel(state, contractId);

/** The words a man is named by, as the projection resolves them. */
const who = (
  displayNameKey: string | null,
  sideKey: string | null,
  roleKey: string | null
): readonly string[] =>
  displayNameKey !== null
    ? [`text(${displayNameKey})`]
    : sideKey === null || roleKey === null
      ? []
      : [`text(${sideKey})`, `text(${roleKey})`];

describe('the battle screen’s journal, as texts', () => {
  const texts = expectedSnapshot(watched, everyKeyOf(watched));

  it('prints subject, the word between the two men, then the target, then the number', () => {
    const blow = watched.journal.find((line) => line.key === 'battle.event.damage_dealt');

    expect(blow, 'a fight in which nobody was struck proves nothing here').toBeDefined();

    const run = [
      `text(${blow!.key})`,
      ...who(blow!.displayNameKey, blow!.sideKey, blow!.roleKey),
      `text(${String(blow!.linkKey)})`,
      ...who(blow!.targetDisplayNameKey, blow!.targetSideKey, blow!.targetRoleKey),
      String(blow!.amount)
    ];

    expect(indexOfRun(texts, run), run.join(' | ')).toBeGreaterThanOrEqual(0);
  });

  it('prints the link and the target after the detail, on a line that has both', () => {
    // An intent: the act is the detail, and the man it is aimed at comes after it — the same
    // order the intent line above the journal reads in.
    const aimed = watched.journal.find(
      (line) => line.key === 'battle.event.intent_declared' && line.linkKey !== null
    );

    expect(aimed, 'a fight in which nobody aimed at anybody proves nothing here').toBeDefined();

    const run = [
      `text(${aimed!.key})`,
      ...who(aimed!.displayNameKey, aimed!.sideKey, aimed!.roleKey),
      `text(${String(aimed!.detailKey)})`,
      `text(${String(aimed!.linkKey)})`,
      ...who(aimed!.targetDisplayNameKey, aimed!.targetSideKey, aimed!.targetRoleKey)
    ];

    expect(indexOfRun(texts, run), run.join(' | ')).toBeGreaterThanOrEqual(0);
  });

  it('prints the intent line above the journal with the same word between the two men', () => {
    // One event, one format. The last intent is printed twice on a finished screen — as the
    // line above the journal and as the journal's own `intent_declared` line — and review
    // found the first without the arrow the second has. A reader given `Выстрел Доран` on one
    // line and `Выстрел → Доран` on the next is being taught two grammars for one thing.
    const intent = watched.intent;

    expect(intent, 'a fight in which nobody declared anything proves nothing here').not.toBeNull();
    expect(intent!.targetSideKey, 'the last intent must be aimed at somebody').not.toBeNull();

    const run = [
      `text(${BattleFieldKeys.Intent})`,
      ...who(intent!.displayNameKey, intent!.sideKey, intent!.roleKey),
      `text(${intent!.actionKey})`,
      `text(${BattleFieldKeys.To})`,
      ...who(intent!.targetDisplayNameKey, intent!.targetSideKey, intent!.targetRoleKey),
      `text(${intent!.reasonKey})`
    ];

    expect(indexOfRun(texts, run), run.join(' | ')).toBeGreaterThanOrEqual(0);
  });

  it('points back on a line whose own word is about the man who was acted on', () => {
    const fell = watched.journal.find((line) => line.key === 'battle.event.unit_downed');

    expect(fell, 'a fight in which nobody went down proves nothing here').toBeDefined();

    const run = [
      `text(${fell!.key})`,
      ...who(fell!.displayNameKey, fell!.sideKey, fell!.roleKey),
      `text(${BattleFieldKeys.From})`,
      ...who(fell!.targetDisplayNameKey, fell!.targetSideKey, fell!.targetRoleKey)
    ];

    expect(indexOfRun(texts, run), run.join(' | ')).toBeGreaterThanOrEqual(0);
  });

  it('prints no link on a line about nobody', () => {
    const opened = watched.journal.find((line) => line.key === 'battle.event.round_started');

    expect(opened).toBeDefined();

    const at = texts.indexOf(`text(${opened!.key})`);

    expect(at).toBeGreaterThanOrEqual(0);
    expect(
      [BattleFieldKeys.To, BattleFieldKeys.From, BattleFieldKeys.With].map((key) => `text(${key})`)
    ).not.toContain(texts[at + 1]);
  });
});

describe('the board list, as texts', () => {
  const texts = expectedSnapshot(watched, everyKeyOf(watched));

  it('names every man’s cell, row then column, between his job and his health', () => {
    // `COMBAT_SPEC` §3.1: a cell is `(row, column)`, row 1 the rank that meets the enemy. The
    // list is the board in words (`GDD` §16.6), and until now it had no cell in it — a
    // reader could not say where anybody stood without the canvas.
    for (const unit of watched.units) {
      const run = [
        `text(${unit.roleKey})`,
        `text(${BattleFieldKeys.Row})`,
        String(unit.row),
        `text(${BattleFieldKeys.Column})`,
        String(unit.column),
        `text(${BattleFieldKeys.Health})`,
        String(unit.health)
      ];

      expect(indexOfRun(texts, run), run.join(' | ')).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('the debrief’s feed, as texts', () => {
  it('prints the same words for the second man that the battle screen prints', () => {
    // One journal, two readers. The whole of the battle screen's journal texts must appear
    // inside the debrief's, in order: the debrief shows the same list, all at once.
    const journal = expectedSnapshot(watched, everyKeyOf(watched));
    const feed = expectedSnapshot(debrief, everyKeyOf(debrief));

    const from = journal.indexOf(`text(${BattleFieldKeys.Journal})`) + 1;
    const to = journal.indexOf(`text(${watched.controls.pauseKey})`);
    const lines = journal.slice(from, to);

    expect(lines.length).toBeGreaterThan(0);
    expect(lines).toContain(`text(${BattleFieldKeys.To})`);
    expect(indexOfRun(feed, lines)).toBeGreaterThanOrEqual(0);
  });
});
