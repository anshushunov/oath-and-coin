// The name of this namespace is load-bearing, not just descriptive.
// `OathAndCoin.Simulation.Random` shadows `System.Random` for every type
// nested anywhere under `OathAndCoin.Simulation`: name lookup finds this
// namespace first, so `new Random()` inside the core does not compile at
// all (CS0118, "Random is a namespace but is used like a type"). That is
// accidental defence in depth on top of the ("System", "Random") entry in
// CoreBoundaryTests.BannedTypes — it fails at build time rather than at
// test time, and it also catches the case where the guard itself is
// weakened. Renaming this namespace removes that protection silently, and
// nothing else in the repository would notice.

namespace OathAndCoin.Simulation.Random;

/// <summary>
/// The result of <see cref="DeterministicRng.DrawInt32"/>: the value drawn,
/// together with how many RNG ordinals producing it actually cost.
/// </summary>
/// <param name="Value">The drawn value, in the requested range.</param>
/// <param name="OrdinalsConsumed">
/// How many ordinals the draw burned, starting at the one passed in. Always
/// at least 1, and more than 1 exactly when rejection sampling had to
/// re-draw (see <see cref="DeterministicRng.AcceptanceThreshold"/>). This is
/// the value to hand to
/// <c>GameState.WithEvent(..., drawsConsumed)</c>.
/// </param>
/// <remarks>
/// <para>
/// This type exists because <see cref="DeterministicRng.DrawInt32"/> used to
/// return a bare <see cref="int"/>. A rejected sample advanced a
/// <em>local</em> ordinal and the extra ordinals it burned were invisible to
/// the caller, who then reported <c>drawsConsumed: 1</c> — the only number
/// available to report. <c>GameState.Metadata.NextDecisionOrdinal</c>
/// therefore landed on an ordinal that had already been drawn <em>and
/// accepted</em>, and the next decision reproduced that exact sample. Because
/// the RNG is a pure function of <c>(seed, stream, ordinal)</c>, nothing
/// anywhere would flag the repeat: replay, save/continue and the golden
/// vectors would all agree with each other and all be wrong about how much
/// randomness the campaign had spent.
/// </para>
/// <para>
/// Pairing the count with the value in one return type is what makes the
/// wrong number the awkward thing to write rather than the thing that falls
/// out of an ordinary call: <c>draw.OrdinalsConsumed</c> is right there next
/// to <c>draw.Value</c>, and a caller who instead types a literal <c>1</c>
/// has to ignore a value it is holding. An <c>out</c> parameter was the
/// alternative; it was rejected because <c>out _</c> and "declare it, never
/// use it" are both quiet, whereas here the count travels with the value it
/// belongs to.
/// </para>
/// </remarks>
public readonly record struct Int32Draw(int Value, ulong OrdinalsConsumed);
