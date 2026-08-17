/**
 * Independent RNG streams (`TDD` §7.2). Separating draws by stream means a change
 * in one subsystem's draw count (say combat) never perturbs another subsystem's
 * sequence (say hero decisions), because the stream value is mixed into the key
 * before any ordinal is applied.
 *
 * A frozen object and a union type rather than an `enum`, and not by preference:
 * `erasableSyntaxOnly` bans `enum` across this workspace because Node's type
 * stripping cannot run it, and the pure packages have to be executable by plain
 * `node`. The values are the ones the C# enum had and the frozen corpus recorded —
 * they are part of every draw, so renumbering them silently re-rolls the whole
 * campaign.
 */
export const RngStream = Object.freeze({
  WorldGeneration: 0,
  WorldTick: 1,
  ContractGeneration: 2,
  HeroDecision: 3,
  ExpeditionEvent: 4,
  Combat: 5,
  CosmeticPresentation: 6
});

export type RngStream = (typeof RngStream)[keyof typeof RngStream];

/** Every stream, in declaration order, for the checks that must cover all of them. */
export const RNG_STREAM_NAMES = Object.freeze(
  Object.keys(RngStream) as readonly (keyof typeof RngStream)[]
);
