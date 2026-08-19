import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

import { memoryFileSource } from '../file-source.ts';
import { nodeFileSource } from '../node/file-source.ts';

import {
  UI_TEXT_ROOT,
  UI_TEXT_SCHEMA_VERSION,
  loadUiTextCatalogue,
  uiTextCatalogueFile
} from './ui-text-catalogue.ts';

/**
 * The interface catalogue read the way content is read — through a
 * {@link import('../file-source.ts').ContentFileSource}, so that the browser and Node
 * cannot end up with two readers of one file format.
 *
 * What is *not* tested here is the boundary itself ("this file lives outside
 * `content/`"). That is a property of the shipped tree rather than of the loader, and
 * `tests/locale/catalogue.test.ts` states it, beside the two-catalogue rule it belongs to.
 */

const repositoryRoot = resolve(import.meta.dirname, '..', '..', '..', '..');

function file(body: Readonly<Record<string, unknown>>): string {
  return JSON.stringify({ schema_version: UI_TEXT_SCHEMA_VERSION, locale: 'ru', ...body });
}

function sourceHolding(text: string) {
  return memoryFileSource({ 'ru.json': text });
}

describe('loadUiTextCatalogue', () => {
  it('answers the text an entry names', () => {
    const catalogue = loadUiTextCatalogue(
      sourceHolding(file({ entries: { 'error.save_malformed': 'Файл сохранения повреждён.' } })),
      'ru.json'
    );

    expect(catalogue.get('error.save_malformed')).toBe('Файл сохранения повреждён.');
  });

  it('refuses the content catalogue’s own schema version', () => {
    // The two catalogues version separately on purpose: `content/locale/ru.json` is at 2
    // because it evolved twice, and a new file starting at 2 to match would tie the next
    // change of either format to the other. A file that states the wrong one is refused
    // rather than read under this version's assumptions.
    const text = JSON.stringify({ schema_version: 2, locale: 'ru', entries: {} });

    expect(() => loadUiTextCatalogue(sourceHolding(text), 'ru.json')).toThrow(
      /does not satisfy its contract/u
    );
  });

  it('refuses an entry whose key is not a localization key', () => {
    // Same rule as the content catalogue's, from the same pattern: a key is a key
    // whichever side of the boundary it was authored on, and `errorKey` produces this
    // shape on both.
    expect(() =>
      loadUiTextCatalogue(sourceHolding(file({ entries: { 'Save Failed': 'x' } })), 'ru.json')
    ).toThrow(/does not satisfy its contract/u);
  });

  it('refuses an entry with no text at all', () => {
    // An empty string passes every completeness check that only asks whether the key is
    // present, and shows a player a blank label.
    expect(() =>
      loadUiTextCatalogue(sourceHolding(file({ entries: { 'error.save_malformed': '' } })), 'ru.json')
    ).toThrow(/does not satisfy its contract/u);
  });

  it('refuses a field the format does not have', () => {
    expect(() =>
      loadUiTextCatalogue(sourceHolding(file({ entries: {}, comment: 'x' })), 'ru.json')
    ).toThrow(/does not satisfy its contract/u);
  });

  it('refuses a key declared twice in the same file', () => {
    // `JSON.parse` keeps the last of two identical keys and says nothing, so the reader
    // that goes through `scanJson` is what makes a doubled entry visible. Written as raw
    // text because no object literal can express it.
    const text =
      '{"schema_version":1,"locale":"ru","entries":{"error.save_malformed":"а","error.save_malformed":"б"}}';

    expect(() => loadUiTextCatalogue(sourceHolding(text), 'ru.json')).toThrow(/error\.save_malformed/u);
  });

  it('names the file the source describes when it refuses one', () => {
    // The diagnostic must name the catalogue an author edits, not a path on the machine
    // that produced it (`TDD` §18).
    expect(() =>
      loadUiTextCatalogue(sourceHolding(file({ entries: { 'Save Failed': 'x' } })), 'ru.json')
    ).toThrow(/'ru\.json'/u);
  });
});

describe('the shipped interface catalogue', () => {
  it('is read out of the repository through the same loader', () => {
    // The one case that reads the real file: a schema nothing has ever validated the
    // shipped bytes against is a schema that agrees with itself.
    const catalogue = loadUiTextCatalogue(
      nodeFileSource(resolve(repositoryRoot, UI_TEXT_ROOT)),
      uiTextCatalogueFile('ru')
    );

    expect(catalogue.size).toBeGreaterThan(0);
  });
});
