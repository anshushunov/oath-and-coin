import { useText } from '../../text.tsx';

/**
 * The three primitives every block of the contract-offer screen is built from —
 * `BuildLabel`, `AddCaptioned` and `AddKeyList` of the Godot original, with the
 * rules they carried intact.
 *
 * They are components rather than helpers because that is what makes the rules
 * enforceable: a caption and its value are two elements produced by one component, so
 * there is no call site at which somebody can compose them into one string, and an
 * empty list produces nothing at all rather than a heading over an absence.
 */

/**
 * One text, in one element, holding exactly one text node.
 *
 * The whole of what the screen may put on the page. Nothing here concatenates,
 * interpolates or punctuates: word order and punctuation between a caption and its
 * value differ by language, so both live in the catalogue with the words
 * (`FieldKeys`).
 */
export function Label({ text }: { readonly text: string }) {
  return <span className="label">{text}</span>;
}

/**
 * A caption and the value it names, side by side — two labels, never one composed
 * string.
 *
 * External review of the Godot screen found what the captions are for: the frame
 * showed `40`, `4`, `3` and a run of qualitative grades stacked with nothing saying
 * which was the payment, which the crew, and which of greed, caution and pride each
 * grade belonged to. Both hashes were green, and correctly — every one of those texts
 * was the right text for its field.
 *
 * `captionKey` is a key and `value` is already resolved text, because the two are
 * different kinds of thing: a caption is always a catalogue entry, while a value is
 * sometimes one (a qualitative grade) and sometimes an objective number the model
 * carries literally (`payment`, `requiredCrew`, `acceptedCount`).
 */
export function Captioned({
  captionKey,
  value
}: {
  readonly captionKey: string;
  readonly value: string;
}) {
  const text = useText();

  return (
    <div className="captioned">
      <Label text={text(captionKey)} />
      <Label text={value} />
    </div>
  );
}

/**
 * A captioned row of localization keys — a hero's principles, a contract's tags — or
 * nothing at all when the list is empty.
 *
 * The branch is on whether a model list is empty, never on what is in it, and
 * `expectedSnapshot` makes the identical decision from the identical field. That
 * agreement is what lets the two lists be compared: a screen that drew a caption over
 * an empty list would produce a text the snapshot does not, on exactly the models
 * where the list happens to be empty.
 */
export function KeyList({
  captionKey,
  keys
}: {
  readonly captionKey: string;
  readonly keys: readonly string[];
}) {
  const text = useText();

  if (keys.length === 0) {
    return null;
  }

  return (
    <div className="key-list">
      <Label text={text(captionKey)} />
      {keys.map((key) => (
        <Label key={key} text={text(key)} />
      ))}
    </div>
  );
}
