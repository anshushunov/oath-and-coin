import { SortedMap, compareStrings } from '@oath-and-coin/simulation';
import { z } from 'zod';

import type { ContentFileSource } from '../file-source.ts';
import { LOCALIZATION_KEY_PATTERN } from '../schemas.ts';
import { readFile } from '../strict-json.ts';

/**
 * The catalogue for text the **interface** produces, held outside `content/`.
 *
 * `content_version` is a digest over every byte under `content/`, and the frozen corpus
 * pins it at `5d03734fd9c7abaa` in all 54 entries. Measured directly (`ADR-012`): adding
 * one correct key to `content/locale/ru.json` moves the version to `e036d5cbb35bc29d`
 * and `pnpm scenario:parity` refuses all 54. So while the corpus is the oracle, no new
 * player-facing string can be authored inside the content tree — which would have
 * blocked the save-failure codes and the whole save screen.
 *
 * The boundary is by the nature of the key and it acts forward only. A key that names
 * game *data* — a hero's name, a contract's title — belongs to `content/locale/ru.json`
 * and must move `content_version` when it changes, because it is part of what content
 * is. A key the interface invents — a refusal code, a slot caption, a button — belongs
 * here. `ADR-012` names the price honestly: `content/locale/ru.json` already holds
 * interface keys (`screen.contract_offer.title`, `action.*`, `error.*` of the five
 * `ERROR_CODES`, `reason.*`, `response.wavered.*`) and they stay on the wrong side until
 * Task 19 retires the corpus, because moving one changes the digest exactly as adding
 * one does.
 *
 * Read through a {@link ContentFileSource} for the same reason content is
 * (`FULL_TYPESCRIPT_MIGRATION` §12.2): one reader, one set of diagnostics, and a browser
 * that validates the shipped bytes rather than a build step's re-serialization of them.
 * That this module sits under `packages/content` says nothing about the boundary — the
 * digest is computed over the data tree `content/`, never over the package that reads
 * it, and this is the package that owns both the port and the strict reader.
 */

/** The repository directory holding the interface catalogues. Not under `content/`. */
export const UI_TEXT_ROOT = 'ui-text';

/**
 * This format's version, counted separately from the content catalogue's.
 *
 * `SUPPORTED_LOCALE_SCHEMA_VERSION` is 2 because that format evolved twice; a new file
 * starting at 2 to match would tie the next change of either format to the other, and
 * these two evolve for unrelated reasons — one follows content authoring, the other
 * follows the screens.
 */
export const UI_TEXT_SCHEMA_VERSION = 1;

/** The catalogue file for one locale, relative to {@link UI_TEXT_ROOT}. */
export function uiTextCatalogueFile(locale: string): string {
  return `${locale}.json`;
}

/**
 * The contract, stated here rather than borrowed from `localeFileSchema`.
 *
 * Two of its three fields are deliberately identical — a locale is a non-empty string,
 * and a key obeys `LOCALIZATION_KEY_PATTERN`, which is imported rather than respelled so
 * that the two catalogues cannot drift into disagreeing about what a key looks like
 * (`errorKey` produces the same shape on both sides). The third is deliberately
 * different: the version literal is this format's own. Reusing the whole schema would
 * have made that difference impossible to state.
 */
export const uiTextFileSchema = z.strictObject({
  schema_version: z.literal(UI_TEXT_SCHEMA_VERSION),
  locale: z.string().min(1),
  entries: z.record(z.string().regex(new RegExp(LOCALIZATION_KEY_PATTERN)), z.string().min(1))
});

export type UiTextFile = z.infer<typeof uiTextFileSchema>;

/**
 * One interface catalogue, as the same "key → text" map the content catalogue answers.
 *
 * The same type on purpose: a consumer resolving a key looks in one catalogue and then
 * the other, and a second map shape would make that lookup a place where the two sides
 * of the boundary are told apart. They are told apart when a key is *authored*, which is
 * where the decision belongs, and nowhere else.
 */
export function loadUiTextCatalogue(
  source: ContentFileSource,
  path: string
): SortedMap<string, string> {
  const file = readFile(source, path, uiTextFileSchema);

  return SortedMap.from(compareStrings, Object.entries(file.entries));
}
