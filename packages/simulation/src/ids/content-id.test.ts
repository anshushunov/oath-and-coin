import { describe, expect, it } from 'vitest';

import {
  CONTENT_ID_PATTERN,
  compareContentIds,
  contentIdName,
  contentIdNamespace,
  parseContentId,
  tryParseContentId
} from './content-id.ts';

describe('parseContentId', () => {
  it.each(['core:bram', 'action:accept', 'target:undead', 'a:b', 'core:will_not_serve_slavers'])(
    'accepts %s',
    (text) => {
      expect(parseContentId(text)).toBe(text);
    }
  );

  it.each([
    { name: 'no separator', text: 'bram' },
    { name: 'two separators', text: 'core:sub:bram' },
    { name: 'an empty namespace', text: ':bram' },
    { name: 'an empty name', text: 'core:' },
    { name: 'a leading digit in the namespace', text: '1core:bram' },
    { name: 'a leading underscore in the name', text: 'core:_bram' },
    { name: 'an uppercase letter', text: 'Core:bram' },
    { name: 'a hyphen', text: 'core:will-not' },
    { name: 'a space', text: 'core:two words' },
    { name: 'surrounding whitespace', text: ' core:bram ' },
    { name: 'the empty string', text: '' }
  ])('rejects $name', ({ text }) => {
    expect(tryParseContentId(text)).toBeUndefined();
    expect(() => parseContentId(text)).toThrow(/Invalid ContentId/);
  });

  it('rejects null and undefined without being handed a default', () => {
    // The C# struct's `default` was the one invalid value the language forced on
    // it, and three nullable fields existed to make touching it throw. Here the
    // absence has to be refused at the door instead, because there is no such
    // value to guard.
    expect(tryParseContentId(null)).toBeUndefined();
    expect(tryParseContentId(undefined)).toBeUndefined();
    expect(() => parseContentId(null)).toThrow(/Invalid ContentId 'null'/);
  });

  it('names the value and the expected shape in its message', () => {
    // The message is the C# one word for word: a diagnostic an author has learned
    // to read should not change spelling because the language did.
    expect(() => parseContentId('Core:Bram')).toThrow(
      "Invalid ContentId 'Core:Bram'. Expected format 'namespace:name', " +
        "where each segment matches '^[a-z][a-z0-9_]*$'."
    );
  });
});

describe('CONTENT_ID_PATTERN', () => {
  it('accepts and rejects exactly what the parser does', () => {
    // The pattern is what the content contracts — and through them the generated
    // JSON Schemas — validate with. Two statements of one format that disagree
    // mean a schema accepts identifiers the loader then refuses, which is the
    // worst of both. Both are built from one segment body, and this is what holds
    // them to it.
    const pattern = new RegExp(CONTENT_ID_PATTERN);

    for (const text of ['core:bram', 'a:b', 'core:will_not_serve_slavers']) {
      expect(pattern.test(text), text).toBe(true);
    }

    for (const text of ['bram', 'core:sub:bram', ':bram', 'core:', 'Core:bram', 'core:will-not']) {
      expect(pattern.test(text), text).toBe(false);
    }
  });
});

describe('segments', () => {
  it('splits at the separator', () => {
    const id = parseContentId('core:bram');
    expect(contentIdNamespace(id)).toBe('core');
    expect(contentIdName(id)).toBe('bram');
  });
});

describe('compareContentIds', () => {
  it('orders by UTF-16 code units, never by locale', () => {
    const sorted = ['core:zara', 'core:bram', 'core:ilsa', 'action:accept']
      .map((text) => parseContentId(text))
      .sort(compareContentIds);

    expect(sorted).toEqual(['action:accept', 'core:bram', 'core:ilsa', 'core:zara']);
  });

  it('answers zero for equal identifiers and is antisymmetric', () => {
    const left = parseContentId('core:bram');
    const right = parseContentId('core:zara');

    expect(compareContentIds(left, left)).toBe(0);
    expect(compareContentIds(left, right)).toBeLessThan(0);
    expect(compareContentIds(right, left)).toBeGreaterThan(0);
  });

  it('puts an underscore after every letter, as code-unit order requires', () => {
    // `_` is U+005F, after uppercase and before lowercase. A locale-aware sort
    // typically ignores it altogether, and the order this returns is what the
    // canonical artifact's trait lists are written in.
    const sorted = ['core:will_not_serve', 'core:willow', 'core:willing']
      .map((text) => parseContentId(text))
      .sort(compareContentIds);

    expect(sorted).toEqual(['core:will_not_serve', 'core:willing', 'core:willow']);
  });
});
