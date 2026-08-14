using System.Collections.Immutable;
using System.Globalization;
using Godot;
using OathAndCoin.Presentation;

namespace OathAndCoin.Game.Ui;

/// <summary>
/// The gate 0 spike screen, built entirely in code from a
/// <see cref="SpikeScreenModel"/> — the type's only input; this class never
/// reaches into <c>GameState</c> or reloads content, so nothing it shows can
/// disagree with the model <c>Main</c> already computed.
/// </summary>
/// <remarks>
/// <para>
/// <b>This screen is diagnostic, not a product screen.</b> It shows the raw
/// decision score and reason codes a player is never meant to read —
/// <see cref="SpikeScreenLine.Score"/>, <see cref="SpikeScreenLine.For"/>,
/// <see cref="SpikeScreenLine.Against"/> verbatim, and an error state that
/// prints <see cref="SpikeScreenModel.ErrorCode"/> rather than a translated
/// message. It exists only to prove the runtime harness's pipeline — that a
/// model built off-engine and a model built by the running game agree, and
/// that the second one actually reached the screen (see
/// <see cref="Snapshot"/>). It is meant to be deleted, not evolved: its
/// removal condition is the first screen Milestone 1 actually ships.
/// </para>
/// <para>
/// <b>Node order is the wire format.</b> <see cref="Render"/> adds exactly
/// one <see cref="Label"/> per text <see cref="RenderedUiSnapshot.Expected"/>
/// puts in its list, in the same order, and nothing else — an extra label
/// (a caption, a separator) would show up in <see cref="Snapshot"/> and break
/// every hash comparison the runtime harness makes. The one exception is
/// <see cref="SpikeScreenModel.ErrorDetail"/>: it is shown, for a person
/// reading the screen, but as a <see cref="Label.TooltipText"/> rather than a
/// second <see cref="Label"/>, because <see cref="RenderedUiSnapshot.Expected"/>
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
    public void Render(SpikeScreenModel model)
    {
        ArgumentNullException.ThrowIfNull(model);

        if (_rendered)
        {
            throw new InvalidOperationException(
                $"{nameof(SpikeScreen)}.{nameof(Render)} was already called once; this screen has no "
                + "second model to show.");
        }

        _rendered = true;

        AddChild(BuildLabel(model.Title));

        if (model.ErrorCode is not null)
        {
            var errorLabel = BuildLabel(model.ErrorCode);
            errorLabel.TooltipText = model.ErrorDetail;
            AddChild(errorLabel);
        }

        foreach (var line in model.Lines)
        {
            AddChild(BuildLine(line));
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

    private static VBoxContainer BuildLine(SpikeScreenLine line)
    {
        var block = new VBoxContainer();
        block.AddChild(BuildLabel(line.HeroDefinition));
        block.AddChild(BuildLabel(line.Action));
        block.AddChild(BuildLabel(line.Score.ToString(CultureInfo.InvariantCulture)));

        foreach (var reason in line.For)
        {
            block.AddChild(BuildLabel(reason));
        }

        foreach (var reason in line.Against)
        {
            block.AddChild(BuildLabel(reason));
        }

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
