import { describe, expect, it } from 'vitest';

import { compareStrings } from '../collections/comparator.ts';
import { SortedMap } from '../collections/sorted-map.ts';

import { NEED_IDS, NeedId, compareNeedIds } from './need-id.ts';

/**
 * The one ordering every `SortedMap<NeedId, …>` in the engine is built with
 * (`RESOLUTION_SPEC` §2.1). It has to be stated once and used everywhere, because a
 * contract's needs and a hero's expertise are enumerated into the canonical artifact:
 * two collections keyed the same way and ordered differently would produce two orders
 * for one campaign, and the artifact would stop being a function of the state.
 */

describe('the need vocabulary', () => {
  it('порядок потребностей — порядок объявления, а не алфавит', () => {
    const sorted = [NeedId.Wilderness, NeedId.Frontline].sort(compareNeedIds);

    expect(sorted).toEqual([NeedId.Frontline, NeedId.Wilderness]);
  });

  it('сортирует любую перестановку словаря обратно в порядок объявления', () => {
    const shuffled = [NeedId.Wilderness, NeedId.Frontline, NeedId.UndeadKnowledge];

    expect([...shuffled].sort(compareNeedIds)).toEqual([...NEED_IDS]);
  });

  it('сегодня объявление совпадает с алфавитом, и это делает два теста выше слепыми', () => {
    // Не тавтология, а растяжка. `frontline < undead_knowledge < wilderness` и в
    // объявлении, и по кодам UTF-16, поэтому ни один тест на трёх сегодняшних
    // литералах не отличит `compareNeedIds` от `compareStrings`. Этот краснеет в тот
    // день, когда объявлена потребность, ломающая совпадение (скажем, `arcane_lore`
    // после `frontline`), — и говорит тому, кто её объявил, что проверки выше только
    // что стали содержательными и что компаратор обязан считать по позиции в
    // `NEED_IDS`, а не по строке.
    expect(
      [...NEED_IDS].sort(compareStrings),
      'объявление потребностей разошлось с алфавитным порядком — проверь, что ' +
        'compareNeedIds сравнивает позиции в NEED_IDS, а не сами строки, и сними эту растяжку'
    ).toEqual([...NEED_IDS]);
  });

  it('перечисляет каждый объявленный литерал ровно один раз', () => {
    expect(NEED_IDS).toEqual(Object.values(NeedId));
    expect(new Set(NEED_IDS).size).toBe(NEED_IDS.length);
  });

  it('отвергает потребность, которой нет в словаре, а не сортирует её в конец', () => {
    // Типом это состояние недостижимо, а данными — достижимо: потребность приходит из
    // файла контента и из сейва. Молчаливый ответ здесь означал бы порядок, которого
    // никто не объявлял, и две неизвестные потребности, равные друг другу, — то есть
    // дубликат ключа с точки зрения `SortedMap.from`.
    const invented = 'siegecraft' as NeedId;

    expect(() => compareNeedIds(invented, NeedId.Frontline)).toThrow(/siegecraft/u);
  });

  it('годится как компаратор SortedMap: ключи выходят в порядке объявления', () => {
    const needs = SortedMap.from<NeedId, number>(compareNeedIds, [
      [NeedId.Wilderness, 30],
      [NeedId.Frontline, 60]
    ]);

    expect([...needs.keys()]).toEqual([NeedId.Frontline, NeedId.Wilderness]);
  });
});
