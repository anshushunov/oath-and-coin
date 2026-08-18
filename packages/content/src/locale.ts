import { SortedMap, compareStrings } from '@oath-and-coin/simulation';

import type { ContentFileSource } from './file-source.ts';
import { localeFileSchema } from './schemas.ts';
import { readFile } from './strict-json.ts';

/**
 * A flat "key → text" catalogue for one locale. Every player-facing string content
 * is allowed to name is a localization key (`TDD` §11.1).
 *
 * Resolving a key to its text is deliberately not this module's job. The read model
 * the engine and the presentation layer agree on stays keys all the way through: a
 * read model carrying resolved text would make its hash a function of the player's
 * language, and Milestone 1's whole "does the screen match the simulation" story
 * depends on that hash being a property of game state alone.
 *
 * One rule moved and is worth naming, because it moved to somewhere stricter. The
 * C# loader read locale files through `JsonDocument` specifically so it could see a
 * repeated key — `JsonNode` collapsed duplicates silently — and that made "no two
 * keys share a name" a locale-only guarantee. Here `scanJson` refuses a repeated
 * key in *every* file this package reads, so a hero file with two `greed` fields is
 * refused as well. Nothing relied on that being allowed; it was allowed because the
 * reader could not see it.
 */
export function loadLocaleCatalogue(
  source: ContentFileSource,
  path: string
): SortedMap<string, string> {
  const file = readFile(source, path, localeFileSchema);

  return SortedMap.from(compareStrings, Object.entries(file.entries));
}
