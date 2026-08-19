import { z } from 'zod';

/**
 * The whole IPC surface of the desktop host, in one file, as data.
 *
 * ADR-010 §80 asks for an allowlist of IPC methods and Zod validation of every
 * payload. Both live here rather than beside their handlers so that "what can
 * the renderer ask for" is answerable by reading one screen of code — an
 * allowlist spread across the call sites is a list nobody can enumerate.
 */

/** Channels the main process answers. Anything else is rejected by name. */
export const DESCRIBE_HOST_CHANNEL = 'desktop:describe-host';
export const SAVE_READ_CHANNEL = 'desktop:save-read';
export const SAVE_WRITE_CHANNEL = 'desktop:save-write';
export const SAVE_LIST_CHANNEL = 'desktop:save-list';

export const ALLOWED_CHANNELS = [
  DESCRIBE_HOST_CHANNEL,
  SAVE_READ_CHANNEL,
  SAVE_WRITE_CHANNEL,
  SAVE_LIST_CHANNEL
] as const;

/**
 * `describeHost` takes no arguments. Stated as a schema rather than ignored:
 * an unused argument list is where a renderer starts smuggling paths.
 */
export const describeHostRequest = z.tuple([]);

export const describeHostResponse = z.object({
  /** `win32`, `linux`, `darwin` — Electron's own value, not a guess. */
  platform: z.string().min(1),
  /** The version electron-builder wrote into the package. */
  appVersion: z.string().min(1),
  /** False when running from source, true inside a packaged build. */
  packaged: z.boolean()
});

export type HostDescription = z.infer<typeof describeHostResponse>;

/**
 * The closed set of save slot names, declared a second time.
 *
 * `packages/application/src/save/slots.ts` already declares `SAVE_SLOTS`, and
 * `apps/desktop` cannot import it: pulling in `@oath-and-coin/application`
 * would drag content, simulation and presentation into `main.cjs`, and
 * `ADR-010` keeps the host free of game rules. So the three names are stated
 * here a second time, and `tests/architecture/save-slots-agreement.test.ts` is
 * what keeps this list and `SAVE_SLOTS` from drifting apart silently — the
 * same shape segment 4 used for `KNOWN_SCREEN_STATES` against `SCREEN_STATES`.
 */
export const DESKTOP_SAVE_SLOTS = ['slot-a', 'slot-b', 'slot-c'] as const;

export type DesktopSaveSlot = (typeof DESKTOP_SAVE_SLOTS)[number];

/**
 * The slot name schema every save channel below validates its slot argument
 * with. `z.enum(DESKTOP_SAVE_SLOTS)` rather than trusting the renderer's
 * `DesktopSaveSlot` type: there is no type at the boundary between two
 * processes, only bytes, so the main process checks membership in the closed
 * set itself.
 */
const desktopSaveSlot = z.enum(DESKTOP_SAVE_SLOTS);

export const saveReadRequest = z.tuple([desktopSaveSlot]);
export const saveReadResponse = z.instanceof(Uint8Array).nullable();

/**
 * The upper bound on a save-write payload. The frozen scenario corpus's
 * largest canonical snapshot — the whole state of a finished campaign — is
 * about 11 KB (`scenarios/screen_incomplete.canonical.json`); a real
 * campaign's history runs longer than any scripted scenario, but `write()`
 * replaces a slot wholesale rather than appending, so nothing this build ever
 * asks for is more than one campaign's worth of history at once. 8 MiB is a
 * ceiling roughly three orders of magnitude above the largest measured
 * snapshot: generous enough that no real campaign will approach it, and
 * finite enough that an untrusted page cannot ask this process to write an
 * unbounded amount to the data directory.
 */
export const MAX_SAVE_BYTES = 8 * 1024 * 1024;

export const saveWriteRequest = z.tuple([
  desktopSaveSlot,
  z.instanceof(Uint8Array).refine((bytes) => bytes.length <= MAX_SAVE_BYTES, {
    message: `save payload exceeds the ${String(MAX_SAVE_BYTES)}-byte limit.`
  })
]);
export const saveWriteResponse = z.void();

export const saveListRequest = z.tuple([]);
export const saveListResponse = z.array(desktopSaveSlot);

/**
 * The only URL schemes the host will hand to the operating system.
 *
 * `shell.openExternal` asks the OS to open a URL with whatever is registered
 * for its scheme, and Electron's own security guidance is explicit that doing
 * that with untrusted input can end in arbitrary command execution
 * (electronjs.org/docs/latest/tutorial/security, item 15). "Untrusted" is not
 * hypothetical here: the argument arrives from a page, through
 * `setWindowOpenHandler`, and the page is the one surface of this application
 * an attacker would aim at.
 *
 * Found by external review of segment 2, where the handler forwarded every
 * scheme — `file:`, `ms-msdt:`, anything with a registered handler — without
 * looking at it.
 */
const OPENABLE_SCHEMES: ReadonlySet<string> = new Set(['http:', 'https:']);

/**
 * Whether the host may ask the operating system to open this URL.
 *
 * A pure predicate rather than an inline check inside the handler, so it can
 * be tested against the strings that matter without packaging an application
 * first.
 */
export function mayOpenExternally(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    // Not a URL at all. `shell.openExternal` would still pass it to the shell,
    // which is precisely the case worth refusing.
    return false;
  }

  return OPENABLE_SCHEMES.has(parsed.protocol);
}
