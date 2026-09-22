import type { ChoiceOption, ContentId, NumericLever } from '@oath-and-coin/presentation';

import { useText } from '../../text.tsx';

import { Label } from '../labels.tsx';

/**
 * A number a player may move, beside the number the package already records.
 *
 * Both, not one: the caption above it shows what the campaign has *recorded*, which is what
 * `expectedSnapshot` describes and what the rendered-UI hash compares — an input's value is
 * a DOM property with no text node behind it, so a screen that replaced the text with a
 * control would have made the recorded term unprovable from the frame. The input is what is
 * being assembled; the text beside it is what stands.
 *
 * `min` and `max` come off the lever, so the control cannot be moved past a bound the engine
 * would refuse — and `disabled` off the same lever's reason, so a locked package is not
 * merely refused after the fact.
 */
export function NumberField({
  testId,
  lever,
  value,
  onChange
}: {
  readonly testId: string;
  readonly lever: NumericLever;
  readonly value: number;
  readonly onChange: (value: number) => void;
}) {
  return (
    <input
      type="number"
      className="lever-input"
      data-testid={testId}
      min={lever.min}
      max={lever.max}
      // Every money term of a package is an integer, all the way down to the canonical
      // artifact (`RESOLUTION_SPEC` §4.8), and `step` is what makes the control itself say
      // so — the handler below is the second line of defence, not the only one.
      step={1}
      value={String(value)}
      disabled={lever.disabledReasonKey !== null}
      onChange={(event) => {
        // **`valueAsNumber`, never `parseInt` over the text.** External review found what
        // the difference costs: `input[type=number]` legitimately accepts `1e1` and `1.5`,
        // and `Number.parseInt` reads both as `1` — so a player who typed ten got one, a
        // player who typed one and a half got one, and in each case the package carried a
        // term nobody entered with nothing on screen saying so. The browser's own parse
        // reads `1e1` as ten.
        const typed = event.target.valueAsNumber;

        // Anything that is not a whole number leaves the term where it was: an empty box is
        // `NaN`, and a player midway through clearing a field has not said "nothing"; a
        // fraction is a number this package cannot carry at all. Silence beats a value
        // nobody typed — the last one they did type still stands, and the control shows it.
        if (Number.isInteger(typed)) {
          onChange(typed);
        }
      }}
    />
  );
}

/**
 * A closed set of options a player picks from — one of them, or several.
 *
 * Renders exactly the texts {@link KeyList} did before a handler existed, in the same order,
 * so the second hash sees no difference between a list a player can act on and a list they
 * could only read. What changed is what sits beside each name.
 */
export function OptionList({
  captionKey,
  type,
  name,
  prefix,
  options,
  disabled,
  isChosen,
  onToggle
}: {
  readonly captionKey: string;
  readonly type: 'radio' | 'checkbox';
  readonly name: string;
  readonly prefix: string;
  readonly options: readonly ChoiceOption<ContentId>[];
  readonly disabled: boolean;
  readonly isChosen: (value: ContentId) => boolean;
  readonly onToggle: (value: ContentId) => void;
}) {
  const text = useText();

  if (options.length === 0) {
    return null;
  }

  return (
    <div className="key-list">
      <Label text={text(captionKey)} />
      {options.map((option, index) => (
        <label className="option" key={option.value}>
          <input
            type={type}
            name={name}
            // Positional, never the option's own id:  asserts
            // that no content id reaches *any* attribute, not only the ones a player reads,
            // and a hook carrying one would put the raw identifier back on the page through
            // the one door that walk exists to watch.
            data-testid={`${prefix}-option-${String(index)}`}
            checked={isChosen(option.value)}
            disabled={disabled}
            onChange={() => {
              onToggle(option.value);
            }}
          />
          <span className="label">{text(option.labelKey)}</span>
        </label>
      ))}
    </div>
  );
}
