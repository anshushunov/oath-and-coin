/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';

import { render } from '../testing/render.tsx';
import { Columns, Rail } from './layout.tsx';

describe('Columns', () => {
  it('кладёт детей в одну сетку и в их порядке', () => {
    const container = render(
      <Columns>
        <p>Ильза</p>
        <p>Брам</p>
      </Columns>
    );
    const columns = container.querySelector('.columns');

    expect(Array.from(columns?.children ?? [], (child) => child.textContent)).toEqual([
      'Ильза',
      'Брам'
    ]);
  });
});

describe('Rail', () => {
  it('кладёт детей в одну полосу и в их порядке', () => {
    const container = render(
      <Rail>
        <span>Аванс</span>
        <span>Казна</span>
      </Rail>
    );
    const rail = container.querySelector('.rail');

    expect(Array.from(rail?.children ?? [], (child) => child.textContent)).toEqual([
      'Аванс',
      'Казна'
    ]);
  });
});
