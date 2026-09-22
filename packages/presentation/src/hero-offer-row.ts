import { Actions } from '@oath-and-coin/simulation';

import type { HeroCard, ResponseLine } from './contract-offer-screen-model.ts';

/**
 * Where a hero stands on the package, as the offer screen groups the squad.
 *
 * Four, in the order the rows are drawn. `Blocked` is its own stance and not a kind of
 * `Refused`, although both answer `decline`: a principle that closed the decision has no
 * lever under it, and a player must read "will not do this at all" apart from "the price
 * is wrong".
 */
export const HeroStance = Object.freeze({
  Refused: 'refused',
  Blocked: 'blocked',
  Accepted: 'accepted',
  Unanswered: 'unanswered'
});

export type HeroStance = (typeof HeroStance)[keyof typeof HeroStance];

/** The stances in the order their rows are drawn — refusals first. */
export const HERO_STANCES: readonly HeroStance[] = Object.freeze(Object.values(HeroStance));

/**
 * One hero of the offer screen together with his answer — what the screen draws as one
 * line, so that a player reads who said no and why without matching two columns by name.
 *
 * `response` is `null` for a hero who has not answered, and that is an ordinary state of
 * the screen rather than a defect in the data: only the invited are polled (`DEC-012`,
 * amendment of 2026-08-25), and an applied `composeOffer` empties every answer at once.
 *
 * `stance` is the group the row was sorted into, carried so that the screen can colour a
 * row by it without deciding it again from `action` — which would be the branch on a
 * field's value the screen is not allowed to make.
 */
export interface HeroOfferRow {
  readonly hero: HeroCard;
  readonly response: ResponseLine | null;
  readonly stance: HeroStance;
}

/**
 * The roster joined with the answers and sorted the way the screen reads it: refused
 * first, then blocked outright by a principle, then accepted, then not answered.
 *
 * **Why this is here and not in the component.** The screen holds the invariant that it
 * renders in a fixed order with no branch on a field's *value*
 * (`contract-offer-screen.tsx`'s own header). The join and the "refusals first" order are
 * both branches on the value of `action`, so in React they would break that rule; here
 * they are a pure function with tests of their own, and the screen only maps the list.
 *
 * **The sort is stable, and the rows lean on it.** `Array.prototype.sort` has been stable
 * by specification since ES2019, so rows of one group keep the roster's order — which
 * matters, because two rows swapping places between two polls reads as "somebody changed
 * his mind" when nobody did. The key is the group alone; the order inside a group is the
 * roster's by that stability, and the test "внутри группы держит порядок ростера" holds
 * this paragraph to it.
 *
 * Takes the two lists it reads rather than the whole screen model, so that a test states
 * exactly what the result depends on. Joined on `HeroCard.definition` against
 * `ResponseLine.heroDefinition` — the two fields name the same id under different names.
 */
export function heroOfferRows(source: {
  readonly roster: readonly HeroCard[];
  readonly responses: readonly ResponseLine[];
}): readonly HeroOfferRow[] {
  const byHero = new Map<string, ResponseLine>();

  // One answer per hero, or the row cannot say which one is his. The engine refuses a
  // second answer to one version of a package (`respondedBy`), and the factory shows only
  // the current version's (`DEC-012`) — so a repeat here is a defect upstream, and a row
  // that silently kept one of the two would be choosing which answer the player reads.
  for (const response of source.responses) {
    if (byHero.has(response.heroDefinition)) {
      throw new Error(
        `Hero '${response.heroDefinition}' answers this package twice; one hero answers one ` +
          'version once, so the model carries an answer to a package that no longer exists.'
      );
    }

    byHero.set(response.heroDefinition, response);
  }

  return source.roster
    .map((hero) => {
      const response = byHero.get(hero.definition) ?? null;

      return { hero, response, stance: stanceOf(response) };
    })
    .sort((left, right) => HERO_STANCES.indexOf(left.stance) - HERO_STANCES.indexOf(right.stance));
}

/**
 * Which stance an answer puts its hero in.
 *
 * A block is checked before the action, for the reason {@link HeroStance} gives. Compared
 * with `Actions.Decline`, never with a string literal: the action is a content id
 * (`action:decline`).
 */
function stanceOf(response: ResponseLine | null): HeroStance {
  if (response === null) {
    return HeroStance.Unanswered;
  }

  if (response.blockedByEntity !== null) {
    return HeroStance.Blocked;
  }

  return response.action === Actions.Decline ? HeroStance.Refused : HeroStance.Accepted;
}
