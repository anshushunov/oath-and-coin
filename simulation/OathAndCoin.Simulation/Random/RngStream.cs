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
