import {
  MAX_ROUNDS,
  unitNamedBy,
  type BattleRecord,
  type BattleSide,
  type BattleUnitId,
  type CanonicalValue,
  type ContentId,
  type GameState,
  type HeroId
} from '@oath-and-coin/simulation';

import { boardAfter, type BattleBoardUnit } from './battle-board.ts';
import { battleAmount, battleDetailKey, battleEventKey } from './battle-journal.ts';
import {
  BATTLE_TITLE_KEY,
  BattleControlKeys,
  battleOutcomeKey,
  battleStatusKey,
  battleStatusMarkKey,
  BattleFieldKeys,
  combatActionKey,
  combatRoleKey,
  contractDisplayNameKey,
  doctrineKey
} from './keys.ts';
import { ScreenKind } from './screen-kind.ts';
import { ScreenState } from './screen-state.ts';

/**
 * What a player watching a fight sees (`COMBAT_SPEC` §10.2).
 *
 * **A function of the record and one number.** The battle is over before the first frame is
 * drawn — the resolver ran it to the end and the campaign stored it — so the screen is not a
 * simulation with a camera on it but a *position* in a finished list of events. That is
 * `ADR-002`'s line drawn where it can be checked: the discrete model is the record, the
 * continuous presentation is everything downstream of {@link BattleScreenModel}, and the only
 * thing crossing between them is an index.
 *
 * **The retreat signal is the exception, and it is an input rather than an interruption**
 * (§6.3, as amended 2026-08-30). Pressing the button does not reach into a running battle; it
 * re-runs `resolveContract` with the round filled in, and the prefix the player has already
 * watched is byte-identical by §9's determinism. So this model carries which rounds the
 * button is live for and what it will cost, and the command is the host's business.
 *
 * **Five states, and each is a real position rather than a mood.** `Loading` before there is
 * a record; `Empty` on a contract that never went to a fight; `Error` when the run never got
 * there; `Incomplete` while the feed is somewhere inside the battle; `Normal` once it has
 * reached the end and the outcome is on the screen.
 */

/** A status on a unit — the word, the mark, and how long it has left (`COMBAT_SPEC` §3.5). */
export interface BattleStatusLine {
  readonly key: string;
  /**
   * The glyph beside the word, so the tint is never the only thing carrying it.
   *
   * §10.2 п.5, bought by the spike: the scene's colour channel already carries the *side*,
   * and a second meaning on the same channel is the case colour blindness breaks outright
   * (`GDD` §16.6).
   */
  readonly markKey: string;
  readonly remainingRounds: number;
}

/** One token on the board. */
export interface BattleUnitLine {
  readonly unit: BattleUnitId;
  readonly side: BattleSide;
  /** The hero this is, or `null` for a foe or a ward — which is what the record says. */
  readonly heroDefinition: ContentId | null;
  /** `null` together with {@link heroDefinition}: a foe has a role, not a name. */
  readonly displayNameKey: string | null;
  readonly roleKey: string;
  readonly row: number;
  readonly column: number;
  readonly health: number;
  readonly maxHealth: number;
  readonly standing: boolean;
  /** Why he is off the board — knocked down or walked off — or `null` while he is on it. */
  readonly leftKey: string | null;
  readonly statuses: readonly BattleStatusLine[];
}

/**
 * The line of intent with its cause (`COMBAT_SPEC` §10.2, `DIRECTION` §4.4).
 *
 * The attraction the whole screen is built around, and the cheapest thing on it: the reason
 * is already a localization key on the event, so the line costs a lookup and no invention.
 * `contraryToDoctrineKey` is the moment `DIRECTION` §4.8 is about — a man doing something the
 * order did not ask for — and it is a separate field rather than a different reason so that a
 * screen cannot show the break without showing what was broken.
 */
export interface BattleIntentLine {
  readonly unit: BattleUnitId;
  readonly displayNameKey: string | null;
  readonly roleKey: string;
  readonly actionKey: string;
  readonly targetUnit: BattleUnitId | null;
  readonly targetDisplayNameKey: string | null;
  readonly targetRoleKey: string | null;
  readonly reasonKey: string;
  readonly contraryToDoctrineKey: string | null;
}

/**
 * One line of the battle's own journal — the text dub of every visual signal (`GDD` §16.6).
 *
 * `amount` is a fact that happened and stays a number (`DIRECTION` §4.7); everything else is
 * a key. `detailKey` is whatever the line's own kind needs beside the actor: a status, a
 * doctrine, an outcome, a reason.
 */
