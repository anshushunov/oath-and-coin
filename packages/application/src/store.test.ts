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

  it('does not notify a listener that subscribed during the notification', () => {
    // The audience for a change is fixed when the change happens. A listener told about
    // a change it was not yet watching for would see that change twice — once here and
    // once as whatever made it subscribe.
    const store = createStore(0);
    const notified: string[] = [];
    store.subscribe(() => {
      notified.push('first');
      store.subscribe(() => {
        notified.push('late');
      });
    });

    store.replace(1);
    expect(notified).toEqual(['first']);

    // ...and it is in the audience for the next one, so this is a rule about timing
    // rather than a listener quietly dropped. Second in that round because it
    // subscribed second; the first listener subscribes yet another one, which waits
    // its own turn in the same way.
    store.replace(2);
    expect(notified).toEqual(['first', 'first', 'late']);
  });

  it('does not notify a listener that another listener unsubscribed mid-notification', () => {
    // The other direction, and the reason the membership test exists beside the copy.
    // React unsubscribes on unmount, and a component unmounting in response to an
    // earlier listener is ordinary; calling it afterwards is calling something that has
    // said it is gone.
    const store = createStore(0);
    const notified: string[] = [];
    store.subscribe(() => {
      notified.push('first');
      unsubscribeSecond();
    });
    const unsubscribeSecond = store.subscribe(() => {
      notified.push('second');
    });

    store.replace(1);

    expect(notified).toEqual(['first']);
  });

  it('keeps the snapshot stable between changes, so a consumer may compare by identity', () => {
    const value = { screen: 'loading' };
    const store = createStore(value);

    expect(store.snapshot()).toBe(store.snapshot());
    expect(store.snapshot()).toBe(value);
  });
});
