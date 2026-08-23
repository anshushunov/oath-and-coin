import type { ContentId } from '../ids/content-id.ts';
import type { HeroId } from '../ids/hero-id.ts';

/**
 * Revise a contract's negotiation package (`NEGOTIATION_SPEC` §3.1, §3.3). The
 * package this command names entirely replaces the one before it: `version` steps
 * forward and both `respondedBy` and `acceptedBy` are cleared, because an answer
 * given to a package the player has since changed is an answer to a package that no
 * longer exists — there is nowhere left to keep it.
 *
 * The first command of the negotiation protocol: every contract starts with nobody
 * keyed, nothing offered (`initialOffer`), and this is the only command that ever
 * sets `keyHero`, `advance`, `methodTag` or `promisedBonus` away from that start.
 */
export interface ComposeOffer {
  /** Identifies this command for the campaign's lifetime; see `ProposeContractToHero`. */
  readonly commandId: number;
  readonly contractId: ContentId;
  /** Who the revised package is negotiated with. */
  readonly keyHero: HeroId;
  /** Money offered to every hero who accepts; must fall within `0..patronFee`. */
  readonly advance: number;
  /** The negotiated tag this version chooses, or `null` to choose none. */
  readonly methodTag: ContentId | null;
  /** Extra pay promised to `keyHero` alone; must fall within `0..patronFee`. */
  readonly promisedBonus: number;
  /** The state version this command was composed against; see `ProposeContractToHero`. */
  readonly expectedStateVersion: number;
}
