import { describe, expect, it } from 'vitest';

import { computeContentDigest, computeContentVersion } from './content-digest.ts';
import { memoryFileSource } from './file-source.ts';

/**
 * The digest against sources built in memory rather than trees written to a temporary
 * directory.
 *
 * Not a convenience: a source is what the digest now takes, and building one here is
 * the same act a browser performs. The cases are the ones this file has always held —
 * an edited byte, a rename, enumeration order, files no loader reads — and each of them
 * is a property of the (path, bytes) pairs, which is exactly what a source is. That the
 * value agrees with a real directory is a separate claim and has its own test
 * (`source-agreement.test.ts`), because it is about the Node source rather than about
 * the digest.
 */

function tree(files: Readonly<Record<string, string>>) {
  return memoryFileSource(files);
}

describe('computeContentDigest', () => {
  it('changes when a byte of content changes', () => {
    // The whole reason the version is computed rather than declared: a declared version
    // is wrong exactly when it matters most, which is after an edit.
    const before = computeContentDigest(tree({ 'heroes/a.json': '{"greed":1}' }));
    const after = computeContentDigest(tree({ 'heroes/a.json': '{"greed":2}' }));

    expect(after).not.toBe(before);
  });

  it('changes when a file is renamed, because renaming changes what content exists', () => {
    const before = computeContentDigest(tree({ 'heroes/a.json': '{}' }));
    const after = computeContentDigest(tree({ 'heroes/b.json': '{}' }));

    expect(after).not.toBe(before);
  });

  it('does not depend on the order the source lists files in', () => {
    // Ordinal path order, never enumeration order: the same tree has to hash the same on
    // Windows and on Linux, after a fresh checkout, and out of a bundle whose keys arrive
    // in whatever order the bundler emitted them.
    const one = computeContentDigest(tree({ 'heroes/a.json': '{"a":1}', 'heroes/z.json': '{"z":1}' }));
    const two = computeContentDigest(tree({ 'heroes/z.json': '{"z":1}', 'heroes/a.json': '{"a":1}' }));

    expect(two).toBe(one);
  });

  it('covers files no loader reads', () => {
    // The digest is over the tree, not over what was parsed — a README beside the content
    // is part of what content exists.
    const without = computeContentDigest(tree({ 'heroes/a.json': '{}' }));
    const with_ = computeContentDigest(tree({ 'heroes/a.json': '{}', 'README.md': 'x' }));

    expect(with_).not.toBe(without);
  });

  it('covers a nested directory, not only the files at the top', () => {
    // The walk is recursive and the corpus depends on it: `content/` holds `heroes/`,
    // `contracts/`, `traits/` and `locale/`, and a source that listed only the root
    // would hash an empty tree to the same value as the shipped one.
    const shallow = computeContentDigest(tree({ 'README.md': 'x' }));
    const deep = computeContentDigest(tree({ 'README.md': 'x', 'heroes/core/a.json': '{}' }));

    expect(deep).not.toBe(shallow);
  });

  it('shortens the version to sixteen hex characters of the digest', () => {
    const source = tree({ 'heroes/a.json': '{}' });

    expect(computeContentVersion(source)).toBe(computeContentDigest(source).slice(0, 16));
    expect(computeContentVersion(source)).toHaveLength(16);
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
    const oneFile = computeContentDigest(tree({ a: `b${separator}c${separator}d` }));
    const twoFiles = computeContentDigest(tree({ a: 'b', c: 'd' }));

    expect(twoFiles).toBe(oneFile);
  });
});
