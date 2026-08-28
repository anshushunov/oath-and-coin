import { join, resolve } from 'node:path';

import {
  CommitmentState,
  ConsequenceKind,
  ContractStatus,
  CoverageVerdict,
  DeficitKind,
  NeedId,
  OfferPhase,
  OutcomeGrade,
  OutcomeReasonCodes,
  ReasonCodes,
  SortedMap,
  SortedSet,
  compareHeroIds,
  parseContentId,
  createContractState,
  deepEqual,
  proposeContractToHero,
  resolveContract,
  settleContract,
  type ContentId,
  type ContractResolution,
  type GameState,
  type HeroContribution,
  type HeroId
} from '@oath-and-coin/simulation';
import { describe, expect, it } from 'vitest';

import { createInitialState } from '../initial-state.ts';
import { loadContentSet } from '../node/index.ts';

import { decodeSnapshot, encodeSnapshot } from './snapshot-codec.ts';

// Тот же способ добыть контент, что у `initial-state.test.ts`: тестовые файлы
// пакета исключены из правила «никаких node:*» и читают настоящее дерево.
const repoRoot = resolve(import.meta.dirname, '..', '..', '..', '..');
const content = loadContentSet(join(repoRoot, 'content'));

/**
 * The shipped crypt, locked to one seat and one hero with a real
 * `promisedBonus`, ready for `settleContract` — the state both
 * {@link campaignWithABrokenPromise} and {@link campaignWithAKeptPromise} settle
 * from, so the two fixtures differ only in `pay`, not in two independently-built
 * starting points that could quietly drift apart. `requiredCrew: 1`, overriding
 * whatever the shipped contract authored: this fixture needs a crew of exactly
 * one hero so `settleContract` can run without a `pollCrew` neither test is
 * about. `createContractState` (`NEGOTIATION_SPEC` §2.1) validates the override
 * rather than merely hoping it is consistent.
 *
 * **Named, not "whichever contract sorts first".** It used to be the latter, and external
 * review of the contract-loop UI plan's task 9 caught what that costs: the playtest's second
 * pair put `core:burn_the_plague_barrow` ahead of the crypt in content-id order, so this
 * fixture's subject changed under it in silence while every assertion stayed green and the
 * comment above still described the crypt. A fixture that says which campaign it is about
 * fails loudly when that campaign goes away.
 */
function lockedSingleHeroCampaign(): {
  readonly state: GameState;
  readonly contractId: ContentId;
} {
  const base = createInitialState(content, 7n, 'm1-resolution/1');
  const [heroKey] = base.heroes.keys();
  const contractKey = parseContentId('core:cleanse_the_crypt');
  const contract = base.contracts.get(contractKey)!;
  const keyOnly = SortedSet.from(compareHeroIds, [heroKey!]);

  const lockedAndCrewed = createContractState({
    ...contract,
    requiredCrew: 1,
    status: ContractStatus.Crewed,
    offer: {
      ...contract.offer,
      keyHero: heroKey!,
      advance: 10,
      promisedBonus: Math.min(20, contract.patronFee),
      phase: OfferPhase.Locked,
      // One seat, one invited, one commitment recorded for the one acceptance
      // (`RESOLUTION_SPEC` §2.5). Written out rather than composed through the engine
      // for the reason this whole fixture is: it exists to hold a state where every
      // round-tripped field has moved off its default, not to replay the protocol.
      invited: keyOnly,
      respondedBy: keyOnly,
      acceptedBy: keyOnly,
      commitments: SortedMap.from(compareHeroIds, [[heroKey!, CommitmentState.Committed]])
    }
  });

  return {
    state: { ...base, contracts: base.contracts.set(lockedAndCrewed.id, lockedAndCrewed) },
    contractId: lockedAndCrewed.id
  };
}

/**
 * The same campaign, with its crew already sent out and back (`RESOLUTION_SPEC` §3).
 *
 * Every fixture below that settles goes through here first, because since Task 8 there is
 * no such thing as a settleable contract that has not been resolved — `settleContract`
 * refuses one with `NotResolved` (§2.5). Driven through the real command rather than by
 * writing a `ContractResolution` in by hand: what these tests round-trip has to be a
 * history and a result this build actually produces, events and all.
 */
function resolvedFrom(state: GameState, contractId: ContentId): GameState {
  const resolved = resolveContract(state, {
    commandId: 100,
    contractId,
    expectedStateVersion: state.metadata.stateVersion
  });

  if (!resolved.applied) {
    throw new Error(
      `resolvedFrom: resolveContract was refused (${String(resolved.rejectionCode)}).`
    );
  }

  return resolved.state;
}

