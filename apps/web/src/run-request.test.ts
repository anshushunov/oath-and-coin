import { describe, expect, it } from 'vitest';

import { DEFAULT_RUN, parseRunRequest } from './run-request.ts';

/**
 * The inputs of a run are the one thing on this page that a person types, so this is the
 * one place where "what did you actually ask for" can go wrong silently. Every case below
 * is either a spelling that must be accepted exactly or one that must be refused loudly;
 * there is no third outcome, and that is the point.
 */
describe('the inputs a run declares', () => {
  it('runs the stated defaults when nothing is declared', () => {
    expect(parseRunRequest('')).toEqual(DEFAULT_RUN);
    expect(parseRunRequest('?')).toEqual(DEFAULT_RUN);
  });

  it('reads all four inputs', () => {
    expect(parseRunRequest('?scenario=screen_error&checkpoint=final&seed=7&locale=ru')).toEqual({
      scenario: 'screen_error',
      checkpoint: 'final',
      seed: 7n,
      locale: 'ru'
    });
  });

  it('takes the leading question mark or no leading question mark', () => {
    // `location.search` carries it and a hand-written string usually does not, and a
    // parser that accepted only one of the two would work in a browser and not in a test,
    // or the other way round.
    expect(parseRunRequest('scenario=screen_empty')).toEqual(
      parseRunRequest('?scenario=screen_empty')
    );
  });

  it('leaves the checkpoint unnamed when it is not declared', () => {
    // `null` is what the session takes to mean "the manifest's last", and that is the
    // only way to ask for it: a checkpoint is a name, so there is no value spelling the
    // absence of one.
    expect(parseRunRequest('?scenario=screen_normal').checkpoint).toBeNull();
  });

  it('reads a seed as a bigint, not as a number', () => {
    // 2^53 + 1, which is not representable as a JS number: parsed through `Number` it
    // becomes 9007199254740992 and the run draws from a different stream than the one
    // asked for.
    expect(parseRunRequest('?seed=9007199254740993').seed).toBe(9007199254740993n);
  });

  it.each([
    { search: '?seed=0x2a', why: 'hexadecimal, which BigInt accepts and a command line does not' },
    { search: '?seed=1_000', why: 'a numeric separator, likewise' },
    { search: '?seed= 7', why: 'surrounding whitespace, which BigInt trims away' },
    { search: '?seed=-7', why: 'negative' },
    { search: '?seed=7.5', why: 'not an integer' },
    { search: '?seed=seven', why: 'not a number at all' }
  ])('refuses a seed that is $why', ({ search }) => {
    expect(() => parseRunRequest(search)).toThrow(/non-negative decimal integer/u);
  });

  it.each(['scenario', 'checkpoint', 'seed', 'locale'])(
    'refuses %s stated with no value',
    (name) => {
      expect(() => parseRunRequest(`?${name}=`)).toThrow(/stated with no value/u);
    }
  );

  it.each(['scenario', 'checkpoint', 'seed', 'locale'])('refuses %s stated twice', (name) => {
    // `?scenario=screen_error&scenario=screen_normal` runs `screen_error` under
    // `URLSearchParams.get`, and would run `screen_normal` under any reader that takes
    // the last value. The URL is ambiguous, so it is refused rather than resolved.
    expect(() => parseRunRequest(`?${name}=a&${name}=b`)).toThrow(/stated 2 times/u);
  });

  it('refuses a parameter repeated with the same value', () => {
    // The ambiguity is in the URL rather than in the values: a reader still cannot tell
    // whether the author meant one input or wrote two by accident.
    expect(() => parseRunRequest('?seed=7&seed=7')).toThrow(/stated 2 times/u);
  });

  it('refuses a parameter it does not know', () => {
    // The failure this rule exists for: a typo produces a screenshot, a report and a
    // green verdict about a scenario nobody asked for.
    expect(() => parseRunRequest('?scenarion=screen_error')).toThrow(/Unknown run parameter/u);
  });
});
