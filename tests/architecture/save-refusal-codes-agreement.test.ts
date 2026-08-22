import { SAVE_HOST_REFUSAL_CODES } from '@oath-and-coin/desktop/src/contract.ts';
import { SAVE_ERROR_CODES } from '@oath-and-coin/content';
import { describe, expect, it } from 'vitest';

/**
 * The refusals the desktop host answers with as a *value* on an IPC channel, held to
 * the vocabulary the rest of the build refuses with.
 *
 * The host may not import `@oath-and-coin/content` for the reason `ADR-010` gives and
 * `save-size-agreement.test.ts` records for the size ceiling, so it states the code
 * strings a second time. A code stated twice is a code that can drift, and this one
 * drifting is not a compile error anywhere: the renderer would hand
 * `packages/presentation` a string that `errorKey` turns into a locale key nothing in
 * `ui-text/ru.json` answers, and the strict catalogue would kill the screen — three
 * layers away from the typo, at a player's save button.
 *
 * A subset rather than an equality, deliberately: most of `SaveErrorCodes` names a
 * condition only the envelope or a browser store can see, and the host has no business
 * claiming those.
 *
 * The host's half is named by its source path for the reason
 * `save-slots-agreement.test.ts` records: a `./contract` subpath in the host's manifest
 * travels into `app.asar`, where `./src/contract.ts` does not exist.
 */
describe('every refusal the desktop host can name is one this build already has', () => {
  it.each(SAVE_HOST_REFUSAL_CODES)('%s is a declared save error code', (code) => {
    expect(SAVE_ERROR_CODES).toContain(code);
  });

  it('names at least one — an empty list would make the check above vacuous', () => {
    expect(SAVE_HOST_REFUSAL_CODES.length).toBeGreaterThan(0);
  });
});
