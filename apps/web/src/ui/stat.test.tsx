/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';

import { render } from '../testing/render.tsx';
import { Stat } from './stat.tsx';

describe('Stat', () => {
  // `labels.tsx`: подпись и значение — два элемента, никогда не одна склеенная
  // строка. Порядок слов между ними зависит от языка, и склеивать их на месте значило
  // бы решить его за каталог.
  it('держит подпись и значение двумя элементами, подпись первой', () => {
    const container = render(<Stat caption="Казна" value="120" testId="treasury" />);
    const stat = container.querySelector('[data-testid="treasury"]');

    expect(stat?.children).toHaveLength(2);
    expect(stat?.children[0]?.textContent).toBe('Казна');
    expect(stat?.children[1]?.textContent).toBe('120');
  });

  it('печатает ноль, а не пустоту', () => {
    const container = render(<Stat caption="Аванс" value="0" />);

    expect(container.querySelector('.stat-value')?.textContent).toBe('0');
  });
});
