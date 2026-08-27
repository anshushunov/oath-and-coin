import { Sha256, utf8Bytes } from '@oath-and-coin/simulation';

import {
  AfterActionFieldKeys,
  ContractBoardFieldKeys,
  FieldKeys,
  OfferFieldKeys,
  SettlementFieldKeys,
  TreasuryFieldKeys,
  actionKey,
  afterActionStateKey,
  contractAvailabilityKey,
  contractBoardStateKey,
  errorKey,
  offerPhaseKey,
  reasonDirectionKey,
  screenStateKey,
  waveredKey
} from './keys.ts';
import { createAfterActionScreenModel } from './after-action-screen-model.ts';
import { createContractBoardScreenModel } from './contract-board-screen-model.ts';
import {
  createContractOfferScreenModel,
  type ContractOfferScreenModel,
  type HeroCard,
  type OfferLine,
  type PromiseTermsLine,
  type SettlementLine
} from './contract-offer-screen-model.ts';
import type { AfterActionScreenModel } from './after-action-screen-model.ts';
import type { ContractBoardScreenModel } from './contract-board-screen-model.ts';
import { ScreenKind } from './screen-kind.ts';
import type { ScreenModel } from './screen-model.ts';
import { ScreenState } from './screen-state.ts';
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
  model: ScreenModel,
  catalogue: ReadonlyMap<string, string>
): readonly string[] {
  // One walk per screen, chosen by the discriminant and by nothing else. No `default`: a
  // fourth screen does not build until somebody has said what a correctly bound version of
  // it should put on the page, which is the whole reason this union carries one.
  switch (model.screen) {
    case ScreenKind.ContractOffer:
      return contractOfferSnapshot(model, catalogue);
    case ScreenKind.AfterAction:
      return afterActionSnapshot(model, catalogue);
    case ScreenKind.ContractBoard:
      return contractBoardSnapshot(model, catalogue);
  }
}

function contractOfferSnapshot(
  model: ContractOfferScreenModel,
  catalogue: ReadonlyMap<string, string>
): readonly string[] {
  // Re-validated for the reason the read-model projection is (see its own remarks): a
  // TypeScript spread walks around the factory, and this is the second place a model
  // becomes evidence about a screen. A snapshot built from a Normal model carrying no
  // contract would describe a frame no screen can draw.
  createContractOfferScreenModel(model);

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
    resolve(FieldKeys.ContractPatronFee);
    texts.push(String(contract.patronFee));
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

  const heroDisplayNameKeyOf = displayNameKeyResolver(model.roster);

  if (model.offer !== null) {
    resolveOffer(model.offer, resolve, texts, heroDisplayNameKeyOf);
  }

  // Not gated on `contract !== null`: `NEGOTIATION_SPEC` §5.1 treats the treasury as a
  // campaign-wide fact, one `GDD` §16.3 already keeps a plain number, and it reads on
  // `Empty` exactly as it reads on `Normal` — a campaign with nothing to offer still
  // has a treasury. `Loading` and `Error` are excluded because there is no campaign
  // behind either to read one from at all (`ContractOfferScreenModel.treasury`'s own
  // doc comment): both are `0` by construction, and showing a manufactured `0` beside
  // a title that has not finished loading would claim a fact this screen does not
  // have.
  if (model.state !== ScreenState.Loading && model.state !== ScreenState.Error) {
    resolve(TreasuryFieldKeys.Treasury);
    texts.push(String(model.treasury));
    resolve(TreasuryFieldKeys.Forecast);
    texts.push(String(model.treasuryForecast));
  }

  if (model.promiseTerms !== null) {
    resolvePromiseTerms(model.promiseTerms, resolve, texts);
  }

  if (model.settlement !== null) {
    resolveSettlement(model.settlement, resolve, texts, heroDisplayNameKeyOf);
  }

  return texts;
}