export interface BattleJournalLine {
  readonly key: string;
  readonly unit: BattleUnitId | null;
  readonly displayNameKey: string | null;
  readonly detailKey: string | null;
  readonly amount: number | null;
  readonly round: number;
}

/**
 * The one lever the player has, and what it costs (`DEC-005`, `COMBAT_SPEC` §7.4).
 *
 * The cost is a sentence and not a figure. A withdrawal costs one `Retreat` to every hero who
 * moved, and how much that is worth to a man is exactly the sort of number `DEC-006` keeps
 * off a screen — the debrief prints what it actually cost, afterwards, as a fact.
 */
export interface BattleRetreatLine {
  /** The round the button would signal for, or `null` when it cannot be pressed. */
  readonly atRound: number | null;
  readonly labelKey: string;
  readonly costKey: string;
  /** The round a signal was already given at, or `null`. */
  readonly givenAtRound: number | null;
}

export interface BattleScreenModel {
  readonly screen: typeof ScreenKind.Battle;
  readonly state: ScreenState;
  readonly titleKey: string;
  readonly contractDefinition: ContentId | null;
  readonly contractDisplayNameKey: string | null;
  readonly doctrineKey: string | null;
  /** The round the feed has reached; `0` before the battle has started. */
  readonly round: number;
  /** The ceiling a battle stops at, so a bar has something to be a fraction of (§6.1). */
  readonly maxRounds: number;
  readonly units: readonly BattleUnitLine[];
  /** The last intent the feed applied, or `null` before there has been one. */
  readonly intent: BattleIntentLine | null;
  readonly journal: readonly BattleJournalLine[];
  readonly retreat: BattleRetreatLine | null;
  /** `null` until the feed has reached the end of the battle. */
  readonly outcomeKey: string | null;
  readonly errorCode: string | null;
  readonly errorDetail: string | null;
}

export type BattleScreenContent = Omit<BattleScreenModel, 'screen'>;

/**
 * Builds a model, refusing every combination that would make it lie.
 *
 * The same gate the other three screens have, for the reason theirs record: a spread walks
 * around a factory, so `{ ...BATTLE_LOADING_SCREEN, state: 'Normal' }` typechecks and would
 * otherwise be hashed, rendered and published as a battle nobody fought.
 */
export function createBattleScreenModel(model: BattleScreenContent): BattleScreenModel {
  if (model.errorDetail !== null && model.errorCode === null) {
    throw new Error(
      'errorDetail must not be set without errorCode: a detail with nothing to detail is not ' +
        'an error, it is an orphaned string.'
    );
  }

  switch (model.state) {
    case ScreenState.Error:
      if (model.errorCode === null) {
        throw new Error('errorCode must be set when state is Error.');
      }

      requireNoBattle(model);
      break;

    case ScreenState.Loading:
    case ScreenState.Empty:
      if (model.errorCode !== null) {
        throw new Error(`errorCode must be null when state is ${model.state}.`);
      }

      requireNoBattle(model);
      break;

    case ScreenState.Incomplete:
    case ScreenState.Normal:
      if (model.errorCode !== null) {
        throw new Error(`errorCode must be null when state is ${model.state}.`);
      }

      if (
        model.contractDefinition === null ||
        model.contractDisplayNameKey === null ||
        model.doctrineKey === null
      ) {
        throw new Error(
          `contractDefinition, contractDisplayNameKey and doctrineKey must all be set when ` +
            `state is ${model.state}: a battle screen names the contract it is about and the ` +
            'order the crew went out under, or it is a board with tokens on it.'
        );
      }

      if (model.units.length === 0) {
        throw new Error(
          `A ${model.state} battle screen must have somebody on the board: a fight with no ` +
            'units is not a fight this screen can be showing.'
        );
      }

      // The whole point of the split between the two: `Normal` is "the feed has arrived",
      // and the outcome is the thing that has arrived with it.
      if ((model.state === ScreenState.Normal) !== (model.outcomeKey !== null)) {
        throw new Error(
          'outcomeKey is set exactly when the state is Normal: a battle still playing has no ' +
            'outcome to show, and one that has finished has nothing else to be.'
        );
      }

      break;

    default:
      throw new Error(`Unknown screen state '${String(model.state)}'.`);
  }

  for (const unit of model.units) {
    if ((unit.heroDefinition === null) !== (unit.displayNameKey === null)) {
      throw new Error(
        `Unit '${unit.unit}' carries half a hero: a unit names somebody under both an id and a ` +
          'key, or under neither. One without the other is a token the screen cannot label ' +
          'without showing the id itself.'
      );
    }

    if (unit.standing === (unit.leftKey !== null)) {
      throw new Error(
        `Unit '${unit.unit}' is both standing and gone, or neither: a unit off the board says ` +
          'how it left, and a unit on it has nothing to say about leaving.'
      );
    }
  }

  return { ...model, screen: ScreenKind.Battle };
}

