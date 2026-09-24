import type { ColourRole } from './tokens.ts';

export type BarRole = Extract<ColourRole, 'health' | 'crew' | 'foe'>;

/**
 * Полоска значения от предела, с подписью.
 *
 * `label` обязателен по той же причине, по какой обязательно слово у `Tag`: длина
 * заливки — визуальный сигнал, а `GDD` §16.6 требует каждому такому сигналу текстовый
 * дубль. Подпись приходит готовой строкой: компонент не складывает её из `value` и
 * `max`, потому что порядок слов и знаки между числами зависят от языка и живут в
 * каталоге вместе со словами (`labels.tsx`).
 *
 * Два края, которые иначе рисуют неправду:
 *
 * - значение больше предела зажимается в 100% — заливка шире своей дорожки уезжает за
 *   панель и налезает на соседа;
 * - предел ноль (или не число) даёт пустую полоску, а не деление на ноль: `0 / 0` это
 *   `NaN`, и `width: NaN%` браузер молча отбрасывает, оставляя ширину, которая была.
 */
export function Bar({
  value,
  max,
  role = 'health',
  label
}: {
  readonly value: number;
  readonly max: number;
  readonly role?: BarRole;
  readonly label: string;
}) {
  return (
    <div className="bar-row">
      <span className="bar-label">{label}</span>
      <div className="bar" data-role={role}>
        <i style={{ width: `${String(share(value, max))}%` }} />
      </div>
    </div>
  );
}

/** Доля `value` от `max` в процентах, зажатая в `[0, 100]`; ноль, когда доли нет. */
function share(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) {
    return 0;
  }

  return Math.min(100, Math.max(0, (value / max) * 100));
}
