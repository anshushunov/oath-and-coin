import { parseContentId, type ContentId } from '../ids/content-id.ts';

/**
 * The fixed action vocabulary a hero's decision selects from
 * (`DecisionResult.selectedAction`, `DecisionResult.consideredActions`). These are
 * actions, not targets — which hero and which contract a decision concerned is carried
 * by the `DomainEvent` the decision produces, not by the action or by the trace.
 *
 * Declared here as named constants — not `parseContentId('action:accept')` at each call
 * site — for the same reason `ReasonCodes` is: a value assembled ad hoc at one call site
 * drifts from the "same" value assembled independently at another.
 *
 * `action:accept` and `action:decline` are fixed engine actions, never content: no
 * content pack defines an `action:`-namespaced identifier, and a content loader must not
 * try to resolve these against loaded content — by design they do not exist there.
 */

export const Actions = Object.freeze({
  Accept: parseContentId('action:accept'),
  Decline: parseContentId('action:decline')
});

/**
 * Both actions above, in declaration order — the service `REASON_CODES` performs for its
 * own vocabulary, and derived the same way so that a third action cannot exist without
 * being in this list. The presentation layer needs every action the engine can select in
 * order to check that the locale catalogue names each one.
 */
export const ACTIONS: readonly ContentId[] = Object.freeze(Object.values(Actions));