function requireNoBattle(model: BattleScreenContent): void {
  if (
    model.contractDefinition !== null ||
    model.contractDisplayNameKey !== null ||
    model.doctrineKey !== null ||
    model.units.length > 0 ||
    model.intent !== null ||
    model.journal.length > 0 ||
    model.retreat !== null ||
    model.outcomeKey !== null ||
    model.round !== 0
  ) {
    throw new Error(
      `A ${model.state} battle screen must carry no battle at all: there is nothing to watch, ` +
        'so a board, a journal or an outcome on it belongs to some other fight.'
    );
  }
}

const NOTHING_TO_WATCH = {
  titleKey: BATTLE_TITLE_KEY,
  contractDefinition: null,
  contractDisplayNameKey: null,
  doctrineKey: null,
  round: 0,
  maxRounds: MAX_ROUNDS,
  units: [],
  intent: null,
  journal: [],
  retreat: null,
  outcomeKey: null
} as const;

/** The screen before there is a record to play — the one state the factory never produces. */
export const BATTLE_LOADING_SCREEN: BattleScreenModel = createBattleScreenModel({
  ...NOTHING_TO_WATCH,
  state: ScreenState.Loading,
  errorCode: null,
  errorDetail: null
});

/** The screen for a run that never reached a campaign at all. */
export function battleFailedScreen(errorCode: string, errorDetail: string): BattleScreenModel {
  if (errorCode.length === 0) {
    throw new Error('errorCode must not be empty: an error screen has to name what failed.');
  }

  if (errorDetail.length === 0) {
    throw new Error('errorDetail must not be empty: an error nobody can act on is not a report.');
  }

  return createBattleScreenModel({
    ...NOTHING_TO_WATCH,
    state: ScreenState.Error,
    errorCode,
    errorDetail
  });
}

/** Where the playback has got to, and which battle it is playing. */
export interface BattleView {
  /** How many of the record's events have been applied. */
  readonly applied: number;
  /**
   * The battle to play, when it is not the one the campaign has already stored.
   *
   * **An input rather than a lookup, because the screen shows a fight before the campaign
   * has it** (`COMBAT_SPEC` §6.3). The resolver runs the battle; the player watches it; only
   * then does `resolveContract` commit an outcome — which is the only arrangement in which
   * the retreat button can do anything, since a signal given during a fight that has already
   * been applied would be a signal about the past. Pressing it re-runs the resolver with the
   * round filled in, and §9's determinism makes everything before that round identical.
   *
   * Omitted once the contract is resolved, and then the stored record is the one played: a
   * debrief's replay is about the battle that actually happened.
   */
  readonly record?: BattleRecord;
}

/**
 * The battle screen for `contractId` at the position `view` names.
 *
 * @throws when `contractId` names a contract the campaign does not carry — a routing bug,
 * and the same refusal the other factories make.
 */
