# Migration oracle corpus v1

The observable behaviour of the Godot/C# implementation at commit
`12565862b1e88e0524f95def18c023571ec4269f`, frozen as data.

**Generated. Never edited by hand.** Every file here is written by
`tools/OathAndCoin.MigrationOracle` and covered by a SHA-256 in
`manifest.json`. To reproduce:

```powershell
dotnet run --project tools/OathAndCoin.MigrationOracle -c Release -- export --root . --output migration/oracle/v1
git diff --exit-code -- migration/oracle/v1
```

The second command must print nothing. Changing a byte here requires an
artifact-version bump and a recorded reason
(`docs/production/FULL_TYPESCRIPT_MIGRATION.md`), because this corpus is
what the TypeScript port is compared against — and it is what the
behaviour of this build will still be provable from after the C# tree is
deleted (`ADR-010`).

## Contents

| File | What it freezes |
|---|---|
| `manifest.json` | Artifact schema version, source commit, seeds, per-file SHA-256, every scenario, checkpoint and entry |
| `scenarios/<scenario>/<checkpoint>/seed-<seed>.json` | Inputs, outcome, final state, steps, events, traces, draws consumed, presentation read model, canonical bytes and hash |
| `rng-vectors.json` | Every RNG stream, boundary seeds, ordinals around zero and both ends of the range, and the cases from the simulation's own golden fixture |
| `jcs-compatibility-vectors.json` | Where this build's canonical JSON and RFC 8785 agree, and where they do not |

## Reading it

- 64-bit values (seeds, ordinals, draws) are decimal **strings**: JSON's
  number type is an IEEE 754 double in every reader the port will use,
  and a value above 2^53 written as a number is silently rounded.
- `final_state`, `steps`, `events` and `traces` are slices of the same
  canonical artifact `canonical_base64` holds, not a second projection.
- `read_model` carries no `error_detail`: it holds a machine-specific
  path, which would make this corpus differ between the machine that
  generated it and the one validating it. The presentation factory's own
  hash excludes it for the same reason.
- An entry with `outcome.kind` other than `success` has no
  `final_state` and no canonical bytes, and says so with explicit
  `null`s rather than by omitting the keys.
- The seed is part of an entry's identity, not a constant of the
  corpus: every checkpoint is frozen at each seed in `manifest.json`'s
  `seeds`. Only entries at `canonical_artifact_seed` reproduce the
  repository's committed `scenarios/<scenario>.canonical.json`; a port
  that ignored the seed it was handed would match one of the two and
  fail the other.

Validated by `tests/OathAndCoin.MigrationOracle.Tests`, which re-derives
every fact here from the production loaders, rules and presentation
factory instead of trusting the exporter that wrote it.
