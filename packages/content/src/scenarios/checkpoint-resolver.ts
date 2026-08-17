import type { ScenarioCommand } from './scenario-commands.ts';
import type { Checkpoint, ScenarioManifest } from './scenario-manifest.ts';

/**
 * Turns a manifest's checkpoint (a name) and a scenario's command list (an ordered
 * sequence) into the concrete slice of commands a caller replays to reach it.
 *
 * Kept out of the manifest module: resolving a checkpoint needs the command list to
 * validate against, and a manifest is loaded from its own file without ever seeing a
 * scenario's commands. The list is passed in rather than re-read from disk, so a caller
 * that already loaded the scenario does not pay for it twice and nothing here touches
 * the filesystem.
 */

/**
 * Picks the checkpoint named `requestedName`, or the last one declared in the manifest
 * when no name is given — a caller driving a scenario end to end should not have to
 * spell out its final checkpoint by name.
 *
 * @throws if the manifest declares no checkpoints, the name matches none of them, or
 * the matched checkpoint names a command id the scenario does not contain.
 */
export function resolveCheckpoint(
  manifest: ScenarioManifest,
  commands: readonly ScenarioCommand[],
  requestedName: string | null
): Checkpoint {
  const checkpoint =
    requestedName === null ? defaultCheckpoint(manifest) : findByName(manifest, requestedName);

  // 0 is the one value that never has to appear in the scenario: it means "before the
  // first command", not "after some command with id 0" — command ids start at 1.
  if (
    checkpoint.afterCommandId !== 0 &&
    !commands.some((command) => command.commandId === checkpoint.afterCommandId)
  ) {
    throw new Error(
      `Checkpoint '${checkpoint.name}' in scenario '${manifest.scenario}' names command id ` +
        `${checkpoint.afterCommandId}, which is not in the scenario's command list.`
    );
  }

  return checkpoint;
}

/**
 * The commands a run must replay to reach `checkpoint`: everything up to **and
 * including** the command whose id equals `afterCommandId` — not everything strictly
 * before it, which would silently drop the boundary command from every slice. An
 * `afterCommandId` of 0 always yields an empty slice: the checkpoint sits before any
 * command has run.
 */
export function commandsUpTo(
  commands: readonly ScenarioCommand[],
  checkpoint: Checkpoint
): readonly ScenarioCommand[] {
  if (checkpoint.afterCommandId === 0) {
    return [];
  }

  return commands.filter((command) => command.commandId <= checkpoint.afterCommandId);
}

function defaultCheckpoint(manifest: ScenarioManifest): Checkpoint {
  const last = manifest.checkpoints[manifest.checkpoints.length - 1];
  if (last === undefined) {
    throw new Error(`Scenario '${manifest.scenario}' declares no checkpoints to default to.`);
  }

  return last;
}

function findByName(manifest: ScenarioManifest, requestedName: string): Checkpoint {
  for (const checkpoint of manifest.checkpoints) {
    if (checkpoint.name === requestedName) {
      return checkpoint;
    }
  }

  const available = manifest.checkpoints.map((checkpoint) => checkpoint.name).join(', ');
  throw new Error(
    `Scenario '${manifest.scenario}' has no checkpoint named '${requestedName}'. ` +
      `Available checkpoints: ${available}.`
  );
}
