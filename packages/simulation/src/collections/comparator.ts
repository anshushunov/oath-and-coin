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

/**
 * Orders a closed vocabulary by **where its members were declared**, not by how they are
 * spelled — the ordering `compareNeedIds` is (`RESOLUTION_SPEC` §2.1).
 *
 * A declared order is a designer's statement about a vocabulary; an ordinal one is a
 * statement about its spelling, and the two agree only until a literal is added that
 * breaks the coincidence. On the three needs shipped today they *do* agree, which is
 * precisely why this is a function rather than three lines inside `need-id.ts`: a rule
 * that cannot be told apart from `compareStrings` on the only data that exists is a rule
 * with no test, and here it can be exercised on a vocabulary chosen to disagree
 * (`comparator.test.ts`).
 *
 * Throws on a value the vocabulary does not hold, rather than sorting it to one end. The
 * type forbids that value; the type is a compile-time claim, and a need arrives from a
 * content file and from a save. Sorting it silently would invent an order nobody wrote,
 * and two unknown members would compare *equal* — which `SortedMap.from` reads as a
 * duplicate key.
 */
export function byDeclarationOrder<T>(values: readonly T[]): Comparator<T> {
  const position = new Map(values.map((value, index) => [value, index]));

  const positionOf = (value: T): number => {
    const index = position.get(value);

    if (index === undefined) {
      throw new Error(`Value ${String(value)} is not part of this vocabulary.`);
    }

    return index;
  };

  return (left, right) => positionOf(left) - positionOf(right);
}
