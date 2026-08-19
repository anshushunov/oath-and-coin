import { join, resolve } from 'node:path';

import { deepEqual, proposeContractToHero } from '@oath-and-coin/simulation';
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
