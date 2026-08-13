using System.Collections.Immutable;

namespace OathAndCoin.Simulation;

/// <summary>
/// Element-wise equality and hashing for the immutable collections campaign
/// state is built from.
/// </summary>
/// <remarks>
/// None of the BCL immutable collections used here override
/// <see cref="object.Equals(object?)"/>:
/// <see cref="ImmutableArray{T}"/> compares its <em>backing array</em> by
/// reference, and <see cref="ImmutableSortedDictionary{TKey,TValue}"/> /
/// <see cref="ImmutableSortedSet{T}"/> inherit plain reference equality. A
/// record that holds one of them therefore gets a compiler-generated
/// <c>Equals</c> that says "not equal" for two independently built values
/// with identical contents — and, worse, says "equal" when both happen to
/// hold the same shared <c>Empty</c> singleton. That inconsistency makes a
/// save/load round-trip test pass on a trivial fixture and start failing only
/// once a real explanation with real factors exists, which is the exact
/// moment the test was supposed to be protecting.
///
/// Every record in this assembly that holds a collection routes its
/// <c>Equals</c>/<c>GetHashCode</c> through this class, so state equality is
/// one rule rather than per-type ad-hoc helpers.
///
/// The hash codes produced here are process-local (<see cref="HashCode"/> is
/// randomly seeded per process, as is <see cref="string"/> hashing). That is
/// not a determinism problem: every collection in state is a <em>sorted</em>
/// one, so no enumeration order, no persisted artifact and no simulation
/// outcome ever depends on a hash code. Hashing is only ever used to satisfy
/// the <c>Equals</c>/<c>GetHashCode</c> contract inside a single run.
/// </remarks>
internal static class StructuralEquality
{
    /// <summary>
    /// Compares two <see cref="ImmutableArray{T}"/> values element by
    /// element. <c>default(ImmutableArray&lt;T&gt;)</c> is handled explicitly
    /// (it is an uninitialized struct, and touching its backing storage
    /// throws) and is only ever equal to another uninitialized array.
    /// </summary>
    public static bool ElementsEqual<T>(ImmutableArray<T> left, ImmutableArray<T> right)
    {
        if (left.IsDefault || right.IsDefault)
        {
            return left.IsDefault && right.IsDefault;
        }

        return left.Length == right.Length && left.SequenceEqual(right);
    }

    /// <summary>
    /// Hashes an array in order — deliberately, unlike
    /// <see cref="EntriesHash"/> and <see cref="MembersHash"/>.
    /// <see cref="ElementsEqual"/> compares element by element in sequence,
    /// so two arrays holding the same elements in a different order are
    /// <em>not</em> equal and are free to hash differently. Order sensitivity
    /// here is what matches equality; there it is what breaks it.
    /// </summary>
    public static int ElementsHash<T>(ImmutableArray<T> values)
    {
        if (values.IsDefault)
        {
            return 0;
        }

        var hash = default(HashCode);
        hash.Add(values.Length);
        foreach (var value in values)
        {
            hash.Add(value);
        }

        return hash.ToHashCode();
    }

    /// <summary>
    /// Compares two sorted dictionaries by key/value content. Lookup by key
    /// rather than pairwise enumeration, so the result does not silently
    /// depend on the two instances having been built with the same key
    /// comparer.
    /// </summary>
    public static bool EntriesEqual<TKey, TValue>(
        ImmutableSortedDictionary<TKey, TValue>? left,
        ImmutableSortedDictionary<TKey, TValue>? right)
        where TKey : notnull
    {
        if (ReferenceEquals(left, right))
        {
            return true;
        }

        if (left is null || right is null || left.Count != right.Count)
        {
            return false;
        }

        foreach (var entry in left)
        {
            if (!right.TryGetValue(entry.Key, out var otherValue)
                || !EqualityComparer<TValue>.Default.Equals(entry.Value, otherValue))
            {
                return false;
            }
        }

        return true;
    }

    /// <summary>
    /// Hashes a sorted dictionary <em>independently of enumeration order</em>,
    /// to match <see cref="EntriesEqual"/>, which compares by key lookup and
    /// therefore does not depend on order either.
    /// </summary>
    /// <remarks>
    /// A sorted dictionary enumerates in the order its key comparer defines,
    /// so folding entries into a <see cref="HashCode"/> one after another made
    /// the hash a function of the comparer. Two dictionaries with identical
    /// keys and values, one built with the natural comparer and one with the
    /// reverse of it, then compared equal and hashed differently — which
    /// breaks the <c>Equals</c>/<c>GetHashCode</c> contract outright and, in
    /// practice, makes such a value unfindable in the very
    /// <see cref="HashSet{T}"/> or <see cref="Dictionary{TKey,TValue}"/> it
    /// was just put into. Banning non-default comparers was the alternative;
    /// it was rejected because it turns a mistake that can simply not exist
    /// into a run-time exception, and because nothing else in state cares
    /// which comparer built a collection.
    ///
    /// Per-entry hashes are combined with <em>addition</em> in an
    /// <c>unchecked</c> context rather than XOR. Both are commutative, but
    /// XOR cancels: two entries that hash alike contribute nothing at all,
    /// so a dictionary containing a duplicated pair would hash like one
    /// without it. Addition keeps multiplicity. The entry count is mixed
    /// in afterwards, once, so the count itself does not depend on order
    /// either and collections of different sizes do not collide as readily.
    /// </remarks>
    public static int EntriesHash<TKey, TValue>(ImmutableSortedDictionary<TKey, TValue>? entries)
        where TKey : notnull
    {
        if (entries is null)
        {
            return 0;
        }

        var accumulated = 0;
        foreach (var entry in entries)
        {
            accumulated = unchecked(accumulated + HashCode.Combine(entry.Key, entry.Value));
        }

        return HashCode.Combine(entries.Count, accumulated);
    }

    public static bool MembersEqual<T>(ImmutableSortedSet<T>? left, ImmutableSortedSet<T>? right)
    {
        if (ReferenceEquals(left, right))
        {
            return true;
        }

        if (left is null || right is null || left.Count != right.Count)
        {
            return false;
        }

        return left.SetEquals(right);
    }

    /// <summary>
    /// Hashes a sorted set <em>independently of enumeration order</em>, to
    /// match <see cref="MembersEqual"/>, which uses
    /// <see cref="ImmutableSortedSet{T}.SetEquals"/> and therefore does not
    /// depend on order. Same reasoning, same commutative accumulation as
    /// <see cref="EntriesHash"/> — see its remarks.
    /// </summary>
    public static int MembersHash<T>(ImmutableSortedSet<T>? members)
    {
        if (members is null)
        {
            return 0;
        }

        var accumulated = 0;
        foreach (var member in members)
        {
            accumulated = unchecked(accumulated + HashCode.Combine(member));
        }

        return HashCode.Combine(members.Count, accumulated);
    }
}