/**
 * A campaign carrying every field `DEC-008` added, all away from their defaults at
 * once: an aggrieved hero (`grievance > 0`), a hero who stopped believing the
 * guild's word (`believesGuildPromises = false`), and a treasury that has actually
 * moved (`treasury !== STARTING_TREASURY`). Task 6's `offer`/`moodOrdinals`
 * round-trip wiring was correct by inspection but untested against a non-default
 * value — every round-trip test before this one would pass identically if the
 * decoder reverted to hardcoded defaults for these three fields. This fixture is
 * what closes that: it locks the shipped crypt to one seat, one
 * hero, a real bonus, breaks the promise through the real `settleContract`, and
 * round-trips whatever that produced.
 */
function campaignWithABrokenPromise(): GameState {
  const { state: unresolved, contractId } = lockedSingleHeroCampaign();
  const locked = resolvedFrom(unresolved, contractId);

  const settled = settleContract(locked, {
    commandId: 1,
    contractId,
    pay: false,
    expectedStateVersion: locked.metadata.stateVersion
  });

  if (!settled.applied) {
    throw new Error(
      `campaignWithABrokenPromise: settleContract was refused (${String(settled.rejectionCode)}), ` +
        'not the non-default state this fixture is supposed to build.'
    );
  }

  return settled.state;
}

/**
 * The same starting point as {@link campaignWithABrokenPromise}, settled with
 * `pay: true` instead — the one settlement event kind
 * (`contract_settled_promise_kept`) nothing round-tripped through the save codec
 * before this (external review of Task 14: `rg` found it only in the union, the
 * engine's own ternary and the four exhaustive consumers, never in an `expect`).
 */
function campaignWithAKeptPromise(): GameState {
  const { state: unresolved, contractId } = lockedSingleHeroCampaign();
  const locked = resolvedFrom(unresolved, contractId);

  const settled = settleContract(locked, {
    commandId: 1,
    contractId,
    pay: true,
    expectedStateVersion: locked.metadata.stateVersion
  });

  if (!settled.applied) {
    throw new Error(
      `campaignWithAKeptPromise: settleContract was refused (${String(settled.rejectionCode)}), ` +
        'not the non-default state this fixture is supposed to build.'
    );
  }

  return settled.state;
}

/**
 * A resolution with **every branch of {@link ContractResolution} filled** — coverage with
 * a contributor row, a contribution with a commitment and a provenance, a deficit, a
 * non-null `dominant`, and a consequence.
 *
 * External review of PR #33: every round-trip case in this file used `resolution = null`
 * and `wounds = 0`, so the encoder's `deficits`, `consequences`, `contributions` and
 * `dominant` projections were never executed against a non-empty value. Mutants writing
 * `deficits: []` or `wounds: 0` on the write path stayed green. Nothing below is a
 * number the resolver would actually produce — the resolver arrives in Task 7 — and it
 * does not need to be: what is under test is that the codec carries what it is handed.
 */
function aFullResolution(hero: HeroId): ContractResolution {
  return {
    grade: OutcomeGrade.Costly,
    coverage: [
      {
        need: NeedId.Frontline,
        weight: 30,
        required: 54,
        supplied: 41,
        effective: 41,
        verdict: CoverageVerdict.Weak,
        // Two numbers that differ, not one repeated: `counted` equals `amount` only for
        // whoever was first on the need (`RESOLUTION_SPEC` §4.3), so a codec dropping one
        // of them and copying the other would round-trip a fixture where they agree.
        contributors: [{ hero, amount: 41, counted: 20 }]
      }
    ],
    contributions: SortedMap.from<HeroId, HeroContribution>(compareHeroIds, [
      [
        hero,
        {
          amount: 41,
          commitment: CommitmentState.Fragile,
          provenance: [OutcomeReasonCodes.NeedWeak, OutcomeReasonCodes.FalteredEarly]
        }
      ]
    ]),
    deficits: [
      {
        kind: DeficitKind.Capability,
        magnitude: 13,
        needs: [NeedId.Frontline],
        heroes: [hero]
      }
    ],
    dominant: DeficitKind.Capability,
    consequences: [
      {
        hero,
        kind: ConsequenceKind.Wound,
        reason: OutcomeReasonCodes.WoundOnThePoint,
        magnitude: 1
      }
    ]
  };
}

