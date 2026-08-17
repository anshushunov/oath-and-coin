import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { canonicalBytes, canonicalSha256, sha256Hex } from '@oath-and-coin/simulation';
import { describe, expect, it } from 'vitest';

/**
 * The port held to the frozen corpus on the two things Task 6 changes underneath
 * every later hash: canonicalization and SHA-256.
 *
 * `FULL_TYPESCRIPT_MIGRATION` §3.3 booked a debt against this task — the C# writer
 * escaped things RFC 8785 does not, and the difference had to be paid "одним явным
 * шагом версии артефакта с сохранённым отображением старых и новых хешей", never by
 * a silent re-shoot. The corpus is where that mapping already lives: each of the ten
 * vectors carries the bytes and hash under both rules plus a `same_artifact_version`
 * flag, and this file is where both halves of it are asserted.
 *
 * What the assertions add up to:
 *
 * - this port produces the `rfc8785` bytes for all ten vectors — the standard is
 *   what is implemented, not a replica of the old writer;
 * - the five vectors flagged `same_artifact_version: true` produce the `current`
 *   bytes as well, because under both rules they are the same bytes;
 * - every string a determinism artifact holds falls inside that agreeing domain, so
 *   the artifact version does not step and the 54 recorded artifacts stay
 *   comparable. That last claim is not taken on trust: Task 10 replays all 54
 *   against their recorded bytes.
 *
 * The SHA-256 half is the third leg of the proof that this repository's own hash
 * implementation is correct. The 57 digests in `manifest.json` were produced by
 * `System.Security.Cryptography` over files that are still on disk, so recomputing
 * them is agreement with an implementation nobody here wrote.
 */

const repoRoot = resolve(import.meta.dirname, '..', '..');
const corpusRoot = join(repoRoot, 'migration', 'oracle', 'v1');

interface Rendering {
  readonly canonical_base64: string;
  readonly sha256: string;
}

interface JcsVector {
  readonly name: string;
  readonly input: unknown;
  readonly current: Rendering;
  readonly rfc8785: Rendering;
  readonly same_artifact_version: boolean;
  readonly difference: string | null;
}

interface JcsVectorFile {
  readonly covered_number_domain: string;
  readonly vectors: readonly JcsVector[];
  readonly rejected_inputs: readonly { readonly name: string; readonly input_json: string }[];
}

interface CorpusManifest {
  readonly files: readonly {
    readonly path: string;
    readonly bytes: number;
    readonly sha256: string;
  }[];
}

function readCorpusJson<T>(name: string): T {
  return JSON.parse(readFileSync(join(corpusRoot, name), 'utf8')) as T;
}

const vectorFile = readCorpusJson<JcsVectorFile>('jcs-compatibility-vectors.json');
const manifest = readCorpusJson<CorpusManifest>('manifest.json');

