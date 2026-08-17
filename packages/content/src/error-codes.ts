/**
 * Every stable code the load sequence can stop at — the five spellings `ErrorCodes` in
 * `OathAndCoin.Presentation` held, and the debt `FULL_TYPESCRIPT_MIGRATION` §3.1 booked
 * against this task: the corpus covers exactly one of them, so the other four are
 * checked here against fixtures rather than left to "some day".
 *
 * **Why these live in the content package and not beside a screen.** In C# they sat in
 * `OathAndCoin.Presentation`, because that is where the model carrying them lived. The
 * dependency direction here forbids that: `presentation-depends-only-on-simulation`, so
 * a presentation module cannot reach content, and every one of these five codes is
 * *produced* by reading files — a missing content root, a schema violation, a loader
 * refusal, an unreadable scenario, an unresolvable checkpoint. None is produced by a
 * screen. So the layer that emits them owns them, and a screen takes a code as the
 * plain string its model already carries.
 *
 * The cost is named rather than discovered later: Task 11 ports `ErrorKeys`, which
 * needs this list to check that the locale catalogue names every code. That check
 * cannot live inside `packages/presentation` — it would have to import content — so it
 * belongs in a test member, the way the corpus checks already do.
 */

export const ErrorCodes = Object.freeze({
  /** The content directory itself is missing. */
  ContentRootNotFound: 'CONTENT_ROOT_NOT_FOUND',

  /** A content file failed schema validation (stage 1, `TDD` §11.2). */
  SchemaInvalid: 'SCHEMA_INVALID',

  /** A content file failed the loader itself, past schema validation. */
  ContentInvalid: 'CONTENT_INVALID',

  /** The scenario's own manifest or commands file could not be read. */
  ScenarioInvalid: 'SCENARIO_INVALID',

  /** The requested checkpoint did not resolve against an otherwise valid scenario. */
  CheckpointUnknown: 'CHECKPOINT_UNKNOWN'
});

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

/** Every code above, derived rather than typed a second time — see `REASON_CODES`. */
export const ERROR_CODES: readonly ErrorCode[] = Object.freeze(Object.values(ErrorCodes));
