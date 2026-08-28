import {
  ContractBoardFieldKeys,
  FieldKeys,
  ScreenState,
  TreasuryFieldKeys,
  contractAvailabilityKey,
  contractBoardStateKey,
  errorKey,
  type ContractBoardRow,
  type ContractBoardScreenModel
} from '@oath-and-coin/presentation';

import type { SessionController } from '@oath-and-coin/application';

import { useText } from '../../text.tsx';

import { Captioned, KeyList, Label } from '../labels.tsx';

/**
 * The board the loop comes back to: every contract of the campaign, how far each has got,
 * and the way into the next one (`RESOLUTION_SPEC` §6.4).
 *
 * **This screen decides nothing**, the same rule the other two are held to. Every field the
 * model carries becomes at most one label, in a fixed order; the branches are on
 * {@link ContractBoardScreenModel.state} deciding which blocks exist at all, on a field being
 * `null` (the error code, a row's target screen) and on a list being empty. Never on what is
 * *in* one — in particular never on which of the four words a row's `availability` is. Where
 * a contract belongs is `RESOLUTION_SPEC` §6.4's table, the model answers it as
 * {@link ContractBoardRow.opensScreen}, and this component passes that answer through to
 * {@link SessionController.show} without looking at it. A component that read the word and
 * picked a screen would be the table's second copy, and two copies of a navigation table is
 * how the debrief becomes unreachable from one of them.
 *
 * **No raw identifier becomes a label.** A row carries its contract's content id purely so
 * that a press can name it to the controller; it is not a name a player reads, and it reaches
 * neither the text nor an attribute (`TDD` §11.1). `errorDetail` does not reach this screen
 * at all — it is assembled in code, carries a machine's own path, and neither hash covers it.
 *
 * **The name is the control.** A row's own display name is what a player presses, rather than
 * a separate "открыть" button beside it: `expectedSnapshot` puts that name first in every
 * row's block, so making it the button's own text adds no text to the page and keeps the two
 * lists comparable. A row whose contract leads nowhere is drawn dark rather than as plain
 * text, because a name that stops being pressable without changing shape reads as a page that
 * failed to draw.
 */
export function ContractBoardScreen({
  model,
  controller
}: {
  readonly model: ContractBoardScreenModel;
  readonly controller: ContractBoardScreenActions;
}) {
  const text = useText();
  // The same gate the other two screens keep: `Loading` and `Error` have no campaign behind
  // them to read a figure off at all, so a `0` there would be a fact this screen invented.
  const showTreasury = model.state !== ScreenState.Loading && model.state !== ScreenState.Error;

  return (
    <section className="contract-board" data-testid="contract-board-screen">
      <Label text={text(model.titleKey)} />
      <Label text={text(contractBoardStateKey(model.state))} />

      {model.errorCode === null ? null : <Label text={text(errorKey(model.errorCode))} />}

      {showTreasury ? (
        <Captioned captionKey={TreasuryFieldKeys.Treasury} value={String(model.treasury)} />
      ) : null}

      {model.rows.length === 0 ? null : (
        <div className="board-rows">
          {model.rows.map((row, index) => (
            <BoardRow
              key={row.definition}
              row={row}
              // Positional, never the row's own id: `collectRenderedAttributes` watches every
              // attribute for exactly that leak, and a hook carrying a content id would put
              // the raw identifier back on the page through the one door it guards.
              testId={`board-row-${String(index)}`}
              onOpen={() => {
                open(controller, row);
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * The subset of the session controller this screen is allowed to use.
 *
 * `Pick` over the controller's own type, for the reason the other two screens' props are: it
 * states *which* moves a board may make. It may not negotiate, may not settle and may not
 * save — a component that grew such a call would stop compiling rather than quietly gain the
 * ability.
 */
export type ContractBoardScreenActions = Pick<SessionController, 'focus' | 'show'>;

/**
 * Takes the player to `row`'s contract.
 *
 * Two calls, in this order, because they are two facts: the focused contract belongs to the
 * session and the screen belongs to the page. `focus` redraws whichever screen is up about
 * the newly focused contract, and `show` then moves to the one the row named — a board that
 * called them the other way round would draw the *previous* contract's screen for a frame.
 *
 * @throws when the row leads nowhere — a defect in this component, which must draw such a
 * row dark rather than press it.
 */
function open(controller: ContractBoardScreenActions, row: ContractBoardRow): void {
  const screen = row.opensScreen;

  if (screen === null) {
    throw new Error(
      'A board row that leads nowhere was pressed — a defect in this component, which must ' +
        'not offer a control for a contract the campaign has already closed.'
    );
  }

  controller.focus(row.definition);
  controller.show(screen);
}

/**
 * One contract as the board shows it: its name, what the patron pays, how many seats it
 * needs, what it asks for and how far it has got.
 *
 * The fee and the seats share a row so they read as two facts rather than as a column of
 * unexplained numbers — the defect external review found on the Godot frame, recorded in
 * `labels.tsx`. What the job asks for stays a list of names and never a weight: a weight is
 * the contract's own arithmetic and not the board's subject (`DEC-006`).
 */
function BoardRow({
  row,
  testId,
  onOpen
}: {
  readonly row: ContractBoardRow;
  readonly testId: string;
  readonly onOpen: () => void;
}) {
  const text = useText();

  return (
    <div className="board-row">
      <button
        type="button"
        data-testid={testId}
        disabled={row.opensScreen === null}
        onClick={onOpen}
      >
        {text(row.displayNameKey)}
      </button>

      <div className="row">
        <Captioned captionKey={FieldKeys.ContractPatronFee} value={String(row.patronFee)} />
        <Captioned captionKey={FieldKeys.ContractRequiredCrew} value={String(row.requiredCrew)} />
      </div>

      <KeyList captionKey={ContractBoardFieldKeys.Needs} keys={row.needKeys} />

      {/* How far this contract has got, in this layer's own vocabulary rather than in the
          three engine fields a screen would otherwise have to combine — and it is also what
          says *why* a dark control is dark, which is the sentence a player needs before they
          blame the button. */}
      <Captioned
        captionKey={ContractBoardFieldKeys.Availability}
        value={text(contractAvailabilityKey(row.availability))}
      />
    </div>
  );
}
