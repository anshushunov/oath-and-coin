import { useLayoutEffect, useRef, type ReactNode } from 'react';

/**
 * Насколько читатель может не дойти до низа и всё ещё считаться «у низа», в пикселях.
 *
 * Не ноль: браузер хранит `scrollTop` дробным при масштабе страницы не 100%, и лента,
 * прокрученная до упора, может недосчитать до `scrollHeight - clientHeight` долю пикселя.
 * Строгое равенство отпустило бы её с низа от одного только масштаба.
 */
const PINNED_SLACK = 1;

/**
 * Лента строк, прилипшая к низу: новая строка приходит — лента показывает её.
 *
 * Прилипает, **пока читатель у низа**. Отмотавший ленту назад читает строку, которую
 * отмотал, и лента, дёрнувшая его вниз на следующем событии, отнимает её у него; вернулся
 * вниз — прилипание вернулось. Это определение прилипания, а не дополнение к нему.
 *
 * Прокрутка — присваиванием `scrollTop`, а не `scrollTo`: у элемента в jsdom `scrollTo`
 * нет вовсе, и лента, которая звала бы его на монтировании, роняла бы любой компонентный
 * тест экрана, где она стоит. Присваивание есть везде и делает то же самое.
 *
 * Строки — готовые узлы, ключ — номер строки. Лента только прирастает, поэтому номер и
 * есть личность строки: строка N всегда одна и та же строка N. Пересобранная с нуля лента
 * («смотреть заново») — это новые строки под теми же номерами, и React честно
 * перерисовывает их содержимое.
 *
 * Прилипание проверяется здесь только как **куда** лента себя прокрутила — у jsdom нет
 * геометрии. Что она действительно стоит у низа в окне, проверяет браузер (Task 7).
 */
export function Feed({
  lines,
  testId
}: {
  readonly lines: readonly ReactNode[];
  readonly testId: string;
}) {
  const feed = useRef<HTMLOListElement>(null);
  const pinned = useRef(true);
  const count = lines.length;

  // До отрисовки кадра, а не после: иначе на один кадр видна лента, не дошедшая до новой
  // строки, и прокрутка дёргается.
  useLayoutEffect(() => {
    const element = feed.current;

    if (element !== null && pinned.current) {
      element.scrollTop = element.scrollHeight - element.clientHeight;
    }
  }, [count]);

  return (
    <ol
      className="feed"
      data-testid={testId}
      ref={feed}
      onScroll={(event) => {
        const element = event.currentTarget;

        pinned.current =
          element.scrollHeight - element.scrollTop - element.clientHeight <= PINNED_SLACK;
      }}
    >
      {lines.map((line, index) => (
        <li key={index}>{line}</li>
      ))}
    </ol>
  );
}
