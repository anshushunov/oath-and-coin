/**
 * Метрика: подпись и значение рядом, два элемента.
 *
 * Правило то же, что у `Captioned` в `screens/labels.tsx`, и по той же причине: порядок
 * слов и знаки между подписью и значением зависят от языка, поэтому компонент не
 * склеивает их в одну строку — склейка решила бы за каталог. Отличие одно: `Captioned`
 * держит ключ подписи и сам разрешает его, а `Stat` получает обе строки готовыми и о
 * каталоге не знает.
 *
 * `value` — строка, а не число: число экран печатает сам (`String(n)`), и так у значения
 * всегда ровно один текстовый узел, а ноль не превращается в пустоту по дороге.
 */
export function Stat({
  caption,
  value,
  testId
}: {
  readonly caption: string;
  readonly value: string;
  readonly testId?: string;
}) {
  return (
    <div className="stat" data-testid={testId}>
      <span className="stat-caption">{caption}</span>
      <span className="stat-value">{value}</span>
    </div>
  );
}
