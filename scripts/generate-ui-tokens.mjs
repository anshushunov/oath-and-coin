import { writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { BANNER } from './ui-tokens-banner.mjs';

/**
 * Печатает `apps/web/src/ui/tokens.css` из `apps/web/src/ui/tokens.ts` (`ADR-017`).
 *
 * CSS — производное, а не второе объявление: цвет, кегль и шаг названы в `tokens.ts` и
 * больше нигде, а этот скрипт переводит их в вид, который понимает браузер. Отсюда
 * следует и то, что файл коммитится: сборка не запускает генератор, `index.html` держит
 * `default-src 'none'` и не подтянет ничего на лету, — значит на диске должен лежать
 * готовый результат. Что он не устарел, проверяет `pnpm tokens:check` внутри
 * `pnpm verify`.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(repoRoot, 'apps', 'web', 'src', 'ui', 'tokens.css');

// `pathToFileURL`, а не голый путь: на Windows абсолютный путь начинается с буквы диска,
// и ESM-загрузчик читает `c:` как неподдерживаемую схему URL. Та же грабля записана в
// scripts/check-schemas.mjs:41 — все точки импорта обязаны обходить её одинаково.
const { cssVariables } = await import(
  pathToFileURL(join(repoRoot, 'apps', 'web', 'src', 'ui', 'tokens.ts')).href
);

writeFileSync(target, `${BANNER}${cssVariables()}\n`, 'utf8');

console.log(`generate-ui-tokens: ${target}`);
