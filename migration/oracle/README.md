# The oracle corpus, after the stack it describes was deleted

`v1/` is the frozen record of the Godot/.NET implementation's observable behaviour at
the Gate 0 baseline `12565862`. Task 19 of
[`FULL_TYPESCRIPT_MIGRATION`](../../docs/production/FULL_TYPESCRIPT_MIGRATION.md) deleted
that implementation on 2026-08-22. This file exists because `v1/README.md` cannot say so.

**Why the corpus's own README was not updated.** Every file under `v1/` is covered by a
SHA-256 recorded in `v1/manifest.json`, including that README. Editing a word in it makes
the manifest wrong and `tests/oracle` red — on a corpus whose entire value is that it is
byte-identical everywhere and unchanged since export. So `v1/README.md` still tells a
reader to run

```
dotnet run --project tools/OathAndCoin.MigrationOracle -c Release -- export --root . --output migration/oracle/v1
```

and still names `tests/OathAndCoin.MigrationOracle.Tests` as its validator. Neither path
exists. Both were true on the commit that exported the corpus, which is exactly what a
frozen artifact is supposed to say: what was true when it was made.

**Where things are now.**

| `v1/README.md` says | Where it is now |
|---|---|
| exported by `tools/OathAndCoin.MigrationOracle` | deleted; the tree is at tag `dotnet-final` |
| validated by `tests/OathAndCoin.MigrationOracle.Tests` | `tests/oracle` — same claims, TypeScript |
| re-exportable with `dotnet run …` | not re-exportable at all; see below |

**The corpus is no longer re-derivable, and that is the point rather than a loss.** It
was never meant to be regenerated: it is the frozen answer the migration is measured
against, and a corpus that can be re-exported by the stack being tested proves nothing
about that stack. Since 2026-08-22 it is also the *only* record of what the deleted
implementation did — which makes the digests in `v1/manifest.json` and the `eol=lf`
rules in `.gitattributes` more load-bearing than they were, not less.

**What still reads it.** `tests/oracle` (manifest digests, RNG vectors, JCS vectors,
54/54 parity, restored read model, save round trip) and `pnpm scenario:parity`. All of
them run in `pnpm verify`.
