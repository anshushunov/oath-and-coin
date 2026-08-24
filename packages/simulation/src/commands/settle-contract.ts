import type { ContentId } from '../ids/content-id.ts';

/**
 * Settles a contract's locked, crewed package (`NEGOTIATION_SPEC` §3.1, §3.3): pays
 * the patron fee in, pays the advance out to every hero who accepted, and — when the
 * offer promised a bonus — either honors it or breaks it, on the player's own word.
 *
 * No `keyHero`, `advance` or `promisedBonus` of its own: those already live on the
 * package this command settles (`ContractState.offer`), set by `composeOffer` and
 * frozen by `lockOffer` — `settleContract` is not a second door for changing them,
 * only the one that decides what becomes of the promise they carry.
 */
export interface SettleContract {
  /** Identifies this command for the campaign's lifetime; see `ProposeContractToHero`. */
  readonly commandId: number;
  readonly contractId: ContentId;
  /**
   * Whether the guild pays the bonus it promised — the player's own choice, not a
   * fact derived from state. Ignored when `offer.promisedBonus` is `0`
   * (`NEGOTIATION_SPEC` §6: "Расчёт без обещания — законен; `pay` игнорируется, обид
   * не возникает").
   */
  readonly pay: boolean;
  /** The state version this command was composed against; see `ProposeContractToHero`. */
  readonly expectedStateVersion: number;
}
