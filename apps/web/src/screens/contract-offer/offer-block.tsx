import {
  OfferFieldKeys,
  OfferLeverId,
  offerPhaseKey,
  type OfferLine
} from '@oath-and-coin/presentation';

import { useText } from '../../text.tsx';

import { Captioned, KeyList, Label } from '../labels.tsx';

import { NumberField, OptionList } from './fields.tsx';
import type { OfferForm } from './offer-form.ts';
import { DisabledReason, LeverRefusal } from './refusal.tsx';

/**
 * The negotiation package as one draft block (`NEGOTIATION_SPEC` §5.1): version and
 * phase, then the three levers a player pulls together — advance, method, promised
 * bonus — and last what locking this exact package would reserve. The CK3 layout rule
 * this segment's plan names: a control that changes money shows the money it changes,
 * next to it. `lockCommitment` is that money, and the three levers above it are what
 * produces it — `advance × requiredCrew + promisedBonus` — so it closes the block
 * rather than sitting apart from what it prices.
 *
 * Advance and promised bonus are shown the same way every other objective number on
 * this screen is — a caption beside a value, `Captioned` — not as editable `<input>`
 * elements: this task draws what the model carries, and wiring a lever to a command is
 * explicitly later work (the negotiation slice's five commands are Task 16's, not this
 * screen's to dispatch; `NEGOTIATION_SPEC` §3.1 names a sixth since 2026-08-25). The method choice is a real `role="radio"` group even so,
 * because which of two named alternatives a package has chosen is a selection among a
 * closed set the way a number is not, and a screen that already draws it this way costs
 * nothing extra to keep drawing it this way once a handler lands.
 *
 * The radio group's `checked` state is not the only place the choice is visible.
 * `OfferFieldKeys.SelectedMethod` repeats it as an ordinary `Captioned` value right
 * under the group — the same text `OfferFieldKeys.Method`'s two options already carry,
 * projected a second time from `methodTagKey` directly rather than from which option
 * happens to render first. A `checked` prop is a DOM property with no text node behind
 * it, so without this second line "which alternative won" could not be told from
 * rendered text at all — see {@link OfferFieldKeys.SelectedMethod}'s own doc comment.
 */
