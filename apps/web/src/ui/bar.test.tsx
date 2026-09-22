/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';

import { render } from '../testing/render.tsx';
import { Bar } from './bar.tsx';

function fillOf(container: HTMLElement): HTMLElement {
  const fill = container.querySelector('.bar > i');

  if (!(fill instanceof HTMLElement)) {
    throw new Error('Полоска отрисована без заливки: `.bar > i` не найден.');
  }

  return fill;
}

describe('Bar', () => {
  // GDD §16.6: полоска — визуальный сигнал, и у неё обязан быть текстовый дубль.
  // Длина заливки не читается ни экранным диктором, ни проверкой достижимости.
  it('печатает подпись текстом', () => {
    const container = render(<Bar value={35} max={70} label="Здоровье 35 из 70" />);

    expect(container.textContent).toContain('Здоровье 35 из 70');
  });

  it('заливает долю значения от предела', () => {
    const container = render(<Bar value={35} max={70} label="Здоровье 35 из 70" />);

    expect(fillOf(container).style.width).toBe('50%');
  });

  it('не уезжает за край, когда значение больше предела', () => {
    const container = render(<Bar value={90} max={70} label="Здоровье 90 из 70" />);

    expect(fillOf(container).style.width).toBe('100%');
  });

  it('не уходит в минус, когда значение меньше нуля', () => {
    const container = render(<Bar value={-5} max={70} label="Здоровье -5 из 70" />);

    expect(fillOf(container).style.width).toBe('0%');
  });

  it('пустая полоска вместо деления на ноль', () => {
    const container = render(<Bar value={0} max={0} label="Здоровье неизвестно" />);

    expect(fillOf(container).style.width).toBe('0%');
  });

  it('по умолчанию красится как здоровье, и роль видна атрибутом', () => {
    const health = render(<Bar value={1} max={2} label="Здоровье" />);
    const foe = render(<Bar value={1} max={2} role="foe" label="Противник" />);

    expect(health.querySelector('.bar')?.getAttribute('data-role')).toBe('health');
    expect(foe.querySelector('.bar')?.getAttribute('data-role')).toBe('foe');
  });
});
