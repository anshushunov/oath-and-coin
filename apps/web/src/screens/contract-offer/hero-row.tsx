import {
  FieldKeys,
  HeroStance,
  QUALITATIVE_GRADES,
  actionKey,
  qualitativeKey,
  reasonDirectionKey,
  waveredKey,
  type HeroOfferRow,
  type QualitativeGrade,
  type ResponseLine
} from '@oath-and-coin/presentation';

import { useText } from '../../text.tsx';
import { Tag, type TagRole } from '../../ui/tag.tsx';

import { Captioned, KeyList, Label } from '../labels.tsx';

/**
 * The chip each stance wears. A table rather than a branch: which stance a row is in was
 * decided once, by `heroOfferRows`, and the screen only looks the colour up.
 *
 * `Unanswered` is in the table only because the table is total — a hero with no answer
 * draws no chip at all, so its entry is never read.
 */
const STANCE_TAG: Readonly<Record<HeroStance, TagRole>> = {
  [HeroStance.Refused]: 'against',
  [HeroStance.Blocked]: 'blocked',
  [HeroStance.Accepted]: 'favour',
  [HeroStance.Unanswered]: 'status'
};

/**
 * One hero and his answer on one card (spec §4.3): the name with what he said and whether
 * his mood turned it, then his three scales, then why.
 *
 * The owner could not read the screen when the card and the answer were two columns joined
 * by name; this is the same texts, paired. The row's edge takes the stance's colour and the
 * answer is a chip — both only doubles of a word already on the card (`GDD` §16.6), never
 * the only place a meaning is carried.
 *
 * **What is drawn and not written.** The arrow before a reason and the pips after its
 * strength are marks with no text node: the arrow is `direction` as a picture and the pips
 * are the grade as a length, and the words for both — "За решение", "Сила: Умеренно" — are
 * on the row beside them. So they stay out of both hashes, which compare texts, and a
 * screen reader skips them (`aria-hidden`) rather than reading an arrow aloud.
 *
 * Every branch here is on a field being `null` or a list being empty, never on what is in
 * it — `expectedSnapshot` makes the identical decisions from the identical fields.
 */
export function HeroRow({ row }: { readonly row: HeroOfferRow }) {
  const text = useText();
  const { hero, response, stance } = row;

  return (
    <article className="hero-row" data-stance={stance} data-testid="hero-row">
      <div className="hero-row-head">
        <Label text={text(hero.displayNameKey)} />

        {response === null ? null : (
          <>
            <Tag role={STANCE_TAG[stance]} word={text(actionKey(response.action))} />
            <span className="wavered" data-wavered={String(response.wavered)}>
              {text(waveredKey(response.wavered))}
            </span>
          </>
        )}
      </div>

      <div className="row hero-row-scales">
        <Captioned captionKey={FieldKeys.HeroGreed} value={text(qualitativeKey(hero.greed))} />
        <Captioned captionKey={FieldKeys.HeroCaution} value={text(qualitativeKey(hero.caution))} />
        <Captioned captionKey={FieldKeys.HeroPride} value={text(qualitativeKey(hero.pride))} />
      </div>

      <KeyList captionKey={FieldKeys.HeroPrinciples} keys={hero.principleKeys} />
      <KeyList captionKey={FieldKeys.HeroInclinations} keys={hero.inclinationKeys} />

      {response === null ? null : <Why response={response} />}
    </article>
  );
}

/** Why he answered as he did: the reasons, the principle that closed it, the tie-break. */
function Why({ response }: { readonly response: ResponseLine }) {
  const text = useText();

  return (
    <>
      {response.reasons.map((reason, index) => (
        // Keyed by position, which is honest here rather than lazy: reasons carry no
        // identity of their own, and the list is rebuilt whole whenever the model changes.
        <div className="row reason" data-direction={reason.direction} key={index}>
          <span className="mark" aria-hidden="true" />
          <Label text={text(reason.reasonCode)} />

          {/* A branch on whether this reason carries a source worth naming — a model
              fact, never a branch on the reason's code. */}
          {reason.sourceDisplayNameKey === null ? null : (
            <Label text={text(reason.sourceDisplayNameKey)} />
          )}

          {/* Which way this reason pulled relative to the answer — read off the model,
              never worked out here from the action. */}
          <Label text={text(reasonDirectionKey(reason.direction))} />
          <Captioned
            captionKey={FieldKeys.ReasonStrength}
            value={text(qualitativeKey(reason.strength))}
          />
          <Pips grade={reason.strength} />
        </div>
      ))}

      {/* A red line has no strength to rank, so it gets a cross instead of an arrow and no
          pips: "will not do this at all" must not read as a strong "too risky". */}
      {response.blockedByDisplayNameKey === null ? null : (
        <div className="row reason" data-direction="blocked">
          <span className="mark" aria-hidden="true" />
          <Label text={text(FieldKeys.ResponseBlockedBy)} />
          <Label text={text(response.blockedByDisplayNameKey)} />
        </div>
      )}

      {/* The rule that settled a dead heat, when there was one. */}
      {response.tieBreakCode === null ? null : <Label text={text(response.tieBreakCode)} />}
    </>
  );
}

/**
 * A grade as a length: one lit pip per step of the five-step scale up to this one.
 *
 * The same kind of mapping `Bar` makes from a number to a width — a picture of a value the
 * row already states in words — and not a branch on what the grade means.
 */
function Pips({ grade }: { readonly grade: QualitativeGrade }) {
  const reached = QUALITATIVE_GRADES.indexOf(grade);

  return (
    <span className="pips" aria-hidden="true">
      {QUALITATIVE_GRADES.map((step, index) => (
        <i key={step} data-lit={String(index <= reached)} />
      ))}
    </span>
  );
}
