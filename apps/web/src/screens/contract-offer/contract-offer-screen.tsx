import {
  FieldKeys,
  actionKey,
  errorKey,
  qualitativeKey,
  reasonDirectionKey,
  screenStateKey,
  waveredKey,
  type ContractLine,
  type ContractOfferScreenModel,
  type HeroCard,
  type ResponseLine
} from '@oath-and-coin/presentation';

import { useText } from '../../text.tsx';

import { Captioned, KeyList, Label } from './labels.tsx';

/**
 * The first product screen of the new stack: a rendering of one
 * `ContractOfferScreenModel`, built from that model and the catalogue above it and
 * from nothing else. The port of `game/ui/ContractOfferScreen.cs`, node for node.
 *
 * **This screen decides nothing.** Every field the model carries becomes at most one
 * label, in a fixed order, with no branch on a field's *value* beyond
 * {@link ContractOfferScreenModel.state} deciding which blocks exist at all — the
 * same "any other branch means the model was incomplete" rule the factory is held to.
 * Reading a screen-state key off `state` is that one allowed branch rather than an
 * exception to it. The remaining branches are all of one other kind: whether a model
 * field is `null` (a reason's source name, a response's blocker, a tie-break) or a
 * model list is empty (a hero's principles, a contract's tags) — never on what is in
 * it. `expectedSnapshot` makes the identical decisions from the identical fields.
 *
 * **No raw identifier becomes a label.** Every field that is a localization key is
 * resolved before it reaches one; every field that carries a content id purely for
 * the model's own bookkeeping — a contract's `definition`, a hero's `definition`, a
 * response's `heroDefinition`, a reason's `sourceEntity`, a blocking entity — is not
 * shown at all. It is not a name a player reads, showing it beside the resolved name
 * it duplicates is the raw-identifier leak `TDD` §11.1 forbids, and `readModelHash`
 * already covers every one of them without help from here. The three objective
 * numbers the spec calls out on purpose — payment, required crew, accepted count —
 * are the one kind of value shown literally, because they were never keys.
 * `errorDetail` does not reach this screen at all: it is assembled in code, carries a
 * machine's own path, and neither hash covers it.
 *
 * **Node order is the wire format.** This renders exactly one text per entry
 * `expectedSnapshot` puts in its list, in the same order, and nothing else. Which
 * element a text hangs off does not enter into it — `collectRenderedTexts` is a
 * document-order walk, so a row laying a caption and its value out side by side
 * visits them in the same order a column would. The roster and the responses are two
 * columns for the reason the Godot original made them two: a single stack of six hero
 * cards followed by six response blocks is twice as tall as the window and pushes
 * every response below the fold. A depth-first walk still visits every roster text
 * before every response text, so that is a layout choice and not a change to the
 * order the snapshot states.
 */
