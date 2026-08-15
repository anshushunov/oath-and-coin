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
/// the screen-state key, a display-name key, a tag key, a reason code, an
/// action, whether the hero wavered, the error code, and a
/// <see cref="QualitativeGrade"/> by way of <see cref="QualitativeScale.KeyFor"/> —
/// is resolved to player-facing text before it becomes a <see cref="Label"/>.
/// A field that carries a raw content id purely for the model's own
/// bookkeeping (<see cref="ContractLine.Definition"/>,
/// <see cref="HeroCard.Definition"/>, <see cref="ResponseLine.HeroDefinition"/>,
/// <see cref="ReasonLine.SourceEntity"/>, <see cref="ResponseLine.BlockedByEntity"/>)
/// is not shown at all — it is not a name a player reads, showing it next to
/// the resolved name it duplicates would be exactly the raw-identifier leak
/// TDD §11.1 forbids, and <see cref="ContractOfferScreenModelFactory.ReadModelHash"/>
/// already hashes it without any help from this screen. The two objective
/// numbers spec calls out on purpose — <see cref="ContractLine.Payment"/>,
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
/// the runtime harness makes. The one exception is
/// <see cref="ContractOfferScreenModel.ErrorDetail"/>: shown, for a person
/// reading the screen, as a <see cref="Label.TooltipText"/> on the resolved
/// error label rather than a second <see cref="Label"/>, because the
/// expected snapshot never includes it (see that method's remarks) and
/// <see cref="Snapshot"/> only ever reads <see cref="Label.Text"/>.
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
            var errorLabel = BuildLabel(textSource.Resolve(ErrorKeys.For(model.ErrorCode)));
            errorLabel.TooltipText = model.ErrorDetail;
            AddChild(errorLabel);
        }

        if (model.Contract is { } contract)
        {
            AddChild(BuildContractLine(contract, textSource));
        }

        foreach (var hero in model.Roster)
        {
            AddChild(BuildHeroCard(hero, textSource));
        }

        foreach (var response in model.Responses)
        {
            AddChild(BuildResponseLine(response, textSource));
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
        block.AddChild(BuildLabel(textSource.Resolve(ActionKeys.For(response.Action))));

        foreach (var reason in response.Reasons)
        {
            block.AddChild(BuildLabel(textSource.Resolve(reason.ReasonCode)));
            block.AddChild(BuildLabel(textSource.Resolve(QualitativeScale.KeyFor(reason.Strength))));
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
