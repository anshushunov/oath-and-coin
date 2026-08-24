import { createContext, useContext, useMemo, type ReactNode } from 'react';

/**
 * The port of C#'s `TextSource`: the one way a key becomes a string a player reads.
 *
 * `TDD` §11.1 makes every player-facing string a catalogue entry, so a screen that
 * cannot resolve a key has nothing legitimate to show. This module's whole job is to
 * make that failure loud. The C# original threw on a missing key for the same reason,
 * and the reason is worth restating: the alternative — falling back to the key itself
 * — produces a screen that renders, passes a smoke test, and shows
 * `field.contract.patron_fee` to a player.
 *
 * **Context rather than a parameter, and that is a deviation from the segment plan
 * worth naming.** §4 of the plan writes it as `useText(catalogue)`, which mirrors C#,
 * where a `TextSource` was threaded through every `Build*` method because a static
 * method has no other way to receive one. React has another way, and what it buys is
 * ordinary: the catalogue is a dependency of the whole run rather than a property of
 * any component, so it is injected once at the top instead of appearing in the
 * signature of every component between there and the label that needs it. The failure
 * mode also improves — a component rendered with no provider above it fails the render
 * (see below) rather than receiving whatever the nearest caller happened to have.
 *
 * What this is *not* is a guarantee that one run resolves against one catalogue. A
 * nested `TextSource` overrides the one above it, exactly as any React context does;
 * external review of this task corrected an earlier version of this comment that
 * claimed otherwise. Nothing in the screen nests one, and if single-catalogue ever
 * becomes an invariant worth having, it needs a check of its own rather than a
 * mechanism that reads as if it were one.
 *
 * What does *not* move into context is the catalogue the tests resolve against:
 * `expectedSnapshot(model, catalogue)` takes it as an argument, and the two lists it
 * and the screen produce stay the products of unrelated code paths — which is the
 * only reason comparing them proves anything (see `rendered-ui-snapshot.ts`).
 */

/** Resolves one localization key to the text a player reads. Throws when it cannot. */
export type ResolveText = (key: string) => string;

const CatalogueContext = createContext<ReadonlyMap<string, string> | null>(null);

/**
 * Makes `catalogue` the one catalogue every screen below resolves against.
 *
 * Named for what it replaces: this is `TextSource`, with the subtree it serves stated
 * by where it sits rather than by who remembered to pass it on.
 */
export function TextSource({
  catalogue,
  children
}: {
  readonly catalogue: ReadonlyMap<string, string>;
  readonly children: ReactNode;
}) {
  return <CatalogueContext.Provider value={catalogue}>{children}</CatalogueContext.Provider>;
}

/**
 * The resolver for the catalogue above this component.
 *
 * @throws when no {@link TextSource} is above it, or when the catalogue has no entry
 * for a key it is asked to resolve.
 */
export function useText(): ResolveText {
  const catalogue = useContext(CatalogueContext);

  // The `null` check lives inside the memo rather than before it: a hook called after
  // a conditional throw is a hook whose position in the call order depends on a value,
  // which is the one thing `rules-of-hooks` exists to prevent.
  return useMemo(() => {
    if (catalogue === null) {
      throw new Error(
        'useText was called with no TextSource above it. A screen with no catalogue can resolve ' +
          'no key, and every label on it would be a key or a blank.'
      );
    }

    return (key: string): string => {
      const text = catalogue.get(key);

      if (text === undefined) {
        throw new Error(
          `Locale catalogue has no entry for key '${key}'. A missing translation must fail ` +
            'loudly, not let the key itself reach the screen as if that were the design.'
        );
      }

      return text;
    };
  }, [catalogue]);
}
