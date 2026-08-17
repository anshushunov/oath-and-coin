import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { computeContentDigest, computeContentVersion } from './content-digest.ts';

const temporaryRoots: string[] = [];

afterEach(() => {
  while (temporaryRoots.length > 0) {
    rmSync(temporaryRoots.pop()!, { recursive: true, force: true });
  }
});

function writeTree(files: Readonly<Record<string, string>>): string {
  const root = mkdtempSync(join(tmpdir(), 'oac-digest-'));
  temporaryRoots.push(root);

  for (const [relativePath, text] of Object.entries(files)) {
    const path = join(root, ...relativePath.split('/'));
    mkdirSync(join(path, '..'), { recursive: true });
    writeFileSync(path, text, 'utf8');
  }

  return root;
}

describe('computeContentDigest', () => {
  it('changes when a byte of content changes', () => {
    // The whole reason the version is computed rather than declared: a declared version
    // is wrong exactly when it matters most, which is after an edit.
    const before = computeContentDigest(writeTree({ 'heroes/a.json': '{"greed":1}' }));
    const after = computeContentDigest(writeTree({ 'heroes/a.json': '{"greed":2}' }));

    expect(after).not.toBe(before);
  });

  it('changes when a file is renamed, because renaming changes what content exists', () => {
    const before = computeContentDigest(writeTree({ 'heroes/a.json': '{}' }));
    const after = computeContentDigest(writeTree({ 'heroes/b.json': '{}' }));

    expect(after).not.toBe(before);
  });

  it('does not depend on the order the filesystem returns files', () => {
    // Ordinal path order, never enumeration order: the same tree has to hash the same on
    // Windows and on Linux and after a fresh checkout.
    const one = computeContentDigest(
      writeTree({ 'heroes/a.json': '{"a":1}', 'heroes/z.json': '{"z":1}' })
    );
    const two = computeContentDigest(
      writeTree({ 'heroes/z.json': '{"z":1}', 'heroes/a.json': '{"a":1}' })
    );

    expect(two).toBe(one);
  });

  it('covers files no loader reads', () => {
    // The digest is over the tree, not over what was parsed — a README beside the content
    // is part of what content exists.
    const without = computeContentDigest(writeTree({ 'heroes/a.json': '{}' }));
    const with_ = computeContentDigest(writeTree({ 'heroes/a.json': '{}', 'README.md': 'x' }));

    expect(with_).not.toBe(without);
  });

  it('shortens the version to sixteen hex characters of the digest', () => {
    const root = writeTree({ 'heroes/a.json': '{}' });

    expect(computeContentVersion(root)).toBe(computeContentDigest(root).slice(0, 16));
    expect(computeContentVersion(root)).toHaveLength(16);
  });

  it('collides between two trees whose bytes differ, which is an inherited defect', () => {
    // External review found this, it is real, and it is deliberately **not** fixed here.
    //
    // The hash input is `path 0x1F content 0x1F` per file, and 0x1F can occur inside
    // content. So one file named `a` holding `b<1F>c<1F>d` feeds the hash exactly the same
    // bytes as two files `(a → b)` and `(c → d)`. A length-framed input would fix it.
    //
    // Why it stays: this is the C# algorithm byte for byte, and the frozen corpus records
    // `5d03734fd9c7abaa` as the content version of the shipped tree in all 54 entries.
    // Changing the framing changes every content version, which invalidates the corpus —
    // the one piece of evidence the whole migration is measured against — and breaks the
    // "both stacks agree" requirement while C# is still in the tree. The fix belongs with
    // cutover (Task 19), when the corpus stops having to agree with a C# implementation.
    //
    // Pinned as a test rather than left as a comment so that the day somebody reframes the
    // input, this fails and forces the decision to be taken deliberately.
    const separator = String.fromCharCode(0x1f);
    const oneFile = computeContentDigest(
      writeTree({ a: `b${separator}c${separator}d` })
    );
    const twoFiles = computeContentDigest(writeTree({ a: 'b', c: 'd' }));

    expect(twoFiles).toBe(oneFile);
  });
});
