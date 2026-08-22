import { join, resolve } from 'node:path';

import { ReasonCodes, deepEqual, proposeContractToHero } from '@oath-and-coin/simulation';
import { describe, expect, it } from 'vitest';

import { createInitialState } from '../initial-state.ts';
import { loadContentSet } from '../node/index.ts';

import { decodeSnapshot, encodeSnapshot } from './snapshot-codec.ts';

// Тот же способ добыть контент, что у `initial-state.test.ts`: тестовые файлы
// пакета исключены из правила «никаких node:*» и читают настоящее дерево.
const repoRoot = resolve(import.meta.dirname, '..', '..', '..', '..');
const content = loadContentSet(join(repoRoot, 'content'));

describe('snapshot codec', () => {
  it('переживает 64-битные значения, которых нет в корпусе', () => {
    const base = createInitialState(content, 7n, 'm1-decision/1');
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
    const state = createInitialState(content, 7n, 'm1-decision/1');
    const encoded = encodeSnapshot(state) as { heroes: { key: number }[] };
    encoded.heroes[0]!.key = 999;

    expect(() => decodeSnapshot(encoded)).toThrow(/SAVE_INCONSISTENT/u);
  });

  it('отказывается читать героя с числом черт больше предела', () => {
    const state = createInitialState(content, 7n, 'm1-decision/1');
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
    const base = createInitialState(content, 7n, 'm1-decision/1');
    const [heroKey] = base.heroes.keys();
    const [contractKey] = base.contracts.keys();
    const result = proposeContractToHero(base, {
      commandId: 1,
      heroId: heroKey!,
      contractId: contractKey!,
      expectedStateVersion: base.metadata.stateVersion
    });

    expect(result.applied).toBe(true);
    expect(result.state.history.length).toBeGreaterThan(0);
    expect(result.state.traces.size).toBeGreaterThan(0);
    expect(result.state.appliedCommandIds.size).toBeGreaterThan(0);

    const decoded = decodeSnapshot(JSON.parse(JSON.stringify(encodeSnapshot(result.state))));

    expect(deepEqual(decoded, result.state)).toBe(true);
  });

  it('отказывается читать снимок, чьи метаданные не проходят Zod', () => {
    const state = createInitialState(content, 7n, 'm1-decision/1');
    const encoded = encodeSnapshot(state) as { metadata: Record<string, unknown> };
    encoded.metadata.logicalTime = 'nope';

    expect(() => decodeSnapshot(encoded)).toThrow(/SAVE_MALFORMED/u);
  });

  it('отказывается читать имя героя вне artifact-safe алфавита', () => {
    const state = createInitialState(content, 7n, 'm1-decision/1');
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
    const state = createInitialState(content, 7n, 'm1-decision/1');
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
    const state = createInitialState(content, 7n, 'm1-decision/1');
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
    const state = createInitialState(content, 7n, 'm1-decision/1');
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
