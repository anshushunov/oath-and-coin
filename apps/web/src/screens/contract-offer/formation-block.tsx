import {
  OfferFieldKeys,
  OfferLeverId,
  type Cell,
  type ContentId,
  type DeploymentLine
} from '@oath-and-coin/presentation';

import { useState } from 'react';

import { useText } from '../../text.tsx';

import { Label } from '../labels.tsx';

import type { OfferForm } from './offer-form.ts';
import { LeverRefusal } from './refusal.tsx';

/**
 * The 3×3, the order and the threshold (`COMBAT_SPEC` §3.7, §7.2, §7.4).
 *
 * **The board comes from the model.** Nine cells drawn from a loop written here would be a
 * second declaration of §3.1's field, and the two would part company the day the field
 * changes shape.
 *
 * **Nothing is decided here.** Pressing a cell moves a man in the *draft* and nothing else;
 * a man already standing on that cell is turned out of it, because two men on one cell is
 * what `placeCrew` refuses by name (`cell_taken`) and letting a player build that state and
 * then telling him about it is the failure `NEGOTIATION_SPEC` §5.1's dark controls exist to
 * avoid. Everything else the command can refuse — an unplaced hero, a contract with no plan
 * — is left to the engine, whose refusal the player reads.
 */
export function FormationBlock({
  deployment,
  draft,
  onChange,
  refusal
}: {
  readonly deployment: DeploymentLine;
  readonly draft: OfferForm;
  readonly onChange: (draft: OfferForm) => void;
  /** The last refusal, when `placeCrew` made it about the board or the threshold. */
  readonly refusal: LeverRefusal | null;
}) {
  const text = useText();
  const [holding, setHolding] = useState<ContentId | null>(
    deployment.crew[0]?.heroDefinition ?? null
  );

  const standingOn = (cell: Cell): ContentId | null =>
    Object.entries(draft.placement).find(
      ([, at]) => at.row === cell.row && at.column === cell.column
    )?.[0] as ContentId | null;

  return (
    <div className="formation" data-testid="offer-formation" data-lever={OfferLeverId.Formation}>
      <Label text={text(OfferFieldKeys.Formation)} />

      <div className="formation-crew">
        {deployment.crew.map((slot) => {
          const cell = draft.placement[slot.heroDefinition];

          return (
            <button
              key={slot.heroDefinition}
              type="button"
              data-testid={`formation-hero-${slot.heroDefinition}`}
              aria-pressed={holding === slot.heroDefinition}
              onClick={() => {
                setHolding(slot.heroDefinition);
              }}
            >
              <Label text={text(slot.displayNameKey)} />
              <Label text={text(slot.roleKey)} />
              {cell === undefined ? (
                <Label text={text(OfferFieldKeys.Unplaced)} />
              ) : (
                <>
                  <Label text={text(OfferFieldKeys.Cell)} />
                  <Label text={String(cell.row)} />
                  <Label text={String(cell.column)} />
                </>
              )}
            </button>
          );
        })}
      </div>

      {/*
        Bottom-up, so row 1 is nearest the enemy on this board as it is on the battle
        screen's (`battle-scene-model.ts` draws the crew's front rank at the bottom for the
        same reason). A player who places a man "at the top" here and finds him at the bottom
        there is being shown two different boards for one formation. The *order of the texts*
        is the model's and is unchanged; where they land is layout, which is this component's.
      */}
      <div className="formation-board" data-testid="formation-board">
        {[...deployment.cells]
          // Rows reversed, columns left alone. Reversing the flat list turns the board
          // inside out as well as upside down, and the frame showed exactly that: column 3
          // on the left. Found by looking, and by nothing else — a grid of nine buttons is
          // the right nine buttons in either order.
          .sort((left, right) => right.row - left.row || left.column - right.column)
          .map((cell) => (
            <button
              key={`${String(cell.row)}:${String(cell.column)}`}
              type="button"
              data-testid={`formation-cell-${String(cell.row)}-${String(cell.column)}`}
              onClick={() => {
                if (holding === null) {
                  return;
                }

                const evicted = standingOn(cell);
                const next = { ...draft.placement, [holding]: cell };

                if (evicted !== null && evicted !== holding) {
                  delete next[evicted];
                }

                onChange({ ...draft, placement: next });
              }}
            >
              <Label text={String(cell.row)} />
              <Label text={String(cell.column)} />
            </button>
          ))}
      </div>

      <div className="formation-doctrine">
        <Label text={text(OfferFieldKeys.Doctrine)} />
        {deployment.doctrineLever.options.map((option) => (
          <button
            key={option.value}
            type="button"
            data-testid={`formation-doctrine-${option.value}`}
            aria-pressed={draft.doctrine === option.value}
            onClick={() => {
              onChange({ ...draft, doctrine: option.value });
            }}
          >
            {text(option.labelKey)}
          </button>
        ))}
      </div>

      <label className="formation-retreat">
        <Label text={text(OfferFieldKeys.RetreatBelow)} />
        <input
          type="number"
          data-testid="formation-retreat-below"
          value={draft.retreatBelowPercent}
          onChange={(event) => {
            onChange({ ...draft, retreatBelowPercent: Number(event.target.value) });
          }}
        />
      </label>

      <LeverRefusal at={OfferLeverId.Formation} refusal={refusal} />
    </div>
  );
}
