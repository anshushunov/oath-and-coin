import { Sha256, utf8Bytes } from '@oath-and-coin/simulation';

import {
  FieldKeys,
  actionKey,
  errorKey,
  reasonDirectionKey,
  screenStateKey,
  waveredKey
} from './keys.ts';
import type { ContractOfferScreenModel } from './contract-offer-screen-model.ts';
import { qualitativeKey } from './qualitative-scale.ts';

/**
 * A flat list of texts, in the order a screen presents them — the second of the two
 * hashes, and the one that says the model actually reached the markup.
 *
 * The read-model hash proves two sides built the same model. It proves nothing about
 * whether that model reached the screen: a forgotten binding, two swapped blocks or a
 * dropped reason all leave it green. {@link expectedSnapshot} builds the texts a
 * correctly bound screen should produce, resolving every field that is a key through
 * the catalogue — never by walking any real DOM, and never by showing the model's own
 * raw key or a raw content id, which no real screen puts on a label either.
 *
 * The screen side builds its own list by walking the rendered DOM in document order.
 * The two lists are produced by unrelated code paths on purpose: a binding mistake
 * breaks the match precisely because nothing here can know what the screen rendered.
 *
 * The order promised is the order a depth-first walk visits — title, state, error,
 * contract, then the whole roster, then every response. Not "the order a reader
 * encounters it": the screen may lay the roster and the responses out as two columns,
 * so a person reads them interleaved while the walk still visits every roster text
 * before every response text. That distinction matters because this list *is* the
 * second hash — if it described what a reader sees, a pure layout change would have to
 * move it, and the hash would assert something no code on either side computes.
 */

/**
 * 0x1F (Unit Separator) cannot occur inside ordinary text this codebase produces, so
 * joining with it before hashing keeps `"ab" + "c"` from hashing the same as
 * `"a" + "bc"` — the trick the content digest already uses for file paths.
 */
const SEPARATOR = 0x1f;

/**
 * The texts a correctly bound screen should produce for `model`, resolved against
 * `catalogue`.
 *
 * Every content id the model carries for bookkeeping — the contract's and heroes'
 * definitions, a reason's source entity, a blocking entity — stays out entirely. The
 * read-model hash still covers every one of them, but none is a name a player reads,
 * and showing one beside the resolved name it duplicates is exactly the raw-identifier
 * leak `TDD` §11.1 forbids. `errorDetail` is excluded for the reason the read-model
 * hash excludes it: it is not a value either side can agree on ahead of time.
 *
 * @throws when the catalogue has no entry for a key the model carries. A missing
 * translation must fail loudly rather than let a raw key reach the screen silently.
 */
export function expectedSnapshot(
  model: ContractOfferScreenModel,
  catalogue: ReadonlyMap<string, string>
): readonly string[] {
  const texts: string[] = [];
  const resolve = (key: string): void => {
    texts.push(resolveText(catalogue, key));
  };

  resolve(model.titleKey);
  resolve(screenStateKey(model.state));

  if (model.errorCode !== null) {
    resolve(errorKey(model.errorCode));
  }

  const { contract } = model;

  if (contract !== null) {
    resolve(contract.displayNameKey);
    resolve(FieldKeys.ContractPayment);
    texts.push(String(contract.payment));
    resolve(FieldKeys.ContractRisk);
    resolve(qualitativeKey(contract.risk));
    resolve(FieldKeys.ContractRequiredCrew);
    texts.push(String(contract.requiredCrew));
    resolve(FieldKeys.ContractAcceptedCount);
    texts.push(String(contract.acceptedCount));

    // A caption for a list nobody has is a heading over nothing, so an empty list
    // produces neither. A branch on whether a model field is empty — never on what is
    // in it.
    if (contract.tagKeys.length > 0) {
      resolve(FieldKeys.ContractTags);
      contract.tagKeys.forEach(resolve);
    }
  }

  for (const hero of model.roster) {
    resolve(hero.displayNameKey);
    resolve(FieldKeys.HeroGreed);
    resolve(qualitativeKey(hero.greed));
    resolve(FieldKeys.HeroCaution);
    resolve(qualitativeKey(hero.caution));
    resolve(FieldKeys.HeroPride);
    resolve(qualitativeKey(hero.pride));

    if (hero.principleKeys.length > 0) {
      resolve(FieldKeys.HeroPrinciples);
      hero.principleKeys.forEach(resolve);
    }

    if (hero.inclinationKeys.length > 0) {
      resolve(FieldKeys.HeroInclinations);
      hero.inclinationKeys.forEach(resolve);
    }
  }

  for (const response of model.responses) {
    resolve(response.heroDisplayNameKey);
    resolve(actionKey(response.action));

    for (const reason of response.reasons) {
      resolve(reason.reasonCode);

      if (reason.sourceDisplayNameKey !== null) {
        resolve(reason.sourceDisplayNameKey);
      }

      resolve(reasonDirectionKey(reason.direction));
      resolve(FieldKeys.ReasonStrength);
      resolve(qualitativeKey(reason.strength));
    }

    if (response.blockedByDisplayNameKey !== null) {
      resolve(FieldKeys.ResponseBlockedBy);
      resolve(response.blockedByDisplayNameKey);
    }

    if (response.tieBreakCode !== null) {
      resolve(response.tieBreakCode);
    }

    resolve(waveredKey(response.wavered));
  }

  return texts;
}

/** SHA-256 over the texts, in order, separated, lowercase hex. */
export function snapshotHash(texts: readonly string[]): string {
  const hash = new Sha256();

  for (const text of texts) {
    hash.update(utf8Bytes(text));
    hash.update(Uint8Array.of(SEPARATOR));
  }

  return hash.hex();
}

function resolveText(catalogue: ReadonlyMap<string, string>, key: string): string {
  const text = catalogue.get(key);

  if (text === undefined) {
    throw new Error(
      `Locale catalogue has no entry for key '${key}'. A missing translation must fail loudly, ` +
        'not let the key itself reach the screen as if that were the design.'
    );
  }

  return text;
}
