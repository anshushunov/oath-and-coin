import { SAVE_SLOTS } from '@oath-and-coin/application';
import { DESKTOP_SAVE_SLOTS } from '@oath-and-coin/desktop/contract';
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
 */
describe('the desktop host and the application agree on which slots exist', () => {
  it('DESKTOP_SAVE_SLOTS names exactly what SAVE_SLOTS names, in the same order', () => {
    expect([...DESKTOP_SAVE_SLOTS]).toEqual([...SAVE_SLOTS]);
  });
});