export function OfferBlock({
  offer,
  draft,
  onDraft,
  heroDisplayNameKeyOf,
  refusal
}: {
  readonly offer: OfferLine;
  readonly draft: OfferForm;
  readonly onDraft: (next: OfferForm) => void;
  readonly heroDisplayNameKeyOf: (definition: string) => string;
  /** The last refusal, when it names one of this block's levers. */
  readonly refusal: LeverRefusal | null;
}) {
  const text = useText();

  return (
    <div className="offer">
      <Captioned captionKey={OfferFieldKeys.Version} value={String(offer.version)} />
      <Label text={text(offerPhaseKey(offer.phase))} />

      {/* Each lever in a block of its own, named by `data-lever`, so that a refusal has a
          place to stand that is provably the lever's — the browser suite asks the DOM which
          block the sentence is in. The wrappers carry no text, so the walk both hashes
          make sees exactly what it saw before them. */}
      <div className="lever-block" data-lever={OfferLeverId.Terms}>
        <div className="row lever">
          <Captioned captionKey={OfferFieldKeys.Advance} value={String(offer.advanceLever.value)} />
          <NumberField
            testId="offer.advance"
            lever={offer.advanceLever}
            value={draft.advance}
            onChange={(advance) => {
              onDraft({ ...draft, advance });
            }}
          />
          <DisabledReason lever={offer.advanceLever} />

          {offer.methodLever.options.length === 0 ? null : (
            <div className="method-options">
              <Label text={text(OfferFieldKeys.Method)} />
              {offer.methodLever.options.map((option, index) => (
                <label className="method-option" key={option.value}>
                  <input
                    type="radio"
                    name="offer-method"
                    data-testid={`method-option-${String(index)}`}
                    checked={option.value === draft.methodTag}
                    disabled={offer.methodLever.disabledReasonKey !== null}
                    onChange={() => {
                      onDraft({ ...draft, methodTag: option.value });
                    }}
                  />
                  <span className="label">{text(option.labelKey)}</span>
                </label>
              ))}
            </div>
          )}

          {offer.methodLever.options
            .filter((option) => option.selected)
            .map((option) => (
              <Captioned
                key={option.value}
                captionKey={OfferFieldKeys.SelectedMethod}
                value={text(option.labelKey)}
              />
            ))}

          <DisabledReason lever={offer.methodLever} />

          <Captioned
            captionKey={OfferFieldKeys.PromisedBonus}
            value={String(offer.bonusLever.value)}
          />
          <NumberField
            testId="offer.promised_bonus"
            lever={offer.bonusLever}
            value={draft.promisedBonus}
            onChange={(promisedBonus) => {
              onDraft({ ...draft, promisedBonus });
            }}
          />
          <DisabledReason lever={offer.bonusLever} />
        </div>
        <LeverRefusal at={OfferLeverId.Terms} refusal={refusal} />
      </div>

      {/* Both hero levers show every option before they show the choice made out of it:
          a set of alternatives a player cannot see is not a set they can choose from,
          and the crew being part of the package is the whole point of `RESOLUTION_SPEC`
          §2.5. Never gated on emptiness — a roster is never empty on a screen that has a
          contract at all (`contractOfferScreenModel`'s own `Empty` guard). */}
      <div className="lever-block" data-lever={OfferLeverId.KeyHero}>
        <OptionList
          captionKey={OfferFieldKeys.KeyHeroOptions}
          type="radio"
          name="offer-key-hero"
          prefix="key-hero"
          options={offer.keyHeroLever.options}
          disabled={offer.keyHeroLever.disabledReasonKey !== null}
          isChosen={(value) => value === draft.keyHero}
          onToggle={(keyHero) => {
            onDraft({ ...draft, keyHero });
          }}
        />

        {offer.keyHeroLever.chosen === null ? null : (
          <Captioned
            captionKey={OfferFieldKeys.KeyHero}
            value={text(heroDisplayNameKeyOf(offer.keyHeroLever.chosen))}
          />
        )}
        <DisabledReason lever={offer.keyHeroLever} />
        <LeverRefusal at={OfferLeverId.KeyHero} refusal={refusal} />
      </div>

      <div className="lever-block" data-lever={OfferLeverId.Crew}>
        <OptionList
          captionKey={OfferFieldKeys.CrewOptions}
          type="checkbox"
          name="offer-crew"
          prefix="crew"
          options={offer.crewLever.options}
          disabled={offer.crewLever.disabledReasonKey !== null}
          isChosen={(value) => draft.invited.includes(value)}
          onToggle={(value) => {
            // Kept in the options' own order rather than in the order they were ticked: the
            // engine sorts the crew into a `SortedSet` anyway (`composeOffer`), so click order
            // is a difference nothing downstream can see — and a list that reordered itself as
            // a player worked would be the same thing the owner rejected for the method
            // alternatives.
            onDraft({
              ...draft,
              invited: offer.crewLever.options
                .map((option) => option.value)
                .filter((candidate) =>
                  candidate === value
                    ? !draft.invited.includes(value)
                    : draft.invited.includes(candidate)
                )
            });
          }}
        />
        <Captioned captionKey={OfferFieldKeys.CrewSize} value={String(offer.crewLever.exactly)} />

        <KeyList
          captionKey={OfferFieldKeys.Crew}
          keys={offer.crewLever.chosen.map(heroDisplayNameKeyOf)}
        />
        <DisabledReason lever={offer.crewLever} />
        <LeverRefusal at={OfferLeverId.Crew} refusal={refusal} />
      </div>

      <div className="row budget">
        <Captioned
          captionKey={OfferFieldKeys.BudgetAvailable}
          value={String(offer.budget.available)}
        />
        <Captioned captionKey={OfferFieldKeys.MaxAdvance} value={String(offer.advanceLever.max)} />
        <Captioned captionKey={OfferFieldKeys.MaxBonus} value={String(offer.bonusLever.max)} />

        {/* Only when the package has stopped fitting — a branch on a number being zero is
            the same kind as a branch on an empty list, and "не хватает: 0" beside a
            package that fits is a heading for an absence. */}
        {offer.budget.shortfall === 0 ? null : (
          <Captioned
            captionKey={OfferFieldKeys.Shortfall}
            value={String(offer.budget.shortfall)}
            testId="offer-shortfall"
          />
        )}
      </div>

      <Captioned captionKey={OfferFieldKeys.LockCommitment} value={String(offer.lockCommitment)} />
    </div>
  );
}
