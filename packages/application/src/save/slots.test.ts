import { describe, expect, it } from 'vitest';

import { SAVE_SLOTS } from './slots.ts';

describe('the closed set of save slots', () => {
  it('names exactly the three the spec fixed, in that order', () => {
    expect(SAVE_SLOTS).toEqual(['slot-a', 'slot-b', 'slot-c']);
  });
});
