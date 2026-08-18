import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';

/**
 * Mounting a component into a jsdom document, with no testing library between.
 *
 * `ADR-010` §125 asks for a review of every dependency, and the review of the obvious
 * one is short: what these tests need is a container, a mount and a way to read the
 * DOM back, which is thirty lines. A query library would add a matcher vocabulary and
 * an accessibility model to tests whose entire question is "which text nodes exist,
 * in which order" — a question its queries are designed to abstract away from.
 *
 * `act` is not optional here. Without it React 19 warns and, worse, may not have
 * flushed the render by the time the assertions read the container, which produces a
 * test that passes on the second run and fails on a slower machine.
 */

/** React refuses to run `act` unless the environment says it is a test one. */
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/**
 * Mounts `element` into a fresh container attached to the document and answers it.
 *
 * Attached rather than detached: a detached tree lays out as nothing, and Task 15's
 * reachability measurement is about a tree that is actually in a document. Keeping the
 * two the same shape here means the DOM these tests walk is the DOM a browser gets.
 */
export function render(element: ReactNode): HTMLElement {
  const container = document.createElement('div');
  document.body.append(container);

  const root = createRoot(container);
  act(() => {
    root.render(element);
  });

  return container;
}
