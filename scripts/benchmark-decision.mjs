import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/**
 * Baseline p50/p95 for the two hot paths Task 9 ports: one hero decision, and one
 * command applied end to end through the engine.
 *
 * This writes a measurement; it does **not** enforce a budget, and the distinction is
 * the whole reason the file says so out loud. No document in this repository pins a
 * latency for a decision — `ADR-010` names `tools/scenario-runner` as the place
 * benchmarks live and stops there — so a threshold here would be a number this script
 * invented, dressed as a requirement. The artifact exists so that Task 18, which does
 * own the performance gate, has something from before the UI stack landed to compare
 * against, and so that a regression of the "we made it 40× slower" kind is visible
 * rather than felt.
 *
 * The numbers are wall-clock on one machine and will differ on another. What is
 * reproducible is the *work*: the same seed, the same ordinals, the same campaign, so
 * two runs measure the same computation even where they disagree about how long it took.
 *
 * Usage: `pnpm bench:decision [--samples N] [--output PATH]`
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// `pathToFileURL`, not the bare path: on Windows an absolute path starts with a drive
// letter and the ESM loader reads `c:` as a URL scheme it does not support.
const moduleAt = (...segments) => import(pathToFileURL(join(repoRoot, ...segments)).href);

const simulation = (...segments) => moduleAt('packages', 'simulation', 'src', ...segments);

const { SortedMap } = await simulation('collections', 'sorted-map.ts');
const { SortedSet } = await simulation('collections', 'sorted-set.ts');
const { decide } = await simulation('decisions', 'contract-decision-rule.ts');
const { proposeContractToHero } = await simulation('engine.ts');
const { compareContentIds, parseContentId } = await simulation('ids', 'content-id.ts');
const { compareHeroIds, heroId } = await simulation('ids', 'hero-id.ts');
const { compareNumbers } = await simulation('collections', 'comparator.ts');
const { ContractStatus } = await simulation('state', 'contract-state.ts');

function argument(name, fallback) {
  const index = process.argv.indexOf(name);
  return index >= 0 && index + 1 < process.argv.length ? process.argv[index + 1] : fallback;
}

const samples = Number(argument('--samples', '20000'));
const warmup = Math.min(2000, Math.floor(samples / 10));
const outputPath = resolve(
  repoRoot,
  argument('--output', join('artifacts', 'decision-benchmark', 'report.json'))
);

if (!Number.isSafeInteger(samples) || samples < 100) {
  throw new Error(`--samples must be an integer of at least 100, received '${samples}'.`);
}

const ids = {
  bram: parseContentId('core:bram'),
  zara: parseContentId('core:zara'),
  crypt: parseContentId('core:cleanse_the_crypt'),
  undead: parseContentId('target:undead'),
  temple: parseContentId('target:temple'),
  loyal: parseContentId('core:loyal'),
  squeamish: parseContentId('core:squeamish')
};

const traitRules = SortedMap.from(compareContentIds, [
  [ids.loyal, { id: ids.loyal, tag: ids.undead, isPrinciple: false, weight: 7 }],
  [ids.squeamish, { id: ids.squeamish, tag: ids.temple, isPrinciple: false, weight: -3 }]
]);

const hero = {
  id: heroId(0),
  definition: ids.bram,
  displayNameKey: 'hero.core.bram.name',
  greed: 60,
  caution: 30,
  pride: 45,
  trustInGuild: 50,
  traits: [ids.squeamish, ids.loyal],
  relationships: SortedMap.from(compareContentIds, [[ids.zara, 5]])
};

const contract = {
  id: ids.crypt,
  patronFee: 70,
  risk: 80,
  requiredCrew: 2,
  tags: SortedSet.from(compareContentIds, [ids.undead, ids.temple]),
  status: ContractStatus.Offered,
  respondedBy: SortedSet.empty(compareHeroIds),
  acceptedBy: SortedSet.empty(compareHeroIds)
};

const state = {
  metadata: {
    saveSchemaVersion: 1,
    rulesetVersion: 'm1-decision/1',
    contentVersion: '5d03734fd9c7abaa',
    campaignSeed: 424242n,
    stateVersion: 0,
    logicalTime: 0,
    nextEventId: 0,
    nextTraceId: 0,
    nextDecisionOrdinal: 0n
  },
  heroes: SortedMap.from(compareHeroIds, [[hero.id, hero]]),
  contracts: SortedMap.from(compareContentIds, [[contract.id, contract]]),
  appliedCommandIds: SortedSet.empty(compareNumbers),
  traitRules,
  traces: SortedMap.empty(compareNumbers),
  history: []
};

const context = {
  hero,
  contract,
  traits: [traitRules.get(ids.loyal), traitRules.get(ids.squeamish)],
  crew: SortedMap.empty(compareHeroIds),
  campaignSeed: state.metadata.campaignSeed,
  decisionOrdinal: 0n,
  traceId: 0
};

/**
 * Each sample times exactly one call. Timing a batch and dividing would report a number
 * the engine never produces — the per-call cost only after the optimizer has seen the
 * same input a thousand times in a row — and would hide the tail p95 exists to show.
 */
function measure(run) {
  for (let index = 0; index < warmup; index++) {
    run(index);
  }

  const durations = new Float64Array(samples);
  for (let index = 0; index < samples; index++) {
    const started = performance.now();
    run(index);
    durations[index] = performance.now() - started;
  }

  const sorted = Float64Array.from(durations).sort();
  const percentile = (fraction) =>
    sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];

  return {
    samples,
    p50_ms: percentile(0.5),
    p95_ms: percentile(0.95),
    p99_ms: percentile(0.99),
    max_ms: sorted[sorted.length - 1]
  };
}

// The ordinal moves with the sample index so that the mood draw is a different one each
// time; a fixed ordinal would measure the same cached arithmetic repeatedly and would
// never once reach the rejection-sampling branch.
const decision = measure((index) => decide({ ...context, decisionOrdinal: BigInt(index) }));

const command = measure((index) =>
  proposeContractToHero(state, {
    commandId: index,
    heroId: hero.id,
    contractId: ids.crypt,
    expectedStateVersion: 0
  })
);

const report = {
  what: 'Task 9 baseline: one hero decision, and one command applied through the engine.',
  enforces_no_budget:
    'These are measurements, not thresholds. No document pins a latency for a decision; Task 18 owns the performance gate and this artifact is what it compares against.',
  node: process.version,
  platform: `${process.platform}-${process.arch}`,
  campaign_seed: String(state.metadata.campaignSeed),
  warmup_iterations: warmup,
  decide: decision,
  propose_contract_to_hero: command
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');

const format = (measurement) =>
  `p50 ${measurement.p50_ms.toFixed(4)} ms, p95 ${measurement.p95_ms.toFixed(4)} ms`;

console.log(`decide:                  ${format(decision)}`);
console.log(`proposeContractToHero:   ${format(command)}`);
console.log(`written: ${outputPath}`);
