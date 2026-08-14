using System.Collections.Immutable;

namespace OathAndCoin.Presentation;

/// <summary>
/// One row of the gate 0 spike screen: which hero, what they chose, the
/// score that decided it, and the reasons a player would read for and
/// against — already ranked (see
/// <see cref="SpikeScreenModelFactory.FromOutcome"/>), never in whatever
/// order the trace happened to compute them.
/// </summary>
/// <param name="HeroDefinition">
/// The hero's content id text (e.g. <c>"core:zara"</c>), not a
/// <see cref="OathAndCoin.Simulation.Ids.ContentId"/>: this type is read by
/// both a .NET tool process and, eventually, a screen — a plain string keeps
/// it usable on both sides without either one depending on the simulation's
/// identifier type.
/// </param>
/// <param name="Action">The chosen action's content id text (see <see cref="OathAndCoin.Simulation.Decisions.Actions"/>).</param>
/// <param name="Score">The score that decided the action (<see cref="OathAndCoin.Simulation.Decisions.DecisionResult.SelectedScore"/>).</param>
/// <param name="For">Reason codes that pulled toward the chosen action, strongest first.</param>
/// <param name="Against">Reason codes that pulled against it, strongest first.</param>
public sealed record SpikeScreenLine(
    string HeroDefinition,
    string Action,
    int Score,
    ImmutableArray<string> For,
    ImmutableArray<string> Against);

/// <summary>
/// The whole gate 0 spike screen, as data — engine-free on purpose (spec:
/// runtime harness). A tool process builds this from
/// <see cref="OathAndCoin.Content.Scenarios.ScenarioOutcome"/> to know what
/// the screen is supposed to show; the running game builds the same shape
/// from the same outcome to know what it actually put on screen.
/// </summary>
/// <param name="Title">The screen's title text.</param>
/// <param name="Lines">One line per decision, in the order the scenario made them.</param>
/// <param name="ErrorCode">
/// A stable, machine-comparable identifier (e.g. <c>"CONTENT_ROOT_NOT_FOUND"</c>)
/// when the run could not produce a screen at all; <c>null</c> on a normal
/// run. Never null together with a non-empty <see cref="ErrorDetail"/>.
/// </param>
/// <param name="ErrorDetail">
/// The human-readable half of an error — an OS message, an absolute path, or
/// both. Deliberately excluded from every hash this type has
/// (<see cref="SpikeScreenModelFactory.ReadModelHash"/>): it is localized,
/// carries machine-specific paths, and differs between runs of the same
/// failure, so hashing it would make "the same error" look like a mismatch.
/// </param>
public sealed record SpikeScreenModel(
    string Title,
    ImmutableArray<SpikeScreenLine> Lines,
    string? ErrorCode,
    string? ErrorDetail);
