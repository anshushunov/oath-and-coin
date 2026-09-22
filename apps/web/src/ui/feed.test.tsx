/** @vitest-environment jsdom */
import { describe, expect, it } from 'vitest';

import { mount } from '../testing/render.tsx';
import { Feed } from './feed.tsx';

/**
 * Даёт ленте размеры, которых у jsdom нет, и записывает каждое присваивание `scrollTop`.
 *
 * В jsdom `scrollHeight` и `clientHeight` — нули, и `scrollTop = 0 - 0` неотличим от
 * «ничего не делали». Поэтому геометрия задаётся здесь, а тест проверяет, **куда** лента
 * себя прокрутила. Что она действительно стоит у низа в настоящем окне, проверяет
 * браузер (Task 7).
 */
function measured(
  element: HTMLElement,
  geometry: { scrollHeight: number; clientHeight: number; scrollTop: number }
): number[] {
  const writes: number[] = [];

  Object.defineProperty(element, 'scrollHeight', {
    configurable: true,
    get: () => geometry.scrollHeight
  });
  Object.defineProperty(element, 'clientHeight', {
    configurable: true,
    get: () => geometry.clientHeight
  });
  Object.defineProperty(element, 'scrollTop', {
    configurable: true,
    get: () => geometry.scrollTop,
    set: (next: number) => {
      writes.push(next);
      geometry.scrollTop = next;
    }
  });

  return writes;
}

function feedIn(container: HTMLElement): HTMLElement {
  const feed = container.querySelector('[data-testid="journal"]');

  if (!(feed instanceof HTMLElement)) {
    throw new Error('Лента не отрисована.');
  }

  return feed;
}

describe('Feed', () => {
  it('печатает строки по порядку', () => {
    const { container } = mount(<Feed testId="journal" lines={['Раунд 1', 'Ильза бьёт']} />);

    expect(Array.from(feedIn(container).children, (line) => line.textContent)).toEqual([
      'Раунд 1',
      'Ильза бьёт'
    ]);
  });

  it('прилипает к низу, когда приходит новая строка', () => {
    const tree = mount(<Feed testId="journal" lines={['Раунд 1']} />);
    const writes = measured(feedIn(tree.container), {
      scrollHeight: 500,
      clientHeight: 100,
      scrollTop: 0
    });

    tree.rerender(<Feed testId="journal" lines={['Раунд 1', 'Ильза бьёт']} />);

    expect(writes).toEqual([400]);
  });

  // Лента, которая дёргает вниз того, кто отмотал её назад читать, отнимает у него
  // строку, которую он читал. Прилипание — пока читатель у низа, и только тогда.
  it('не дёргает вниз того, кто отмотал ленту назад', () => {
    const tree = mount(<Feed testId="journal" lines={['Раунд 1']} />);
    const feed = feedIn(tree.container);
    const writes = measured(feed, { scrollHeight: 500, clientHeight: 100, scrollTop: 120 });

    feed.dispatchEvent(new Event('scroll'));
    tree.rerender(<Feed testId="journal" lines={['Раунд 1', 'Ильза бьёт']} />);

    expect(writes).toEqual([]);
  });

  it('снова прилипает, когда читатель вернулся к низу', () => {
    const tree = mount(<Feed testId="journal" lines={['Раунд 1']} />);
    const feed = feedIn(tree.container);
    const geometry = { scrollHeight: 500, clientHeight: 100, scrollTop: 120 };
    const writes = measured(feed, geometry);

    feed.dispatchEvent(new Event('scroll'));
    feed.scrollTop = 400;
    feed.dispatchEvent(new Event('scroll'));
    geometry.scrollHeight = 540;
    tree.rerender(<Feed testId="journal" lines={['Раунд 1', 'Ильза бьёт']} />);

    expect(writes).toEqual([400, 440]);
  });

  it('не прокручивает, когда строк не прибавилось', () => {
    const lines = ['Раунд 1'];
    const tree = mount(<Feed testId="journal" lines={lines} />);
    const writes = measured(feedIn(tree.container), {
      scrollHeight: 500,
      clientHeight: 100,
      scrollTop: 0
    });

    tree.rerender(<Feed testId="journal" lines={lines} />);

    expect(writes).toEqual([]);
  });
});
