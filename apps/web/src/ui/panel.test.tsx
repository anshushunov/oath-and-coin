/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';

import { render } from '../testing/render.tsx';
import { TextSource } from '../text.tsx';
import { Panel } from './panel.tsx';

describe('Panel', () => {
  it('разрешает заголовок по ключу через каталог над собой', () => {
    const container = render(
      <TextSource catalogue={new Map([['panel.crew', 'Отряд']])}>
        <Panel titleKey="panel.crew">
          <p>Ильза</p>
        </Panel>
      </TextSource>
    );

    expect(container.querySelector('.panel-title')?.textContent).toBe('Отряд');
    expect(container.textContent).toBe('ОтрядИльза');
  });

  // Готовая строка не требует каталога: панель, которой дали текст, а не ключ, не
  // должна падать без `TextSource` над собой — ключа, который нечем разрешить, у неё нет.
  it('печатает готовый заголовок без каталога', () => {
    const container = render(
      <Panel title="Журнал">
        <p>Раунд 1</p>
      </Panel>
    );

    expect(container.querySelector('.panel-title')?.textContent).toBe('Журнал');
  });

  it('без заголовка не рисует пустую шапку', () => {
    const container = render(
      <Panel testId="crew-panel">
        <p>Ильза</p>
      </Panel>
    );

    expect(container.querySelector('.panel-title')).toBeNull();
    expect(container.querySelector('[data-testid="crew-panel"]')?.textContent).toBe('Ильза');
  });
});
