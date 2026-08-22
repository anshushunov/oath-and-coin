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

/**
 * The refusals the host answers with **as an answer**, rather than by rejecting the
 * call.
 *
 * Every other failure inside the main process is a rejection, and the renderer
 * reports the whole class as `SAVE_STORAGE_UNAVAILABLE` — it cannot tell one raw
 * `fs` error from another, and it deliberately does not repeat their messages,
 * which embed the player's Windows username in an `AppData` path. That is the
 * right answer for "the store could not be reached" and the wrong one for a
 * refusal the host made deliberately, about a file it read perfectly well.
 *
 * So a deliberate refusal travels as a value on the channel, carrying the same
 * stable code the rest of the build uses for that condition. The strings are
 * `packages/content`'s `SaveErrorCodes`, stated here a second time for the reason
 * {@link DESKTOP_SAVE_SLOTS} and {@link MAX_SAVE_BYTES} are, and held to that
 * declaration by `tests/architecture/save-refusal-codes-agreement.test.ts`.
 */
export const SAVE_HOST_REFUSAL_CODES = ['SAVE_OUT_OF_BOUNDS', 'SAVE_SLOT_CHANGED'] as const;

export type SaveHostRefusalCode = (typeof SAVE_HOST_REFUSAL_CODES)[number];

/**
 * A refusal the store made on purpose, thrown inside the main process and turned
 * into a value on the wire by `ipc.ts`.
 *
 * A thrown error rather than a result type through every internal call, because the
 * store's own callers — `main.ts`, the test suite — want the ordinary shape, and the
 * seam where a refusal has to stop being an exception is exactly one function wide.
 */
export class SaveHostRefusal extends Error {
  readonly code: SaveHostRefusalCode;

  constructor(code: SaveHostRefusalCode, message: string) {
    // The code inside the message as well as on the field, the same way
    // `packages/content`'s `SaveReadError` carries it: this one is logged in the
    // main process, where `error.message` is usually the whole of what is seen.
    super(`${code}: ${message}`);
    this.name = 'SaveHostRefusal';
    this.code = code;
  }
}

const saveHostRefusal = z.object({
  ok: z.literal(false),
  code: z.enum(SAVE_HOST_REFUSAL_CODES)
});

export const saveReadRequest = z.tuple([desktopSaveSlot]);

/**
 * Either the slot's bytes or a refusal with a name.
 *
 * It was a bare `Uint8Array | null`, which left the host no way to say anything but
 * "here they are" or "the call failed". External review of segment 5 found what that
 * cost on the one condition the host is the only process that can see: an oversized
 * file. See {@link MAX_SAVE_BYTES}.
 */
export const saveReadResponse = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), bytes: z.instanceof(Uint8Array).nullable() }),
  saveHostRefusal
]);

export type SaveReadReply = z.infer<typeof saveReadResponse>;

/**
 * The upper bound on a save-write payload, **declared a second time** for the
 * reason {@link DESKTOP_SAVE_SLOTS} is: `apps/desktop` may not import
 * `@oath-and-coin/application`, and that is where the number belongs now.
 *
 * External review of Task 16 found it declared *only* here, which made it a
 * property of one runtime rather than of the application: the browser's
 * IndexedDB store accepted any `Uint8Array`, so the identical call succeeded in
 * a browser and failed in Electron, and nothing compared the two. The ceiling
 * now lives in `packages/application/src/save/envelope.ts` — `buildSave` will
 * not produce more, and both `SaveStorePort` implementations import it and will
 * not store more. `tests/architecture/save-size-agreement.test.ts` holds this
 * literal to that one, the same shape the slot names are held.
 *
 * Why the host states it at all rather than trusting the renderer's check: the
 * renderer is the untrusted side of this boundary. A limit only the caller
 * applies is not a limit.
 *
 * **It bounds a read as well as a write**, since external review of segment 5.
 * `readSave` in the renderer compared a save's size against this number before
 * decoding it, which is one boundary too late for the desktop build: the main
 * process had already read the whole file into its own heap and IPC had already
 * copied it into the renderer's. An old or hand-placed `slot-a.save` of arbitrary
 * size was enough to spend the memory of both processes on a file nothing was ever
 * going to accept. `save-store.ts` now measures the open file's own descriptor and
 * refuses past this ceiling before allocating anything, and the refusal reaches the
 * player as {@link SAVE_HOST_REFUSAL_CODES}'s `SAVE_OUT_OF_BOUNDS` rather than as
 * the storage being blamed for a file's size.
 *
 * The number itself: the frozen scenario corpus's largest canonical snapshot —
 * the whole state of a finished campaign — is about 11 KB
 * (`scenarios/screen_incomplete.canonical.json`); a real campaign's history runs
 * longer than any scripted scenario, but `write()` replaces a slot wholesale
 * rather than appending, so nothing this build ever asks for is more than one
 * campaign's worth of history at once. 8 MiB is roughly three orders of
 * magnitude above the largest measured snapshot: generous enough that no real
 * campaign will approach it, and finite enough that an untrusted page cannot ask
 * this process to write an unbounded amount to the data directory.
 */
export const MAX_SAVE_BYTES = 8 * 1024 * 1024;

const savePayload = z.instanceof(Uint8Array).refine((bytes) => bytes.length <= MAX_SAVE_BYTES, {
  message: `save payload exceeds the ${String(MAX_SAVE_BYTES)}-byte limit.`
});

/**
 * What the renderer believes the slot still holds — `packages/application`'s `SlotGuard`,
 * stated a third time for the reason the slot names and the size ceiling are stated a
 * second time.
 *
 * The comparison happens in *this* process, inside the serialized per-slot write queue,
 * and that placement is the whole point: a renderer that read the slot and then wrote it
 * would leave exactly the window the guard exists to close. See `SaveStorePort.write`
 * for what the window costs.
 *
 * The bytes travel in full rather than as a digest, and are bounded by the same ceiling
 * the payload is — see `packages/application/src/save/slot-guard.ts` for why a digest
 * would be three implementations of one identity.
 */
export const slotGuard = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('unchecked') }),
  z.object({ kind: z.literal('as-seen'), seen: savePayload.nullable() })
]);

/**
 * The same shape {@link slotGuard} parses, written out rather than inferred.
 *
 * `z.instanceof(Uint8Array)` infers `Uint8Array<ArrayBuffer>` specifically, and the
 * application's own `SlotGuard` — and every `TextEncoder` in a test — produces the wider
 * `Uint8Array<ArrayBufferLike>`. A rule stated twice that cannot be handed the same value
 * twice is not comparable, and comparing them is what
 * `tests/architecture/slot-guard-agreement.test.ts` exists to do. What the schema parses
 * is assignable to this, so the boundary still validates; the type is the wider of the
 * two on purpose.
 */
export type DesktopSlotGuard =
  { readonly kind: 'unchecked' } | { readonly kind: 'as-seen'; readonly seen: Uint8Array | null };

export const saveWriteRequest = z.tuple([desktopSaveSlot, savePayload, slotGuard]);

/** Either the write happened, or it was refused with a name. See {@link saveReadResponse}. */
export const saveWriteResponse = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true) }),
  saveHostRefusal
]);

export type SaveWriteReply = z.infer<typeof saveWriteResponse>;

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