export function battleScreenModel(
  state: GameState,
  contractId: ContentId,
  view: BattleView
): BattleScreenModel {
  const contract = state.contracts.get(contractId);

  if (contract === undefined) {
    throw new Error(
      `A battle screen was asked for contract '${contractId}', but the campaign it was built ` +
        'from has no such contract — a routing bug, not a contract with no fight.'
    );
  }

  const record = view.record ?? contract.resolution?.battle ?? null;

  if (record === null) {
    // Two different absences and one screen: a contract nobody has resolved yet, and one the
    // abstract resolver answered because it never goes to a fight (`ADR-016` §5). Both are
    // "there is no battle here", and a screen that told them apart would be inviting the
    // player to wait for a fight that is not coming.
    return createBattleScreenModel({
      ...NOTHING_TO_WATCH,
      state: ScreenState.Empty,
      errorCode: null,
      errorDetail: null
    });
  }

  const applied = Math.min(Math.max(0, view.applied), record.events.length);
  const board = boardAfter(record, applied);
  const finished = applied >= record.events.length;
  const names = namesOf(state);

  return createBattleScreenModel({
    state: finished ? ScreenState.Normal : ScreenState.Incomplete,
    titleKey: BATTLE_TITLE_KEY,
    contractDefinition: contract.id,
    contractDisplayNameKey: contractDisplayNameKey(contract.id),
    doctrineKey: doctrineKey(record.initial.doctrine),
    round: board.round,
    maxRounds: MAX_ROUNDS,
    units: board.units.map((unit) => unitLineOf(unit, names)),
    intent: lastIntentOf(record, applied, names),
    journal: journalOf(record, applied, names),
    retreat: retreatOf(record, board.round, finished),
    outcomeKey: finished ? battleOutcomeKey(record.outcome) : null,
    errorCode: null,
    errorDetail: null
  });
}

/** Which hero each battle id belongs to, and what a screen may call him (`TDD` §11.1). */
interface Names {
  readonly definitionOf: (hero: HeroId) => ContentId | null;
  readonly displayNameKeyOf: (hero: HeroId) => string | null;
}

function namesOf(state: GameState): Names {
  const heroes = [...state.heroes.values()];
  const definitions = new Map(heroes.map((hero) => [hero.id, hero.definition]));
  const keys = new Map(heroes.map((hero) => [hero.id, hero.displayNameKey]));

  return {
    definitionOf: (hero) => definitions.get(hero) ?? null,
    displayNameKeyOf: (hero) => keys.get(hero) ?? null
  };
}

function unitLineOf(unit: BattleBoardUnit, names: Names): BattleUnitLine {
  const definition = unit.hero === null ? null : names.definitionOf(unit.hero);
  const displayNameKey = unit.hero === null ? null : names.displayNameKeyOf(unit.hero);

  return {
    unit: unit.unit,
    side: unit.side,
    // Both or neither, which the gate then checks: a hero the campaign has forgotten would
    // otherwise arrive with an id and no name, and the screen would print the id.
    heroDefinition: displayNameKey === null ? null : definition,
    displayNameKey: definition === null ? null : displayNameKey,
    roleKey: combatRoleKey(unit.role),
    row: unit.cell.row,
    column: unit.cell.column,
    health: unit.health,
    maxHealth: unit.maxHealth,
    standing: unit.standing,
    leftKey: leftKeyOf(unit.left),
    statuses: unit.statuses.map((status) => ({
      key: battleStatusKey(status.status),
      markKey: battleStatusMarkKey(status.status),
      remainingRounds: status.remainingRounds
    }))
  };
}

const leftKeyOf = (left: BattleBoardUnit['left']): string | null => {
  switch (left) {
    case 'downed':
      return BattleFieldKeys.Downed;
    case 'withdrew':
      return BattleFieldKeys.Withdrew;
    case null:
      return null;
  }
};

/**
 * The last thing anybody declared, at this position.
 *
 * Searched backwards from where the feed is rather than tracked forwards, for the reason the
 * board is refolded rather than advanced: one pass over a list of under a hundred is free,
 * and a tracked value is a second place the position can be wrong.
 */
function lastIntentOf(
  record: BattleRecord,
  applied: number,
  names: Names
): BattleIntentLine | null {
  for (let index = applied - 1; index >= 0; index -= 1) {
    const event = record.events[index];

    if (event?.kind !== 'intent_declared') {
      continue;
    }

    const actor = record.initial.units.find((unit) => unit.id === event.actor);
    const target =
      event.target === null
        ? null
        : (record.initial.units.find((unit) => unit.id === event.target) ?? null);

    if (actor === undefined) {
      return null;
    }

    return {
      unit: actor.id,
      displayNameKey: actor.hero === null ? null : names.displayNameKeyOf(actor.hero),
      roleKey: combatRoleKey(actor.role),
      actionKey: combatActionKey(event.action),
      targetUnit: target?.id ?? null,
      targetDisplayNameKey: target?.hero == null ? null : names.displayNameKeyOf(target.hero),
      targetRoleKey: target === undefined || target === null ? null : combatRoleKey(target.role),
      reasonKey: event.reason,
      contraryToDoctrineKey: event.contraryTo === null ? null : doctrineKey(event.contraryTo)
    };
  }

  return null;
}

