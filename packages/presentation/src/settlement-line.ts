import {
  ContractStatus,
  OfferPhase,
  type ContentId,
  type ContractState,
  type HeroId
} from '@oath-and-coin/simulation';

import type { SettlementLine } from './contract-offer-screen-model.ts';

/**
 * What the promise costs and who is bound by it, in one place for the two screens that
 * both show it.
 *
 * Extracted from the offer factory when the debrief screen arrived (`RESOLUTION_SPEC`
 * §6.1: the debrief carries "блок расчёта обещания"). Two copies of this arithmetic would
 * be two answers to "what does keeping the word cost", shown on two screens a player moves
 * between in one click — the drift would be visible to them and to nothing else.
 */

/**
 * The hero `heroId` names, resolved to the definition the rest of a screen shows.
 *
 * A bare lookup would surface a missing id with no clue which one or where it came from —
 * an offer naming a hero the roster does not carry is a content-loading or roster-building
 * bug, not a hero with no name.
 */
export function definitionOfHero(
  heroId: HeroId,
  heroDefinitionByHeroId: ReadonlyMap<HeroId, ContentId>
): ContentId {
  const definition = heroDefinitionByHeroId.get(heroId);

  if (definition === undefined) {
    throw new Error(
      `An offer names hero#${String(heroId)}, but the roster this factory built has no ` +
        'definition for it — a content-loading or roster-building bug, not a hero with no name.'
    );
  }

  return definition;
}

/**
 * What `treasury` would read after settling `contract`'s current package with `pay: true`
 * — `settleContract`'s own formula (`NEGOTIATION_SPEC` §3.3, `RESOLUTION_SPEC` §5.3), term
 * for term: the patron's share arrives, the advance leaves for every hero who actually has
 * a seat, and the promised bonus leaves because this is the branch where the guild pays it.
 *
 * **`patronPays` is a parameter, and that is what keeps one formula from becoming two.**
 * The share is `patronFee × patronFeePercent(grade) / 100` and the grade is a fact only the
 * debrief has: before the crew comes back nobody knows which of 100 %, 40 % or 0 % applies,
 * so the offer screen's forecast passes the whole fee — the figure a player is being asked
 * to weigh, and the one that answer was always about — while the debrief passes the share
 * §5.3 actually pays. Computing the share inside here would make the offer screen claim to
 * know a grade that does not exist yet; hard-coding the whole fee here would make the
 * debrief promise money a failed contract never earns.
 */
export function treasuryAfterSettling(
  treasury: number,
  contract: ContractState,
  patronPays: number
): number {
  const { offer } = contract;

  return treasury + patronPays - offer.advance * offer.acceptedBy.size - offer.promisedBonus;
}

/**
 * What the promise costs and who is bound by it (`NEGOTIATION_SPEC` §5.1) — `null` before
 * there is a crew to bind: the phase is `settled`, or it is `locked` with every seat filled
 * (`ContractStatus.Crewed`). A package that might still change, or one still short a seat,
 * has no settlement to show.
 *
 * `treasuryIfBroken` is {@link treasuryAfterSettling}'s figure plus the promised bonus back
 * — the same formula with `pay: false`, which simply skips that term rather than computing
 * it a second, independent way.
 */
export function settlementLineFor(
  contract: ContractState,
  treasury: number,
  patronPays: number,
  heroDefinitionByHeroId: ReadonlyMap<HeroId, ContentId>
): SettlementLine | null {
  const { offer } = contract;
  const eligible =
    offer.phase === OfferPhase.Settled ||
    (offer.phase === OfferPhase.Locked && contract.status === ContractStatus.Crewed);

  if (!eligible) {
    return null;
  }

  const treasuryIfKept = treasuryAfterSettling(treasury, contract, patronPays);

  return {
    promisedBonus: offer.promisedBonus,
    keyHeroDefinition:
      offer.keyHero === null ? null : definitionOfHero(offer.keyHero, heroDefinitionByHeroId),
    crew: [...offer.acceptedBy.values()].map((heroId) =>
      definitionOfHero(heroId, heroDefinitionByHeroId)
    ),
    treasuryIfKept,
    treasuryIfBroken: treasuryIfKept + offer.promisedBonus
  };
}
