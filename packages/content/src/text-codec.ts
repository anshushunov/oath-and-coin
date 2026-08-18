/**
 * The two text operations this package needs, declared narrowly instead of borrowed
 * from a whole standard library.
 *
 * `TextDecoder` and `TextEncoder` exist in Node, in every browser and in Electron, but
 * they are declared by `lib.dom.d.ts` and by `@types/node` and by nothing in `ES2023`.
 * That left every project compiling this package's sources needing one of those two,
 * and `packages/application` — which is inside the browser bundle and must not touch
 * the DOM — took `lib: ["DOM"]` to get them.
 *
 * External review measured what that bought along with them: `location`, `fetch`,
 * `localStorage` and every DOM constructor typechecked in the application layer, where
 * a `no-restricted-globals` rule banned three names by hand. A ban written as a list of
 * three is the same defect shape the boundary rules were repaired for twice (§5.6,
 * §11.2) — it misses whatever is reached for next.
 *
 * So the declarations are here, in the one package that uses them, and they describe
 * exactly the two constructions this package makes. Nothing else about the DOM becomes
 * visible anywhere, and `packages/application` compiles under plain `ES2023` again.
 *
 * A hand-written UTF-8 decoder was the other way out and is not needed for this: the
 * runtime has the decoder, only the compiler was missing its type.
 */

declare const TextDecoder: {
  new (
    label: string,
    options: { readonly fatal: boolean }
  ): { decode(bytes: Uint8Array): string };
};

declare const TextEncoder: {
  new (): { encode(text: string): Uint8Array };
};

/**
 * UTF-8 text from bytes, refusing anything that is not valid UTF-8.
 *
 * `fatal: true` is the whole point: content is external data, and a decoder that
 * substituted `U+FFFD` for a corrupted byte would hand the loader a string nobody
 * authored and let it validate cleanly.
 */
export function decodeUtf8OrThrow(bytes: Uint8Array): string {
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

/** UTF-8 bytes from text. */
export function encodeUtf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}
