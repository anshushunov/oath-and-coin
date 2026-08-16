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
