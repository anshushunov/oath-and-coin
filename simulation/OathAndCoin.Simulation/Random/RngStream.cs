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
/// Independent RNG streams (TDD §7.2). Separating draws by stream means a
/// change in one subsystem's draw count (e.g. combat) never perturbs another
/// subsystem's sequence (e.g. hero decisions), because the stream value is
/// mixed into the key before any ordinal is applied.
/// </summary>
public enum RngStream
{
    WorldGeneration = 0,
    WorldTick = 1,
    ContractGeneration = 2,
    HeroDecision = 3,
    ExpeditionEvent = 4,
    Combat = 5,
    CosmeticPresentation = 6,
}
