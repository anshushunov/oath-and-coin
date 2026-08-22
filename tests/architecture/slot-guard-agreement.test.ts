import { asSeen, slotMayBeWritten, UNCHECKED_SLOT } from '@oath-and-coin/application';
import { mayPublish } from '@oath-and-coin/desktop/src/save-store.ts';
import { describe, expect, it } from 'vitest';

/**
 * The compare-and-swap rule is stated twice — `packages/application`'s
 * `slotMayBeWritten` and `apps/desktop`'s `mayPublish` — because the host may not import
 * the application (`ADR-010`, and `save-size-agreement.test.ts` records the same reason
 * for the size ceiling). This runs one table of cases through both and requires the same
 * verdict.
 *
 * Two statements of one rule drifting is not a hypothetical here: it is precisely the
 * class of defect external review of Task 16 found on the size ceiling, where a browser
 * accepted what Electron refused and every per-implementation suite stayed green. A guard
 * that drifted the same way would refuse a save on one platform and destroy a campaign on
 * the other.
 *
 * The host's half is named by its source path for the reason
 * `save-slots-agreement.test.ts` records: a `./contract` subpath in the host's manifest
 * travels into `app.asar`, where `./src/contract.ts` does not exist.
 */

const A = Uint8Array.of(1, 2, 3);
const SAME_AS_A = Uint8Array.of(1, 2, 3);
const LONGER = Uint8Array.of(1, 2, 3, 4);
const DIFFERENT = Uint8Array.of(1, 2, 4);

const cases: [string, ReturnType<typeof asSeen> | typeof UNCHECKED_SLOT, Uint8Array | null][] = [
  ['unchecked over an empty slot', UNCHECKED_SLOT, null],
  ['unchecked over an occupied slot', UNCHECKED_SLOT, A],
  ['saw empty, still empty', asSeen(null), null],
  ['saw empty, now occupied', asSeen(null), A],
  ['saw a save, slot is empty', asSeen(A), null],
  ['saw a save, same bytes by value', asSeen(SAME_AS_A), A],
  ['saw a save, one byte different', asSeen(DIFFERENT), A],
  ['saw a save, a prefix of what is there', asSeen(A), LONGER],
  ['saw a save, longer than what is there', asSeen(LONGER), A]
];

describe('the desktop host and the application agree on when a slot may be written', () => {
  it.each(cases)('answers the same for: %s', (_name, guard, actual) => {
    expect(mayPublish(guard, actual)).toBe(slotMayBeWritten(guard, actual));
  });

  it('and the table is not vacuously agreeable — it holds both verdicts', () => {
    const verdicts = new Set(cases.map(([, guard, actual]) => slotMayBeWritten(guard, actual)));

    expect(verdicts).toEqual(new Set([true, false]));
  });
});
