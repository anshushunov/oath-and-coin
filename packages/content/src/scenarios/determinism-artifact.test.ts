import { join, resolve } from 'node:path';

import { canonicalSha256, sha256Hex } from '@oath-and-coin/simulation';
import { describe, expect, it } from 'vitest';

import { loadAndRunScenario, type RanResult } from './load-sequence.ts';
import {
  ARTIFACT_VERSION,
  artifactHash,
  renderDecision,
  renderTrace,
  toCanonicalBytes,
  toCanonicalJson
} from './determinism-artifact.ts';

/**
 * The projection two runs are compared on, checked on properties rather than on a
 * snapshot. Byte parity against the frozen corpus is `tests/oracle`'s job and is the
 * stronger evidence; what belongs here is the handful of rules that would still be
 * satisfiable by a projection that had quietly stopped carrying something.
 */

const repoRoot = resolve(import.meta.dirname, '..', '..', '..', '..');

function ran(scenario: string, seed = 7n): RanResult {
  const result = loadAndRunScenario({
    scenarioRoot: join(repoRoot, 'scenarios'),
    scenario,
    checkpoint: null,
    contentRoot: join(repoRoot, 'content'),
    seed
  });

  if (result.kind !== 'ran') {
    throw new Error(`Scenario '${scenario}' did not run: ${result.kind}`);
  }

  return result;
}

describe('the artifact says which shape it is', () => {
  it('declares version 3, the version the frozen corpus was recorded under', () => {
    expect(ARTIFACT_VERSION).toBe(3);
    expect(JSON.parse(toCanonicalJson(ran('gate0').outcome))).toMatchObject({
      artifact_version: 3,
      rng_algorithm: 'splitmix64-composed/1',
      ruleset_version: 'm1-decision/1'
    });
  });

  it('writes object keys in ordinal order whatever order they were built in', () => {
    const text = toCanonicalJson(ran('gate0').outcome);
    const keys = Object.keys(JSON.parse(text) as Record<string, unknown>);

    expect(keys).toEqual([...keys].sort());
  });

  it('is a pure function of the run: two calls, identical bytes', () => {
    const outcome = ran('gate0').outcome;

    expect(toCanonicalBytes(outcome)).toEqual(toCanonicalBytes(outcome));
    expect(toCanonicalJson(ran('gate0').outcome)).toBe(toCanonicalJson(ran('gate0').outcome));
  });

  it('hashes the bytes it wrote, not something adjacent to them', () => {
    const outcome = ran('gate0').outcome;

    expect(artifactHash(outcome)).toBe(sha256Hex(toCanonicalBytes(outcome)));
  });

  it('changes with the seed, which is the only thing that differs between these two', () => {
    expect(artifactHash(ran('gate0', 7n).outcome)).not.toBe(
      artifactHash(ran('gate0', 424242n).outcome)
    );
  });
});

describe('a score that does not exist is absent, not null', () => {
  it('omits selected_score entirely on a decision the gate closed', () => {
    // A key present with a null value and a key absent must not become two
    // different-looking ways of saying "no score", or a comparison keyed on key presence
    // drifts from one keyed on value.
    const result = ran('refusal_by_principle');
    const blocked = result.outcome.steps.find(
      (step) => step.decision !== null && step.decision.selectedScore === null
    );

    expect(blocked, 'refusal_by_principle must contain a blocked decision').toBeDefined();
    expect(renderDecision(blocked!.decision!)).not.toContain('selected_score');
    expect(renderDecision(blocked!.decision!)).toContain('"trace_id"');
  });

  it('writes selected_score on a scored decision', () => {
    const scored = ran('gate0').outcome.steps.find(
      (step) => step.decision !== null && step.decision.selectedScore !== null
    );

    expect(renderDecision(scored!.decision!)).toContain('selected_score');
  });
});

describe('the projection carries the rulebook decisions were weighed against', () => {
  it('renders trait_rules, without which two campaigns differing in what a trait means look identical', () => {
    const artifact = JSON.parse(toCanonicalJson(ran('gate0').outcome)) as {
      final_state: { trait_rules: readonly Record<string, unknown>[] };
    };

    expect(artifact.final_state.trait_rules.length).toBeGreaterThan(0);
    expect(Object.keys(artifact.final_state.trait_rules[0]!).sort()).toEqual([
      'id',
      'is_principle',
      'tag',
      'weight'
    ]);
  });
});

describe('one trace renders on its own', () => {
  it('so a single field can be shown to distinguish two explanations', () => {
    const trace = {
      traceId: 0,
      positiveFactors: [],
      negativeFactors: [],
      blockedBy: [],
      tieBreak: null
    };

    expect(renderTrace(trace)).not.toBe(
      renderTrace({ ...trace, tieBreak: 'hero.decision.no_reason_to_refuse' })
    );
    expect(canonicalSha256(JSON.parse(renderTrace(trace)))).toBe(
      canonicalSha256(JSON.parse(renderTrace({ ...trace })))
    );
  });
});