/**
 * {@link lockedSingleHeroCampaign} carried all the way to a resolved contract and a
 * wounded hero — the two fields `RESOLUTION_SPEC` §2.5 and §2.6 added that no other
 * fixture in this file ever moves off its default.
 *
 * Built through `createContractState`, so the §2.5 invariants a resolution has to satisfy
 * (`phase ∈ {Locked, Settled} ∧ status = Crewed`, `contributions.keys() === acceptedBy`)
 * hold by construction rather than by hope.
 */
function campaignWithAResolvedContract(): GameState {
  const { state, contractId } = lockedSingleHeroCampaign();
  const [heroKey] = state.heroes.keys();
  const contract = state.contracts.get(contractId)!;
  const hero = state.heroes.get(heroKey!)!;

  return {
    ...state,
    heroes: state.heroes.set(heroKey!, { ...hero, wounds: 2 }),
    contracts: state.contracts.set(
      contractId,
      createContractState({ ...contract, resolution: aFullResolution(heroKey!) })
    )
  };
}

describe('snapshot codec', () => {
  it('carries a resolution and a wound through a snapshot round trip', () => {
    const state = campaignWithAResolvedContract();
    const [heroKey] = state.heroes.keys();
    // Named, not the board's first row: this fixture resolved the crypt (see
    // `lockedSingleHeroCampaign`), and reading whichever contract sorts first is what let
    // the subject drift silently once new content arrived.
    const contractKey = parseContentId('core:cleanse_the_crypt');

    // Guards against the fixture quietly degenerating into the `null`/`0` case the rest
    // of the file already covers — a round trip of two defaults would prove nothing and
    // would still be green.
    expect(state.heroes.get(heroKey!)!.wounds).toBe(2);
    expect(state.contracts.get(contractKey)!.resolution).not.toBeNull();

    const decoded = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(state))));

    expect(deepEqual(decoded, state)).toBe(true);
  });

  it.each([
    ['hero', 'capability'],
    ['hero', 'wounds'],
    ['contract', 'needs'],
    ['contract', 'resolution'],
    ['offer', 'invited'],
    ['offer', 'commitments']
  ])('отказывается читать снимок без обязательного ключа %s.%s', (owner, key) => {
    // `RESOLUTION_SPEC` §2.5, §2.2, §2.6: все шесть ключей обязательны — они приходят
    // вместе с собственным поднятием `SAVE_SCHEMA_VERSION`, поэтому сейва под этой
    // версией, у которого их законно нет, не существует. Утверждение стояло в
    // комментарии кодека, но не проверялось ничем: мутант `wounds: z.int().default(0)`
    // оставлял весь файл зелёным (внешнее ревью PR #33).
    const encoded = JSON.parse(JSON.stringify(encodeSnapshot(campaignWithAResolvedContract())));
    const target =
      owner === 'hero'
        ? encoded.heroes[0].value
        : owner === 'contract'
          ? encoded.contracts[0].value
          : encoded.contracts[0].value.offer;

    delete target[key];

    expect(() => decodeSnapshot(encoded)).toThrow(/SAVE_MALFORMED/u);
  });

  it.each([0, 1])('отказывается читать контракт с %i потребностями', (count) => {
    // `RESOLUTION_SPEC` §2.3: ровно две-три потребности. Одна возвращает доминирующую
    // стратегию «бери сильнейшего» — тот самый kill-criterion `MVP_PLAN` §3.2, ради
    // которого потребностей больше одной. Схема кодека держала только потолок, и
    // повреждённый сейв с пустым `needs` читался (внешнее ревью PR #33).
    //
    // `SAVE_OUT_OF_BOUNDS`, not `SAVE_MALFORMED`: this codec classifies a violated size
    // as a bound, the same way the too-many-traits case below does. The shape is well
    // formed; the count is outside what the domain allows.
    const encoded = JSON.parse(JSON.stringify(encodeSnapshot(campaignWithAResolvedContract())));
    encoded.contracts[0].value.needs = encoded.contracts[0].value.needs.slice(0, count);

    expect(() => decodeSnapshot(encoded)).toThrow(/SAVE_OUT_OF_BOUNDS/u);
  });

  it('carries the offer, the treasury and a hero memory through a snapshot round trip', () => {
    // `NEGOTIATION_SPEC` §2.3 (treasury), §2.2 (grievance, believesGuildPromises) and
    // §2.1 (offer) all round-trip through the same `decodeSnapshot`/`encodeSnapshot`
    // pair the other cases in this file exercise — this is the one case among them
    // that starts from a state where all three have actually moved away from their
    // defaults, so a decoder that silently reverted any of them to a hardcoded
    // default would be caught here and nowhere else in this file.
    const state = campaignWithABrokenPromise();

    expect(state.treasury).not.toBe(400);
    const [heroKey] = state.heroes.keys();
    expect(state.heroes.get(heroKey!)!.grievance).toBeGreaterThan(0);
    expect(state.heroes.get(heroKey!)!.believesGuildPromises).toBe(false);

    const decoded = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(state))));

    expect(deepEqual(decoded, state)).toBe(true);
  });

  it('carries a kept promise (contract_settled_promise_kept) through a snapshot round trip', () => {
    // External review of Task 14: `contract_settled_promise_kept` was asserted
    // nowhere in the suite — reachable only through the union, the engine's own
    // ternary and the four exhaustive consumers, never through an `expect`. This
    // is that assertion, plus the save round trip the broken-promise case above
    // already exercises for `contract_settled_promise_broken`.
    const state = campaignWithAKeptPromise();

    expect(state.history[state.history.length - 1]!.kind).toBe(
      'contract_settled_promise_kept'
    );

    const decoded = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(state))));

    expect(deepEqual(decoded, state)).toBe(true);
  });

  it('переживает 64-битные значения, которых нет в корпусе', () => {
    const base = createInitialState(content, 7n, 'm1-resolution/1');
    // 2^64 − 1 и 2^64 − 2. Проекция артефакта детерминизма здесь теряет точность —
    // это закреплено её собственным тестом `canonical-json.test.ts`. Кодек
    // сохранения обязан вернуть ровно эти числа, поэтому 64-битные значения
    // пишутся десятичными строками.
    const state = {
      ...base,
      metadata: {
        ...base.metadata,
        campaignSeed: 18446744073709551615n,
        nextDecisionOrdinal: 18446744073709551614n
      }
    };

    const decoded = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(state))));

    expect(decoded.metadata.campaignSeed).toBe(18446744073709551615n);
    expect(decoded.metadata.nextDecisionOrdinal).toBe(18446744073709551614n);
  });

  it('отказывается читать карту, где ключ не равен id значения', () => {
    const state = createInitialState(content, 7n, 'm1-resolution/1');
    const encoded = encodeSnapshot(state) as { heroes: { key: number }[] };
    encoded.heroes[0]!.key = 999;

    expect(() => decodeSnapshot(encoded)).toThrow(/SAVE_INCONSISTENT/u);
  });

  it('отказывается читать героя с числом черт больше предела', () => {
    const state = createInitialState(content, 7n, 'm1-resolution/1');
    const encoded = encodeSnapshot(state) as { heroes: { value: { traits: string[] } }[] };
    // MAX_TRAITS_PER_HERO = 4. Длинный список — путь, которым сумма склонностей
    // переполняет int32 и расходится с суммой факторов следа (§1.3 спеки).
    encoded.heroes[0]!.value.traits = Array.from({ length: 64 }, (_, i) => `trait:x${String(i)}`);

    expect(() => decodeSnapshot(encoded)).toThrow(/SAVE_OUT_OF_BOUNDS/u);
  });

  it('переживает состояние с решением: history, traces и appliedCommandIds непусты', () => {
    // `createInitialState` в одиночку не исполняет ни `domainEventSchema`, ни
    // `causalTraceValueSchema`, ни ветку `buildMap` для `traces` — все три пусты
    // на старте. Одна применённая команда (принята она или отклонена — решение
    // всё равно производит событие и след, `engine.ts`) заполняет их и делает
    // `toEqual`/`deepEqual` первой проверкой, которую выброс поля целиком из
    // `encodeSnapshot`/схемы не может пройти молча.
    const base = createInitialState(content, 7n, 'm1-resolution/1');
    const [heroKey] = base.heroes.keys();
    const contractKey = parseContentId('core:cleanse_the_crypt');
    // `proposeContractToHero` (`DEC-008` Task 11) only lets the offer's key hero
    // answer while the package is a draft — this fixture keys the offer to the one
    // hero it proposes to directly, by hand, rather than through a real `composeOffer`
    // command, so the shape this test checks (`history`/`traces`/`appliedCommandIds`
    // each non-empty) is unchanged by a command this test is not about.
    const contract = base.contracts.get(contractKey)!;
    const keyed = {
      ...base,
      contracts: base.contracts.set(contractKey, {
        ...contract,
        // One seat, so the key hero is the whole crew (`RESOLUTION_SPEC` §2.5) — the
        // shipped crypt asks for four, and this case is about a decision surviving a
        // round trip, not about filling a crew. The crypt is named rather than taken as
        // `contracts.keys()[0]`, for the reason `lockedSingleHeroCampaign` records.
        requiredCrew: 1,
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
      contractId: contractKey,
      expectedStateVersion: keyed.metadata.stateVersion
    });

    expect(result.applied).toBe(true);
    expect(result.state.history.length).toBeGreaterThan(0);
    expect(result.state.traces.size).toBeGreaterThan(0);
    expect(result.state.appliedCommandIds.size).toBeGreaterThan(0);

    const decoded = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(result.state))));

    expect(deepEqual(decoded, result.state)).toBe(true);
  });

  it('отказывается читать снимок, чьи метаданные не проходят Zod', () => {
    const state = createInitialState(content, 7n, 'm1-resolution/1');
    const encoded = encodeSnapshot(state) as { metadata: Record<string, unknown> };
    encoded.metadata.logicalTime = 'nope';

    expect(() => decodeSnapshot(encoded)).toThrow(/SAVE_MALFORMED/u);
  });

  it('отказывается читать имя героя вне artifact-safe алфавита', () => {
    const state = createInitialState(content, 7n, 'm1-resolution/1');
    const encoded = encodeSnapshot(state) as { heroes: { value: { displayNameKey: string } }[] };
    // Кириллица и `<>&` — ровно то множество, на котором C#-писатель и RFC 8785
    // расходятся (`artifact-domain.ts`); значение сюда не пришло бы через
    // content-контракт, но кодек читает файл, а не контракт.
    encoded.heroes[0]!.value.displayNameKey = 'Имя <героя> & Co';

    expect(() => decodeSnapshot(encoded)).toThrow(/SAVE_MALFORMED/u);
  });

  it('отказывается читать след с магнитудой фактора больше достижимой в decide()', () => {
    // 100 — PATRON_FEE_MAX/RISK_MAX, потолок MAX_FACTOR_MAGNITUDE. 101 — на единицу
    // больше того, что `decide()` может когда-либо записать в след (§1.3 спеки:
    // границы содержимого недостаточно, нужен ещё и потолок величины фактора).
    const state = createInitialState(content, 7n, 'm1-resolution/1');
    const encoded = encodeSnapshot(state) as {
      traces: { key: number; value: unknown }[];
    };
    encoded.traces.push({
      key: 0,
      value: {
        traceId: 0,
        positiveFactors: [
          {
            // A code from the engine's own vocabulary, and it has to be: the field is
            // closed on `FACTOR_REASON_CODES`, so the `payment_attractive` this fixture
            // used to carry — right namespace missing, in no dictionary at all — now
            // reports its own `invalid_value` beside the magnitude's `too_big`, and the
            // pair classifies as `SAVE_MALFORMED`. The test would still have been red for
            // *a* reason while measuring nothing about the ceiling it names.
            reasonCode: ReasonCodes.PaymentAttractive,
            sourceEntity: 'core:bram',
            magnitude: 101
          }
        ],
        negativeFactors: [],
        blockedBy: [],
        tieBreak: null
      }
    });

    expect(() => decodeSnapshot(encoded)).toThrow(/SAVE_OUT_OF_BOUNDS/u);
  });

  it('отказывается читать карту с двумя записями на один и тот же ключ', () => {
    const state = createInitialState(content, 7n, 'm1-resolution/1');
    const encoded = encodeSnapshot(state) as { heroes: { key: number; value: unknown }[] };
    // Оба совпадают со своим `id` по отдельности — проверка «ключ === id» из
    // шага 6 их пропускает. Дубликат ловит только `SortedMap.from`, и он не
    // должен просочиться плоским `Error` мимо контракта `decodeSnapshot`.
    encoded.heroes.push({ ...encoded.heroes[0]! });

    expect(() => decodeSnapshot(encoded)).toThrow(/SAVE_INCONSISTENT/u);
  });
});

