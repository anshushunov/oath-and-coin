import {
  CONTENT_ID_PATTERN,
  HERO_ID_MAX,
  HERO_ID_MIN,
  parseContentId,
  type ContentId
} from '@oath-and-coin/simulation';
import { z } from 'zod';

import type { ContentFileSource } from '../file-source.ts';
import { readFile } from '../strict-json.ts';

/**
 * One step of a scenario: offer a contract to the hero at {@link heroIndex}.
 *
 * A scenario names a hero by position rather than by content id because it is written
 * against a campaign's roster, not against the content tree — and the mapping from
 * position to definition is deterministic (the loader assigns ids in content-id order),
 * so this stays reproducible.
 */
export interface ScenarioCommand {
  readonly commandId: number;
  readonly heroIndex: number;
  readonly contract: ContentId;
  readonly expectedStateVersion: number;
}

// Stated from the parser's own pattern rather than as `z.string()` plus a hopeful
// `parseContentId` afterwards: a malformed id is then a contract violation naming the
// file and the JSON path, which is what an author needs, instead of a bare parse error.
const contentIdString = z.string().regex(new RegExp(CONTENT_ID_PATTERN));

// `hero_index` is bounded to the id's own domain — signed 32-bit, exactly what the C#
// `int` field could hold. Unbounded, a scenario could name an index this port accepts
// and the original could not have deserialized at all, and the difference would surface
// as a thrown `Invalid HeroId` rather than as the `UNKNOWN_HERO` rejection C# records.
// Found by external review; the corpus cannot see it, because no shipped scenario names
// an index outside the roster.
const commandFileSchema = z.strictObject({
  command_id: z.int(),
  hero_index: z.int().min(HERO_ID_MIN).max(HERO_ID_MAX),
  contract: contentIdString,
  expected_state_version: z.int()
});

const scenarioFileSchema = z.strictObject({
  commands: z.array(commandFileSchema)
});

/**
 * Reads a scenario file — the ordered command list of a run.
 *
 * @throws if the file is missing, malformed, has an unknown property, or declares no
 * commands. An empty scenario would "reproduce" perfectly and demonstrate nothing — the
 * most comfortable way for a determinism check to be green about nothing at all.
 */
export function loadScenarioCommands(
  source: ContentFileSource,
  path: string
): readonly ScenarioCommand[] {
  const displayPath = source.describe(path);
  if (!source.exists(path)) {
    throw new Error(`Scenario file '${displayPath}' does not exist.`);
  }

  const file = readFile(source, path, scenarioFileSchema);

  if (file.commands.length === 0) {
    throw new Error(`Scenario file '${displayPath}' declares no commands.`);
  }

  return file.commands.map((command) => ({
    commandId: command.command_id,
    heroIndex: command.hero_index,
    contract: parseContentId(command.contract),
    expectedStateVersion: command.expected_state_version
  }));
}
