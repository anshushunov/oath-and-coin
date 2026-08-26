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
  compareHeroIds,
  composeOffer,
  deepEqual,
  lockOffer,
  proposeContractToHero,
  settleContract,
  SortedSet,
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
 * against `m1-negotiation/1` / `5d03734fd9c7abaa` — the real shipped tree's ruleset and
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
  schema_version: 4,
  id: 'core:bram',
  display_name_key: 'hero.core.bram.name',
  greed: 60,
  caution: 30,
  pride: 45,
  trust_in_guild: 50,
  capability: { grade: 50, expertise: { frontline: 50, wilderness: 50 } },
  traits: [],
  relationships: []
};

const CRYPT_FILE = {
  schema_version: 4,
  id: 'core:cleanse_the_crypt',
  display_name_key: 'contract.core.cleanse_the_crypt.name',
  patron_fee: 70,
  // Risk 0, not 30: `ScenarioCommand`/`proposeContractToHero` here has no way to compose
  // an offer (`composeOffer` arrives in `DEC-008` Tasks 10-14), so every propose in this
  // file reaches Bram with `advance = 0` — the patron fee itself no longer contributes at
  // all (`NEGOTIATION_SPEC` §4). Zero risk keeps both risk-aversion and the insult term
  // out of the way, so trust still carries this fixture to an acceptance rather than the
  // whole suite needing a second lever this command surface cannot supply.
  risk: 0,
  required_crew: 1,
  needs: { frontline: 10, wilderness: 10 },
  tags: []
};

/** A second, legitimate contract — needed so a `focused_contract` tamper test can name
 * a contract that really exists in the save without being the signed one (review round
 * 2: a nonexistent id is caught by referential integrity before the checksum is ever
 * asked, which proves nothing about checksum coverage). */
const CARAVAN_FILE = {
  schema_version: 4,
  id: 'core:escort_the_caravan',
  display_name_key: 'contract.core.escort_the_caravan.name',
  patron_fee: 40,
  risk: 20,
  required_crew: 1,
  needs: { frontline: 10, wilderness: 10 },
  tags: []
};

/** Unused by any hero here — `loadContentSet` still requires a `traits/` directory. */
const GREEDY_FILE = {
  schema_version: 4,
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
  const contract = base.contracts.get(contractKey!)!;
  // `proposeContractToHero` (`DEC-008` Task 11) only lets the offer's key hero answer
  // while the package is a draft — the offer is keyed to the one hero this fixture
  // proposes to directly, rather than through a real `composeOffer` command, so every
  // event id, trace id and history index this file's tamper table pins by number stays
  // exactly where it was: this fixture is about the envelope, not the negotiation
  // protocol's own commands.
  const keyed: GameState = {
    ...base,
    contracts: base.contracts.set(contractKey!, {
      ...contract,
      // `invited` moves with `keyHero` (`RESOLUTION_SPEC` §2.5): this contract has one
      // seat, so the key hero is the crew. Set by hand for the same reason `keyHero` is
      // — this fixture is about the envelope, not about `composeOffer`.
      offer: {
        ...contract.offer,
        keyHero: heroKey!,
        invited: SortedSet.from(compareHeroIds, [heroKey!])
      }
    })
  };

  const result = proposeContractToHero(keyed, {
    commandId: 1,
    heroId: heroKey!,
    contractId: contractKey!,
    expectedStateVersion: keyed.metadata.stateVersion
  });

  return result.state;
}

/**
 * `aDecidedState()`, then that same offer revised — `respondedBy` cleared while the
 * hero's `hero_accepted_contract`/`hero_declined_contract` event stays in `history`
 * (`NEGOTIATION_SPEC` §3.3, `composeOffer`). Named by review: the first campaign
 * `composeOffer` (`DEC-008` Task 10) can actually build, and the one
 * `checkResponseBookkeeping`'s response-bookkeeping invariant refused before it was
 * taught that a revision resets the window a hero can answer only once in — measured
 * directly, `buildSave` on this exact campaign threw `SAVE_INCONSISTENT` before that fix.
 */
function aDecidedThenRevisedState(): GameState {
  const decided = aDecidedState();
  const [heroKey] = decided.heroes.keys();
  const [contractKey] = decided.contracts.keys();

  const result = composeOffer(decided, {
    commandId: 2,
    contractId: contractKey!,
    keyHero: heroKey!,
    invited: [heroKey!],
    advance: 10,
    methodTag: null,
    promisedBonus: 0,
    expectedStateVersion: decided.metadata.stateVersion
  });

  return result.state;
}

