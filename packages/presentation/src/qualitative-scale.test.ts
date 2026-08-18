import { describe, expect, it } from 'vitest';

import {
  QUALITATIVE_GRADES,
  QUALITATIVE_KEYS,
  QualitativeGrade,
  gradeForMagnitude,
  gradeForValue,
  qualitativeKey
} from './qualitative-scale.ts';

describe('the hero scale', () => {
  // Both sides of every band edge, because an off-by-one in a threshold is the whole
  // failure mode here: `<= 64` and `<= 65` differ on exactly one input, and that input
  // is what a run of the corpus would disagree on.
  it.each([
    [0, QualitativeGrade.Negligible],
    [9, QualitativeGrade.Negligible],
    [10, QualitativeGrade.Low],
    [34, QualitativeGrade.Low],
    [35, QualitativeGrade.Moderate],
    [64, QualitativeGrade.Moderate],
    [65, QualitativeGrade.High],
    [89, QualitativeGrade.High],
    [90, QualitativeGrade.Extreme],
    [100, QualitativeGrade.Extreme]
  ])('maps %i to %s', (value, grade) => {
    expect(gradeForValue(value)).toBe(grade);
  });

  it('is total: a value outside the authored range still lands on one grade', () => {
    // Content bounds keep traits in 0..100, but the scale must not have a hole a
    // caller has to ask about. Both directions, because a threshold chain written with
    // `>=` instead of `<=` loses one end and not the other.
    expect(gradeForValue(-1)).toBe(QualitativeGrade.Negligible);
    expect(gradeForValue(1_000)).toBe(QualitativeGrade.Extreme);
  });
});

describe('the reason scale', () => {
  it.each([
    [0, QualitativeGrade.Negligible],
    [4, QualitativeGrade.Negligible],
    [5, QualitativeGrade.Low],
    [14, QualitativeGrade.Low],
    [15, QualitativeGrade.Moderate],
    [29, QualitativeGrade.Moderate],
    [30, QualitativeGrade.High],
    [59, QualitativeGrade.High],
    [60, QualitativeGrade.Extreme]
  ])('maps magnitude %i to %s', (magnitude, grade) => {
    expect(gradeForMagnitude(magnitude)).toBe(grade);
  });

  it('is a different scale from the hero one, not the same thresholds reused', () => {
    // 30 is Low on a 0..100 authored trait and High as a reason's strength. If the two
    // scales ever collapsed into one, this is the input that would notice: the corpus
    // carries both readings of the same number in the same entry.
    expect(gradeForValue(30)).toBe(QualitativeGrade.Low);
    expect(gradeForMagnitude(30)).toBe(QualitativeGrade.High);
  });
});

describe('the keys the scale produces', () => {
  it('names every grade, derived from the closed set rather than listed again', () => {
    expect(QUALITATIVE_GRADES).toHaveLength(5);
    expect(QUALITATIVE_KEYS).toEqual([
      'qualitative.negligible',
      'qualitative.low',
      'qualitative.moderate',
      'qualitative.high',
      'qualitative.extreme'
    ]);
  });

  it('builds one key per grade with no duplicates', () => {
    // A sixth grade whose key collided with an existing one would translate to the
    // wrong word while every list above stayed the right length.
    expect(new Set(QUALITATIVE_KEYS).size).toBe(QUALITATIVE_GRADES.length);
    expect(QUALITATIVE_GRADES.map(qualitativeKey)).toEqual(QUALITATIVE_KEYS);
  });
});
