import type { ContentFileSource } from '@oath-and-coin/content';

import type { SaveSlot } from './save/slots.ts';

/**
 * What the application needs from the outside, and nothing else.
 *
 * `ContentSourcePort` was, for most of this segment, the one port in this file with
 * an implementation. `apps/web` builds a {@link ContentFileSource} from
 * `import.meta.glob`, `@oath-and-coin/content/node` builds one from a directory, and
 * both satisfy this without knowing about each other.
 *
 * This comment used to name `SavePort` alongside `DesktopPort` as "easy to imagine
 * and deliberately not written": a port with no implementation is a shape guessed in
 * advance, and the first real caller always wants a slightly different one — at which
 * point the guess has to be changed by whoever least wants to change it. That was true
 * of `SaveStorePort` until it stopped being a guess: `apps/web/src/save/indexeddb-store.ts`
 * (Task 16.5) is its first real caller and its first real implementation, both at
 * once, so the interface below is no longer a shape written in advance of anyone
 * needing it. `DesktopPort` has no such caller yet and stays unwritten for exactly the
 * original reason.
 *
 * Why a port at all rather than passing the two sources around: the load sequence
 * asks two different questions about files — "the scenario's own" and "the content
 * root this manifest decided on" — and only the second is a lookup. Handing a caller
 * one object with both answers is what stops each caller inventing its own way to
 * resolve a content root, which is the defect external review already found once in
 * this repository (`FULL_TYPESCRIPT_MIGRATION` §10.2: the CLI and the parity checker
 * each ran `screen_error` against the production tree).
 */
export interface ContentSourcePort {
  /** The scenario directory: `<scenario>.manifest.json` and `<scenario>.commands.json`. */
  readonly scenarios: ContentFileSource;

  /**
   * The content root at a repository-relative path, or `null` when there is none.
   *
   * `null` rather than a throw because an absent content root is a result the game
   * shows a player: `CONTENT_ROOT_NOT_FOUND` is one of the five stable error codes,
   * and `screen_error` is a shipped scenario whose whole purpose is to reach it.
   */
  openContentRoot(repositoryRelativePath: string): ContentFileSource | null;
}

/**
 * The slot store a save screen reads and writes through — the second port beside
 * {@link ContentSourcePort}, for the same shape of reason: two runtimes answer "where
 * do a save's bytes live" in genuinely different ways (design spec §2.1), and this
 * interface is what lets the rest of `packages/application` — the envelope, and later
 * the save-slots screen model — stay ignorant of which one it is talking to.
 *
 * `apps/web/src/save/indexeddb-store.ts` is the first implementation, over IndexedDB,
 * where a `readwrite` transaction is what makes {@link write} atomic rather than the
 * order its caller calls things in. A second implementation, over a file through
 * Electron's main process, is a later task's.
 *
 * `list()` deliberately answers only *which* slots are occupied, not what they
 * contain: a slot's descriptor comes from decoding its bytes (`readSave`, which
 * `SaveDescriptor`'s own doc comment already explains does not know its own slot),
 * and `read()` is what a caller already has for that. A caller wanting a slot paired
 * with its descriptor builds that pair itself — `list()`'s slot beside `readSave`'s
 * result for that same slot's bytes — rather than this port returning two separately-
 * ordered arrays a caller would have to zip back together and trust stayed aligned.
 */
export interface SaveStorePort {
  /** A slot's bytes, or `null` if it is empty. Throws if the store is unavailable. */
  read(slot: SaveSlot): Promise<Uint8Array | null>;

  /** Replaces a slot's contents wholesale and atomically. */
  write(slot: SaveSlot, bytes: Uint8Array): Promise<void>;

  /** Which slots are occupied. An empty slot is not an error. */
  list(): Promise<readonly SaveSlot[]>;
}
