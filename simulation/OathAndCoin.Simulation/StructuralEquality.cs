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

    public static int EntriesHash<TKey, TValue>(ImmutableSortedDictionary<TKey, TValue>? entries)
        where TKey : notnull
    {
        if (entries is null)
        {
            return 0;
        }

        var hash = default(HashCode);
        hash.Add(entries.Count);
        foreach (var entry in entries)
        {
            hash.Add(entry.Key);
            hash.Add(entry.Value);
        }

        return hash.ToHashCode();
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

    public static int MembersHash<T>(ImmutableSortedSet<T>? members)
    {
        if (members is null)
        {
            return 0;
        }

        var hash = default(HashCode);
        hash.Add(members.Count);
        foreach (var member in members)
        {
            hash.Add(member);
        }

        return hash.ToHashCode();
    }
}
