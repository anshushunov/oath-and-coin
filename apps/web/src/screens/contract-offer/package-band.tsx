import { FieldKeys, OfferFieldKeys, type ContractLine } from '@oath-and-coin/presentation';
import type { ReactNode } from 'react';

import { useText } from '../../text.tsx';
import { Stat } from '../../ui/stat.tsx';
import { Tag } from '../../ui/tag.tsx';

import { Label } from '../labels.tsx';

/**
 * The package as one band across the top of the screen (spec §4, layout **Б**): the
 * contract, the count, the five levers, the treasury with what the deal would leave, and
 * the ladder of commands. Sticky in a window tall enough to hold it beside the squad, so that
 * a player reading the squad further down still has the terms he is bargaining with in front
 * of him; in the 1280×800 window it would cover most of the screen, and there it scrolls
 * away (`styles.css`, `.package-band`, gives the numbers).
 *
 * A container and nothing else — each block inside is the one the screen already had —
 * because what moved is *where* the package is, not what it says.
 */
export function PackageBand({ children }: { readonly children: ReactNode }) {
  return (
    <div className="package-band" data-testid="package-band">
      {children}
    </div>
  );
}

/**
 * How many said yes, against how many the job needs — the number the whole negotiation is
 * about, drawn large (spec §4.2).
 *
 * Three states, and only one of them is the model's:
 *
 * - **not asked** (`answered` false): the package as it stands has no answers yet — a
 *   freshly composed one, whose answers the engine has just emptied (`DEC-012`). The count
 *   says so in words; a `0` there would read as a squad that refused.
 * - **being edited** (`stale` true): the form holds terms the package does not record yet.
 *   The count stays what it was — nothing has been asked about the new terms — and is
 *   dimmed and marked, because declaring the answers void before the package changed would
 *   be the same lie in the other direction.
 * - **as recorded**: everything else, including a refused `compose`: the package did not
 *   move, so neither does the count, and the refusal stands by the lever it names.
 *
 * `answered` is the list being empty or not, decided by the caller from the model; `stale`
 * is the screen's own state. Neither is a branch on what an answer says.
 */
export function Tally({
  contract,
  answered,
  stale
}: {
  readonly contract: ContractLine;
  readonly answered: boolean;
  readonly stale: boolean;
}) {
  const text = useText();

  return (
    <div className="tally" data-testid="offer-tally" data-stale={String(stale)}>
      {answered ? (
        <Stat
          caption={text(FieldKeys.ContractAcceptedCount)}
          value={String(contract.acceptedCount)}
          testId="tally-accepted"
        />
      ) : (
        <Label text={text(OfferFieldKeys.NotAsked)} />
      )}
      <Stat caption={text(FieldKeys.ContractRequiredCrew)} value={String(contract.requiredCrew)} />
      {stale ? (
        <Tag role="status" word={text(OfferFieldKeys.Editing)} testId="tally-editing" />
      ) : null}
    </div>
  );
}
