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

/** A mounted tree, and the two things a test can do to it besides read it. */
export interface Mounted {
  readonly container: HTMLElement;
  /**
   * Renders `element` into the same root, the way a parent re-rendering with new props
   * does.
   *
   * The question this exists for is what a component *keeps* across a prop change and
   * what it throws away — a screen holding a half-filled form has to reset it when the
   * contract underneath changes and hold onto it when a command is merely refused, and
   * neither half is observable from a fresh mount, which starts from nothing either way.
   */
  rerender(element: ReactNode): void;
  /** Unmounts the tree, flushing every effect cleanup React owes it. */
  unmount(): void;
}

/**
 * Mounts `element` into a fresh container attached to the document and answers it.
 *
 * Attached rather than detached: a detached tree lays out as nothing, and Task 15's
 * reachability measurement is about a tree that is actually in a document. Keeping the
 * two the same shape here means the DOM these tests walk is the DOM a browser gets.
 */
export function render(element: ReactNode): HTMLElement {
  return mount(element).container;
}

/**
 * The same mount, with the unmount kept.
 *
 * Almost every test here mounts and reads, which is what {@link render} is for. What
 * needs this one is the question `render` cannot ask: what a component does when it is
 * taken down while something it started is still in flight. That is a property of the
 * cleanup React runs at unmount, and there is no way to observe a cleanup without being
 * able to cause one.
 */
export function mount(element: ReactNode): Mounted {
  const container = document.createElement('div');
  document.body.append(container);

  const root = createRoot(container);
  act(() => {
    root.render(element);
  });

  return {
    container,
    rerender: (next) => {
      act(() => {
        root.render(next);
      });
    },
    unmount: () => {
      act(() => {
        root.unmount();
      });
    }
  };
}

/**
 * Presses a control, flushing whatever React does about it.
 *
 * `element.click()` on its own dispatches the event and returns before React has
 * re-rendered, so an assertion straight after it reads the DOM as it was — the same
 * "passes on the second run" failure `act` exists to prevent.
 */
export function click(element: Element): void {
  act(() => {
    (element as HTMLElement).click();
  });
}

/**
 * Types `value` into a controlled input, the way a person does.
 *
 * Assigning `.value` directly is not enough and the reason is React's own: it patches the
 * value property on the element instance to track what it last rendered, so a plain
 * assignment updates the DOM and leaves React believing nothing changed — the `input`
 * event then carries the *old* value and the component never sees the keystroke. Calling
 * the prototype's setter writes past the patch, which is what makes the event honest.
 */
export function type(element: Element, value: string): void {
  const input = element as HTMLInputElement;
  const setValue = Object.getOwnPropertyDescriptor(
    input instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype,
    'value'
  )?.set;

  if (setValue === undefined) {
    throw new Error('This environment has no value setter on HTMLInputElement.prototype.');
  }

  act(() => {
    setValue.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}
