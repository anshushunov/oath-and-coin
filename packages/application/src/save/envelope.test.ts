import {
  RULESET_VERSION,
  createInitialState,
  decodeUtf8OrThrow,
  encodeUtf8,
  loadContentSet,
  memoryFileSource
} from '@oath-and-coin/content';
import {
  deepEqual,
  proposeContractToHero,
  type ContentId,
  type GameState
} from '@oath-and-coin/simulation';
import { describe, expect, it } from 'vitest';

import { SAVE_FORMAT_VERSION, buildSave, readSave, saveChecksum } from './envelope.ts';

/**
 * The envelope: version, signature and refusal table (design spec §2.3-§2.4).
 *
 * The plan this suite executes (`task-16-4-brief.md`) writes its tamper-test fixture
 * against `m1-decision/1` / `5d03734fd9c7abaa` — the real shipped tree's ruleset and
 * content version, the same pair `packages/content/src/save/snapshot-codec.test.ts` and
 * `packages/simulation/src/testing/fixtures.ts`'s own `aState()` use. This suite cannot
 * reach that tree the same way: `packages/application/tsconfig.json` carries `types: []`
 * (no Node types anywhere under `src`, tests included — see the comment there), so there
 * is no path here to `@oath-and-coin/content/node`, which is what reads a real directory.
 * `expectedVersions` is therefore derived from this file's own in-memory fixture instead
 * of the corpus's literal digest — internally consistent with what `aValidSave()` builds,
 * rather than a restatement of the brief's literal text.
 */

const BRAM_FILE = {
  schema_version: 2,
  id: 'core:bram',
  display_name_key: 'hero.core.bram.name',
  greed: 60,
  caution: 30,
  pride: 45,
  trust_in_guild: 50,
  traits: [],
  relationships: []
};

const CRYPT_FILE = {
  schema_version: 2,
  id: 'core:cleanse_the_crypt',
  display_name_key: 'contract.core.cleanse_the_crypt.name',
  payment: 70,
  risk: 30,
  required_crew: 1,
  tags: []
};

/** Unused by any hero here — `loadContentSet` still requires a `traits/` directory. */
const GREEDY_FILE = {
  schema_version: 2,
  id: 'core:greedy',
  display_name_key: 'trait.core.greedy.name',
  kind: 'inclination',
  tag: 'method:escort',
  weight: 20
};

const content = loadContentSet(
  memoryFileSource({
    'heroes/bram.json': JSON.stringify(BRAM_FILE),
    'contracts/crypt.json': JSON.stringify(CRYPT_FILE),
    'traits/greedy.json': JSON.stringify(GREEDY_FILE)
  })
);

function aState(): GameState {
  return createInitialState(content, 7n, RULESET_VERSION);
}

/** `aState()`, with Bram's answer to the crypt contract recorded — history and traces
 * non-empty, and the contract's `respondedBy`/`acceptedBy` non-empty too, so referential
 * integrity has something to break. */
function aDecidedState(): GameState {
  const base = aState();
  const [heroKey] = base.heroes.keys();
  const [contractKey] = base.contracts.keys();
  const result = proposeContractToHero(base, {
    commandId: 1,
    heroId: heroKey!,
    contractId: contractKey!,
    expectedStateVersion: base.metadata.stateVersion
  });

  return result.state;
}

const state = aState();
const FOCUSED_CONTRACT = state.contracts.keys()[0] as ContentId;
const CREATED_AT = '2026-08-19T00:00:00.000Z';

const expectedVersions = {
  rulesetVersion: state.metadata.rulesetVersion,
  contentVersion: state.metadata.contentVersion
};

function aValidSave(): Uint8Array {
  return buildSave({ state, focusedContract: FOCUSED_CONTRACT, createdAt: CREATED_AT });
}

function parseSave(bytes: Uint8Array): Record<string, unknown> {
  return JSON.parse(decodeUtf8OrThrow(bytes)) as Record<string, unknown>;
}

/** Recomputes the checksum for a mutated file and re-encodes it — an honest resign. */
function resign(file: Record<string, unknown>): Uint8Array {
  const { checksum: _checksum, created_at, ...withoutChecksum } = file;
  return encodeUtf8(
    JSON.stringify({ ...withoutChecksum, created_at, checksum: saveChecksum(withoutChecksum) })
  );
}

describe('reading back a save nobody tampered with', () => {
  it('answers the state and descriptor it was built from', () => {
    const { state: readState, descriptor } = readSave(aValidSave(), expectedVersions);

    expect(deepEqual(readState, state)).toBe(true);
    expect(descriptor).toEqual({
      createdAt: CREATED_AT,
      logicalTime: state.metadata.logicalTime,
      focusedContract: FOCUSED_CONTRACT
    });
  });
});

const tamperCases: [string, (f: Record<string, unknown>) => void, string][] = [
  [
    'чужая версия конверта',
    (f) => {
      f.format_version = 99;
    },
    'SAVE_FORMAT_UNSUPPORTED'
  ],
  [
    'чужая версия снимка',
    (f) => {
      f.save_schema_version = 99;
    },
    'SAVE_SCHEMA_UNSUPPORTED'
  ],
  [
    'чужие правила',
    (f) => {
      f.ruleset_version = `${RULESET_VERSION}/999`;
    },
    'SAVE_RULESET_MISMATCH'
  ],
  [
    'чужой контент',
    (f) => {
      f.content_version = 'deadbeefdeadbeef';
    },
    'SAVE_CONTENT_MISMATCH'
  ],
  [
    'поле конверта разошлось со снимком',
    (f) => {
      f.campaign_seed = '12345';
    },
    'SAVE_INCONSISTENT'
  ]
];

