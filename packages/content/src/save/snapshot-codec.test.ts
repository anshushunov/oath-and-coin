import { join, resolve } from 'node:path';

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
});