/**
 * `aDecidedState()`, then that same accepted offer locked (`NEGOTIATION_SPEC` §3.3,
 * `lockOffer`) — `history` gains an `offer_locked` event alongside the acceptance,
 * `respondedBy`/`acceptedBy` stay exactly as `proposeContractToHero` left them (locking
 * clears neither), and the offer's `phase` moves to `locked`. Named by the same task
 * that added `lockOffer` (`DEC-008` Task 12): `domainEventSchema`
 * (`snapshot-codec.ts`) needs a member for this event, and `requireReadableSnapshot`
 * re-decodes on the *write* path (`buildSave`), so a schema missing that member breaks
 * saving this exact campaign, not only loading a file that already carries one.
 */
function aDecidedThenLockedState(): GameState {
  const decided = aDecidedState();
  const [contractKey] = decided.contracts.keys();

  const result = lockOffer(decided, {
    commandId: 2,
    contractId: contractKey!,
    expectedStateVersion: decided.metadata.stateVersion
  });

  return result.state;
}

/**
 * `aDecidedThenLockedState()`, then settled with the promise broken
 * (`NEGOTIATION_SPEC` §3.3, `settleContract`) — `history` gains a
 * `contract_settled_promise_broken` event, the treasury moves, and the key hero's
 * `believesGuildPromises`/`grievance` move with it. Named by `DEC-008` Task 14, for
 * the same reason `aDecidedThenLockedState` was named by Task 12:
 * `domainEventSchema` needs a member for this event, and `requireReadableSnapshot`
 * re-decodes on the write path, so a schema missing that member breaks saving this
 * exact campaign, not only loading a file that already carries one. `crypt.json`'s
 * offer carries no `promisedBonus` of its own by this point in the chain, so one is
 * composed onto it first — the one command in this chain `aDecidedState()`'s own
 * callers do not otherwise issue.
 */
