import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { loadLocaleCatalogue } from './node/index.ts';

const repoRoot = resolve(import.meta.dirname, '..', '..', '..');
const shippedLocale = join(repoRoot, 'content', 'locale', 'ru.json');

const temporaryFiles: string[] = [];

afterEach(() => {
  while (temporaryFiles.length > 0) {
    rmSync(temporaryFiles.pop()!, { recursive: true, force: true });
  }
});

function writeLocale(text: string): string {
  const directory = mkdtempSync(join(tmpdir(), 'oath-locale-'));
  temporaryFiles.push(directory);
  const path = join(directory, 'ru.json');
  writeFileSync(path, text, 'utf8');

  return path;
}

describe('loadLocaleCatalogue over the shipped catalogue', () => {
  const catalogue = loadLocaleCatalogue(shippedLocale);

  it('resolves an authored key to its text', () => {
    expect(catalogue.get('hero.core.bram.name')).toBe('Брам');
    expect(catalogue.get('hero.core.zara.name')).toBe('Зара');
  });

  it('keys the catalogue in ordinal order', () => {
    const keys = catalogue.keys();
    expect([...keys].sort((left, right) => (left < right ? -1 : 1))).toEqual(keys);
  });

  it('answers undefined for a key nobody authored, rather than an empty string', () => {
    // An absent key that read as `''` would put a blank where a name belongs and
    // look like a missing translation rather than a missing key.
    expect(catalogue.get('hero.core.nobody.name')).toBeUndefined();
  });
});

describe('loadLocaleCatalogue refuses', () => {
  it('a missing file', () => {
    expect(() => loadLocaleCatalogue(join(repoRoot, 'content', 'locale', 'nope.json'))).toThrow();
  });

  it('a catalogue authored for another format version', () => {
    expect(() =>
      loadLocaleCatalogue(writeLocale('{"schema_version":1,"locale":"ru","entries":{}}'))
    ).toThrow(/does not satisfy its contract/);
  });

  it('an empty locale name', () => {
    expect(() =>
      loadLocaleCatalogue(writeLocale('{"schema_version":2,"locale":"","entries":{}}'))
    ).toThrow(/does not satisfy its contract/);
  });

  it('a key with an empty value', () => {
    // An empty string is not a translation, and accepting it would put a blank on
    // screen where the key itself would at least have been diagnosable.
    expect(() =>
      loadLocaleCatalogue(writeLocale('{"schema_version":2,"locale":"ru","entries":{"a.b":""}}'))
    ).toThrow(/does not satisfy its contract/);
  });

  it('a key with a non-string value', () => {
    expect(() =>
      loadLocaleCatalogue(writeLocale('{"schema_version":2,"locale":"ru","entries":{"a.b":42}}'))
    ).toThrow(/does not satisfy its contract/);
  });

  it('a repeated key', () => {
    // The rule the C# loader read locale files through `JsonDocument` to keep, since
    // `JsonNode` collapsed duplicates silently. `JSON.parse` collapses them too, so
    // it is `scanJson` that sees this now — and it sees it in every file, not only
    // here.
    expect(() =>
      loadLocaleCatalogue(
        writeLocale('{"schema_version":2,"locale":"ru","entries":{"a.b":"one","a.b":"two"}}')
      )
    ).toThrow(/repeats the object key 'a.b'/);
  });

  it('an unknown top-level property', () => {
    expect(() =>
      loadLocaleCatalogue(
        writeLocale('{"schema_version":2,"locale":"ru","entries":{},"fallback":"en"}')
      )
    ).toThrow(/does not satisfy its contract/);
  });

  it('a missing entries object', () => {
    expect(() => loadLocaleCatalogue(writeLocale('{"schema_version":2,"locale":"ru"}'))).toThrow(
      /does not satisfy its contract/
    );
  });
});