/**
 * The texts a correctly bound debrief should produce (`RESOLUTION_SPEC` §6.1), in the order
 * a depth-first walk visits: the contract and the step it landed on, the feed, what each man
 * brought, the coverage, the diagnoses, what it cost people, and last the promise still to
 * be answered.
 *
 * Every content id stays out, exactly as it does on the offer screen: the read-model hash
 * covers each of them and none is a name a player reads (`TDD` §11.1). A caption is emitted
 * only when the list under it is non-empty — a heading over an absence is not a fact.
 */
function afterActionSnapshot(
  model: AfterActionScreenModel,
  catalogue: ReadonlyMap<string, string>
): readonly string[] {
  createAfterActionScreenModel(model);

  const texts: string[] = [];
  const resolve = (key: string): void => {
    texts.push(resolveText(catalogue, key));
  };

  resolve(model.titleKey);
  resolve(afterActionStateKey(model.state));

  if (model.errorCode !== null) {
    resolve(errorKey(model.errorCode));
  }

  if (model.contractDisplayNameKey !== null) {
    resolve(model.contractDisplayNameKey);
  }

  if (model.gradeKey !== null) {
    resolve(AfterActionFieldKeys.Grade);
    resolve(model.gradeKey);
  }

  if (model.events.length > 0) {
    resolve(AfterActionFieldKeys.Events);

    for (const line of model.events) {
      resolve(line.key);

      if (line.heroDisplayNameKey !== null) {
        resolve(line.heroDisplayNameKey);
      }

      if (line.needKey !== null) {
        resolve(line.needKey);
      }

      resolve(line.reasonKey);
    }
  }

  if (model.contributions.length > 0) {
    resolve(AfterActionFieldKeys.Contributions);

    for (const line of model.contributions) {
      resolve(line.heroDisplayNameKey);
      // `DEC-014`'s two numbers, each under its own caption: "100 → 50" with nothing
      // naming either side is the column a player cannot read.
      resolve(AfterActionFieldKeys.Brought);
      texts.push(String(line.amount));
      resolve(AfterActionFieldKeys.Counted);
      texts.push(String(line.counted));
      resolve(AfterActionFieldKeys.Commitment);
      resolve(line.commitmentKey);

      if (line.provenanceKeys.length > 0) {
        resolve(AfterActionFieldKeys.Provenance);
        line.provenanceKeys.forEach(resolve);
      }
    }
  }

  if (model.coverage.length > 0) {
    resolve(AfterActionFieldKeys.Coverage);

    for (const line of model.coverage) {
      resolve(line.needKey);
      resolve(line.verdictKey);
    }
  }

  if (model.deficits.length > 0) {
    resolve(AfterActionFieldKeys.Deficits);

    for (const line of model.deficits) {
      resolve(line.key);
      resolve(AfterActionFieldKeys.DeficitMagnitude);
      texts.push(String(line.magnitude));
      line.needKeys.forEach(resolve);
      line.heroes.forEach((hero) => {
        resolve(hero.displayNameKey);
      });
    }
  }

  if (model.dominantKey !== null) {
    resolve(AfterActionFieldKeys.Dominant);
    resolve(model.dominantKey);
  }

  if (model.consequences.length > 0) {
    resolve(AfterActionFieldKeys.Consequences);

    for (const line of model.consequences) {
      resolve(line.heroDisplayNameKey);
      resolve(line.kindKey);
      resolve(line.reasonKey);
      resolve(AfterActionFieldKeys.ConsequenceMagnitude);
      texts.push(String(line.magnitude));
    }
  }

  const { settlement } = model;

  if (settlement !== null) {
    resolve(AfterActionFieldKeys.PatronPays);
    texts.push(String(settlement.patronPays));
    resolve(OfferFieldKeys.PromisedBonus);
    texts.push(String(settlement.promisedBonus));

    if (settlement.keyHero !== null) {
      resolve(OfferFieldKeys.KeyHero);
      resolve(settlement.keyHero.displayNameKey);
    }

    if (settlement.crew.length > 0) {
      resolve(SettlementFieldKeys.Crew);
      settlement.crew.forEach((hero) => {
        resolve(hero.displayNameKey);
      });
    }

    resolve(SettlementFieldKeys.TreasuryIfKept);
    texts.push(String(settlement.treasuryIfKept));
    resolve(SettlementFieldKeys.TreasuryIfBroken);
    texts.push(String(settlement.treasuryIfBroken));
  }

  return texts;
}

