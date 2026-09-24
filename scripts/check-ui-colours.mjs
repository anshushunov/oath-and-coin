import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Запрещает цветовой литерал в `.css` под `apps/web` (`ADR-017` §2).
 *
 * Половина запрета по ту сторону шва CSS/TypeScript: ESLint работает по AST и в `.css`
 * не заглядывает вовсе, так что без этого скрипта `color: #f0a8a8` — второе объявление
 * цвета, которое не ловит ни один гейт. Именно так оно и попало в
 * `saves-screen.css` мимо обеих палитр.
 *
 * Исключение ровно одно и названо поимённо: сгенерированный `tokens.css`, где литералы и
 * должны быть — он производный, а не второй источник. Третьего исключения не заводится:
 * `AGENTS.md` §12 п. 3 запрещает копить их, и если понадобится третье, переписывается
 * весь гейт, а не список.
 *
 * **Пустой обход — это красный, а не зелёный, и это отдельная проверка.** Самый вероятный
 * отказ здесь не «нашёлся литерал», а «не нашлось файлов»: директория переехала, обход
 * сломался, — и проверка, которая просто не нашла нарушений, довольна. Печатать число
 * просмотренных файлов недостаточно: число в логе — это напоминание человеку, а не гейт,
 * и ноль в нём заметит только тот, кто читает вывод зелёной стадии. Поэтому ниже —
 * {@link FLOOR}, и обход, не добравший до него, выходит с единицей.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const root = join(repoRoot, 'apps', 'web');

/** Сгенерированный файл — производное объявление, а не второе. */
const EXEMPT = join(root, 'src', 'ui', 'tokens.css');

/**
 * Сколько `.css` под `apps/web` обход обязан увидеть, чтобы его результату можно было
 * верить.
 *
 * Два: `styles.css` и `screens/saves/saves-screen.css` — те, что есть сегодня. Порог, а
 * не сравнение с нулём: обход, нашедший один файл из двух, сломан ровно так же, как
 * нашедший ноль, и «больше нуля» этого не видит. Число растёт вместе с деревом — экраны
 * Task 8 добавят свои, — и поднимать его, добавляя стилевой файл, это и есть смысл: порог,
 * который никогда не мешает, ничего и не держит.
 */
const FLOOR = 2;

/** Не наш код: установленное и собранное. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist']);

/**
 * Шестнадцатеричная запись и функциональные (`rgb()`, `hsl()` и соседи). Первая редакция
 * читала только hex, и внешнее ревью провело мимо неё `rgb(200 90 74)` — тот же цвет
 * другим почерком. Именованные цвета (`red`, `white`) сюда не входят сознательно: слово
 * `white` законно стоит в `white-space`, и отличить значение от имени свойства может
 * только разбор CSS, а не строка; это известная граница проверки, а не упущение.
 */
const COLOUR = /#[0-9a-fA-F]{3,8}\b|\b(?:rgba?|hsla?|hwb|lab|lch|oklab|oklch|color)\([^)]*\)/giu;

function cssFilesUnder(directory) {
  const found = [];
  let entries;

  try {
    entries = readdirSync(directory, { withFileTypes: true });
  } catch (error) {
    // Сообщением, а не стеком ENOENT: не найденная директория — самый вероятный способ
    // сломать этот обход, и отчёт о ней должен читаться как вывод проверки.
    console.error(
      `check-ui-colours: не удалось прочитать ${relative(repoRoot, directory).split(sep).join('/')} — ` +
        `${error.message}`
    );
    process.exit(1);
  }

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        found.push(...cssFilesUnder(path));
      }
      continue;
    }

    if (entry.isFile() && entry.name.endsWith('.css')) {
      found.push(path);
    }
  }

  return found;
}

const files = cssFilesUnder(root).filter((path) => path !== EXEMPT);

// Прежде чем говорить что-либо о находках — убедиться, что было где искать. Проверка,
// прошедшая по пустоте, не «не нашла нарушений»: она ничего не проверила, и зелёный от
// неё означает только то, что она отработала без исключения.
if (files.length < FLOOR) {
  console.error(
    `check-ui-colours: обход нашёл ${String(files.length)} файл(ов) .css под apps/web, ` +
      `а их должно быть не меньше ${String(FLOOR)}.\n` +
      'Это отказ самой проверки, а не чистое дерево: либо стилевые файлы переехали и обход\n' +
      'смотрит не туда — тогда чините путь в этом скрипте, — либо их стало меньше намеренно,\n' +
      'и тогда правьте FLOOR тем же коммитом, которым удаляете файл.'
  );
  process.exit(1);
}

const failures = [];

for (const path of files) {
  const lines = readFileSync(path, 'utf8').split('\n');

  for (const [index, line] of lines.entries()) {
    for (const match of line.matchAll(COLOUR)) {
      failures.push(
        `${relative(repoRoot, path).split(sep).join('/')}:${String(index + 1)}: ${match[0]}`
      );
    }
  }
}

if (failures.length > 0) {
  console.error(`check-ui-colours нашёл ${String(failures.length)} цветовой(ых) литерал(ов):`);
  for (const failure of failures) {
    console.error(`  ${failure}`);
  }
  console.error(
    'Цвет объявляется один раз, в apps/web/src/ui/tokens.ts (ADR-017), и попадает в CSS\n' +
      'переменной из сгенерированного apps/web/src/ui/tokens.css. Возьмите `var(--роль)`\n' +
      'или заведите новую роль в tokens.ts.'
  );
  process.exit(1);
}

console.log(
  `check-ui-colours: ${String(files.length)} файл(ов) .css под apps/web просмотрено ` +
    `(порог — ${String(FLOOR)}), цветовых литералов нет ` +
    '(кроме сгенерированного tokens.css, который исключён).'
);
