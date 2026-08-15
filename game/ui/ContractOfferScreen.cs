using System.Collections.Immutable;
using System.Globalization;
using Godot;
using OathAndCoin.Presentation;

namespace OathAndCoin.Game.Ui;

/// <summary>
/// The first product screen: a rendering of a <see cref="ContractOfferScreenModel"/>,
/// built entirely from that model and a <see cref="TextSource"/> — the
/// model's only two inputs, so nothing this screen shows can disagree with
/// either the model <c>Main</c> already computed or the catalogue that ships
/// with the game. Replaces <c>SpikeScreen</c>, whose own comment named this
/// screen's arrival as the condition for its removal.
/// </summary>
/// <remarks>
/// <para>
/// <b>This screen decides nothing itself.</b> Every field the model carries
/// becomes at most one label, in a fixed order, with no branch on a field's
/// value beyond <see cref="ContractOfferScreenModel.State"/> deciding which
/// blocks exist at all — the same "any other branch means the model was
/// incomplete" rule <see cref="ContractOfferScreenModelFactory"/> is held to.
/// Reading <see cref="ScreenStateKeys.For"/> off <c>State</c> is exactly that
/// one allowed branch, not an exception to it.
/// </para>
/// <para>
/// <b>No raw identifier ever becomes a label.</b> Every field that is
/// actually a localization key — <see cref="ContractOfferScreenModel.TitleKey"/>,
/// the screen-state key, a display-name key (including
/// <see cref="ResponseLine.HeroDisplayNameKey"/>, joined onto a response by
/// its hero's own id rather than carried as one — see that field's remarks),
/// a tag key, a reason code, a reason's own source name when it has one
/// worth showing (<see cref="ReasonLine.SourceDisplayNameKey"/> — <c>null</c>
/// for the codes whose source is already on screen some other way, per that
/// field's remarks; this screen shows it exactly when it is not null, which
/// is a branch on that model fact, never on <see cref="ReasonLine.ReasonCode"/>
/// itself), an action, whether the hero wavered, the error code, and a
/// <see cref="QualitativeGrade"/> by way of <see cref="QualitativeScale.KeyFor"/> —
/// is resolved to player-facing text before it becomes a <see cref="Label"/>.
/// A field that carries a raw
/// content id purely for the model's own bookkeeping
/// (<see cref="ContractLine.Definition"/>, <see cref="HeroCard.Definition"/>,
/// <see cref="ResponseLine.HeroDefinition"/>, <see cref="ReasonLine.SourceEntity"/>,
/// <see cref="ResponseLine.BlockedByEntity"/>) is not shown at all — it is not
/// a name a player reads, showing it next to the resolved name it duplicates
/// would be exactly the raw-identifier leak TDD §11.1 forbids, and
/// <see cref="ContractOfferScreenModelFactory.ReadModelHash"/> already hashes
/// it without any help from this screen. The two objective numbers spec
/// calls out on purpose — <see cref="ContractLine.Payment"/>,
/// <see cref="ContractLine.RequiredCrew"/>/<see cref="ContractLine.AcceptedCount"/> —
/// are the one kind of value this screen still shows literally, because they
/// were never a key to resolve in the first place.
/// </para>
/// <para>
/// <b>Node order is the wire format.</b> <see cref="Render"/> adds exactly
/// one <see cref="Label"/> per text
/// <see cref="RenderedUiSnapshot.Expected(ContractOfferScreenModel, System.Collections.Generic.IReadOnlyDictionary{string,string})"/>
/// puts in its list, in the same order, and nothing else — an extra label
/// would show up in <see cref="Snapshot"/> and break every hash comparison
/// the runtime harness makes. There is no exception:
/// <see cref="ContractOfferScreenModel.ErrorDetail"/> does not reach this
/// screen at all. It carried a machine's absolute path and an exception's own
/// text — assembled in code, never resolved from the catalogue — and it
/// arrived as a tooltip, which neither hash covers by design, so nothing
/// could have noticed. The error's own key names the failure to the player;
/// the detail belongs to <c>report.json</c> and <c>run.log</c>.
/// </para>
/// </remarks>
public sealed partial class ContractOfferScreen : VBoxContainer
{
    private bool _rendered;