/**
 * The texts a correctly bound board should produce: the title, which of the five shapes it
 * is, the guild's money, and one block per contract — its name, its fee, its seats, what it
 * asks for and how far it has got.
 */
function contractBoardSnapshot(
  model: ContractBoardScreenModel,
  catalogue: ReadonlyMap<string, string>
): readonly string[] {
  createContractBoardScreenModel(model);

  const texts: string[] = [];
  const resolve = (key: string): void => {
    texts.push(resolveText(catalogue, key));
  };

  resolve(model.titleKey);
  resolve(contractBoardStateKey(model.state));

  if (model.errorCode !== null) {
    resolve(errorKey(model.errorCode));
  }

  // The treasury on every state that has a campaign behind it, and on neither of the two
  // that do not — the same gate the offer screen keeps, for the same reason: a manufactured
  // `0` beside a title that has not finished loading claims a fact this screen does not
  // have.
  if (model.state !== ScreenState.Loading && model.state !== ScreenState.Error) {
    resolve(TreasuryFieldKeys.Treasury);
    texts.push(String(model.treasury));
  }

  for (const row of model.rows) {
    resolve(row.displayNameKey);
    resolve(FieldKeys.ContractPatronFee);
    texts.push(String(row.patronFee));
    resolve(FieldKeys.ContractRequiredCrew);
    texts.push(String(row.requiredCrew));

    if (row.needKeys.length > 0) {
      resolve(ContractBoardFieldKeys.Needs);
      row.needKeys.forEach(resolve);
    }

    resolve(ContractBoardFieldKeys.Availability);
    resolve(contractAvailabilityKey(row.availability));
  }

  return texts;
}

/**
 * The negotiation package (`NEGOTIATION_SPEC` §5.1): version and phase first — the two
 * facts about the package itself, rather than its terms — then the three levers a
 * player pulls (advance, method, promised bonus) in the order the screen groups them
 * as one draft block, the key hero the package names when it names one, and last the
 * reservation locking it would make, which is the price those three levers together
 * produce.
 *
 * The method choice is two entries, not one: {@link OfferFieldKeys.Method} names both
 * alternatives, and {@link OfferFieldKeys.SelectedMethod} — separately — names the one
 * actually chosen. Folding the second into "whichever alternative sorts first" would
 * make a wrong selection unprovable by this function's own output.
 */
function resolveOffer(
  offer: OfferLine,
  resolve: (key: string) => void,
  texts: string[],
  heroDisplayNameKeyOf: (definition: string) => string
): void {
  resolve(OfferFieldKeys.Version);
  texts.push(String(offer.version));
  resolve(offerPhaseKey(offer.phase));

  resolve(OfferFieldKeys.Advance);
  texts.push(String(offer.advance));

  // Both alternatives, in whatever order `OfferLine.methodOptionKeys` carries them
  // (`methodOptionKeysOf` puts the chosen one first, but this function does not lean
  // on that — a player choosing between two things has to see both, in *some* stated
  // order, and an empty list means the contract carries no negotiable tag at all, so
  // there is no caption for nothing to choose between).
  if (offer.methodOptionKeys.length > 0) {
    resolve(OfferFieldKeys.Method);
    offer.methodOptionKeys.forEach(resolve);
  }

  // Which one is *chosen*, projected as its own ordinary value — never inferred from
  // position in the list above. A radio's `checked` state has no text representation
  // at all, so without this line "which alternative won" is provable only by reading a
  // DOM property no walk over rendered text (`collectRenderedTexts`, this function's
  // own caller) can see. `null` exactly when nothing has been chosen yet, the same gate
  // {@link OfferLine.methodTagKey}'s own doc keeps.
  if (offer.methodTagKey !== null) {
    resolve(OfferFieldKeys.SelectedMethod);
    resolve(offer.methodTagKey);
  }

  resolve(OfferFieldKeys.PromisedBonus);
  texts.push(String(offer.promisedBonus));

  if (offer.keyHeroDefinition !== null) {
    resolve(OfferFieldKeys.KeyHero);
    resolve(heroDisplayNameKeyOf(offer.keyHeroDefinition));
  }

  resolve(OfferFieldKeys.LockCommitment);
  texts.push(String(offer.lockCommitment));
}