/**
 * Every event applied so far, as a line apiece, in the order the battle raised them.
 *
 * **The whole log, not a window on it.** §10.2 asks for a journal because the tint and the
 * flash are not enough on their own (`GDD` §16.6), and a journal that dropped its head would
 * be a text dub of only the last few seconds. A battle is under a hundred lines; the debrief
 * shows the same list once the fight is over (§10.3).
 */
function journalOf(
  record: BattleRecord,
  applied: number,
  names: Names
): readonly BattleJournalLine[] {
  const lines: BattleJournalLine[] = [];
  let round = record.initial.round;

  record.events.slice(0, applied).forEach((event) => {
    if (event.kind === 'round_started' || event.kind === 'round_ended') {
      round = event.round;
    }

    const unit = unitNamedBy(event);
    const hero = unit === null ? null : record.initial.units.find((one) => one.id === unit)?.hero;

    lines.push({
      key: battleEventKey(event),
      unit,
      displayNameKey: hero === null || hero === undefined ? null : names.displayNameKeyOf(hero),
      detailKey: battleDetailKey(event),
      amount: battleAmount(event),
      round
    });
  });

  return lines;
}

/**
 * The button, and whether it can be pressed from where the feed is standing.
 *
 * Live only while the fight is still running and only from round one onward: a signal at
 * round nought is a signal given before the battle began, which `resolveContract` refuses by
 * name (§11), and a signal after the last event is a signal about a fight that is over.
 */
function retreatOf(
  record: BattleRecord,
  round: number,
  finished: boolean
): BattleRetreatLine | null {
  const given = record.retreatSignalledAtRound;

  if (given !== null) {
    return {
      atRound: null,
      labelKey: BattleControlKeys.RetreatGiven,
      costKey: BattleControlKeys.RetreatCost,
      givenAtRound: given
    };
  }

  if (finished || round < 1) {
    return {
      atRound: null,
      labelKey: BattleControlKeys.RetreatUnavailable,
      costKey: BattleControlKeys.RetreatCost,
      givenAtRound: null
    };
  }

  return {
    atRound: round,
    labelKey: BattleControlKeys.Retreat,
    costKey: BattleControlKeys.RetreatCost,
    givenAtRound: null
  };
}

/** The canonical projection the read-model hash is taken over. */
export function describeBattleReadModel(model: BattleScreenModel): CanonicalValue {
  const validated = createBattleScreenModel(model);

  return {
    screen: validated.screen,
    state: validated.state,
    title_key: validated.titleKey,
    error_code: validated.errorCode,
    contract_definition: validated.contractDefinition,
    contract_display_name_key: validated.contractDisplayNameKey,
    doctrine_key: validated.doctrineKey,
    round: validated.round,
    max_rounds: validated.maxRounds,
    units: validated.units.map((unit) => ({
      unit: unit.unit,
      side: unit.side,
      hero_definition: unit.heroDefinition,
      hero_display_name_key: unit.displayNameKey,
      role_key: unit.roleKey,
      row: unit.row,
      column: unit.column,
      health: unit.health,
      max_health: unit.maxHealth,
      standing: unit.standing,
      left_key: unit.leftKey,
      statuses: unit.statuses.map((status) => ({
        key: status.key,
        mark_key: status.markKey,
        remaining_rounds: status.remainingRounds
      }))
    })),
    intent:
      validated.intent === null
        ? null
        : {
            unit: validated.intent.unit,
            hero_display_name_key: validated.intent.displayNameKey,
            role_key: validated.intent.roleKey,
            action_key: validated.intent.actionKey,
            target_unit: validated.intent.targetUnit,
            target_display_name_key: validated.intent.targetDisplayNameKey,
            target_role_key: validated.intent.targetRoleKey,
            reason_key: validated.intent.reasonKey,
            contrary_to_doctrine_key: validated.intent.contraryToDoctrineKey
          },
    journal: validated.journal.map((line) => ({
      key: line.key,
      unit: line.unit,
      hero_display_name_key: line.displayNameKey,
      detail_key: line.detailKey,
      amount: line.amount,
      round: line.round
    })),
    retreat:
      validated.retreat === null
        ? null
        : {
            at_round: validated.retreat.atRound,
            label_key: validated.retreat.labelKey,
            cost_key: validated.retreat.costKey,
            given_at_round: validated.retreat.givenAtRound
          },
    outcome_key: validated.outcomeKey
  };
}
