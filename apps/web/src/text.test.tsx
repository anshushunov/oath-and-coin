// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';

import { render } from './testing/render.tsx';
import { TextSource, useText } from './text.tsx';

/**
 * The port of `TextSource.Resolve`, and the two ways it is allowed to fail.
 *
 * Both are about the same rule (`TDD` §11.1: every player-facing string is a
 * catalogue entry) seen from opposite ends: a key the catalogue cannot answer, and a
 * screen with no catalogue at all. The tempting behaviour in either case is to render
 * something — the key itself, or a blank — and both produce a page that mounts, passes
 * a smoke test and shows `field.contract.payment` to a player.
 */

function Resolved({ textKey }: { readonly textKey: string }) {
  const text = useText();

  return <span>{text(textKey)}</span>;
}

describe('useText', () => {
  it('resolves a key through the catalogue above it', () => {
    const container = render(
      <TextSource catalogue={new Map([['field.contract.payment', 'Оплата']])}>
        <Resolved textKey="field.contract.payment" />
      </TextSource>
    );

    expect(container.textContent).toBe('Оплата');
  });

  it('fails the render on a key the catalogue does not carry', () => {
    expect(() =>
      render(
        <TextSource catalogue={new Map()}>
          <Resolved textKey="field.contract.payment" />
        </TextSource>
      )
    ).toThrow(/no entry for key 'field[.]contract[.]payment'/u);
  });

  it('fails the render when nothing put a catalogue above it', () => {
    // The failure mode a default would hide. A component rendered outside the
    // provider is wiring that was never done, and answering it with an empty
    // catalogue — or with the key — turns that into a screen somebody has to read to
    // notice.
    expect(() => render(<Resolved textKey="field.contract.payment" />)).toThrow(
      /no TextSource above it/u
    );
  });
});