describe('коды причин в следе замкнуты на словарь движка, а не на форму строки', () => {
  // External review of segment 5. All three fields were validated as `artifactSafeText` —
  // a length and a character class — while `reason-codes.ts` states the vocabulary is
  // closed. Measured on this build: `hero.decision.unknown_but_well_shaped` in a positive
  // factor, honestly re-signed, passed `readSave`, step restoration and the screen model,
  // and reached the strict text catalogue, which throws on a key it does not hold. The
  // file broke nothing the format checked and killed the screen three layers later.
  //
  // The wrong-role cases matter as much as the unknown-code ones, and only a *split*
  // vocabulary catches them: `principle_forbids` names a red line, which
  // `createDecisionResult` requires to come with a `null` score, so a save that files it
  // as a positive factor claims a hero was attracted by a taboo — with a magnitude on
  // something the rule states has none. One combined set would have read that file back
  // without a word.

  /** A snapshot with one trace, built from `trace`. `createInitialState` produces none,
   * so this is the whole trace map. */
  function aSnapshotWithTrace(trace: Record<string, unknown>): unknown {
    const state = createInitialState(content, 7n, 'm1-resolution/1');
    const encoded = encodeSnapshot(state) as { traces: { key: number; value: unknown }[] };
    encoded.traces.push({ key: 0, value: { traceId: 0, ...trace } });

    return encoded;
  }

  const aFactor = (reasonCode: string) => ({
    reasonCode,
    sourceEntity: 'core:bram',
    magnitude: 3
  });
  const aBlock = (reasonCode: string) => ({ reasonCode, sourceEntity: 'core:bram' });

  const legitimate = {
    positiveFactors: [aFactor(ReasonCodes.PaymentAttractive)],
    negativeFactors: [aFactor(ReasonCodes.RiskTooHigh)],
    blockedBy: [] as unknown[],
    tieBreak: null as string | null
  };

  const UNKNOWN = 'hero.decision.unknown_but_well_shaped';

  const cases: [string, Record<string, unknown>, string][] = [
    [
      'неизвестный код в положительном факторе',
      { ...legitimate, positiveFactors: [aFactor(UNKNOWN)] },
      'positiveFactors.0.reasonCode'
    ],
    [
      'неизвестный код в отрицательном факторе',
      { ...legitimate, negativeFactors: [aFactor(UNKNOWN)] },
      'negativeFactors.0.reasonCode'
    ],
    [
      'код блокировки, поданный как фактор',
      { ...legitimate, positiveFactors: [aFactor(ReasonCodes.PrincipleForbids)] },
      'positiveFactors.0.reasonCode'
    ],
    [
      'код развязки ничьей, поданный как фактор',
      { ...legitimate, negativeFactors: [aFactor(ReasonCodes.NoReasonToRefuse)] },
      'negativeFactors.0.reasonCode'
    ],
    [
      'неизвестный код в блокировке',
      { ...legitimate, blockedBy: [aBlock(UNKNOWN)] },
      'blockedBy.0.reasonCode'
    ],
    [
      'код фактора, поданный как блокировка',
      { ...legitimate, blockedBy: [aBlock(ReasonCodes.RiskTooHigh)] },
      'blockedBy.0.reasonCode'
    ],
    ['неизвестный код в развязке ничьей', { ...legitimate, tieBreak: UNKNOWN }, 'tieBreak'],
    [
      'код фактора, поданный как развязка ничьей',
      { ...legitimate, tieBreak: ReasonCodes.PaymentAttractive },
      'tieBreak'
    ]
  ];

  it.each(cases)('отказывает: %s', (_name, trace, field) => {
    // Каждый случай называет СВОЁ поле: без этого мутант, снимающий замыкание с одного
    // из трёх, оставался бы зелёным за счёт соседнего — ровно та форма, которую второй
    // раунд ревью на шве вычистил в `validate-game-state.ts`.
    expect(() => decodeSnapshot(aSnapshotWithTrace(trace))).toThrow(/SAVE_MALFORMED/u);
    expect(() => decodeSnapshot(aSnapshotWithTrace(trace))).toThrow(field);
  });

  it('и принимает след, у которого каждый код стоит в своей роли', () => {
    // Страж над стражами: восемь отказов выше ничего не стоят, если бы схема отвергала
    // всякий след вообще.
    const decoded = decodeSnapshot(
      aSnapshotWithTrace({
        ...legitimate,
        blockedBy: [aBlock(ReasonCodes.PrincipleForbids)],
        tieBreak: ReasonCodes.NoReasonToRefuse
      })
    );

    expect(decoded.traces.get(0)?.positiveFactors[0]?.reasonCode).toBe(
      ReasonCodes.PaymentAttractive
    );
    expect(decoded.traces.get(0)?.blockedBy[0]?.reasonCode).toBe(ReasonCodes.PrincipleForbids);
    expect(decoded.traces.get(0)?.tieBreak).toBe(ReasonCodes.NoReasonToRefuse);
  });
});
