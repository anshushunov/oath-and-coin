/**
 * The comparator shape every sorted collection in this package takes.
 *
 * Sortedness is not tidiness here, it is a determinism requirement: the
 * canonical artifact walks state's collections in order, so the order has to be
 * a property of the data rather than of how it was built (`TDD` §5.1: "сортировка
 * map/set не может неявно влиять на результат симуляции" — and the way it stops
 * influencing anything implicitly is by being explicit).
 */
export type Comparator<T> = (left: T, right: T) => number;

/**
 * Ordinal string comparison — UTF-16 code units, never the host's locale
 * (`TDD` §7.3). `String.prototype.localeCompare` is the trap this exists to
 * avoid: it answers differently on two machines with the same data.
 */
export const compareStrings: Comparator<string> = (left, right) => {
  if (left < right) {
    return -1;
  }

  return left > right ? 1 : 0;
};

/** Numeric comparison, for the integer-keyed collections state holds. */
export const compareNumbers: Comparator<number> = (left, right) => left - right;
