import type { ContentId } from '../ids/content-id.ts';

/**
 * One contributing input to a decision (`TDD` §8): a stable reason code, the entity
 * that produced it, and how strongly it weighed in. The UI decides how much of this
 * to surface, but it never invents a different reason than the one the simulation
 * actually used.
 */
export interface TraceFactor {
  /** A stable code from `reason-codes.ts` — a closed engine vocabulary, never content. */
  readonly reasonCode: string;
  /**
   * The content-addressable entity this factor came from, never free text. For a hero
   * this is the hero's *definition*, not its runtime id: the definition is stable
   * across saves and campaigns, so a stored explanation stays meaningful even where
   * the instance it described no longer exists.
   */
  readonly sourceEntity: ContentId;
  /** How strongly it weighed in — a strength, never signed. See {@link CausalTrace}. */
  readonly magnitude: number;
}

/**
 * A hard constraint that ruled an action out entirely, together with the content
 * entity that carries it.
 *
 * A block has no magnitude on purpose: a red line is not a very large negative
 * contribution, it closes the path before any contribution exists
 * (`HERO_DECISION_SPEC` §2.2). The source entity is not optional either — a screen
 * required to name the principle would otherwise have to guess it from the hero,
 * which is exactly the invented explanation this trace exists to rule out (`TDD` §8).
 */
export interface TraceBlock {
  readonly reasonCode: string;
  readonly sourceEntity: ContentId;
}

/**
 * The stored explanation for a decision (`ADR-007`), addressed by {@link traceId} from
 * the event that produced it and kept in game state rather than only on a command's
 * return value: if it lived only on the result, the reference left on the event would
 * dangle the moment the game is saved and reloaded, and the decision could no longer
 * be explained.
 *
 * A trace is not self-contained on its own — it explains an *action*, not a target.
 * Which hero and which contract the decision concerned already lives on the event
 * that references it, and a trace is only ever looked up together with that event.
 * Repeating the target here would be a second place for it to drift.
 *
 * Magnitudes are strengths, never signed contributions: which list a factor is in
 * already says which way it pulled, and a negative magnitude inside
 * {@link negativeFactors} would mean the opposite of itself.
 */
export interface CausalTrace {
  readonly traceId: number;
  readonly positiveFactors: readonly TraceFactor[];
  readonly negativeFactors: readonly TraceFactor[];
  /**
   * Hard constraints that ruled the action out entirely, independent of score (`TDD`
   * §8: a hard taboo is not bypassed by an ordinary positive score). Empty when
   * nothing was blocked.
   */
  readonly blockedBy: readonly TraceBlock[];
  /**
   * The reason code that broke a tie between equally-scored actions; `null` when the
   * decision involved no tie. Tie-breaking must be deterministic (`TDD` §8), so this
   * is always a stable code, never a description generated on the spot.
   */
  readonly tieBreak: string | null;
}

/**
 * The full result of one decision (`TDD` §8): the chosen action and its explanation
 * come out of the same computation, never reconstructed after the fact.
 */
export interface DecisionResult {
  /** The chosen action — not a target. See the note on {@link CausalTrace}. */
  readonly selectedAction: ContentId;
  readonly consideredActions: readonly ContentId[];
  /**
   * The score that decided {@link selectedAction} — `null` exactly when
   * {@link CausalTrace.blockedBy} is non-empty.
   *
   * A placeholder here is forbidden and zero would be the worst possible one: it is
   * indistinguishable from an honest zero and, under the "accept at score ≥ 0" rule,
   * reads as consent (`TDD` §8). Every reader of a trace — artifact, read model,
   * viewer — has to handle the absence; it is legal, not a loss of data.
   */
  readonly selectedScore: number | null;
  readonly trace: CausalTrace;
}

/**
 * Builds a {@link DecisionResult}, refusing the two shapes that would make it lie.
 *
 * A factory rather than a bare object literal, because these are cross-field
 * invariants and TypeScript cannot express them in a type. The C# original enforced
 * them from `init` accessors against explicit backing fields, plus two assignment
 * flags, because object-initializer order is not guaranteed — a function argument
 * list has no such problem, so this is the whole of it.
 *
 * @throws if the selected action is not among those considered, or if a score and a
 * block are both present or both absent.
 */
export function createDecisionResult(result: DecisionResult): DecisionResult {
  if (!result.consideredActions.includes(result.selectedAction)) {
    throw new Error(
      `selectedAction '${result.selectedAction}' must be among consideredActions ` +
        `(${result.consideredActions.join(', ')}).`
    );
  }

  const blocked = result.trace.blockedBy.length > 0;

  if (blocked && result.selectedScore !== null) {
    throw new Error(
      'selectedScore must be null when trace.blockedBy is non-empty: a red line closes the ' +
        'decision before any score exists.'
    );
  }

  if (!blocked && result.selectedScore === null) {
    throw new Error(
      'selectedScore must not be null when trace.blockedBy is empty: a scored decision needs ' +
        'a score.'
    );
  }

  return result;
}