function base64Of(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

describe('canonicalization against the frozen corpus', () => {
  it('covers all ten recorded vectors, so none can be quietly dropped', () => {
    expect(vectorFile.vectors).toHaveLength(10);
    expect(vectorFile.vectors.filter((vector) => vector.same_artifact_version)).toHaveLength(5);
  });

  it.each(vectorFile.vectors)('produces the RFC 8785 bytes for $name', (vector) => {
    // The standard is what this port implements. For the five diverging vectors
    // these are *new* bytes and a *new* hash, and that is the point: the mapping
    // from the old hash to this one is recorded beside them in the corpus.
    const value = vector.input as Parameters<typeof canonicalBytes>[0];

    expect(base64Of(canonicalBytes(value))).toBe(vector.rfc8785.canonical_base64);
    expect(canonicalSha256(value)).toBe(vector.rfc8785.sha256);
  });

  it.each(vectorFile.vectors.filter((vector) => vector.same_artifact_version))(
    'agrees with the C# writer byte for byte on $name',
    (vector) => {
      // Where the corpus says the artifact version need not step, the bytes must be
      // identical under both rules — that is what the flag claims, and it is the
      // claim the artifact version resting at 3 depends on.
      expect(vector.current.canonical_base64).toBe(vector.rfc8785.canonical_base64);
      expect(base64Of(canonicalBytes(vector.input as Parameters<typeof canonicalBytes>[0]))).toBe(
        vector.current.canonical_base64
      );
    }
  );

  it.each(vectorFile.vectors.filter((vector) => !vector.same_artifact_version))(
    'changes the hash for $name, and says so rather than hiding it',
    (vector) => {
      // A diverging vector whose two hashes were equal would mean the corpus
      // mis-recorded the difference, and the "one explicit step" rule would have
      // been paid against a debt that did not exist.
      expect(vector.current.sha256).not.toBe(vector.rfc8785.sha256);
      expect(vector.difference).toBeTypeOf('string');
    }
  );

  it('refuses every input the corpus records as rejected, for the recorded reason', () => {
    // Two of the three are unpaired surrogates: RFC 8785 §3.2.2 requires failing on
    // invalid Unicode, and a replacement character would canonicalize a string
    // nobody supplied. The third is the number domain the C# reference declined to
    // cover — see the test below for why this port has nothing to decline.
    const surrogates = vectorFile.rejected_inputs.filter((rejected) =>
      rejected.name.endsWith('surrogate')
    );
    expect(surrogates).toHaveLength(2);

    for (const rejected of surrogates) {
      const value = JSON.parse(rejected.input_json) as Parameters<typeof canonicalBytes>[0];
      expect(() => canonicalBytes(value), rejected.name).toThrow(/unpaired surrogate/);
    }
  });

  it('covers the number domain the corpus deferred to this port', () => {
    // `covered_number_domain` limits the vectors to safe integers, and
    // `out_of_scope` asks the TypeScript port to close fractional numbers,
    // exponent forms and larger integers "against the official RFC 8785
    // conformance vectors". There is nothing to implement: RFC 8785 §3.2.2.3
    // delegates number serialization to ECMAScript `Number::toString`, and this
    // code runs on ECMAScript. The C# reference had to approximate that algorithm
    // and refused to, which is why the debt existed at all.
    expect(vectorFile.covered_number_domain).toContain('9007199254740991');

    const outOfScope = {
      fractional: 0.1,
      exponent: 1e21,
      tiny: 5e-324,
      negativeZero: -0
    };

    expect(new TextDecoder().decode(canonicalBytes(outOfScope))).toBe(
      '{"exponent":1e+21,"fractional":0.1,"negativeZero":0,"tiny":5e-324}'
    );
  });

  it('rounds an integer past the safe range instead of refusing it, and bigint is the way out', () => {
    // The one place this port is *weaker* than the C# reference, recorded rather
    // than glossed. That reference refused `9007199254740993` outright; here the
    // value never reaches the writer intact — `JSON.parse` has already rounded it
    // to 9007199254740992, because that is what an IEEE 754 double holds. No
    // ECMAScript implementation of RFC 8785 can do better, since the standard
    // delegates number formatting to ECMAScript in the first place.
    //
    // It is also why campaign seeds are `bigint` and not `number`: a seed is a
    // 64-bit value, and this is the rounding it would otherwise suffer on the way
    // into an artifact that claims to reproduce a run.
    const rounded = JSON.parse('{"n":9007199254740993}') as { n: number };
    expect(new TextDecoder().decode(canonicalBytes(rounded))).toBe('{"n":9007199254740992}');

    expect(new TextDecoder().decode(canonicalBytes({ n: 9007199254740993n }))).toBe(
      '{"n":9007199254740993}'
    );
  });
});

describe('sha256 against the frozen corpus', () => {
  it('recomputes every digest the C# exporter recorded', () => {
    // 57 files, hashed by `System.Security.Cryptography` when the corpus was
    // frozen. Agreement here is agreement with an implementation this repository
    // did not write — the leg of the proof the FIPS vectors cannot provide, since
    // those only say the algorithm was transcribed correctly.
    expect(manifest.files).toHaveLength(57);

    for (const file of manifest.files) {
      const bytes = readFileSync(join(corpusRoot, file.path));
      expect(bytes.byteLength, file.path).toBe(file.bytes);
      expect(sha256Hex(bytes), file.path).toBe(file.sha256);
    }
  });
});
