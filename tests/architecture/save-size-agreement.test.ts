import { MAX_SAVE_BYTES } from '@oath-and-coin/application';
import { MAX_SAVE_BYTES as DESKTOP_MAX_SAVE_BYTES } from '@oath-and-coin/desktop/contract';
import { describe, expect, it } from 'vitest';

/**
 * The largest save this build produces or stores is declared twice —
 * `packages/application/src/save/envelope.ts` and `apps/desktop/src/contract.ts` —
 * because `apps/desktop` may not import `@oath-and-coin/application` (`ADR-010` keeps
 * the host free of game rules, and that import would drag content, simulation and
 * presentation into `main.cjs`).
 *
 * External review of Task 16 found the number declared *only* on the host side, which
 * made it a property of one runtime: the browser's IndexedDB store took any
 * `Uint8Array`, the desktop IPC refused past 8 MiB, the same call therefore succeeded in
 * a browser and failed in Electron, and no test compared the two. The ceiling moved to
 * the application, where the port is; this is what keeps the host's second statement of
 * it from drifting, the same shape `DESKTOP_SAVE_SLOTS` is held to `SAVE_SLOTS`.
 */
describe('the desktop host and the application agree on the largest save', () => {
  it('states the same number of bytes', () => {
    expect(DESKTOP_MAX_SAVE_BYTES).toBe(MAX_SAVE_BYTES);
  });
});
