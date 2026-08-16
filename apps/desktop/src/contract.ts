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

export const ALLOWED_CHANNELS = [DESCRIBE_HOST_CHANNEL] as const;

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
