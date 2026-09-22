import type { ReactNode } from 'react';

import { useText } from '../text.tsx';

/**
 * Заголовок панели: ключ каталога, готовая строка или ничего — но не оба сразу.
 *
 * Два способа назвать один заголовок в одном месте дали бы вопрос «какой победит», на
 * который отвечает порядок строк в компоненте, а не тот, кто его вызвал. Тип закрывает
 * вопрос до того, как он возник.
 */
type PanelTitle =
  | { readonly titleKey: string; readonly title?: never }
  | { readonly title: string; readonly titleKey?: never }
  | { readonly titleKey?: never; readonly title?: never };

/**
 * Прямоугольник на поверхности страницы, с заголовком или без.
 *
 * `titleKey` — для экранов, которые держат ключи и каталог (`useText`); `title` — для
 * текста, уже разрешённого выше. Каталог спрашивается только в первом случае, и это
 * не оптимизация: `useText` без `TextSource` над собой роняет рендер, а панели, которой
 * дали готовую строку, разрешать нечего — падать ей не за что.
 */
export function Panel({
  children,
  testId,
  ...title
}: PanelTitle & {
  readonly children: ReactNode;
  readonly testId?: string;
}) {
  return (
    <section className="panel" data-testid={testId}>
      {title.titleKey === undefined ? null : <KeyedTitle textKey={title.titleKey} />}
      {title.title === undefined ? null : <h2 className="panel-title">{title.title}</h2>}
      {children}
    </section>
  );
}

/** Заголовок по ключу — отдельным компонентом, чтобы хук вызывался только там, где ключ есть. */
function KeyedTitle({ textKey }: { readonly textKey: string }) {
  const text = useText();

  return <h2 className="panel-title">{text(textKey)}</h2>;
}