    /// <summary>
    /// Builds this screen's whole node tree from <paramref name="model"/>,
    /// resolving every locale key through <paramref name="textSource"/>.
    /// Called exactly once, right after construction — this type is a single,
    /// disposable view over one model, never rebound to a second one.
    /// </summary>
    public void Render(ContractOfferScreenModel model, TextSource textSource)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(textSource);

        if (_rendered)
        {
            throw new InvalidOperationException(
                $"{nameof(ContractOfferScreen)}.{nameof(Render)} was already called once; this screen has no "
                + "second model to show.");
        }

        _rendered = true;

        AddChild(BuildLabel(textSource.Resolve(model.TitleKey)));
        AddChild(BuildLabel(textSource.Resolve(ScreenStateKeys.For(model.State))));

        if (model.ErrorCode is not null)
        {
            // ErrorDetail deliberately does not reach the screen. It is
            // assembled in code — an absolute path off this machine, the raw
            // text of an exception — and a string a player reads that was
            // built in code rather than resolved from the catalogue is
            // exactly what TDD §11.1 forbids. It used to arrive here as the
            // label's tooltip, where no check could see it: both hashes
            // exclude the detail on purpose, so the one player-facing string
            // in the whole screen that was never localized was also the one
            // string nothing compared. The allowed error key already names
            // the failure; the detail stays in the report and the log, which
            // is where a developer reads it and a player does not.
            AddChild(BuildLabel(textSource.Resolve(ErrorKeys.For(model.ErrorCode))));
        }

        if (model.Contract is { } contract)
        {
            AddChild(BuildContractLine(contract, textSource));
        }