/**
 * The two predicates of the promise (`NEGOTIATION_SPEC` §5.1, §5.2) and the amount
 * they are both about — the same amount {@link resolveOffer} already showed under
 * {@link OfferFieldKeys.PromisedBonus}, shown again here because it belongs to this
 * sentence too, not because it is a second fact.
 */
function resolvePromiseTerms(
  promiseTerms: PromiseTermsLine,
  resolve: (key: string) => void,
  texts: string[]
): void {
  resolve(promiseTerms.fulfilKey);
  resolve(promiseTerms.breachKey);
  resolve(OfferFieldKeys.PromisedBonus);
  texts.push(String(promiseTerms.bonus));
}

/**
 * What the promise costs and who is bound by it, once there is a crew to bind
 * (`NEGOTIATION_SPEC` §5.1). `Crew` is skipped on an empty list for the same reason
 * {@link FieldKeys.ContractTags} is: a caption over nothing is a heading for an
 * absence, not a fact.
 */
function resolveSettlement(
  settlement: SettlementLine,
  resolve: (key: string) => void,
  texts: string[],
  heroDisplayNameKeyOf: (definition: string) => string
): void {
  resolve(OfferFieldKeys.PromisedBonus);
  texts.push(String(settlement.promisedBonus));

  if (settlement.keyHeroDefinition !== null) {
    resolve(OfferFieldKeys.KeyHero);
    resolve(heroDisplayNameKeyOf(settlement.keyHeroDefinition));
  }

  if (settlement.crew.length > 0) {
    resolve(SettlementFieldKeys.Crew);
    settlement.crew.forEach((definition) => {
      resolve(heroDisplayNameKeyOf(definition));
    });
  }

  resolve(SettlementFieldKeys.TreasuryIfKept);
  texts.push(String(settlement.treasuryIfKept));
  resolve(SettlementFieldKeys.TreasuryIfBroken);
  texts.push(String(settlement.treasuryIfBroken));
}

/**
 * A hero's display-name key, joined from the raw content id {@link OfferLine} and
 * {@link SettlementLine} carry for bookkeeping — the same convention
 * {@link ResponseLine.heroDefinition} uses, and the same lookup both screens this
 * projection serves have to build for themselves. Built once per call rather than
 * searched per id: `model.roster` is small, but a linear search repeated for every
 * crew member is the kind of quadratic cost a reviewer has to re-derive is harmless
 * every time this file changes.
 *
 * @throws when `definition` names nobody in the roster — a content-loading or
 * roster-building bug this projection refuses to paper over, the same refusal
 * {@link resolveSourceDisplayNameKey} already makes for a comrade-sourced reason.
 */
function displayNameKeyResolver(roster: readonly HeroCard[]): (definition: string) => string {
  const byDefinition = new Map(roster.map((hero) => [hero.definition, hero.displayNameKey]));

  return (definition) => {
    const key = byDefinition.get(definition);

    if (key === undefined) {
      throw new Error(
        `The negotiation package names hero '${definition}', but the roster this model carries ` +
          'has no display-name key for it — a content-loading or roster-building bug, not a hero ' +
          'with no name.'
      );
    }

    return key;
  };
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
