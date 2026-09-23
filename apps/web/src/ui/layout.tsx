import type { ReactNode } from 'react';

/**
 * Две колонки равной ширины — раскладка отряда на оффере и панелей под полем боя.
 *
 * Класс `.columns` — одно правило в `styles.css`; на оффере в нём стоят карточки героев с
 * их ответами, по две в ряд.
 */
export function Columns({ children }: { readonly children: ReactNode }) {
  return <div className="columns">{children}</div>;
}

/**
 * Полоса: дети в один ряд, с переносом, когда ряд не помещается.
 *
 * `ASSUMPTION`: спека называет `Rail` без определения. Здесь это горизонтальный ряд, а не
 * боковая колонка: две колонки уже даёт `Columns`, а ряда с переносом в ките иначе нет.
 * На оффере им разложена липкая строка итога — контракт, счёт, казна в один ряд
 * (`package-band.tsx`, `OfferSummary`).
 *
 * Перенос, а не прокрутка вбок: горизонтальное переполнение — настоящий дефект, и
 * проверка достижимости обязана его видеть, поэтому ряд ничего не прячет.
 */
export function Rail({ children }: { readonly children: ReactNode }) {
  return <div className="rail">{children}</div>;
}
