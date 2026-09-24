import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { BANNER } from './ui-tokens-banner.mjs';

/**
 * Держит `apps/web/src/ui/tokens.css` равным тому, что печатает `tokens.ts` (`ADR-017`).
 *
 * Та же сборка строки, что в `generate-ui-tokens.mjs`, но вместо записи — сравнение.
 * Ничего не пишет: стадия `pnpm verify`, изменившая рабочее дерево, превращает «гейт
 * зелёный» в «гейт сделал его зелёным».
 *
 * Расхождение печатается построчно, а не одной фразой «файлы разошлись», и это разница
 * между отчётом и загадкой: сломавшийся токен назван по имени (`--crew`), и не нужно
 * запускать генератор, чтобы узнать, что именно уехало.
 */

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(repoRoot, 'apps', 'web', 'src', 'ui', 'tokens.css');

// `pathToFileURL`, а не голый путь: на Windows абсолютный путь начинается с буквы диска,
// и ESM-загрузчик читает `c:` как неподдерживаемую схему URL. Та же грабля записана в
// scripts/check-schemas.mjs:41 — все точки импорта обязаны обходить её одинаково.
const { cssVariables } = await import(
  pathToFileURL(join(repoRoot, 'apps', 'web', 'src', 'ui', 'tokens.ts')).href
);

const expected = `${BANNER}${cssVariables()}\n`;

let actual;
try {
  actual = readFileSync(target, 'utf8');
} catch {
  console.error(
    'check-ui-tokens: apps/web/src/ui/tokens.css отсутствует.\n' +
      'Запустите `pnpm tokens:generate` и закоммитьте результат.'
  );
  process.exit(1);
}

if (actual !== expected) {
  const expectedLines = expected.split('\n');
  const actualLines = actual.split('\n');
  const height = Math.max(expectedLines.length, actualLines.length);

  console.error(
    'check-ui-tokens: apps/web/src/ui/tokens.css разошёлся с apps/web/src/ui/tokens.ts.'
  );

  for (let index = 0; index < height; index += 1) {
    if (expectedLines[index] === actualLines[index]) {
      continue;
    }

    console.error(`  строка ${String(index + 1)}:`);
    console.error(`    tokens.ts  печатает: ${expectedLines[index] ?? '<конец файла>'}`);
    console.error(`    tokens.css содержит: ${actualLines[index] ?? '<конец файла>'}`);
  }

  console.error('Запустите `pnpm tokens:generate` и закоммитьте результат.');
  process.exit(1);
}

console.log('check-ui-tokens: tokens.css совпадает с tokens.ts');
