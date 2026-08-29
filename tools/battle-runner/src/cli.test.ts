import { describe, expect, it } from 'vitest';

import { main, render } from './cli.ts';
import type { Measurement } from './metrics.ts';

/**
 * The exit code is the gate (`COMBAT_SPEC` §12.5).
 *
 * That sentence is a direct finding of external review of the spec, and it is what this file
 * is mostly about: a report that prints a violated threshold and exits zero is a report and
 * not a gate, and the difference is invisible in the printed text.
 *
 * The measurements themselves are asserted against the shipped content in
 * `balance.test.ts` — the one that goes red when the game drifts out of its declared
 * corridors. Here the subject is the command: what it refuses, what it exits with, and the
 * one flag it will never accept.
 */

const measurement = (id: string, status: Measurement['status'] = 'ok'): Measurement => ({
  id,
  value: 1,
  exact: { of: 1, per: 1 },
  unit: 'count',
  threshold: 'a corridor',
  withinThreshold: status === 'ok',
  status,
  cases: 10
});

describe('what the command refuses', () => {
  it('exits 2 on no command, an unknown one and a missing set', () => {
    expect(main([])).toBe(2);
    expect(main(['measure'])).toBe(2);
    expect(main(['report'])).toBe(2);
    expect(main(['report', '--set', 'whatever'])).toBe(2);
  });

  it('refuses an unknown option rather than ignoring it', () => {
    // A silently dropped flag is how a pipeline runs the command it did not mean to and
    // reports success — the failure `tools/scenario-runner`'s own parser already records.
    expect(main(['report', '--set', 'core', '--bogus', 'x'])).toBe(2);
  });

  it('refuses to be told what the thresholds are', () => {
    // §12.5 keeps them in a file. A corridor a run can be told to relax is one the run
    // agrees with by construction, so there is no flag — and asking for one is a usage
    // error rather than a silently ignored argument.
    expect(main(['report', '--set', 'core', '--threshold', '0'])).toBe(2);
    expect(main(['report', '--set', 'core', '--battle-length', '99'])).toBe(2);
  });
});

describe('the report says what it measured, and the verdict follows the same numbers', () => {
  it('names every measurement, its threshold and how many cases it was taken over', () => {
    const text = render(
      [measurement('battle_length_rounds'), measurement('doctrine_breach_percent', 'fail')],
      'core',
      'abcdef0123456789'
    ).join('\n');

    expect(text).toContain('battle-runner report --set core');
    expect(text).toContain('content_version: abcdef0123456789');
    expect(text).toContain('over 10 case(s)');
    expect(text).toContain('doctrine_breach_percent');
  });

  it('says plainly when every threshold held, and names the ones that did not', () => {
    expect(render([measurement('a')], 'core', 'x').join('\n')).toContain(
      'every threshold this run gates on held'
    );

    const failed = render([measurement('a'), measurement('b', 'fail')], 'core', 'x').join('\n');

    expect(failed).toContain('1 threshold(s) outside the corridor declared before balancing');
    expect(failed).toContain('b');
  });
});