function aDecidedThenLockedThenSettledState(): GameState {
  const decided = aDecidedState();
  const [heroKey] = decided.heroes.keys();
  const [contractKey] = decided.contracts.keys();

  const composed = composeOffer(decided, {
    commandId: 2,
    contractId: contractKey!,
    keyHero: heroKey!,
    invited: [heroKey!],
    advance: 10,
    methodTag: null,
    promisedBonus: 20,
    expectedStateVersion: decided.metadata.stateVersion
  }).state;

  const proposed = proposeContractToHero(composed, {
    commandId: 3,
    heroId: heroKey!,
    contractId: contractKey!,
    expectedStateVersion: composed.metadata.stateVersion
  }).state;

  const locked = lockOffer(proposed, {
    commandId: 4,
    contractId: contractKey!,
    expectedStateVersion: proposed.metadata.stateVersion
  }).state;

  const settled = settleContract(locked, {
    commandId: 5,
    contractId: contractKey!,
    pay: false,
    expectedStateVersion: locked.metadata.stateVersion
  });

  if (!settled.applied) {
    throw new Error(
      `aDecidedThenLockedThenSettledState: settleContract was refused ` +
        `(${String(settled.rejectionCode)}).`
    );
  }

  return settled.state;
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

it('отказывает сохранению, записанному предыдущей версией снимка', () => {
  // `NEGOTIATION_SPEC` §2.5: окно совместимости нулевое (`ADR-006`) — `readSave`'s
  // own version gate, not the codec, is the layer that says no to a save the
  // *previous* schema actually wrote, not merely to an arbitrary foreign number
  // (the `'чужая версия снимка'` case above already covers that). `1` is not a
  // made-up value: it is `SAVE_SCHEMA_VERSION`'s own value before `DEC-008` Task 6
  // raised it to 2, so this is the exact save a pre-negotiation build produced.
  const file = parseSave(aValidSave());
  file.save_schema_version = 1;
  expect(() => readSave(resign(file), expectedVersions)).toThrow(/SAVE_SCHEMA_UNSUPPORTED/u);
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
      'контракт зовёт в состав героя, которого нет в ростере',
      (snapshot) => {
        // `RESOLUTION_SPEC` §2.5, вторая колонка: существование каждого `HeroId` из
        // `invited` проверяют команды, валидатор загрузчика и декодер — конструктор
        // пакета ростера не видит и физически этого не может. Внешнее ревью PR #33
        // нашло, что валидатор обходил `respondedBy` и `acceptedBy`, но не `invited`:
        // приглашённый-призрак доезжал до `pollCrew`, который падал обычным `Error`
        // на поиске героя.
        //
        // Порча сделана так, чтобы сейв был структурно безупречен и неверен ровно в
        // одном — герой 999 не существует: два места в отряде, оба заняты, ответил
        // только ключевой, так что `invited.size = requiredCrew`,
        // `respondedBy ⊆ invited` и `acceptedBy ⊆ respondedBy` держатся, и
        // `createContractState` пропускает это состояние.
        const contract = snapshot.contracts[0]!.value;
        contract.requiredCrew = 2;
        contract.status = 'offered';
        contract.offer.invited = [...contract.offer.invited, 999];
      },
      'in invited, but the save carries no such hero'
    ],
    [
      // Renamed by the same reasoning that renamed the `acceptedBy` case below, and for
      // the same kind of cause. `RESOLUTION_SPEC` §2.5 makes `respondedBy ⊆ invited`
      // structural, so an unknown hero can no longer stand *alone* in `respondedBy`:
      // reaching that set at all means being in `invited` too, and the crew's own
      // existence check (added by external review of PR #33) runs one loop earlier. The
      // refusal this case wanted still happens — it happens under the crew's message.
      // The title names what the fixture actually exercises rather than what it used to.
      'контракт держит в respondedBy id, которого нет в ростере — ловится составом',
      (snapshot) => {
        const offer = snapshot.contracts[0]!.value.offer;
        // `DEC-008` Task 14 routes `decodeSnapshot`'s own contract builder through
        // `createContractState`, which refuses `phase = 'draft'` the moment
        // `respondedBy` holds anyone but the key hero — and would catch id 999
        // there first, before this test's own referential-integrity check ever
        // ran. Moved to `locked`, where that draft-only restriction does not
        // apply, so the mutation below still reaches the check this case is
        // about.
        offer.phase = 'locked';
        // §2.5 added `respondedBy ⊆ invited` and tied `invited.size` to `requiredCrew`,
        // so a dangling id dropped into `respondedBy` alone is caught by the *structure*
        // first. The tamper therefore builds a save that is structurally coherent and
        // wrong about exactly one thing — hero 999 does not exist — which is the shape a
        // referential-integrity test needs its input to have.
        const contract = snapshot.contracts[0]!.value;
        contract.requiredCrew = 2;
        contract.status = 'offered';
        offer.invited = [...offer.invited, 999];
        offer.respondedBy = [...offer.respondedBy, 999];
      },
      'in invited, but the save carries no such hero'
    ],
    [
      // Renamed (external review of Task 14): this fixture no longer isolates an
      // unknown hero specifically *in* `acceptedBy` — see the case's own comment
      // for why that isolation is gone — so the title now names the invariant it
      // actually exercises rather than the one it used to.
      'контракт держит в acceptedBy id, которого нет в respondedBy',
      (snapshot) => {
        // `respondedBy` намеренно НЕ трогается — тот же приём, которым этот кейс
        // изолировали от соседнего. Но `DEC-008` Task 14 сделал изоляцию
        // недостижимой другим способом: `createContractState` требует
        // `acceptedBy ⊆ respondedBy` структурно, и id, добавленный только в
        // `acceptedBy`, ловится этой проверкой на входе в `decodeSnapshot` — раньше,
        // чем успевает сработать собственная проверка `validateGameState`. Отказ,
        // которого добивался этот кейс, по-прежнему происходит; он происходит у
        // двери декодирования, под её собственным сообщением, а не под этим.
        snapshot.contracts[0]!.value.offer.acceptedBy = [
          ...snapshot.contracts[0]!.value.offer.acceptedBy,
          999
        ];
      },
      'must be a subset of respondedBy'
    ]
  ];

  // `DEC-008` Task 14: `decodeSnapshot`'s own contract builder now enforces
  // `acceptedBy ⊆ respondedBy` (`requireConsistentContract`, `snapshot-codec.ts`),
  // so the last case above is refused *there*, before `readSave`'s
  // `validateGameState` call — the only thing the write-path `it.each` below
  // exercises — ever runs. Named here, once, rather than left for the write-path
  // block to discover by a throw it was not expecting.
  const REFERENTIAL_CASES_CAUGHT_AT_DECODE: readonly string[] = [
    'контракт держит в acceptedBy id, которого нет в respondedBy'
  ];

  it.each(referentialCases)('отказывает, когда %s', (_name, mutate, detail) => {
    expect(() => readSave(aTamperedSave(mutate), expectedVersions)).toThrow(/SAVE_INCONSISTENT/u);
    expect(() => readSave(aTamperedSave(mutate), expectedVersions)).toThrow(detail);
  });

  it.each(referentialCases.filter(([name]) => !REFERENTIAL_CASES_CAUGHT_AT_DECODE.includes(name)))(
    'и отказывается ЗАПИСАТЬ то же самое: %s',
    (_name, mutate, detail) => {
      const decided = aDecidedState();
      const snapshot = JSON.parse(JSON.stringify(encodeSnapshot(decided))) as RawSnapshot;
      mutate(snapshot);

      // `decodeSnapshot` hoisted out of the `expect` callback on purpose
      // (external review of Task 14): a throw here is this test failing loudly
      // for the wrong reason — not `buildSave` refusing what the case claims to
      // be about — rather than a throw the assertion below would silently catch
      // and read as a pass. Every case reaching this point is expected to decode
      // cleanly; `REFERENTIAL_CASES_CAUGHT_AT_DECODE` above is the filtered-out
      // list of the ones where that is no longer true.
      const state = decodeSnapshot(snapshot);

      expect(() =>
        buildSave({ state, focusedContract: FOCUSED_CONTRACT, createdAt: CREATED_AT })
      ).toThrow(detail);
    }
  );

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
    value: {
      requiredCrew: number;
      status: string;
      offer: {
        phase: string;
        keyHero: number | null;
        invited: number[];
        respondedBy: number[];
        acceptedBy: number[];
        commitments: { key: number; value: string }[];
      };
    };
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
        contract.offer.respondedBy = [];
        contract.offer.acceptedBy = [];
        contract.offer.commitments = [];
        contract.status = 'offered';
      },
      'respondedBy does not carry that hero'
    ],
    [
      'герой в acceptedBy, но не в respondedBy',
      (snapshot) => {
        snapshot.contracts[0]!.value.offer.respondedBy = [];
        snapshot.contracts[0]!.value.status = 'offered';
      },
      // `DEC-008` Task 14: this exact shape (`acceptedBy ⊄ respondedBy`) is now caught
      // by `createContractState` at `decodeSnapshot`'s own door, earlier than
      // `validateGameState`'s own `checkOneContract` ever runs — the same rule, one
      // layer sooner.
      'must be a subset of respondedBy'
    ],
    [
      'история говорит «принял», контракт — «не в составе»',
      (snapshot) => {
        snapshot.contracts[0]!.value.offer.acceptedBy = [];
        // `commitments.keys() === acceptedBy` (`RESOLUTION_SPEC` §2.4): emptied with the
        // acceptances, so the defect this case is about is the one the decoder reports.
        snapshot.contracts[0]!.value.offer.commitments = [];
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
      // `DEC-008` Task 14: `createContractState`'s own two-directional check
      // (`status = 'crewed' ⇔ acceptedBy.size = requiredCrew`) catches this at
      // `decodeSnapshot`'s door now, before `validateGameState`'s `checkOneContract`
      // gets a turn — the same biconditional, worded by the earlier check instead.
      "must be 'crewed' exactly when acceptedBy.size equals requiredCrew"
    ],
    [
      'контракт закрыт составом, которого не хватает',
      (snapshot) => {
        snapshot.contracts[0]!.value.requiredCrew = 2;
      },
      "must be 'crewed' exactly when acceptedBy.size equals requiredCrew"
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
        // `pollCrew` (`DEC-008` Task 13) retired the equality this used to exercise
        // (`appliedCommandIds.size === history.length`) — one `commandId` can now
        // leave several events behind — but `<=` still holds, because a `pollCrew`
        // with nobody left to poll is refused rather than applied
        // (`RejectionCodes.NobodyLeftToPoll`), and every other command still
        // appends exactly one event per id. A padded `appliedCommandIds` — an id
        // nothing in `history` explains — is still `size > length` and still
        // refused.
        snapshot.appliedCommandIds = [1, 2];
      },
      'every applied command appends at least one event'
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
        // one real decision sums to +3, so the mirror of it sums to −3 — a refusal
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
        // `DEC-008` Task 14: `createContractState` refuses `phase = 'draft'` the
        // moment `respondedBy` names anyone but the key hero — `keyHero` is set to
        // the same hero here so this fixture still reaches the clock check this
        // case is about, not that earlier, unrelated one.
        other.value.offer.keyHero = first!.heroId;
        // `invited` moves with `keyHero` (`RESOLUTION_SPEC` §2.5), or the crew-size rule
        // reports this offer before the defect the case is about ever gets read.
        other.value.requiredCrew = 1;
        other.value.offer.invited = [first!.heroId];
        other.value.offer.respondedBy = [first!.heroId];
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
        snapshot.contracts[0]!.value.offer.acceptedBy = [];
        // `commitments.keys() === acceptedBy` (`RESOLUTION_SPEC` §2.4): emptied with the
        // acceptances, so the defect this case is about is the one the decoder reports.
        snapshot.contracts[0]!.value.offer.commitments = [];
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
        snapshot.contracts[0]!.value.offer.acceptedBy = [];
        // `commitments.keys() === acceptedBy` (`RESOLUTION_SPEC` §2.4): emptied with the
        // acceptances, so the defect this case is about is the one the decoder reports.
        snapshot.contracts[0]!.value.offer.commitments = [];
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
        // The one real decision sums to +3; swapping the lists mirrors it to −3 while
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
        // `DEC-008` Task 14: same reason as the clock case above — `keyHero` set to
        // match, so `createContractState`'s draft restriction does not pre-empt the
        // check this case is about.
        const other = snapshot.contracts.find((entry) => entry.key === OTHER_CONTRACT)!;
        other.value.offer.keyHero = first!.heroId;
        // `invited` moves with `keyHero` (`RESOLUTION_SPEC` §2.5), or the crew-size rule
        // reports this offer before the defect the case is about ever gets read.
        other.value.requiredCrew = 1;
        other.value.offer.invited = [first!.heroId];
        other.value.offer.respondedBy = [first!.heroId];
        snapshot.appliedCommandIds = [1, 2];
        snapshot.metadata.nextEventId = 2;
        snapshot.metadata.stateVersion = 2;
      },
      'a trace explains exactly one decision'
    ]
  ];

  // `DEC-008` Task 14: three of the cases above are now refused inside
  // `decodeSnapshot` itself (`createContractState`, via `requireConsistentContract`
  // — `snapshot-codec.ts`), before `readSave`'s `validateGameState` call, the only
  // thing the write-path `it.each` below exercises, ever runs:
  //
  // - `'герой в acceptedBy, но не в respondedBy'` — `acceptedBy ⊆ respondedBy`.
  // - `'состав набран, а контракт всё ещё предлагается'` and
  //   `'контракт закрыт составом, которого не хватает'` — the two-directional
  //   `status = 'crewed' ⇔ acceptedBy.size = requiredCrew`.
  //
  // Named here, once, rather than left for the write-path block to discover by a
  // throw it was not expecting — external review of Task 14 found exactly that:
  // all three had quietly stopped exercising `buildSave` at all, decoding to a
  // thrown `SaveReadError` the outer `expect(() => buildSave(...))` swallowed as
  // if it were the refusal the case claims to test.
  const CASES_CAUGHT_AT_DECODE: readonly string[] = [
    'герой в acceptedBy, но не в respondedBy',
    'состав набран, а контракт всё ещё предлагается',
    'контракт закрыт составом, которого не хватает'
  ];

  it.each(cases)('отказывает при чтении: %s', (_name, mutate, detail) => {
    expect(() => readSave(aTamperedSave(mutate), expectedVersions)).toThrow(/SAVE_INCONSISTENT/u);
    expect(() => readSave(aTamperedSave(mutate), expectedVersions)).toThrow(detail);
  });

  it.each(cases.filter(([name]) => !CASES_CAUGHT_AT_DECODE.includes(name)))(
    'и отказывается ЗАПИСАТЬ то же самое: %s',
    (_name, mutate, detail) => {
      // The other half, and the half external review said was missing: a producer must not
      // be able to write what the reader refuses. The state is built by `decodeSnapshot`,
      // which deliberately checks shape and not domain — so this is a real `GameState`
      // carrying the same broken campaign, handed to `buildSave`.
      const decided = aDecidedState();
      const snapshot = JSON.parse(JSON.stringify(encodeSnapshot(decided))) as RawSnapshot;
      mutate(snapshot);

      // `decodeSnapshot` hoisted out of the `expect` callback on purpose (external
      // review of Task 14): a throw here is this test failing loudly for the wrong
      // reason — not `buildSave` refusing what the case claims to be about —
      // rather than a throw the assertion below would silently catch and read as a
      // pass. Every case reaching this point is expected to decode cleanly;
      // `CASES_CAUGHT_AT_DECODE` above is the filtered-out list of the ones where
      // that is no longer true.
      const state = decodeSnapshot(snapshot);

      expect(() =>
        buildSave({ state, focusedContract: FOCUSED_CONTRACT, createdAt: CREATED_AT })
      ).toThrow(detail);
    }
  );

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

  it('carries a campaign whose offer was answered, then revised, through save and read', () => {
    // The scenario review named directly: a hero answers, the player revises the
    // package, and the campaign must still be a campaign this build can save and load —
    // not only through `encodeSnapshot`/`decodeSnapshot` in isolation
    // (`snapshot-codec.test.ts` covers that byte-level round trip already), but through
    // `buildSave`'s own `validateGameState` call and `readSave`'s matching one, both of
    // which sit between the codec and the campaign a player actually has.
    const revised = aDecidedThenRevisedState();
    // Two events in history — the original answer, then the revision — while
    // `respondedBy` on the current offer is empty again: exactly the shape that used to
    // trip `checkResponseBookkeeping`'s "one history event per name in respondedBy"
    // reading, before it was taught that a revision resets the window.
    expect(revised.history).toHaveLength(2);
    expect(revised.history[1]!.kind).toBe('offer_revised');

    const versions = {
      rulesetVersion: revised.metadata.rulesetVersion,
      contentVersion: revised.metadata.contentVersion
    };
    const [focusedContract] = revised.contracts.keys();

    const bytes = buildSave({
      state: revised,
      focusedContract: focusedContract!,
      createdAt: CREATED_AT
    });

    expect(deepEqual(readSave(bytes, versions).state, revised)).toBe(true);
  });

  it('carries a campaign whose offer was answered, then locked, through save and read', () => {
    // `DEC-008` Task 12's own risk, named in its brief: `offer_locked` is a new
    // `DomainEvent` member, and a schema that forgot it would not fail loudly at
    // `readSave` alone — `buildSave` calls `requireReadableSnapshot`, which re-decodes
    // on the way *out*, so a missing schema member breaks saving this campaign in the
    // first place, before there is ever a file to read back.
    const locked = aDecidedThenLockedState();
    expect(locked.history).toHaveLength(2);
    expect(locked.history[1]!.kind).toBe('offer_locked');

    const versions = {
      rulesetVersion: locked.metadata.rulesetVersion,
      contentVersion: locked.metadata.contentVersion
    };
    const [focusedContract] = locked.contracts.keys();

    const bytes = buildSave({
      state: locked,
      focusedContract: focusedContract!,
      createdAt: CREATED_AT
    });

    expect(deepEqual(readSave(bytes, versions).state, locked)).toBe(true);
  });

  it('carries a campaign whose promise was broken through save and read', () => {
    // `DEC-008` Task 14: the same risk `aDecidedThenLockedState`'s own test names,
    // for the three `settleContract` events instead of `offer_locked` — a schema
    // missing one of them breaks saving this campaign, not only loading a file that
    // already carries one. This is also the one settlement shape the codec's own
    // `snapshot-codec.test.ts` round trip does not reach: the envelope's checksum,
    // `validateGameState` on both sides, and `requireDuplicateFieldsAgree`, over a
    // real settled, broken-promise campaign.
    const settled = aDecidedThenLockedThenSettledState();
    expect(settled.history[settled.history.length - 1]!.kind).toBe(
      'contract_settled_promise_broken'
    );

    const [heroKey] = settled.heroes.keys();
    expect(settled.heroes.get(heroKey!)!.believesGuildPromises).toBe(false);
    expect(settled.heroes.get(heroKey!)!.grievance).toBeGreaterThan(0);
    expect(settled.treasury).not.toBe(400);

    const versions = {
      rulesetVersion: settled.metadata.rulesetVersion,
      contentVersion: settled.metadata.contentVersion
    };
    const [focusedContract] = settled.contracts.keys();

    const bytes = buildSave({
      state: settled,
      focusedContract: focusedContract!,
      createdAt: CREATED_AT
    });

    expect(deepEqual(readSave(bytes, versions).state, settled)).toBe(true);
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
