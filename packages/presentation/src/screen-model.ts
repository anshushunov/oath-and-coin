import { canonicalSha256, type CanonicalValue } from '@oath-and-coin/simulation';

import { describeAfterActionReadModel } from './after-action-screen-model.ts';
import type { AfterActionScreenModel } from './after-action-screen-model.ts';
import { describeContractBoardReadModel } from './contract-board-screen-model.ts';
import type { ContractBoardScreenModel } from './contract-board-screen-model.ts';
import { describeContractOfferReadModel } from './contract-offer-screen-model-factory.ts';
import type { ContractOfferScreenModel } from './contract-offer-screen-model.ts';
import { requireCorpusComparableText } from './corpus-comparable-text.ts';
import { ScreenKind } from './screen-kind.ts';

/**
 * The three screens a campaign has, as one discriminated union.
 *
 * **Why a union rather than three parallel types.** A session shows one screen at a time
 * and everything downstream — the hash, the rendered snapshot, the scene behind the page,
 * the component that draws it — has to answer for whichever one that is. Three separate
 * types would let a reader be written against one of them and simply never be told about a
 * second; the union with a literal discriminant makes the compiler stop the build at every
 * such reader instead (`switch-exhaustiveness-check`, `noImplicitReturns`), which is the
 * same protection `DomainEvent.kind` already buys the engine.
 *
 * `ScreenKind` is stamped by each model's own `create…` gate, never supplied — so a screen
 * cannot claim to be another one, and a spread cannot lose the field that says which it is.
 */
export type ScreenModel =
  ContractOfferScreenModel | AfterActionScreenModel | ContractBoardScreenModel;

/**
 * The canonical projection the read-model hash is taken over, for whichever screen this is.
 *
 * **The screen's own name is inside the projection, and that is load-bearing.** Two screens
 * can carry the same content — an `Empty` board and an `Empty` debrief carry nothing at all
 * — and a hash that could not tell them apart would call a player who is looking at the
 * board and a player who is looking at a debrief the same run. The frozen corpus already
 * makes the same argument one level down, about `state`: `screen_loading` and `screen_empty`
 * carry identical content and differ only in which of the five shapes they are.
 *
 * Exposed rather than private for the reason it always was: a comparison that could only
 * see the hash could not say *where* two screens disagreed.
 */
export function describeReadModel(model: ScreenModel): CanonicalValue {
  const projection = describeScreen(model);

  requireComparableStrings(projection, '$');

  return projection;
}

/** SHA-256 of the canonical bytes of {@link describeReadModel}, lowercase hex. */
export function readModelHash(model: ScreenModel): string {
  return canonicalSha256(describeReadModel(model));
}

/**
 * One projection per screen, chosen by the discriminant and by nothing else.
 *
 * No `default`: a fourth screen does not build until it has been given a projection, which
 * is the whole reason the discriminant exists. Each branch re-validates its own model
 * first — a TypeScript spread walks around a factory function, and this is one of the two
 * places a model becomes evidence about a screen.
 */
function describeScreen(model: ScreenModel): CanonicalValue {
  switch (model.screen) {
    case ScreenKind.ContractOffer:
      return describeContractOfferReadModel(model);
    case ScreenKind.AfterAction:
      return describeAfterActionReadModel(model);
    case ScreenKind.ContractBoard:
      return describeContractBoardReadModel(model);
  }
}

/**
 * Walks a finished projection and refuses any string the frozen corpus and this repository
 * would canonicalize into different bytes.
 *
 * Over the whole tree rather than over the one field that is loose today. External review
 * found `errorCode` — the only string in the projection a caller supplies freely — but a
 * field added to a later projection would reopen the same hole without anyone noticing, and
 * the walk costs one traversal of an object that is about to be serialized anyway. Here
 * rather than in each projection for exactly that reason: one walk covers all three, and a
 * fourth screen inherits it by construction.
 */
function requireComparableStrings(value: CanonicalValue, path: string): void {
  if (typeof value === 'string') {
    requireCorpusComparableText(path, value);
    return;
  }

  if (Array.isArray(value)) {
    value.forEach((element, index) => {
      requireComparableStrings(element, `${path}[${String(index)}]`);
    });
    return;
  }

  if (typeof value === 'object' && value !== null) {
    for (const [key, element] of Object.entries(value)) {
      if (element !== undefined) {
        requireComparableStrings(element, `${path}.${key}`);
      }
    }
  }
}
