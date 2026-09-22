/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';

import { click, render } from '../testing/render.tsx';
import { Button } from './button.tsx';

function buttonIn(container: HTMLElement): HTMLButtonElement {
  const button = container.querySelector('button');

  if (button === null) {
    throw new Error('Кнопка не отрисована.');
  }

  return button;
}

describe('Button', () => {
  // `offer-actions.ts`: контрол, который исчезает, не учит игрока ничему; тёмный,
  // несущий отказ, который он бы получил, учит ровно этому. Все три половины —
  // тёмная, с причиной, не нажимается — проверяются по отдельности, потому что
  // каждая может сломаться, пока две другие зелёные.
  it('с причиной отказа — тёмная, причина в DOM, нажатие не доходит', () => {
    let presses = 0;
    const container = render(
      <Button
        testId="action-compose"
        disabledReason="Пакет уже заперт"
        onPress={() => {
          presses += 1;
        }}
      >
        Собрать пакет
      </Button>
    );
    const button = buttonIn(container);

    click(button);

    expect(button.disabled).toBe(true);
    expect(container.textContent).toContain('Пакет уже заперт');
    expect(presses).toBe(0);
  });

  // Причина — не подсказка при наведении, а текст рядом, и связана с кнопкой так,
  // что её читает и тот, кто кнопку не видит.
  it('связывает кнопку с причиной через aria-describedby', () => {
    const container = render(
      <Button testId="action-compose" disabledReason="Пакет уже заперт" onPress={() => {}}>
        Собрать пакет
      </Button>
    );
    const described = buttonIn(container).getAttribute('aria-describedby');

    expect(described).not.toBeNull();
    expect(container.querySelector(`[id="${String(described)}"]`)?.textContent).toBe(
      'Пакет уже заперт'
    );
  });

  it('без причины — нажимается и ничего рядом не печатает', () => {
    let presses = 0;
    const container = render(
      <Button
        testId="action-compose"
        disabledReason={null}
        onPress={() => {
          presses += 1;
        }}
      >
        Собрать пакет
      </Button>
    );
    const button = buttonIn(container);

    click(button);

    expect(button.disabled).toBe(false);
    expect(button.hasAttribute('aria-describedby')).toBe(false);
    expect(container.textContent).toBe('Собрать пакет');
    expect(presses).toBe(1);
  });

  it('несёт testId на самой кнопке', () => {
    const container = render(
      <Button testId="action-compose" disabledReason={null} onPress={() => {}}>
        Собрать пакет
      </Button>
    );

    expect(buttonIn(container).getAttribute('data-testid')).toBe('action-compose');
  });
});
