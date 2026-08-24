import { resolve } from 'node:path';

import { canonicalSha256, sha256Hex } from '@oath-and-coin/simulation';
import { describe, expect, it } from 'vitest';

import { loadAndRunScenario } from '../node/index.ts';

import { type RanResult } from './load-sequence.ts';
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

/**
 * Runs a shipped scenario, and refuses an outcome that decided nothing.
 *
 * The guard is the point, not a formality. `DEC-008` Task 11 made the engine refuse a
 * proposal to anyone but the offer's key hero, and until Task 11a taught `ScenarioCommand`
 * to compose an offer at all, every command in this directory came back
 * `rejected.not_the_key_hero` — with `decisions: []` and `events: []`. Seven of this
 * file's nine tests stayed green through that, because "two runs agree", "the hash is of
 * the bytes" and "the keys are sorted" are all satisfied by two equally empty artifacts.
 * A comparison that degenerates to comparing nothing with nothing is the most comfortable
 * way for a determinism check to be green about nothing (`AGENTS.md` §8), and no
 * assertion below can see it, because each of them is about the projection rather than
 * about what was projected.
 *
 * So the subject is asserted here, once, where every test in the file passes through.
 *
 * **Two conditions, not one**, and the second was added by review of Task 11a. "Decided
 * something" does not imply "did what it was asked": `accept_by_comrade` shipped for one
 * commit with two commands after its poll carrying the state version the poll had *begun*
 * on, so both came back `rejected.stale_state` while the scenario still produced five
 * decisions and looked healthy from here. Neither scenario this file runs expects any
 * refusal, so the check is simply that every step applied — the general form, where a
 * scenario may legitimately expect one, lives in `tests/oracle/src/restored-read-model.test.ts`,
 * which is the only place that sweeps all of them.
 */
function ran(scenario: string, seed = 7n): RanResult {
  const result = loadAndRunScenario({
    repositoryRoot: repoRoot,
    scenario,
    checkpoint: null,
    seed
  });

  if (result.kind !== 'ran') {
    throw new Error(`Scenario '${scenario}' did not run: ${result.kind}`);
  }

  const refusals = result.outcome.steps
    .filter((step) => !step.applied)
    .map((step) => `#${String(step.command.commandId)} ${step.rejectionCode ?? 'unknown'}`);

  const decisions = result.outcome.steps.reduce((count, step) => count + step.decisions.length, 0);
  if (decisions === 0) {
    throw new Error(
      `Scenario '${scenario}' at seed ${String(seed)} ran but decided nothing, so every ` +
        'comparison taken over its artifact would agree by being empty rather than by being ' +
        `right. Refusals: ${refusals.length === 0 ? 'none — the scenario applied and still decided nothing' : refusals.join(', ')}.`
    );
  }

  if (refusals.length > 0) {
    throw new Error(
      `Scenario '${scenario}' at seed ${String(seed)} had a command refused: ` +
        `${refusals.join(', ')}. Neither scenario this file runs expects one, so this is the ` +
        'scenario file disagreeing with the protocol — most likely an `expected_state_version` ' +
        'that did not follow a command producing more than one event.'
    );
  }

  return result;
}

describe('the artifact says which shape it is', () => {
  it('declares version 4 — bumped in Task 6 for the decisions list and the offer shape', () => {
    // The frozen corpus was recorded under 3; `ADR-013` retired byte parity with it as a
    // property this port owes, so a shape version disagreeing with a frozen recording is
    // not, on its own, a determinism failure. See `ARTIFACT_VERSION`'s own comment for
    // why this moved now rather than at Task 14, where the plan originally placed it.
    expect(ARTIFACT_VERSION).toBe(4);
    expect(JSON.parse(toCanonicalJson(ran('gate0').outcome))).toMatchObject({
      artifact_version: 4,
      rng_algorithm: 'splitmix64-composed/1',
      ruleset_version: 'm1-negotiation/1'
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
      (step) => step.decisions[0] !== undefined && step.decisions[0].selectedScore === null
    );

    expect(blocked, 'refusal_by_principle must contain a blocked decision').toBeDefined();
    expect(renderDecision(blocked!.decisions[0]!)).not.toContain('selected_score');
    expect(renderDecision(blocked!.decisions[0]!)).toContain('"trace_id"');
  });

  it('writes selected_score on a scored decision', () => {
    const scored = ran('gate0').outcome.steps.find(
      (step) => step.decisions[0] !== undefined && step.decisions[0].selectedScore !== null
    );

    expect(renderDecision(scored!.decisions[0]!)).toContain('selected_score');
  });
});

describe('a command reaches the artifact with the keys the scenario wrote it with', () => {
  it('keeps a chosen-no-method-tag as null, where a missing score is an absent key', () => {
    // The two absences in this projection are not the same absence, and this is the one
    // test holding them apart at the artifact. `selected_score` is *elided* on a blocked
    // decision because no score exists; `method_tag` is written `null` because a package
    // that chose no method is not a package that was never asked — the wire format
    // already refuses to conflate them (`method_tag` is required and nullable), and the
    // artifact must not undo that on the way out.
    const artifact = JSON.parse(toCanonicalJson(ran('gate0').outcome)) as {
      steps: readonly Record<string, unknown>[];
    };

    const composed = artifact.steps
      .map((step) => step['command'] as Record<string, unknown>)
      .filter((command) => command['command'] === 'compose_offer');

    expect(composed.length).toBeGreaterThan(0);
    for (const command of composed) {
      expect(command).toHaveProperty('method_tag');
      expect(command['method_tag']).toBeNull();
    }
  });

  it('writes no hero index on a command that names no hero', () => {
    // `lock_offer` and `poll_crew` carry none, and a projection that wrote `null` anyway
    // would have the artifact stating a fact the command never carried.
    const artifact = JSON.parse(toCanonicalJson(ran('screen_normal').outcome)) as {
      steps: readonly Record<string, unknown>[];
    };

    const heroless = artifact.steps
      .map((step) => step['command'] as Record<string, unknown>)
      .filter((command) => command['command'] === 'lock_offer' || command['command'] === 'poll_crew');

    expect(heroless).toHaveLength(2);
    for (const command of heroless) {
      expect(command).not.toHaveProperty('hero_index');
      expect(command).not.toHaveProperty('key_hero_index');
    }
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