export function ContractOfferScreen({ model }: { readonly model: ContractOfferScreenModel }) {
  const text = useText();

  return (
    <section className="contract-offer" data-testid="contract-offer-screen">
      <Label text={text(model.titleKey)} />
      <Label text={text(screenStateKey(model.state))} />

      {model.errorCode === null ? null : <Label text={text(errorKey(model.errorCode))} />}

      {model.contract === null ? null : <ContractBlock contract={model.contract} />}

      {model.roster.length === 0 && model.responses.length === 0 ? null : (
        <div className="columns">
          <div className="roster">
            {model.roster.map((hero) => (
              <HeroCardBlock key={hero.definition} hero={hero} />
            ))}
          </div>
          <div className="responses">
            {model.responses.map((response) => (
              <ResponseBlock key={response.heroDefinition} response={response} />
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

/**
 * The offer itself: its name, the four facts about it, and its tags when it has any.
 *
 * The four facts share one row so that they read as four facts rather than as a
 * column of unexplained numbers.
 */
function ContractBlock({ contract }: { readonly contract: ContractLine }) {
  const text = useText();

  return (
    <div className="contract">
      <Label text={text(contract.displayNameKey)} />

      <div className="row">
        <Captioned captionKey={FieldKeys.ContractPayment} value={String(contract.payment)} />
        <Captioned
          captionKey={FieldKeys.ContractRisk}
          value={text(qualitativeKey(contract.risk))}
        />
        <Captioned
          captionKey={FieldKeys.ContractRequiredCrew}
          value={String(contract.requiredCrew)}
        />
        <Captioned
          captionKey={FieldKeys.ContractAcceptedCount}
          value={String(contract.acceptedCount)}
        />
      </div>

      <KeyList captionKey={FieldKeys.ContractTags} keys={contract.tagKeys} />
    </div>
  );
}

/**
 * One hero: their name and three scales on one line, then whichever of their
 * principles and inclinations they have.
 *
 * The name and the scales share a row because six heroes at four lines each fill a
 * 720px window on their own, and a hero's scales belong beside the hero rather than
 * under them.
 */
function HeroCardBlock({ hero }: { readonly hero: HeroCard }) {
  const text = useText();

  return (
    <div className="hero">
      <div className="row">
        <Label text={text(hero.displayNameKey)} />
        <Captioned captionKey={FieldKeys.HeroGreed} value={text(qualitativeKey(hero.greed))} />
        <Captioned captionKey={FieldKeys.HeroCaution} value={text(qualitativeKey(hero.caution))} />
        <Captioned captionKey={FieldKeys.HeroPride} value={text(qualitativeKey(hero.pride))} />
      </div>

      <KeyList captionKey={FieldKeys.HeroPrinciples} keys={hero.principleKeys} />
      <KeyList captionKey={FieldKeys.HeroInclinations} keys={hero.inclinationKeys} />
    </div>
  );
}

/**
 * One hero's answer: what they said, why, what stopped them if anything did, what
 * settled a dead heat if there was one, and whether their mood turned the answer.
 */
function ResponseBlock({ response }: { readonly response: ResponseLine }) {
  const text = useText();

  return (
    <div className="response">
      <div className="row">
        <Label text={text(response.heroDisplayNameKey)} />
        <Label text={text(actionKey(response.action))} />
      </div>

      {response.reasons.map((reason, index) => (
        // Keyed by position, which is honest here rather than lazy: reasons carry no
        // identity of their own — two `stands_with_comrade` lines about two different
        // comrades are distinguished by `sourceEntity`, which a blocked line does not
        // have at all — and the list is rebuilt whole whenever the model changes, so
        // there is no reordering for a key to survive.
        <div className="row reason" key={index}>
          <Label text={text(reason.reasonCode)} />

          {/* A branch on whether this reason carries a source worth naming — a model
              fact, never a branch on the reason's code. `payment_attractive` names the
              contract and `trusts_the_guild` names the responding hero, both already
              on this screen, so the factory leaves the key null for them rather than
              the screen deciding to skip it. */}
          {reason.sourceDisplayNameKey === null ? null : (
            <Label text={text(reason.sourceDisplayNameKey)} />
          )}

          {/* Which way this reason pulled relative to the answer above it — read off
              the model, never worked out here from the action. A risk that pushed
              toward refusal supports a refusal and opposes an acceptance, and the
              screen has no business deciding which. */}
          <Label text={text(reasonDirectionKey(reason.direction))} />
          <Captioned
            captionKey={FieldKeys.ReasonStrength}
            value={text(qualitativeKey(reason.strength))}
          />
        </div>
      ))}

      {/* Same shape of branch as above: on a model field being null, never on a code.
          A block names its own principle so the screen does not have to guess one from
          the hero, and stays its own line so "too risky" reads differently from "will
          not do this at all". */}
      {response.blockedByDisplayNameKey === null ? null : (
        <div className="row">
          <Label text={text(FieldKeys.ResponseBlockedBy)} />
          <Label text={text(response.blockedByDisplayNameKey)} />
        </div>
      )}

      {/* The rule that settled a dead heat, when there was one. The decision with no
          reasons at all is exactly the one that most needs a line saying what decided
          it. */}
      {response.tieBreakCode === null ? null : <Label text={text(response.tieBreakCode)} />}

      <Label text={text(waveredKey(response.wavered))} />
    </div>
  );
}
