import type { ContentFileSource } from '@oath-and-coin/content';

/**
 * What the application needs from the outside, and nothing else.
 *
 * One port, because one port has an implementation today. `apps/web` builds a
 * {@link ContentFileSource} from `import.meta.glob`, `@oath-and-coin/content/node`
 * builds one from a directory, and both satisfy this without knowing about each
 * other. A `DesktopPort` and a `SavePort` are easy to imagine and are deliberately
 * not written: a port with no implementation is a shape guessed in advance, and the
 * first real caller always wants a slightly different one — at which point the guess
 * has to be changed by whoever least wants to change it.
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
