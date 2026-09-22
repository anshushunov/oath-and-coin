import type { Cell, ContentId, DoctrineId } from '@oath-and-coin/presentation';

/**
 * A package as a player is assembling it, before any of it has been recorded.
 *
 * **This is the state the read model deliberately cannot hold.** `ContractOfferScreenModel`
 * is what the campaign records, rebuilt from the engine after every command, so a
 * half-filled term has nowhere in it to live — and an immutable projection that could hold
 * one would have stopped being a projection.
 *
 * `keyHero` is nullable here and is not on `OfferDraft`, and the difference is the point: a
 * command needs somebody to negotiate with, a form does not yet. Until one is chosen there
 * is no `OfferDraft` to build at all, which is why {@link isSendable} refuses rather than
 * this screen inventing a hero.
 */
export interface OfferForm {
  readonly advance: number;
  readonly promisedBonus: number;
  readonly methodTag: ContentId | null;
  readonly keyHero: ContentId | null;
  readonly invited: readonly ContentId[];
  /**
   * Where each man is to stand, keyed by his definition (`COMBAT_SPEC` §3.7).
   *
   * Part of the draft rather than of the model, for the reason the rest of this form is: it
   * is what a player is *typing*, and until `placeCrew` takes it nothing about the campaign
   * has moved. Once the command applies, the model carries the formation and this is rebuilt
   * from it.
   */
  readonly placement: Readonly<Record<string, Cell>>;
  readonly doctrine: DoctrineId | null;
  readonly retreatBelowPercent: number;
}
