using System.Collections.Immutable;
using System.Globalization;
using Godot;
using OathAndCoin.Presentation;

namespace OathAndCoin.Game.Ui;

/// <summary>
/// A diagnostic rendering of a <see cref="ContractOfferScreenModel"/>, built
/// entirely in code — the type's only input; this class never reaches into
/// <c>GameState</c> or reloads content, so nothing it shows can disagree with
/// the model <c>Main</c> already computed.
/// </summary>
/// <remarks>
/// <para>
/// <b>This screen is diagnostic, not a product screen.</b> It shows every
/// key and qualitative grade the model carries verbatim — reason codes,
/// tag keys, localization keys — rather than resolved, localized text. It
/// exists only to prove the runtime harness's pipeline — that a model built
/// off-engine and a model built by the running game agree, and that the
/// second one actually reached the screen (see <see cref="Snapshot"/>). The
/// real contract-offer screen, resolving these keys through a locale
/// catalogue, is a later task's work.
/// </para>
/// <para>
/// <b>Node order is the wire format.</b> <see cref="Render"/> adds exactly
/// one <see cref="Label"/> per text <see cref="RenderedUiSnapshot.Expected"/>
/// puts in its list, in the same order, and nothing else — an extra label
/// (a caption, a separator) would show up in <see cref="Snapshot"/> and break
/// every hash comparison the runtime harness makes. The one exception is
/// <see cref="ContractOfferScreenModel.ErrorDetail"/>: it is shown, for a
/// person reading the screen, but as a <see cref="Label.TooltipText"/> rather
/// than a second <see cref="Label"/>, because <see cref="RenderedUiSnapshot.Expected"/>
/// never includes it (see that method's remarks) and <see cref="Snapshot"/>
/// only ever reads <see cref="Label.Text"/>.
/// </para>
/// </remarks>
public sealed partial class SpikeScreen : VBoxContainer
{
    private bool _rendered;

    /// <summary>
    /// Builds this screen's whole node tree from <paramref name="model"/>.
    /// Called exactly once, right after construction — this type is a single,
    /// disposable view over one model, never rebound to a second one, so
    /// there is no "clear and rebuild" path to keep correct.
    /// </summary>
    public void Render(ContractOfferScreenModel model)
    {
        ArgumentNullException.ThrowIfNull(model);

        if (_rendered)
        {
            throw new InvalidOperationException(
                $"{nameof(SpikeScreen)}.{nameof(Render)} was already called once; this screen has no "
                + "second model to show.");
        }

        _rendered = true;

        AddChild(BuildLabel(model.TitleKey));

        if (model.ErrorCode is not null)
        {
            var errorLabel = BuildLabel(model.ErrorCode);
            errorLabel.TooltipText = model.ErrorDetail;
            AddChild(errorLabel);
        }

        if (model.Contract is { } contract)
        {
            AddChild(BuildContractLine(contract));
        }

        foreach (var hero in model.Roster)
        {
            AddChild(BuildHeroCard(hero));
        }

        foreach (var response in model.Responses)
        {
            AddChild(BuildResponseLine(response));
        }
    }

    /// <summary>
    /// Walks this screen's own control tree in node order — the order
    /// <see cref="Render"/> added children in, which <see cref="GetChildren"/>
    /// preserves exactly, so two calls in the same run and two runs of the
    /// same model always visit nodes the same way — collecting every
    /// <see cref="Label.Text"/> it finds. This is what a tool compares against
    /// <see cref="RenderedUiSnapshot.Expected"/>: proof that the model this
    /// screen was given actually reached its controls, not a second
    /// projection of the model that could agree with the first by
    /// construction and mean nothing.
    /// </summary>
    public RenderedUiSnapshot Snapshot()
    {
        var texts = ImmutableArray.CreateBuilder<string>();
        CollectTexts(this, texts);
        return new RenderedUiSnapshot(texts.ToImmutable());
    }

    private static VBoxContainer BuildContractLine(ContractLine contract)
    {
        var block = new VBoxContainer();
        block.AddChild(BuildLabel(contract.Definition));
        block.AddChild(BuildLabel(contract.DisplayNameKey));
        block.AddChild(BuildLabel(contract.Payment.ToString(CultureInfo.InvariantCulture)));
        block.AddChild(BuildLabel(contract.Risk.ToString()));

        foreach (var tagKey in contract.TagKeys)
        {
            block.AddChild(BuildLabel(tagKey));
        }

        block.AddChild(BuildLabel(contract.RequiredCrew.ToString(CultureInfo.InvariantCulture)));
        block.AddChild(BuildLabel(contract.AcceptedCount.ToString(CultureInfo.InvariantCulture)));

        return block;
    }

    private static VBoxContainer BuildHeroCard(HeroCard hero)
    {
        var block = new VBoxContainer();
        block.AddChild(BuildLabel(hero.Definition));
        block.AddChild(BuildLabel(hero.DisplayNameKey));
        block.AddChild(BuildLabel(hero.Greed.ToString()));
        block.AddChild(BuildLabel(hero.Caution.ToString()));
        block.AddChild(BuildLabel(hero.Pride.ToString()));

        foreach (var key in hero.PrincipleKeys)
        {
            block.AddChild(BuildLabel(key));
        }

        foreach (var key in hero.InclinationKeys)
        {
            block.AddChild(BuildLabel(key));
        }

        return block;
    }

    private static VBoxContainer BuildResponseLine(ResponseLine response)
    {
        var block = new VBoxContainer();
        block.AddChild(BuildLabel(response.HeroDefinition));
        block.AddChild(BuildLabel(response.Action));

        foreach (var reason in response.Reasons)
        {
            block.AddChild(BuildLabel(reason.ReasonCode));
            block.AddChild(BuildLabel(reason.SourceEntity));
            block.AddChild(BuildLabel(reason.Strength.ToString()));
        }

        if (response.BlockedByEntity is not null)
        {
            block.AddChild(BuildLabel(response.BlockedByEntity));
        }

        block.AddChild(BuildLabel(response.Wavered.ToString()));

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
