import { FieldKeys, OfferFieldKeys, type ContractLine } from '@oath-and-coin/presentation';
import type { ReactNode } from 'react';

import { useText } from '../../text.tsx';
import { Rail } from '../../ui/layout.tsx';
import { Stat } from '../../ui/stat.tsx';
import { Tag } from '../../ui/tag.tsx';

import { Label } from '../labels.tsx';

/**
 * The summary row, pinned to the top of the screen while the squad scrolls under it (spec
 * §4, owner's decision of 2026-09-23): the contract, the count with its "being edited" mark,
 * and the treasury with what the deal would leave. A player reading the squad further down
 * keeps the score of the negotiation and its price in front of him.
 *
 * Only this row is pinned, and on purpose: the whole package band pinned took more than half
 * of a 1280×800 window and left the squad one row of cards. The levers and the ladder are
 * {@link PackageBand}, under it in the ordinary flow — they are what a player works with
 * before he reads the squad, not while.
 *
 * Laid out by the kit's `Rail` — one row, wrapping when it does not fit — inside a wrapper
 * that carries the pinning (`styles.css`, `.offer-summary`).
 */
export function OfferSummary({ children }: { readonly children: ReactNode }) {
  return (
    <div className="offer-summary" data-testid="offer-summary">
      <Rail>{children}</Rail>
    </div>
  );
}

/**
 * The rest of the package, under the summary row in the ordinary flow (spec §4, layout
 * **Б**): the five levers, the promise, and the ladder of commands. It scrolls away with the
 * page; the summary row above it does not.
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
 * about, drawn large in the summary row (spec §4.2).
 *
 * Three states, and only one of them is the model's:
 *
 * - **not asked** (`answered` false): the package as it stands has no answers yet — a
 *   freshly composed one, whose answers the engine has just emptied (`DEC-012`). The count
 *   says so in words; a `0` there would read as a squad that refused.
 * - **being edited** (`stale` true): the form holds terms the package does not record yet,
 *   and the package may still be recomposed. The count stays what it was — nothing has been
 *   asked about the new terms — and is dimmed and marked, because declaring the answers void
 *   before the package changed would be the same lie in the other direction.
 * - **as recorded**: everything else, including a refused `compose` and a package whose
 *   `compose` is dark: the package did not move, so neither does the count, and the refusal
 *   stands by the lever it names.
 *
 * `answered` is the list being empty or not, decided by the caller from the model; `stale`
 * is the screen's own state. Neither is a branch on what an answer says. `answered` stands in
 * for the engine's own `respondedBy` by an invariant the factory states beside `responses`
 * (one line per hero who answered this version) and the oracle suite checks on every
 * shipped run.
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
