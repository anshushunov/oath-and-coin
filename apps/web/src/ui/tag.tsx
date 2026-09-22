import type { ColourRole } from './tokens.ts';

export type TagRole = Extract<ColourRole, 'favour' | 'against' | 'blocked' | 'status'>;

/**
 * Короткий чип: цвет несёт роль, слово несёт тот же смысл словами.
 *
 * `word` не имеет значения по умолчанию намеренно. `GDD` §16.6 требует текстового
 * дубля у каждого визуального сигнала, и единственный способ сделать это правилом,
 * а не пожеланием, — не дать чипу собраться без слова.
 *
 * Роль уходит в `data-role`, а не в имя класса: стиль выбирает цвет по атрибуту
 * (`styles.css`, `.tag[data-role=…]`), и тот же атрибут читает тест. Класс, склеенный
 * из роли, был бы вторым способом назвать одно и то же.
 */
export function Tag({
  role,
  word,
  testId
}: {
  readonly role: TagRole;
  readonly word: string;
  readonly testId?: string;
}) {
  return (
    <span className="tag" data-role={role} data-testid={testId}>
      {word}
    </span>
  );
}
