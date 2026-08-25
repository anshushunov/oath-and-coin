import { describe, expect, it } from 'vitest';

import { byDeclarationOrder, compareStrings } from './comparator.ts';

/**
 * The discriminating half of `need-id.test.ts`.
 *
 * On the three needs shipped today declaration order and ordinal order coincide
 * (`frontline`, `undead_knowledge`, `wilderness` are in the same sequence both ways), so
 * no test over that vocabulary can tell `compareNeedIds` from `compareStrings` by its
 * ordering alone. External review named that, and it is right: a check that cannot fail
 * on the data that exists is documentation, not a check.
 *
 * The rule is testable anyway, because it is a rule about *any* closed vocabulary and not
 * about these three strings. Exercised here on one chosen to disagree with the alphabet,
 * it reddens on exactly the mutant the other file cannot see.
 */

const VOCABULARY = Object.freeze(['wilderness', 'frontline', 'undead_knowledge']);

describe('byDeclarationOrder', () => {
  it('сортирует по позиции объявления, а не по строке', () => {
    const compare = byDeclarationOrder(VOCABULARY);

    expect([...VOCABULARY].sort(compare)).toEqual(['wilderness', 'frontline', 'undead_knowledge']);
  });

  it('и это отличимо: строковый компаратор даёт другой порядок на том же словаре', () => {
    // Растяжка, доказывающая, что тест выше содержателен. Пропади она — и первый же
    // словарь, случайно совпавший с алфавитом, сделал бы проверку зелёной при любой
    // реализации.
    expect([...VOCABULARY].sort(compareStrings)).not.toEqual([...VOCABULARY]);
  });

  it('отвергает значение вне словаря, а не сортирует его в конец', () => {
    const compare = byDeclarationOrder(VOCABULARY);

    expect(() => compare('siegecraft', 'frontline')).toThrow(/siegecraft/u);
  });

  it('годится для устойчивой сортировки: равные значения дают ноль', () => {
    const compare = byDeclarationOrder(VOCABULARY);

    expect(compare('frontline', 'frontline')).toBe(0);
  });
});
