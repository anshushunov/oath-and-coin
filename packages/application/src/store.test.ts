import { describe, expect, it } from 'vitest';

import { createStore } from './store.ts';

/**
 * Forty lines of store, and every one of the four properties a consumer relies on.
 *
 * `useSyncExternalStore` re-reads the snapshot the moment it is notified, so three of
 * these are not style questions: a store that notified before applying would hand React
 * the previous value and never notify again, a store that notified on a no-op would
 * re-render everything for nothing, and a store that iterated its own listener set
 * would skip the listener after one that unsubscribed on unmount. All three show up as
 * a screen that is subtly wrong rather than as an error.
 */

describe('createStore', () => {
  it('answers the value it was created with', () => {
    expect(createStore('first').snapshot()).toBe('first');
  });

  it('applies the change before it announces it', () => {
    // The one that matters. A listener is a notification, not a delivery — so the only
    // way it can learn the new value is by reading the snapshot, and the snapshot has
    // to be the new one by then.
    const store = createStore('first');
    const seen: string[] = [];
    store.subscribe(() => {
      seen.push(store.snapshot());
    });

    store.replace('second');

    expect(seen).toEqual(['second']);
  });

  it('says nothing when the value did not move', () => {
    const store = createStore('first');
    let notifications = 0;
    store.subscribe(() => {
      notifications++;
    });

    store.replace('first');

    expect(notifications).toBe(0);
    expect(store.snapshot()).toBe('first');
  });

  it('stops notifying a listener that unsubscribed', () => {
    const store = createStore(0);
    let notifications = 0;
    const unsubscribe = store.subscribe(() => {
      notifications++;
    });

    store.replace(1);
    unsubscribe();
    store.replace(2);

    expect(notifications).toBe(1);
    expect(store.snapshot()).toBe(2);
  });

  it('notifies every listener even when one unsubscribes during the notification', () => {
    // React unsubscribes on unmount, and a component unmounting in response to a change
    // is ordinary. Iterating the live set would drop whichever listener happened to
    // follow it — for that one change only, which is the hardest kind of bug to see.
    const store = createStore(0);
    const notified: string[] = [];
    const unsubscribeFirst = store.subscribe(() => {
      notified.push('first');
      unsubscribeFirst();
    });
    store.subscribe(() => {
      notified.push('second');
    });

    store.replace(1);

    expect(notified).toEqual(['first', 'second']);
  });

  it('keeps the snapshot stable between changes, so a consumer may compare by identity', () => {
    const value = { screen: 'loading' };
    const store = createStore(value);

    expect(store.snapshot()).toBe(store.snapshot());
    expect(store.snapshot()).toBe(value);
  });
});
