import { useId, type ReactNode } from 'react';

/**
 * Кнопка, которая либо нажимается, либо тёмная и говорит почему.
 *
 * Поведение не изобретено здесь: оно уже описано в `offer-actions.ts` — контрол,
 * который исчезает, не учит игрока ничему; тёмный, несущий отказ, который он бы
 * получил, учит ровно этому. Поэтому `disabledReason` — не необязательный пропс, а
 * `string | null` без значения по умолчанию: каждое место, рисующее кнопку, обязано
 * сказать, есть ли у неё отказ, и нельзя забыть это сделать, просто не передав поле.
 *
 * Причина — готовая строка, а не ключ: кнопка не знает о каталоге ничего, кроме того, что
 * ей дали, и разрешать ключи остаётся экрану, у которого каталог есть (`useText`).
 *
 * Причина печатается текстом рядом и связана с кнопкой через `aria-describedby`, а не
 * спрятана в `title`: подсказка при наведении не существует ни на сенсорном экране, ни
 * для проверки достижимости, которая читает текст страницы.
 */
export function Button({
  onPress,
  disabledReason,
  children,
  testId
}: {
  readonly onPress: () => void;
  readonly disabledReason: string | null;
  readonly children: ReactNode;
  readonly testId: string;
}) {
  const reasonId = useId();
  const disabled = disabledReason !== null;

  return (
    <div className="press">
      <button
        type="button"
        className="button"
        data-testid={testId}
        disabled={disabled}
        aria-describedby={disabled ? reasonId : undefined}
        onClick={onPress}
      >
        {children}
      </button>
      {disabled ? (
        <span className="press-reason" id={reasonId}>
          {disabledReason}
        </span>
      ) : null}
    </div>
  );
}
