import { FieldKeys, qualitativeKey, type ContractLine } from '@oath-and-coin/presentation';

import { useText } from '../../text.tsx';

import { Captioned, KeyList, Label } from '../labels.tsx';

/**
 * The offer itself: its name, the four facts about it, and its tags when it has any.
 *
 * The four facts share one row so that they read as four facts rather than as a
 * column of unexplained numbers.
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
        <Captioned
          captionKey={FieldKeys.ContractRequiredCrew}
          value={String(contract.requiredCrew)}
        />
        <Captioned
          captionKey={FieldKeys.ContractAcceptedCount}
          value={String(contract.acceptedCount)}
        />
      </div>

      <KeyList captionKey={FieldKeys.ContractTags} keys={contract.tagKeys} />
    </div>
  );
}
