import { FieldKeys, qualitativeKey, type ContractLine } from '@oath-and-coin/presentation';

import { useText } from '../../text.tsx';

import { Captioned, KeyList, Label } from '../labels.tsx';

/**
 * The offer itself: its name, the two facts about the job, and its tags when it has any.
 *
 * The facts share one row so that they read as facts rather than as a column of
 * unexplained numbers. How many the job needs and how many said yes moved to the count of
 * the package band (`package-band.tsx`): they are the score of the negotiation, not a
 * property of the job, and printing them twice would make a player check they agree.
 */
export function ContractBlock({ contract }: { readonly contract: ContractLine }) {
  const text = useText();

  return (
    <div className="contract">
      <Label text={text(contract.displayNameKey)} />

      <div className="row">
        <Captioned captionKey={FieldKeys.ContractPatronFee} value={String(contract.patronFee)} />
        <Captioned
          captionKey={FieldKeys.ContractRisk}
          value={text(qualitativeKey(contract.risk))}
        />
      </div>

      <KeyList captionKey={FieldKeys.ContractTags} keys={contract.tagKeys} />
    </div>
  );
}
