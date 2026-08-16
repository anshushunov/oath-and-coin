'use strict';

const { readdirSync, rmSync, statSync } = require('node:fs');
const { join } = require('node:path');

/**
 * Removes the Chromium locale bundles this game cannot use.
 *
 * Kept: `ru` (the only locale in `content/locale`) and `en-US`, which is the
 * fallback Chromium loads when the system locale has no bundle. Removing every
 * .pak including the fallback makes Electron fail at startup rather than
 * degrade, so the fallback is not optional.
 *
 * Plain CommonJS because electron-builder loads this file itself, outside the
 * workspace's build and typecheck. It is deliberately short for that reason.
 */

const KEPT_LOCALES = new Set(['en-US.pak', 'ru.pak']);

exports.default = async function afterPack(context) {
  const localesDirectory = join(context.appOutDir, 'locales');

  let removedFiles = 0;
  let removedBytes = 0;

  for (const entry of readdirSync(localesDirectory)) {
    if (KEPT_LOCALES.has(entry)) {
      continue;
    }

    const path = join(localesDirectory, entry);
    removedBytes += statSync(path).size;
    rmSync(path);
    removedFiles += 1;
  }

  // Printed, not silent: a packaging step that changes the shipped bytes
  // should say so in the log the build leaves behind.
  console.log(
    `  • pruned locales  removed=${String(removedFiles)} kept=${[...KEPT_LOCALES].join(',')} freedBytes=${String(removedBytes)}`
  );
};
