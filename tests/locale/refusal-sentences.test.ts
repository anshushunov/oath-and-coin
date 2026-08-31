import { join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { loadUiTextCatalogue } from '@oath-and-coin/content/node';
import { availableActions, OfferAction } from '@oath-and-coin/presentation';
import {
  ContractStatus,
  OfferPhase,
  RejectionCodes,
  SortedMap,
  SortedSet,
  compareContentIds,
  compareHeroIds,
  heroId,
  type ContractState,
  type GameState,
  type HeroId
} from '@oath-and-coin/simulation';
import { aContract, aHero, aState, anOffer, ids } from '@oath-and-coin/simulation/testing/fixtures';

/**
 * What a dark control **says**, held against the package it is saying it about.
 *
 * `packages/presentation/src/offer-actions.test.ts` checks, thoroughly, which refusal *code*
 * each control carries in each state — and never once reads what that code says out loud.
 * This file is the other side of that boundary, which is what `tests/locale` is for: the
 * codes live in `simulation`, the states in `presentation`, and the sentences in `ui-text/`,
 * and no one of the three may import the other two.
 *
 * **The gap was found by the owner playing, on 2026-08-31.** An invitee declined, the crew
 * stood at two of four, and `Зафиксировать пакет` told him "пакет зафиксирован, отряд набран —
 * условия больше не меняются" while `Записать условия` was live directly beside it. Both
 * halves were false, and the second is the one that ended the session: he read it as a dead
 * end. `RESOLUTION_SPEC` §6.2 makes that state precisely the one a new version of the package
 * exists for, and `composeRefusal` implements it — the code was right and the sentence was
 * not.
 */

const repositoryRoot = resolve(import.meta.dirname, '..', '..');
const catalogue = loadUiTextCatalogue(join(repositoryRoot, 'ui-text', 'ru.json'));

function sentenceFor(key: string): string {
  const text = catalogue.get(key);

  if (text === undefined) {
    throw new Error(`Nothing ships a text for '${key}'.`);
  }

  return text;
}

const crew = (...indices: readonly number[]): SortedSet<HeroId> =>
  SortedSet.from(compareHeroIds, indices.map(heroId));

/**
 * A two-seat contract in one of the states along the negotiation, with the roster it needs.
 *
 * Hand-built through the shipped fixtures rather than driven through the engine: what is
 * under test is a sentence about a state, so the state has to be nameable in one place. The
 * shapes themselves are the ones `offer-actions.test.ts`'s own table already fixes against
 * the engine, command by command — this file does not re-check that they are reachable.
 */
function campaignIn(offer: {
  readonly phase: OfferPhase;
  readonly status: ContractStatus;
  readonly invited: readonly number[];
  readonly respondedBy: readonly number[];
  readonly acceptedBy: readonly number[];
}): { readonly state: GameState; readonly contract: ContractState } {
  const contract = aContract({
    id: ids.crypt,
    patronFee: 100,
    requiredCrew: 2,
    status: offer.status,
    offer: anOffer({
      phase: offer.phase,
      keyHero: heroId(0),
      invited: crew(...offer.invited),
      respondedBy: crew(...offer.respondedBy),
      acceptedBy: crew(...offer.acceptedBy)
    })
  });

  const roster = [ids.bram, ids.doran].map((definition, index) =>
    aHero({ id: heroId(index), definition })
  );

  const state = aState({
    treasury: 400,
    heroes: SortedMap.from(
      compareHeroIds,
      roster.map((hero) => [hero.id, hero] as const)
    ),
    contracts: SortedMap.from(compareContentIds, [[contract.id, contract]])
  });

  return { state, contract };
}

/** The state the owner was standing in: locked, everybody answered, a seat still empty. */
const stranded = () =>
  campaignIn({
    phase: OfferPhase.Locked,
    status: ContractStatus.Offered,
    invited: [0, 1],
    respondedBy: [0, 1],
    acceptedBy: [0]
  });

/** The same package one step earlier: locked, and nobody polled yet. */
const lockedUnpolled = () =>
  campaignIn({
    phase: OfferPhase.Locked,
    status: ContractStatus.Offered,
    invited: [0, 1],
    respondedBy: [0],
    acceptedBy: [0]
  });

/** A deal actually struck, where "отряд набран" is the truth. */
const struck = () =>
  campaignIn({
    phase: OfferPhase.Locked,
    status: ContractStatus.Crewed,
    invited: [0, 1],
    respondedBy: [0, 1],
    acceptedBy: [0, 1]
  });

const REVISABLE = [
  { name: 'locked, polled through, a seat still empty', build: stranded },
  { name: 'locked, nobody polled yet', build: lockedUnpolled }
] as const;

describe('a dark control never contradicts the live one beside it', () => {
  /**
   * Claims a control must not make while the terms can still be revised.
   *
   * Both are claims about the **package**, not about the button they happen to be printed
   * under — which is exactly why a player reads them as rules and stops.
   */
  const FROZEN_CLAIMS = [/отряд набран/u, /условия больше не меняются/u];

  it.each(REVISABLE)('$name', ({ build }) => {
    const { state, contract } = build();
    const actions = availableActions(state, contract);
    const compose = actions.find((one) => one.action === OfferAction.Compose);

    // The premise of the whole suite, asserted rather than assumed: if composing ever stopped
    // being the way out of this state, these sentences would be free to say the opposite.
    expect(compose?.disabledReasonKey).toBeNull();

    for (const available of actions) {
      if (available.disabledReasonKey === null) {
        continue;
      }

      for (const claim of FROZEN_CLAIMS) {
        expect(sentenceFor(available.disabledReasonKey), available.action).not.toMatch(claim);
      }
    }
  });

  it('still says the deal is struck once it actually is', () => {
    // The other direction, so the fix is not "delete the sentence": a locked, crewed package
    // is a deal, `composeOffer` refuses it, and the screen has to say why in as many words.
    const { state, contract } = struck();
    const compose = availableActions(state, contract).find(
      (one) => one.action === OfferAction.Compose
    );

    expect(compose?.disabledReasonKey).toBe(RejectionCodes.OfferNotInDraft);
  });
});

describe('the stranded player is told which control is the way out', () => {
  it('names the button, not the abstraction', () => {
    // "Соберите новую версию пакета" was already the text, and the owner still could not find
    // the control it meant — it sat fourth in a column of seven, and the sentence named no
    // button. The way out has to be named the way it is written on the screen.
    const { state, contract } = stranded();
    const poll = availableActions(state, contract).find((one) => one.action === OfferAction.Poll);

    expect(poll?.disabledReasonKey).toBe(RejectionCodes.NobodyLeftToPoll);
    expect(sentenceFor(poll!.disabledReasonKey!)).toContain(sentenceFor('action.offer.compose'));
  });
});