// `resign` пересчитывает сумму: эти случаи проверяют смысловые отказы, а не сумму.
it.each(tamperCases)('отказывает после честной переподписи: %s', (_name, mutate, code) => {
  const file = parseSave(aValidSave());
  mutate(file);
  expect(() => readSave(resign(file), expectedVersions)).toThrow(new RegExp(code, 'u'));
});

it('ловит подмену, не переподписанную заново', () => {
  // Без этого теста мутант «исключить поле из суммы» остался бы зелёным: `it.each`
  // выше переподписывает файл и получает свой отказ независимо от того, что
  // покрывает сумма.
  const file = parseSave(aValidSave());
  file.campaign_seed = '12345'; // сумма НЕ пересчитывается
  const bytes = encodeUtf8(JSON.stringify(file));

  expect(() => readSave(bytes, expectedVersions)).toThrow(/SAVE_CHECKSUM_MISMATCH/u);
});

it('отказывает на байтах, которые не разбираются как JSON', () => {
  // Не таблицей: остальные случаи мутируют объект, а этот обязан построить байты сам.
  expect(() => readSave(encodeUtf8('{не json'), expectedVersions)).toThrow(/SAVE_MALFORMED/u);
});

it('называет первый по порядку отказ, когда сломано два поля сразу', () => {
  const file = parseSave(aValidSave());
  file.format_version = 99;
  file.ruleset_version = `${RULESET_VERSION}/999`;

  // Версия конверта проверяется раньше: остальные поля прочитаны по правилам
  // формата, которого нет, и говорить о них ещё нечего.
  expect(() => readSave(resign(file), expectedVersions)).toThrow(/SAVE_FORMAT_UNSUPPORTED/u);
});

it('называет отказ суммы раньше отказа версии правил, когда сломаны оба', () => {
  // Не входит в it.each буквально из плана: там оба случая всегда переподписаны,
  // так что порядок «сумма → версии» им не виден — сумма после переподписи валидна
  // в любом порядке проверок. Мутант «переставить сумму после версий» (шаг 9,
  // мутант C) остаётся зелёным без этого теста: обе версии проверок совпадают на
  // существующих тестах, потому что нигде больше сумма не остаётся сломанной и
  // ruleset_version одновременно.
  const file = parseSave(aValidSave());
  file.ruleset_version = `${RULESET_VERSION}/999`; // сумма НЕ пересчитывается
  const bytes = encodeUtf8(JSON.stringify(file));

  expect(() => readSave(bytes, expectedVersions)).toThrow(/SAVE_CHECKSUM_MISMATCH/u);
});

describe('referential integrity across the snapshot’s own maps', () => {
  // `decodeSnapshot` checks a map's own key against its value's identity, but not a
  // *reference between* two maps — an event's `causalTraceId`, a contract's
  // `respondedBy`/`acceptedBy` — because that reference spans two independently-built
  // maps. `readSave` closes that gap once the whole state exists to check it against.

  it('отказывает, когда событие ссылается на несуществующий след', () => {
    const decided = aDecidedState();
    const versions = {
      rulesetVersion: decided.metadata.rulesetVersion,
      contentVersion: decided.metadata.contentVersion
    };
    const file = parseSave(
      buildSave({ state: decided, focusedContract: FOCUSED_CONTRACT, createdAt: CREATED_AT })
    );
    const snapshot = file.snapshot as { history: { causalTraceId: number | null }[] };
    snapshot.history[0]!.causalTraceId = 9999;

    expect(() => readSave(resign(file), versions)).toThrow(/SAVE_INCONSISTENT/u);
  });

  it('отказывает, когда событие называет героя, которого нет в составе', () => {
    const decided = aDecidedState();
    const versions = {
      rulesetVersion: decided.metadata.rulesetVersion,
      contentVersion: decided.metadata.contentVersion
    };
    const file = parseSave(
      buildSave({ state: decided, focusedContract: FOCUSED_CONTRACT, createdAt: CREATED_AT })
    );
    const snapshot = file.snapshot as { history: { heroId: number }[] };
    snapshot.history[0]!.heroId = 999;

    expect(() => readSave(resign(file), versions)).toThrow(/SAVE_INCONSISTENT/u);
  });

  it('отказывает, когда контракт называет отсутствующего героя в respondedBy', () => {
    const decided = aDecidedState();
    const versions = {
      rulesetVersion: decided.metadata.rulesetVersion,
      contentVersion: decided.metadata.contentVersion
    };
    const file = parseSave(
      buildSave({ state: decided, focusedContract: FOCUSED_CONTRACT, createdAt: CREATED_AT })
    );
    const snapshot = file.snapshot as {
      contracts: { value: { respondedBy: number[] } }[];
    };
    snapshot.contracts[0]!.value.respondedBy = [...snapshot.contracts[0]!.value.respondedBy, 999];

    expect(() => readSave(resign(file), versions)).toThrow(/SAVE_INCONSISTENT/u);
  });
});

describe('SAVE_FORMAT_VERSION', () => {
  it('is 1, the version this build writes', () => {
    expect(SAVE_FORMAT_VERSION).toBe(1);
  });
});
