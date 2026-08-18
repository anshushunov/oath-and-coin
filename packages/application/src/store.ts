/**
 * Forty lines of observable state, and no state library.
 *
 * `ADR-010` §125 asks for a review of every new runtime dependency, and the review of
 * this one is short: what a React screen needs from a store is a snapshot, a
 * subscription and a way to replace the value — which is exactly what
 * `useSyncExternalStore` consumes and exactly what is written below. A library would
 * add selectors, middleware, devtools and immutability helpers to a workspace whose
 * state is already immutable by construction, plus a version to keep pinned and an
 * upgrade to read release notes for.
 *
 * The one property that is not obvious and is therefore tested: a subscriber called
 * during the change would read the old snapshot, and every consumer of this store is
 * written on the assumption that it does not. `useSyncExternalStore` re-reads the
 * snapshot the moment it is notified; a store that notified first would hand React the
 * previous value and then never notify again, which shows up as a screen that is one
 * step behind and nowhere else.
 */

export interface Store<TState> {
  /** The current value. Stable between changes, so a consumer may compare by identity. */
  snapshot(): TState;
  /**
   * Registers `listener`, and answers the call that removes it.
   *
   * The listener takes no argument on purpose: it is a notification, not a delivery.
   * A listener handed the new value could act on a value the store has already moved
   * past, and the two would disagree with no way to tell which was current.
   */
  subscribe(listener: () => void): () => void;
  /** Replaces the value and notifies every subscriber — in that order. */
  replace(next: TState): void;
}

export function createStore<TState>(initial: TState): Store<TState> {
  let current = initial;
  const listeners = new Set<() => void>();

  return {
    snapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener);

      return () => {
        listeners.delete(listener);
      };
    },
    replace: (next) => {
      if (Object.is(next, current)) {
        // Nothing moved, so nothing is announced. A store that notified anyway would
        // make every subscriber re-render on a no-op, and the cheapest way to find out
        // would be a profiler rather than a test.
        return;
      }

      current = next;

      // Who is notified about a change is decided when the change happens, and the two
      // halves of that are separate.
      //
      // The copy fixes the audience: a listener that subscribes *during* a notification
      // is not told about the change it was not yet watching for. Iterating the live set
      // would tell it, and it would then see the same change twice — once as the
      // notification and once as whatever made it subscribe.
      //
      // The membership test is the other direction: a listener that unsubscribed while
      // this notification was running is not called after it left. React unsubscribes on
      // unmount, and a component unmounting in response to an earlier listener is
      // ordinary.
      //
      // Neither is what a `Set` gives for free, and only one of them looks like it might
      // be. A `Set` iterator does survive an element deleting *itself*, which was the
      // first justification written here and was wrong — a mutant that removed the copy
      // stayed green against a test built on that claim.
      for (const listener of [...listeners]) {
        if (listeners.has(listener)) {
          listener();
        }
      }
    }
  };
}
