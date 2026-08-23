import type { ContentId } from '../ids/content-id.ts';

/**
 * Freeze a contract's current negotiation package (`NEGOTIATION_SPEC` §3.1, §3.3):
 * the offer's key hero has already accepted this exact version, and locking it is the
 * guild committing to pay — every seat, not merely the heroes who have answered so
 * far (`commitmentOf`, `negotiation/commitments.ts`).
 *
 * No `keyHero`, `advance` or any other term: those already live on the package this
 * command locks (`ContractState.offer`, set by `composeOffer`), and `lockOffer` is
 * not a second door for setting them.
 */
export interface LockOffer {
  /** Identifies this command for the campaign's lifetime; see `ProposeContractToHero`. */
  readonly commandId: number;
  readonly contractId: ContentId;
  /** The state version this command was composed against; see `ProposeContractToHero`. */
  readonly expectedStateVersion: number;
}
