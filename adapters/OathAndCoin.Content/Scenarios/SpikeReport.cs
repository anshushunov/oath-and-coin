using System.Globalization;
using System.Text;
using OathAndCoin.Simulation.Decisions;
using OathAndCoin.Simulation.State;

namespace OathAndCoin.Content.Scenarios;

/// <summary>
/// The human-readable half of a run's output (spec §8.6): what each hero
/// decided and why, for the person who has to judge whether the decisions make
/// sense as a game.
/// </summary>
/// <remarks>
/// Explicitly not the artifact determinism is measured on. This text exists to
/// be reworded as the game gets clearer, and a determinism check pinned to it
/// would report every rewording as a reproducibility failure — while a check
/// pinned to the canonical artifact stays silent about wording and loud about
/// behaviour.
///
/// Reason codes are printed raw. They are localization keys (see
/// <see cref="ReasonCodes"/>), and a report that invented English sentences for
/// them here would be a second, untranslated copy of text that belongs in the
/// localization table.
/// </remarks>
public static class SpikeReport
{
    public static string Render(ScenarioOutcome outcome)
    {
        ArgumentNullException.ThrowIfNull(outcome);

        var report = new StringBuilder();

        // "\n", not Environment.NewLine: the report is written to a file that
        // gets attached to bug reports and diffed between machines.
        report.Append("Oath & Coin — Gate 0 spike\n");
        Line(report, $"seed:    {outcome.FinalState.Metadata.CampaignSeed.ToString(CultureInfo.InvariantCulture)}");
        Line(report, $"ruleset: {outcome.FinalState.Metadata.RulesetVersion}");
        Line(report, $"content: {outcome.FinalState.Metadata.ContentVersion}");
        Line(report, string.Empty);

        foreach (var step in outcome.Steps)
        {
            var stepNumber = step.Command.CommandId.ToString(CultureInfo.InvariantCulture);

            if (!step.Applied || step.Decision is null)
            {
                Line(report, $"command {stepNumber}: refused — {step.RejectionCode}");
                Line(report, string.Empty);
                continue;
            }

            var hero = step.HeroDefinition?.Value ?? "unknown hero";
            var action = step.Decision.SelectedAction.Value;

            // A red line (Trace.BlockedBy non-empty) closes the decision
            // before any score exists (DecisionResult's own invariant) — the
            // principle that closed it is the one thing worth naming here,
            // not a placeholder score.
            if (step.Decision.Trace.BlockedBy.IsEmpty)
            {
                var score = step.Decision.SelectedScore!.Value.ToString(CultureInfo.InvariantCulture);
                Line(report, $"command {stepNumber}: {hero} chose {action} (score {score})");
                AppendFactors(report, "  for:     ", step.Decision.Trace.PositiveFactors);
                AppendFactors(report, "  against: ", step.Decision.Trace.NegativeFactors);
            }
            else
            {
                var principle = step.Decision.Trace.BlockedBy[0];
                Line(
                    report,
                    $"command {stepNumber}: {hero} chose {action} "
                    + $"(blocked by {principle.ReasonCode}, from {principle.SourceEntity.Value})");
            }

            Line(report, string.Empty);
        }

        foreach (var contract in outcome.FinalState.Contracts.Values)
        {
            var status = contract.Status == ContractStatus.Crewed ? "crewed" : "still on offer";
            var crewCount = contract.AcceptedBy.Count.ToString(CultureInfo.InvariantCulture);
            var requiredCrew = contract.RequiredCrew.ToString(CultureInfo.InvariantCulture);
            Line(report, $"contract {contract.Id.Value}: {status} ({crewCount}/{requiredCrew} crewed)");
        }

        return report.ToString();
    }

    private static void AppendFactors(
        StringBuilder report,
        string prefix,
        System.Collections.Immutable.ImmutableArray<TraceFactor> factors)
    {
        if (factors.IsEmpty)
        {
            return;
        }

        var rendered = factors.Select(factor =>
            $"{factor.ReasonCode} ({factor.Magnitude.ToString(CultureInfo.InvariantCulture)}, "
            + $"from {factor.SourceEntity.Value})");

        Line(report, prefix + string.Join(", ", rendered));
    }

    private static void Line(StringBuilder report, string text) => report.Append(text).Append('\n');
}
