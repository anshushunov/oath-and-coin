import { SAVE_SLOTS } from '@oath-and-coin/application';
import { DESKTOP_SAVE_SLOTS } from '@oath-and-coin/desktop/src/contract.ts';
import { describe, expect, it } from 'vitest';

/**
 * The closed set of save slot names is declared twice — `SAVE_SLOTS` in
 * `packages/application/src/save/slots.ts`, `DESKTOP_SAVE_SLOTS` in
 * `apps/desktop/src/contract.ts` — because `apps/desktop` may not import
 * `@oath-and-coin/application` (`ADR-010` keeps the host free of game rules,
 * and that import would drag content, simulation and presentation into
 * `main.cjs`). Two declarations of one closed set drift apart silently unless
 * something checks them against each other; this is that something, the same
 * shape segment 4 used for `KNOWN_SCREEN_STATES` against `SCREEN_STATES`.
 *
 * The host's half is named by its source path rather than through a `./contract`
 * subpath in `apps/desktop/package.json`. That subpath existed for these two
 * tests and for nothing else, and electron-builder copies the manifest into
 * `app.asar` verbatim while packaging only `dist/**` — so the shipped
 * application advertised an export pointing at `./src/contract.ts`, a file the
 * package does not contain. Task 17 measured that inside the asar and removed
 * the field; `tests/desktop/packaged-host.spec.ts` now holds every path the
 * packaged manifest names to something the package actually carries.
 */
describe('the desktop host and the application agree on which slots exist', () => {
  it('DESKTOP_SAVE_SLOTS names exactly what SAVE_SLOTS names, in the same order', () => {
    expect([...DESKTOP_SAVE_SLOTS]).toEqual([...SAVE_SLOTS]);
  });
});
