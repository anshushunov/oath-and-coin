/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';

import { render } from '../testing/render.tsx';
import { Tag } from './tag.tsx';

describe('Tag', () => {
  // GDD §16.6: цвет никогда не единственный носитель смысла. Чип без слова —
  // это ровно тот случай, и тип его запрещает, а тест доказывает, что слово
  // доезжает до DOM, а не только до пропсов.
  it('печатает слово рядом с цветом', () => {
    const container = render(<Tag role="against" word="Против" />);

    expect(container.textContent).toContain('Против');
  });

  it('называет роль атрибутом, а не только классом', () => {
    const container = render(<Tag role="blocked" word="Принцип" />);
    const tag = container.querySelector('[data-role]');

    expect(tag?.getAttribute('data-role')).toBe('blocked');
  });
});