        // Roster and responses side by side, not stacked one after the
        // other: review finding — a single vertical stack of six hero cards
        // followed by up to six response blocks ran well past the window's
        // fixed 720px height, and the captured frame is this proof's only
        // evidence a person can actually read the screen. It cut off before
        // a single response line, which is exactly backwards — a response
        // and its reasons are what the milestone is meant to prove a tester
        // notices. Two columns share the same fixed height instead of
        // spending all of it on the roster first; CollectTexts still visits
        // every roster label before every response label (a depth-first walk
        // does not care which container a subtree hangs off), so this is a
        // layout change only — the text order RenderedUiSnapshot.Expected
        // expects is unchanged.
        if (!model.Roster.IsEmpty || !model.Responses.IsEmpty)
        {
            var columns = new HBoxContainer();

            var rosterColumn = new VBoxContainer();
            foreach (var hero in model.Roster)
            {
                rosterColumn.AddChild(BuildHeroCard(hero, textSource));
            }

            var responsesColumn = new VBoxContainer();
            foreach (var response in model.Responses)
            {
                responsesColumn.AddChild(BuildResponseLine(response, textSource));
            }

            columns.AddChild(rosterColumn);
            columns.AddChild(responsesColumn);
            AddChild(columns);
        }
    }

    /// <summary>
    /// Walks this screen's own control tree in node order — the order
    /// <see cref="Render"/> added children in, which <see cref="GetChildren"/>
    /// preserves exactly — collecting every <see cref="Label.Text"/> it finds.
    /// This is what a tool compares against the expected snapshot: proof that
    /// the model this screen was given actually reached its controls, not a
    /// second projection of the model that could agree with the first by
    /// construction and mean nothing.
    /// </summary>
    public RenderedUiSnapshot Snapshot()
    {
        var texts = ImmutableArray.CreateBuilder<string>();
        CollectTexts(this, texts);
        return new RenderedUiSnapshot(texts.ToImmutable());
    }

    private static VBoxContainer BuildContractLine(ContractLine contract, TextSource textSource)
    {
        var block = new VBoxContainer();
        block.AddChild(BuildLabel(textSource.Resolve(contract.DisplayNameKey)));
        block.AddChild(BuildLabel(contract.Payment.ToString(CultureInfo.InvariantCulture)));
        block.AddChild(BuildLabel(textSource.Resolve(QualitativeScale.KeyFor(contract.Risk))));

        foreach (var tagKey in contract.TagKeys)
        {
            block.AddChild(BuildLabel(textSource.Resolve(tagKey)));
        }

        block.AddChild(BuildLabel(contract.RequiredCrew.ToString(CultureInfo.InvariantCulture)));
        block.AddChild(BuildLabel(contract.AcceptedCount.ToString(CultureInfo.InvariantCulture)));

        return block;
    }

    private static VBoxContainer BuildHeroCard(HeroCard hero, TextSource textSource)
    {
        var block = new VBoxContainer();
        block.AddChild(BuildLabel(textSource.Resolve(hero.DisplayNameKey)));
        block.AddChild(BuildLabel(textSource.Resolve(QualitativeScale.KeyFor(hero.Greed))));
        block.AddChild(BuildLabel(textSource.Resolve(QualitativeScale.KeyFor(hero.Caution))));
        block.AddChild(BuildLabel(textSource.Resolve(QualitativeScale.KeyFor(hero.Pride))));

        foreach (var key in hero.PrincipleKeys)
        {
            block.AddChild(BuildLabel(textSource.Resolve(key)));
        }

        foreach (var key in hero.InclinationKeys)
        {
            block.AddChild(BuildLabel(textSource.Resolve(key)));
        }

        return block;
    }

    private static VBoxContainer BuildResponseLine(ResponseLine response, TextSource textSource)
    {
        var block = new VBoxContainer();
        block.AddChild(BuildLabel(textSource.Resolve(response.HeroDisplayNameKey)));
        block.AddChild(BuildLabel(textSource.Resolve(ActionKeys.For(response.Action))));

        foreach (var reason in response.Reasons)
        {
            block.AddChild(BuildLabel(textSource.Resolve(reason.ReasonCode)));

            // A branch on whether this specific reason carries a source
            // worth naming — a model fact (ReasonLine.SourceDisplayNameKey),
            // never a branch on reason.ReasonCode itself. See that field's
            // remarks: PaymentAttractive/RiskTooHigh name the contract,
            // TrustsTheGuild/UnpredictableMood name the responding hero,
            // both already on screen, so the factory leaves this null for
            // them rather than the screen deciding to skip it by code.
            if (reason.SourceDisplayNameKey is not null)
            {
                block.AddChild(BuildLabel(textSource.Resolve(reason.SourceDisplayNameKey)));
            }

            // Which way this reason pulled relative to the answer above it —
            // read off the model (ReasonLine.Direction), never worked out
            // here from response.Action, for the reason that field's own
            // remarks give.
            block.AddChild(BuildLabel(textSource.Resolve(ReasonDirectionKeys.For(reason.Direction))));
            block.AddChild(BuildLabel(textSource.Resolve(QualitativeScale.KeyFor(reason.Strength))));
        }

        // Same shape as a reason's source above: a branch on the model fact
        // ResponseLine.BlockedByDisplayNameKey (null exactly when nothing
        // blocked this hero), never on any code. HERO_DECISION_SPEC §3 and §4.2: a block names
        // its principle so the screen does not have to guess one from the
        // hero alone, and stays its own line so "too risky" reads
        // differently from "will not do this at all".
        if (response.BlockedByDisplayNameKey is not null)
        {
            block.AddChild(BuildLabel(textSource.Resolve(response.BlockedByDisplayNameKey)));
        }

        block.AddChild(BuildLabel(textSource.Resolve(WaveredKeys.For(response.Wavered))));

        return block;
    }

    private static Label BuildLabel(string text) => new() { Text = text };

    private static void CollectTexts(Node node, ImmutableArray<string>.Builder texts)
    {
        if (node is Label label)
        {
            texts.Add(label.Text);
        }

        foreach (var child in node.GetChildren())
        {
            CollectTexts(child, texts);
        }
    }
}
