import {
  RULESET_VERSION,
  createInitialState,
  decodeSnapshot,
  decodeUtf8OrThrow,
  encodeSnapshot,
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

import {
  MAX_SAVE_BYTES,
  SAVE_FORMAT_VERSION,
  buildSave,
  readSave,
  saveChecksum
} from './envelope.ts';

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
  patron_fee: 70,
  risk: 30,
  required_crew: 1,
  tags: []
};

/** A second, legitimate contract — needed so a `focused_contract` tamper test can name
 * a contract that really exists in the save without being the signed one (review round
 * 2: a nonexistent id is caught by referential integrity before the checksum is ever
 * asked, which proves nothing about checksum coverage). */
const CARAVAN_FILE = {
  schema_version: 2,
  id: 'core:escort_the_caravan',
  display_name_key: 'contract.core.escort_the_caravan.name',
  patron_fee: 40,
  risk: 20,
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
    'contracts/caravan.json': JSON.stringify(CARAVAN_FILE),
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
const [FOCUSED_CONTRACT, OTHER_CONTRACT] = state.contracts.keys() as [ContentId, ContentId];
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

/**
 * Recomputes the checksum for a mutated file and re-encodes it — an honest resign.
 *
 * `created_at` is inside the signed set. It was outside until external review of Task
 * 16, and the whole point of the change is that a file which changes it without
 * re-signing is now refused; a resign helper that still excluded it would sign every
 * fixture below wrongly and every case would answer `SAVE_CHECKSUM_MISMATCH` instead of
 * the refusal it is about.
 */
function resign(file: Record<string, unknown>): Uint8Array {
  const { checksum: _checksum, ...withoutChecksum } = file;
  return encodeUtf8(
    JSON.stringify({ ...withoutChecksum, checksum: saveChecksum(withoutChecksum) })
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

describe('запись отказывается произвести файл, который чтение отвергнет', () => {
  // The domain half of this promise is exercised by the invariant table further down.
  // These two are the other half — the snapshot's own contract, and the size ceiling —
  // and both need a campaign the content loader can no longer build, since the loader
  // now states the same limits. So the state is assembled directly: a real `GameState`
  // with one field replaced, which is exactly what a defect in a future transition would
  // hand `buildSave`.

  it('когда снимок не проходит собственный контракт чтения', () => {
    const base = aState();
    const [id, hero] = base.heroes.entries()[0]!;
    const tooLong = 'x'.repeat(300);

    const withOverlongName: GameState = {
      ...base,
      heroes: base.heroes.set(id, { ...hero, displayNameKey: tooLong })
    };

    expect(() =>
      buildSave({
        state: withOverlongName,
        focusedContract: FOCUSED_CONTRACT,
        createdAt: CREATED_AT
      })
    ).toThrow(/SAVE_OUT_OF_BOUNDS/u);
  });

  it('когда файл вышел бы за потолок, который держит любое хранилище слотов', () => {
    // `MAX_SAVE_BYTES` is a promise every store keeps (`save-store-contract.test.ts`
    // measures both), and this is the promise on the producing side: what this build
    // writes, a store may accept. Reached through `definition`, a content id, which
    // neither the codec nor the content contracts bound by length — the file-size
    // ceiling is what bounds it, and this is the check that says so.
    const base = aState();
    const [id, hero] = base.heroes.entries()[0]!;
    const enormous = `core:${'a'.repeat(MAX_SAVE_BYTES + 16)}` as ContentId;

    const withEnormousDefinition: GameState = {
      ...base,
      heroes: base.heroes.set(id, { ...hero, definition: enormous })
    };

    expect(() =>
      buildSave({
        state: withEnormousDefinition,
        focusedContract: FOCUSED_CONTRACT,
        createdAt: CREATED_AT
      })
    ).toThrow(new RegExp(`${MAX_SAVE_BYTES}-byte ceiling`, 'u'));
  });

  it('и когда фокусный контракт не принадлежит этой кампании', () => {
    expect(() =>
      buildSave({
        state,
        focusedContract: 'core:contract_nobody_authored' as ContentId,
        createdAt: CREATED_AT
      })
    ).toThrow(/SAVE_INCONSISTENT/u);
  });
});

describe('чтение отказывается разбирать файл больше потолка, который держит любое хранилище', () => {
  // External review of segment 5: the ceiling was enforced by everything that *produces*
  // or *stores* a save and by nothing that reads one. Leading JSON whitespace is the
  // demonstration because it is invisible to every other check in this module at once —
  // `JSON.parse` skips it, so the object is unchanged and the checksum over that object
  // still matches. A legitimate, honestly-signed save padded to `MAX_SAVE_BYTES + 1` was
  // read back clean: `{"limit":8388608,"bytes":8388609,"accepted":true}`.
  //
  // The two cases below are a pair on purpose. Without the one at the limit, "refuse
  // everything" would pass; without the one past it, the check can be deleted and nothing
  // notices.

  /** `bytes` with leading spaces in front of the JSON, to exactly `size` bytes. Every
   * byte added is ASCII, so one space is one byte. */
  function paddedTo(bytes: Uint8Array, size: number): Uint8Array {
    return encodeUtf8(' '.repeat(size - bytes.length) + decodeUtf8OrThrow(bytes));
  }

  it('принимает файл ровно в потолок — и добивка ничего больше в нём не меняет', () => {
    const atTheLimit = paddedTo(aValidSave(), MAX_SAVE_BYTES);

    expect(atTheLimit.length).toBe(MAX_SAVE_BYTES);
    expect(readSave(atTheLimit, expectedVersions).descriptor).toEqual({
      createdAt: CREATED_AT,
      logicalTime: state.metadata.logicalTime,
      focusedContract: FOCUSED_CONTRACT
    });
  });

  it('отказывает файлу на байт больше — и именно за размер, а не за сумму или форму', () => {
    const oneTooMany = paddedTo(aValidSave(), MAX_SAVE_BYTES + 1);

    expect(oneTooMany.length).toBe(MAX_SAVE_BYTES + 1);
    expect(() => readSave(oneTooMany, expectedVersions)).toThrow(/SAVE_OUT_OF_BOUNDS/u);
    // Названо отдельно: без этого проверка могла бы стоять после разбора и отвечать
    // тем же кодом, уже разобрав те самые байты, которых потолок и не должен касаться.
    expect(() => readSave(oneTooMany, expectedVersions)).toThrow(
      `${MAX_SAVE_BYTES}-byte ceiling this build writes, stores and reads`
    );
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
  // *reference between* two maps — an event's `heroId`/`contractId`/`causalTraceId`, a
  // hero's `traits`, a contract's `respondedBy`/`acceptedBy` — because that reference
  // spans two independently-built maps. `validateGameState` closes that gap once the
  // whole state exists to check it against.
  //
  // **Every case names the fragment of its own refusal.** These six conditions share
  // the code `SAVE_INCONSISTENT` with fourteen others, and round 2 of the seam review
  // measured what the code alone was worth here: with `/SAVE_INCONSISTENT/` and nothing
  // more, three of them were killed by a *neighbouring* rule — a dangling `heroId` in
  // the history, a dangling `contractId`, and an unknown hero in `respondedBy` all end
  // up refused by "this contract lists a hero the history never records answering",
  // which is a different rule catching a different thing that happens to be true of the
  // same file. A sixth condition — an unknown hero in `acceptedBy` — had no test at all
  // and was masked by its neighbour two lines above it even without a mutant.

  const referentialCases: [string, (snapshot: RawSnapshot) => void, string][] = [
    [
      'событие ссылается на несуществующий след',
      (snapshot) => {
        snapshot.history[0]!.causalTraceId = 9999;
      },
      'references causalTraceId 9999'
    ],
    [
      'событие называет героя, которого нет в составе',
      (snapshot) => {
        snapshot.history[0]!.heroId = 999;
      },
      'names hero#999'
    ],
    [
      'событие называет контракт, которого нет в снимке',
      (snapshot) => {
        // Ревью Task 16.4, раунд 1: `event.contractId` — та же по форме ссылка, что
        // `heroId` и `causalTraceId`; `restoreDecidedSteps` кладёт её в
        // `command.contract` без поиска, так что висячая доехала бы до экрана.
        snapshot.history[0]!.contractId = 'core:contract_nobody_authored';
      },
      "names contract 'core:contract_nobody_authored'"
    ],
    [
      'герой держит черту, для которой в снимке нет правила',
      (snapshot) => {
        // Ревью Task 16.7: экран называет каждую черту каждого героя (`resolveTrait` в
        // фабрике модели), поэтому сохранение с висячей чертой доезжало до фабрики и
        // падало там обычным `Error` — отказ файла превращался в дефект сборки на три
        // слоя выше. Здесь это условие, а не умолчание где-то ниже.
        snapshot.heroes[0]!.value.traits = ['core:trait_nobody_authored'];
      },
      'the save carries no rule for it'
    ],
    [
      'контракт называет отсутствующего героя в respondedBy',
      (snapshot) => {
        snapshot.contracts[0]!.value.respondedBy = [
          ...snapshot.contracts[0]!.value.respondedBy,
          999
        ];
      },
      'in respondedBy, but the save carries no such hero'
    ],
    [
      'контракт называет отсутствующего героя в acceptedBy',
      (snapshot) => {
        // `respondedBy` намеренно НЕ трогается: добавь 999 в оба множества — и первой
        // отвечает проверка `respondedBy` двумя строками выше, а эта не измеряется
        // вовсе. Ровно так она и оставалась непокрытой до второго раунда ревью на шве.
        snapshot.contracts[0]!.value.acceptedBy = [...snapshot.contracts[0]!.value.acceptedBy, 999];
      },
      'in acceptedBy, but the save carries no such hero'
    ]
  ];

  it.each(referentialCases)('отказывает, когда %s', (_name, mutate, detail) => {
    expect(() => readSave(aTamperedSave(mutate), expectedVersions)).toThrow(/SAVE_INCONSISTENT/u);
    expect(() => readSave(aTamperedSave(mutate), expectedVersions)).toThrow(detail);
  });

  it.each(referentialCases)('и отказывается ЗАПИСАТЬ то же самое: %s', (_name, mutate, detail) => {
    const decided = aDecidedState();
    const snapshot = JSON.parse(JSON.stringify(encodeSnapshot(decided))) as RawSnapshot;
    mutate(snapshot);

    expect(() =>
      buildSave({
        state: decodeSnapshot(snapshot),
        focusedContract: FOCUSED_CONTRACT,
        createdAt: CREATED_AT
      })
    ).toThrow(detail);
  });

  it('отказывает, когда focused_contract называет контракт, которого нет в снимке', () => {
    // Ревью Task 16.4, раунд 1: `focused_contract` был проверен только регуляркой формы
    // и уходил в дескриптор без сверки со `state.contracts` — а именно его
    // `contractOfferScreenModel` получает третьим аргументом после перезагрузки.
    const file = parseSave(aValidSave());
    file.focused_contract = 'core:contract_nobody_authored';

    expect(() => readSave(resign(file), expectedVersions)).toThrow(/SAVE_INCONSISTENT/u);
    expect(() => readSave(resign(file), expectedVersions)).toThrow(
      "envelope names focused_contract 'core:contract_nobody_authored'"
    );
  });
});

/**
 * A snapshot with `mutate` applied, re-signed honestly, as bytes — the shape every
 * domain-invariant case below shares. `aDecidedState()` is the campaign: Bram accepts
 * `core:cleanse_the_crypt`, so `respondedBy`, `acceptedBy`, `history`, `traces`,
 * `appliedCommandIds` and every counter are all non-empty and all agree.
 */
function aTamperedSave(mutate: (snapshot: RawSnapshot) => void): Uint8Array {
  const decided = aDecidedState();
  const file = parseSave(
    buildSave({ state: decided, focusedContract: FOCUSED_CONTRACT, createdAt: CREATED_AT })
  );
  mutate(file.snapshot as RawSnapshot);

  return resign(file);
}

interface RawSnapshot {
  metadata: Record<string, number | string>;
  heroes: { value: { traits: string[] } }[];
  contracts: {
    key: string;
    value: { requiredCrew: number; status: string; respondedBy: number[]; acceptedBy: number[] };
  }[];
  appliedCommandIds: number[];
  traces: {
    key: number;
    value: {
      traceId: number;
      positiveFactors: { reasonCode: string; sourceEntity: string; magnitude: number }[];
      negativeFactors: { reasonCode: string; sourceEntity: string; magnitude: number }[];
      blockedBy: { reasonCode: string; sourceEntity: string }[];
      tieBreak: string | null;
    };
  }[];
  history: {
    kind: string;
    eventId: number;
    logicalTime: number;
    heroId: number;
    contractId: string;
    causalTraceId: number | null;
  }[];
}

describe('the campaign’s own invariants, checked on the way in and on the way out', () => {
  // External review of Task 16 reproduced the hole these close: a re-signed file whose
  // history carried `hero_accepted_contract` while the contract's `respondedBy` and
  // `acceptedBy` were emptied and its status put back to `offered` read back
  // successfully — and the same hero then answered the same contract a second time,
  // producing two identical history records. Referential integrity said every id
  // existed; nothing said the relations between them held.

  // Each case carries the fragment of the refusal it must produce, not merely the code.
  // Without that, three of these checks are killed by a *neighbouring* check instead of
  // their own — measured with mutants: dropping "acceptedBy is a subset of respondedBy"
  // left every case green, because the history comparison two lines down refuses the
  // same file for a different reason. A code alone cannot tell those apart; the message
  // a player's refusal carries can, and it is the thing that names which rule was broken.
  const cases: [string, (snapshot: RawSnapshot) => void, string][] = [
    [
      'ответ стёрт из контракта, а событие о нём осталось — файл из внешнего ревью',
      (snapshot) => {
        const contract = snapshot.contracts[0]!.value;
        contract.respondedBy = [];
        contract.acceptedBy = [];
        contract.status = 'offered';
      },
      'respondedBy does not carry that hero'
    ],
    [
      'герой в acceptedBy, но не в respondedBy',
      (snapshot) => {
        snapshot.contracts[0]!.value.respondedBy = [];
        snapshot.contracts[0]!.value.status = 'offered';
      },
      'in acceptedBy but not in respondedBy'
    ],
    [
      'история говорит «принял», контракт — «не в составе»',
      (snapshot) => {
        snapshot.contracts[0]!.value.acceptedBy = [];
        snapshot.contracts[0]!.value.status = 'offered';
      },
      'and the history disagree about'
    ],
    [
      'один герой отвечает на один контракт дважды',
      (snapshot) => {
        // The second answer gets its own trace, and the counters follow it. Sharing the
        // first event's trace would be refused a step earlier — a trace explains exactly
        // one decision — and this case is about the *answer* being recorded twice, not
        // about the explanation being.
        const [first] = snapshot.history;
        snapshot.history = [first!, { ...first!, eventId: 1, causalTraceId: 1 }];
        snapshot.traces = [
          ...snapshot.traces,
          { key: 1, value: { ...snapshot.traces[0]!.value, traceId: 1 } }
        ];
        snapshot.appliedCommandIds = [1, 2];
        snapshot.metadata.nextEventId = 2;
        snapshot.metadata.stateVersion = 2;
        snapshot.metadata.nextTraceId = 2;
      },
      'more than once'
    ],
    [
      'respondedBy называет героя, о котором в истории ничего нет',
      (snapshot) => {
        snapshot.history = [];
        snapshot.appliedCommandIds = [];
        snapshot.traces = [];
        snapshot.metadata.nextEventId = 0;
        snapshot.metadata.stateVersion = 0;
        snapshot.metadata.nextTraceId = 0;
      },
      'the history carries no event of that hero answering it'
    ],
    [
      'состав набран, а контракт всё ещё предлагается',
      (snapshot) => {
        snapshot.contracts[0]!.value.status = 'offered';
      },
      'a contract is crewed exactly when its required crew has accepted'
    ],
    [
      'контракт закрыт составом, которого не хватает',
      (snapshot) => {
        snapshot.contracts[0]!.value.requiredCrew = 2;
      },
      'a contract is crewed exactly when its required crew has accepted'
    ],
    [
      'nextEventId не совпадает с длиной истории',
      (snapshot) => {
        snapshot.metadata.nextEventId = 7;
      },
      'the counter advances by one per appended event'
    ],
    [
      'stateVersion не совпадает с длиной истории',
      (snapshot) => {
        snapshot.metadata.stateVersion = 7;
      },
      'the version advances by one per campaign transition'
    ],
    [
      'применённых команд больше, чем событий',
      (snapshot) => {
        snapshot.appliedCommandIds = [1, 2];
      },
      'every applied command appends exactly one'
    ],
    [
      'nextTraceId не равен числу хранимых следов',
      (snapshot) => {
        snapshot.metadata.nextTraceId = 5;
      },
      'the counter is the next free id'
    ],
    [
      'следы пронумерованы не подряд',
      (snapshot) => {
        // `nextTraceId` deliberately left at 1, which is still `traces.size`: without
        // that, the counter check above fires first and this case measures nothing about
        // trace ids being dense.
        snapshot.traces[0]!.key = 3;
        snapshot.traces[0]!.value.traceId = 3;
        snapshot.history[0]!.causalTraceId = 3;
      },
      'trace ids are dense and assigned in order'
    ],
    [
      'eventId не совпадает с местом события в журнале',
      (snapshot) => {
        // Counters left alone for the same reason: `nextEventId` still equals the
        // history's length, so the only thing left to notice is that the one event in it
        // claims id 4.
        snapshot.history[0]!.eventId = 4;
      },
      'event ids are assigned in order'
    ],
    [
      'событие датировано позже, чем показывают часы кампании',
      (snapshot) => {
        snapshot.history[0]!.logicalTime = 9;
      },
      'it is never behind the log'
    ],
    [
      'журнал не монотонен по логическому времени',
      (snapshot) => {
        // Needs two events, and two events that are otherwise perfectly consistent —
        // otherwise the response bookkeeping refuses this file before the clock is ever
        // looked at, and the case measures a check it does not name. So Bram declines
        // the *second* contract as well: its `respondedBy` gets him, its `acceptedBy`
        // does not, it stays `offered`, and a second trace is stored under the next free
        // id. That second trace is the first one's factor lists swapped: the campaign's
        // one real decision sums to +36, so the mirror of it sums to −36 — a refusal
        // whose motives explain a refusal. A verbatim copy would be an acceptance's
        // trace under a refusal's event, which is refused a step earlier now, and this
        // case is about the clock rather than about the explanation. The only thing
        // wrong with the result is that event 1 is dated before event 0.
        const [first] = snapshot.history;
        first!.logicalTime = 5;
        snapshot.history = [
          first!,
          {
            kind: 'hero_declined_contract',
            eventId: 1,
            logicalTime: 3,
            causalTraceId: 1,
            heroId: first!.heroId,
            contractId: OTHER_CONTRACT
          }
        ];
        snapshot.traces = [
          ...snapshot.traces,
          {
            key: 1,
            value: {
              ...snapshot.traces[0]!.value,
              traceId: 1,
              positiveFactors: snapshot.traces[0]!.value.negativeFactors,
              negativeFactors: snapshot.traces[0]!.value.positiveFactors
            }
          }
        ];
        const other = snapshot.contracts.find((entry) => entry.key === OTHER_CONTRACT)!;
        other.value.respondedBy = [first!.heroId];
        snapshot.appliedCommandIds = [1, 2];
        snapshot.metadata.nextEventId = 2;
        snapshot.metadata.stateVersion = 2;
        snapshot.metadata.nextTraceId = 2;
        snapshot.metadata.logicalTime = 5;
      },
      'history is monotone in logical time'
    ],

    // The two files external review of segment 5 re-signed by hand, and the four
    // neighbouring shapes the same rule has to refuse. Both originals read back clean on
    // the head this review was written against: the first left a decision with no
    // explanation at all, the second let a trace say a red line closed a contract the
    // history says the hero took.
    [
      'решение записано без объяснения — первый файл из внешнего ревью',
      (snapshot) => {
        snapshot.history[0]!.causalTraceId = null;
      },
      'carrying no causalTraceId'
    ],
    [
      'принятие объяснено следом, который называет красную линию — второй файл из ревью',
      (snapshot) => {
        snapshot.traces[0]!.value.blockedBy = [
          { reasonCode: 'hero.decision.principle_forbids', sourceEntity: 'core:greedy' }
        ];
      },
      'a red line closes the decision before any score exists'
    ],
    [
      'заблокированное решение всё же взвешивает факторы',
      (snapshot) => {
        // A refusal, so the block and the action agree — what remains wrong is that the
        // trace both closes the path and weighs terms along it.
        snapshot.history[0]!.kind = 'hero_declined_contract';
        snapshot.contracts[0]!.value.acceptedBy = [];
        snapshot.contracts[0]!.value.status = 'offered';
        snapshot.traces[0]!.value.blockedBy = [
          { reasonCode: 'hero.decision.principle_forbids', sourceEntity: 'core:greedy' }
        ];
      },
      'closed before any factor is weighed'
    ],
    [
      'заблокированное решение вдобавок разрешает ничью',
      (snapshot) => {
        snapshot.history[0]!.kind = 'hero_declined_contract';
        snapshot.contracts[0]!.value.acceptedBy = [];
        snapshot.contracts[0]!.value.status = 'offered';
        snapshot.traces[0]!.value.positiveFactors = [];
        snapshot.traces[0]!.value.negativeFactors = [];
        snapshot.traces[0]!.value.blockedBy = [
          { reasonCode: 'hero.decision.principle_forbids', sourceEntity: 'core:greedy' }
        ];
        snapshot.traces[0]!.value.tieBreak = 'hero.decision.no_reason_to_refuse';
      },
      'settles no dead heat'
    ],
    [
      'принятие объяснено следом, чьи мотивы складываются в минус',
      (snapshot) => {
        // The one real decision sums to +36; swapping the lists mirrors it to −36 while
        // the history still says the hero took the contract.
        const trace = snapshot.traces[0]!.value;
        const positive = trace.positiveFactors;
        trace.positiveFactors = trace.negativeFactors;
        trace.negativeFactors = positive;
      },
      'takes a contract exactly when its motives sum to zero or better'
    ],
    [
      'ничья объявлена там, где мотивы не сошлись',
      (snapshot) => {
        snapshot.traces[0]!.value.tieBreak = 'hero.decision.no_reason_to_refuse';
      },
      'a tie is exactly a sum of zero'
    ],
    [
      'след, который ничего не объясняет',
      (snapshot) => {
        // Numbering stays perfectly legal — dense ids, `nextTraceId` equal to the count —
        // and nothing points at the second trace. That is the case the counters cannot
        // see: they measure how many traces there are, not whether each explains a
        // decision.
        snapshot.traces = [
          ...snapshot.traces,
          { key: 1, value: { ...snapshot.traces[0]!.value, traceId: 1 } }
        ];
        snapshot.metadata.nextTraceId = 2;
      },
      'that no history event references'
    ],
    [
      'два решения объяснены одним следом',
      (snapshot) => {
        // The other direction of the same bijection, and the one the counters are even
        // further from seeing: with two events pointing at one trace, `nextTraceId`
        // still equals the number of traces and the ids are still dense. Bram answers
        // the second contract as well, so everything except the shared explanation is a
        // campaign the engine could have produced.
        const [first] = snapshot.history;
        snapshot.history = [
          first!,
          {
            kind: 'hero_declined_contract',
            eventId: 1,
            logicalTime: first!.logicalTime,
            causalTraceId: 0,
            heroId: first!.heroId,
            contractId: OTHER_CONTRACT
          }
        ];
        snapshot.contracts.find((entry) => entry.key === OTHER_CONTRACT)!.value.respondedBy = [
          first!.heroId
        ];
        snapshot.appliedCommandIds = [1, 2];
        snapshot.metadata.nextEventId = 2;
        snapshot.metadata.stateVersion = 2;
      },
      'a trace explains exactly one decision'
    ]
  ];

  it.each(cases)('отказывает при чтении: %s', (_name, mutate, detail) => {
    expect(() => readSave(aTamperedSave(mutate), expectedVersions)).toThrow(/SAVE_INCONSISTENT/u);
    expect(() => readSave(aTamperedSave(mutate), expectedVersions)).toThrow(detail);
  });

  it.each(cases)('и отказывается ЗАПИСАТЬ то же самое: %s', (_name, mutate, detail) => {
    // The other half, and the half external review said was missing: a producer must not
    // be able to write what the reader refuses. The state is built by `decodeSnapshot`,
    // which deliberately checks shape and not domain — so this is a real `GameState`
    // carrying the same broken campaign, handed to `buildSave`.
    const decided = aDecidedState();
    const snapshot = JSON.parse(JSON.stringify(encodeSnapshot(decided))) as RawSnapshot;
    mutate(snapshot);

    expect(() =>
      buildSave({
        state: decodeSnapshot(snapshot),
        focusedContract: FOCUSED_CONTRACT,
        createdAt: CREATED_AT
      })
    ).toThrow(detail);
  });

  it('принимает кампанию, которую движок действительно произвёл', () => {
    // The guard on the guards: every case above tampers with a save built from this same
    // campaign, so if `validateGameState` refused everything the table would still be
    // green and would prove nothing.
    const decided = aDecidedState();
    const versions = {
      rulesetVersion: decided.metadata.rulesetVersion,
      contentVersion: decided.metadata.contentVersion
    };
    const bytes = buildSave({
      state: decided,
      focusedContract: FOCUSED_CONTRACT,
      createdAt: CREATED_AT
    });

    expect(deepEqual(readSave(bytes, versions).state, decided)).toBe(true);
  });
});

describe('checksum coverage for fields with no second line of defense', () => {
  // `campaign_seed`, `logical_time`, `ruleset_version`, `content_version` и
  // `save_schema_version` дублируются внутри снимка и ловятся ещё раз
  // `requireDuplicateFieldsAgree`, даже если бы выпали из суммы. `focused_contract` и
  // `snapshot` — нет: сумма для них единственная защита. Ревью, раунд 1, находка 3.

  it('ловит непереподписанную подмену focused_contract', () => {
    // Ревью, раунд 2: значение обязано быть законным по всем прочим проверкам —
    // существующим контрактом, отличным от подписанного, — иначе первым отказывает
    // не сумма, а проверка ссылочной целостности, и тест не измеряет то, что заявляет.
    const file = parseSave(aValidSave());
    file.focused_contract = OTHER_CONTRACT; // сумма НЕ пересчитывается
    const bytes = encodeUtf8(JSON.stringify(file));

    expect(() => readSave(bytes, expectedVersions)).toThrow(/SAVE_CHECKSUM_MISMATCH/u);
  });

  it('ловит непереподписанную подмену created_at', () => {
    // Внешнее ревью Task 16: `created_at` был исключён из суммы, проверялся как
    // произвольная строка и доезжал до интерфейса — файл заявлял целостность и при
    // этом был правлен после подписи. Значение здесь законное по форме (иначе первой
    // отвечает проверка формы, а не сумма) и просто не то, которое подписано.
    const file = parseSave(aValidSave());
    expect(file.created_at).toBe(CREATED_AT);
    file.created_at = '2031-01-01T00:00:00.000Z'; // сумма НЕ пересчитывается
    const bytes = encodeUtf8(JSON.stringify(file));

    expect(() => readSave(bytes, expectedVersions)).toThrow(/SAVE_CHECKSUM_MISMATCH/u);
  });

  it('ловит непереподписанную правку внутри snapshot', () => {
    const file = parseSave(aValidSave());
    const snapshot = file.snapshot as { heroes: { value: { greed: number } }[] };
    snapshot.heroes[0]!.value.greed = snapshot.heroes[0]!.value.greed + 1; // сумма НЕ пересчитывается
    const bytes = encodeUtf8(JSON.stringify(file));

    expect(() => readSave(bytes, expectedVersions)).toThrow(/SAVE_CHECKSUM_MISMATCH/u);
  });
});

describe('форма конверта', () => {
  it('отказывает файлу с лишним полем', () => {
    // Ревью, раунд 1, находка 4: `requireEnvelopeShape` перечисляла обязательные
    // поля и молчала про незнакомое десятое — переподписанный файл с лишним полем
    // читался бы штатно.
    const file = parseSave(aValidSave());
    file.extra_field = 'nobody asked for this';

    expect(() => readSave(resign(file), expectedVersions)).toThrow(/SAVE_MALFORMED/u);
  });

  it('отказывает JSON, который не объект, не притворяясь версией `undefined`', () => {
    // Ревью, раунд 1, находка 5: посторонний JSON (число, строка, массив, `null`)
    // раньше давал SAVE_FORMAT_UNSUPPORTED с текстом «version undefined» — значением
    // поля, которого в этих байтах никогда не было.
    let caught: unknown;
    try {
      readSave(encodeUtf8('42'), expectedVersions);
    } catch (error) {
      caught = error;
    }

    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toMatch(/SAVE_MALFORMED/u);
    expect((caught as Error).message).not.toMatch(/undefined/u);
  });

  it('отказывает на байтах, которые не являются валидным UTF-8', () => {
    // Ревью, раунд 1, находка 6: ветка была живая (`decodeUtf8OrThrow`, `fatal:
    // true`), но ни один тест её не проходил.
    const invalidUtf8 = Uint8Array.of(0xff, 0xfe, 0x00, 0x00);

    expect(() => readSave(invalidUtf8, expectedVersions)).toThrow(/SAVE_MALFORMED/u);
  });

  it('называет форму раньше суммы, когда сломаны обе', () => {
    // Ревью, раунд 1, находка 7: пришпилены format_version → ruleset и checksum →
    // ruleset; форма против суммы — нет.
    const file = parseSave(aValidSave());
    file.logical_time = 'not-a-number'; // ломает и форму, и (без переподписи) сумму
    const bytes = encodeUtf8(JSON.stringify(file));

    expect(() => readSave(bytes, expectedVersions)).toThrow(/SAVE_MALFORMED/u);
  });
});

describe('created_at имеет ровно одну форму, и она проверяется с обеих сторон', () => {
  // Оно писалось и читалось как произвольная строка. `not-a-date` доезжал до экрана
  // слотов, где показывается игроку, а сумма его не покрывала — то есть файл заявлял
  // целостность, будучи правленным после подписи.

  const badForms = [
    ['совсем не дата', 'not-a-date'],
    ['без миллисекунд', '2026-08-19T09:41:00Z'],
    ['со смещением вместо UTC', '2026-08-19T09:41:00.000+03:00'],
    ['тринадцатый месяц', '2026-13-19T09:41:00.000Z'],
    ['31 февраля', '2026-02-31T09:41:00.000Z'],
    ['пустая строка', '']
  ];

  it.each(badForms)('чтение отказывает: %s', (_name, createdAt) => {
    const file = parseSave(aValidSave());
    file.created_at = createdAt;

    expect(() => readSave(resign(file), expectedVersions)).toThrow(/SAVE_MALFORMED/u);
  });

  it.each(badForms)('запись отказывается ставить такой штамп: %s', (_name, createdAt) => {
    expect(() => buildSave({ state, focusedContract: FOCUSED_CONTRACT, createdAt })).toThrow(
      /SAVE_MALFORMED/u
    );
  });

  it('принимает ровно то, что пишет `Date.prototype.toISOString`', () => {
    // The composition root's `now` is `() => new Date().toISOString()` (`App.tsx`), so
    // this is the one form that has to pass — asserted against the method itself rather
    // than against a literal that could be typed to match a broken pattern.
    const stamp = new Date(Date.UTC(2026, 7, 19, 9, 41, 0, 123)).toISOString();

    expect(
      readSave(
        buildSave({ state, focusedContract: FOCUSED_CONTRACT, createdAt: stamp }),
        expectedVersions
      ).descriptor.createdAt
    ).toBe(stamp);
  });
});

describe('SAVE_FORMAT_VERSION', () => {
  it('is 1, the version this build writes', () => {
    expect(SAVE_FORMAT_VERSION).toBe(1);
  });
});
