import { describe, expect, it } from 'vitest';

import { COLOUR_ROLES, Colour, Space, Stroke, Type, cssVariables, hex } from './tokens.ts';

describe('токены интерфейса', () => {
  it('каждая роль цвета — шесть шестнадцатеричных цифр со знаком решётки', () => {
    for (const role of COLOUR_ROLES) {
      expect(Colour[role], role).toMatch(/^#[0-9a-f]{6}$/u);
    }
  });

  it('роли не повторяют друг друга по имени', () => {
    expect(new Set(COLOUR_ROLES).size).toBe(COLOUR_ROLES.length);
  });

  // Канвас Pixi принимает число, CSS принимает строку. Одно значение, два вида —
  // и это единственное место, где перевод вообще происходит.
  //
  // Два литерала ниже — единственные `0xrrggbb` в `apps/web` вне `tokens.ts`, и запрет
  // снимается здесь построчно, а не записью в `ignores`: файл целиком вне правила — это
  // ровно та дыра, из-за которой вторая палитра и заводится незамеченной. Написать эти
  // числа через `hex()` нельзя — тогда тест сверял бы функцию с самой собой.
  it('переводит цвет в число, которое понимает Pixi', () => {
    // eslint-disable-next-line no-restricted-syntax -- ожидаемое значение для hex(), см. выше
    expect(hex('foe')).toBe(0xc8_5a_4a);
    // eslint-disable-next-line no-restricted-syntax -- ожидаемое значение для hex(), см. выше
    expect(hex('crew')).toBe(0x4a_7f_c8);
  });

  it('объявляет каждую роль переменной CSS', () => {
    const block = cssVariables();

    for (const role of COLOUR_ROLES) {
      expect(block, role).toContain(Colour[role]);
    }

    expect(block.startsWith(':root {')).toBe(true);
  });

  // Имя переменной — половина контракта, и до этой проверки её не держало ничто.
  // `styles.css` пишет `var(--ink-dim)`; сломанный перевод в kebab-case напечатал бы
  // `--inkdim`, все проверки выше остались бы зелёными (значение-то на месте), а цвет
  // текста на странице молча стал бы «ничем» — `var()` без объявления не наследует, он
  // не резолвится. Хуже: `tokens:check` в этот момент посоветовал бы перегенерировать
  // файл, то есть благословил бы поломку.
  //
  // Составные имена перечислены здесь списком, а не выведены тем же преобразованием,
  // которое их печатает: проверка, повторяющая реализацию, проверяет саму себя.
  it('переводит составные имена ролей в kebab-case', () => {
    const block = cssVariables();

    for (const [role, variable] of [
      ['inkDim', '--ink-dim'],
      ['sceneBackground', '--scene-background'],
      ['healthEmpty', '--health-empty'],
      ['popupOutline', '--popup-outline']
    ] as const) {
      expect(block, variable).toContain(`  ${variable}: ${Colour[role]};\n`);
    }

    expect(block).not.toContain('--inkdim');
  });

  // Цвет — не всё, что объявляет модуль, и до этой проверки всё остальное держалось
  // только побайтовым сравнением в `pnpm tokens:check`. `cssVariables()` могла бы
  // потерять шкалу шага целиком, и весь набор остался бы зелёным.
  //
  // Объявления выписаны целиком и вручную — это независимое утверждение о контракте,
  // включая единицы: кегль уезжает в CSS как `rem`, а шаг и обводка объявлены числами
  // (их складывает канвас) и печатаются в `px`. Перевод числа в пиксели — поведение, а
  // не форматирование.
  it('объявляет шкалу кегля, шага и обводки', () => {
    const block = cssVariables();

    for (const declaration of [
      '--type-display: 1.75rem;',
      '--type-title: 1.25rem;',
      '--type-heading: 1rem;',
      '--type-body: 0.875rem;',
      '--type-caption: 0.75rem;',
      '--type-micro: 0.6875rem;',
      '--space-xs: 4px;',
      '--space-sm: 8px;',
      '--space-md: 12px;',
      '--space-lg: 16px;',
      '--space-xl: 24px;',
      '--space-xxl: 32px;',
      '--stroke-hairline: 2px;',
      '--stroke-thick: 3px;'
    ]) {
      expect(block, declaration).toContain(`  ${declaration}\n`);
    }
  });

  // Ни одна ступень не объявлена и не забыта наполовину: список выше перечисляет
  // ровно столько объявлений, сколько шкалы содержат ключей. Без этого добавленная
  // ступень прошла бы мимо и CSS, и проверки выше — обе перечисляют, а не считают.
  it('не держит ступеней сверх перечисленных', () => {
    expect(Object.keys(Type)).toHaveLength(6);
    expect(Object.keys(Space)).toHaveLength(6);
    expect(Object.keys(Stroke)).toHaveLength(2);
  });

  // Канвас читает те же две толщины числами, а не строками: `pixi-scene.ts` отдаёт их
  // в `stroke({ width })`, где `'2px'` был бы NaN.
  it('отдаёт обводку числом, которое понимает канвас', () => {
    expect(Stroke.hairline).toBe(2);
    expect(Stroke.thick).toBe(3);
    expect(Space.md).toBe(12);
  });
});
