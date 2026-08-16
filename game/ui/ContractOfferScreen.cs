using System.Collections.Immutable;
using System.Globalization;
using Godot;
using OathAndCoin.GameProtocol;
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
/// one allowed branch, not an exception to it. The three remaining branches
/// are of one kind and not that: whether a model field is <c>null</c>
/// (<see cref="ReasonLine.SourceDisplayNameKey"/>,
/// <see cref="ResponseLine.BlockedByDisplayNameKey"/>) or a model list is
/// empty (a hero's principles, a contract's tags) — never on what is in it.
/// A caption over an empty list is a heading over nothing, so neither is
/// drawn; <see cref="RenderedUiSnapshot.Expected"/> makes the identical
/// decision from the identical field.
/// </para>
/// <para>
/// <b>No raw identifier ever becomes a label.</b> Every field that is
/// actually a localization key — <see cref="ContractOfferScreenModel.TitleKey"/>,
/// the screen-state key, a display-name key (including
/// <see cref="ResponseLine.HeroDisplayNameKey"/>, joined onto a response by
/// its hero's own id rather than carried as one — see that field's remarks),
/// a tag key, a reason code, a reason's own source name when it has one
/// worth showing, a reason's direction
/// (<see cref="ReasonDirectionKeys"/>), a field's caption
/// (<see cref="FieldKeys"/>), an action, whether the hero wavered, the error
/// code, and a <see cref="QualitativeGrade"/> by way of
/// <see cref="QualitativeScale.KeyFor"/> — is resolved to player-facing text
/// before it becomes a <see cref="Label"/>. A field that carries a raw
/// content id purely for the model's own bookkeeping
/// (<see cref="ContractLine.Definition"/>, <see cref="HeroCard.Definition"/>,
/// <see cref="ResponseLine.HeroDefinition"/>, <see cref="ReasonLine.SourceEntity"/>,
/// <see cref="ResponseLine.BlockedByEntity"/>) is not shown at all — it is not
/// a name a player reads, showing it next to the resolved name it duplicates
/// would be exactly the raw-identifier leak TDD §11.1 forbids, and
/// <see cref="ContractOfferScreenModelFactory.ReadModelHash"/> already hashes
/// it without any help from this screen. The three objective numbers spec
/// calls out on purpose — <see cref="ContractLine.Payment"/>,
/// <see cref="ContractLine.RequiredCrew"/>, <see cref="ContractLine.AcceptedCount"/> —
/// are the one kind of value this screen still shows literally, because they
/// were never a key to resolve in the first place. Each is preceded by its
/// own caption label, for the reason <see cref="FieldKeys"/> gives.
/// </para>
/// <para>
/// <b>Node order is the wire format.</b> <see cref="Render"/> adds exactly
/// one <see cref="Label"/> per text
/// <see cref="RenderedUiSnapshot.Expected(ContractOfferScreenModel, System.Collections.Generic.IReadOnlyDictionary{string,string})"/>
/// puts in its list, in the same order, and nothing else — an extra label
/// would show up in <see cref="Snapshot"/> and break every hash comparison
/// the runtime harness makes. Which container a label hangs off does not
/// enter into it: <see cref="CollectTexts"/> is a depth-first walk, so a row
/// (<see cref="Row"/>) laying a caption and its value out side by side
/// visits them in the same order a column would. There is no exception:
/// <see cref="ContractOfferScreenModel.ErrorDetail"/> does not reach this
/// screen at all. It carried a machine's absolute path and an exception's own
/// text — assembled in code, never resolved from the catalogue — and it
/// arrived as a tooltip, which neither hash covers by design, so nothing
/// could have noticed. The error's own key names the failure to the player;
/// the detail belongs to <c>report.json</c> and <c>run.log</c>.
/// </para>
/// <para>
/// <b>Everything is inside one <see cref="ScrollContainer"/>.</b> External
/// review finding (blocker): the roster ran off the bottom of the 1280x720
/// frame at the fourth of six heroes, and the responses — the one thing this
/// milestone exists to show a tester — were mostly below the edge with no
/// way to reach them. Both hashes stayed green, correctly: they are about
/// which texts the model produced, not about where those texts landed. The
/// content now scrolls, so nothing is unreachable at any window size, and
/// <see cref="Measure"/> reports what it actually measured so the harness can
/// fail a run where content outgrew what a person can get to.
/// </para>
/// </remarks>
public sealed partial class ContractOfferScreen : VBoxContainer
{
    private bool _rendered;
    private ScrollContainer? _scroll;
    private VBoxContainer? _content;

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

        // Fills the window rather than sitting at its own minimum size in the
        // corner: the scroll container below can only know what does not fit
        // if it has been told how much room there is.
        SetAnchorsAndOffsetsPreset(LayoutPreset.FullRect);

        _content = new VBoxContainer { SizeFlagsHorizontal = SizeFlags.ExpandFill };
        _scroll = new ScrollContainer
        {
            SizeFlagsHorizontal = SizeFlags.ExpandFill,
            SizeFlagsVertical = SizeFlags.ExpandFill,
        };

        _scroll.AddChild(_content);
        AddChild(_scroll);

        _content.AddChild(BuildLabel(textSource.Resolve(model.TitleKey)));
        _content.AddChild(BuildLabel(textSource.Resolve(ScreenStateKeys.For(model.State))));

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
            _content.AddChild(BuildLabel(textSource.Resolve(ErrorKeys.For(model.ErrorCode))));
        }

        if (model.Contract is { } contract)
        {
            _content.AddChild(BuildContractLine(contract, textSource));
        }

        // Roster and responses side by side, not stacked one after the
        // other: a single vertical stack of six hero cards followed by up to
        // six response blocks is twice as tall as the window, and the roster
        // would push every response below the fold. Two columns share the
        // height instead; CollectTexts still visits every roster label before
        // every response label (a depth-first walk does not care which
        // container a subtree hangs off), so this is a layout choice only —
        // the text order RenderedUiSnapshot.Expected states is unchanged.
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
            _content.AddChild(columns);
        }
    }

    /// <summary>
    /// What this screen's content actually measures, and how much of it a
    /// person at a <paramref name="windowSize"/> window can reach — the two
    /// pairs <c>TerminalEvent</c>'s <c>layout_*</c> fields carry, and the
    /// harness compares (see <c>SmokeVerdict</c>).
    /// </summary>
    /// <remarks>
    /// <para>
    /// Content is the laid-out tree's own natural size
    /// (<see cref="Control.GetCombinedMinimumSize"/> of everything inside the
    /// scroll container), never what survived clipping: a screen whose bottom
    /// half was cut off has to measure as taller than the window, or the
    /// measurement would agree with the bug.
    /// </para>
    /// <para>
    /// Reachable is the window plus however far the content can actually be
    /// scrolled, taken from the scroll bars' own range. The two numbers come
    /// from different places on purpose — deleting the scroll container makes
    /// reachable collapse to the window size while content stays what it is,
    /// which is exactly the state this pair exists to catch. Rounding is
    /// deliberately pessimistic in both directions (content up, reachable
    /// down) so a sub-pixel remainder can never turn an overflow into a pass.
    /// </para>
    /// <para>
    /// Must be called after the engine has laid the tree out — the harness
    /// calls it from the terminal-line builder, which runs after the capture's
    /// own wait for a drawn frame. Called on the engine's main thread, like
    /// every other engine call in a <c>--smoke</c> run.
    /// </para>
    /// </remarks>
    public ScreenLayoutMeasurement Measure(Vector2 windowSize)
    {
        if (_content is null || _scroll is null)
        {
            throw new InvalidOperationException(
                $"{nameof(ContractOfferScreen)}.{nameof(Measure)} was called before {nameof(Render)}; there is "
                + "no content to measure yet.");
        }

        var content = _content.GetCombinedMinimumSize();
        var horizontal = _scroll.GetHScrollBar();
        var vertical = _scroll.GetVScrollBar();

        return new ScreenLayoutMeasurement(
            Mathf.CeilToInt(content.X),
            Mathf.CeilToInt(content.Y),
            Mathf.FloorToInt(windowSize.X + ScrollRange(horizontal)),
            Mathf.FloorToInt(windowSize.Y + ScrollRange(vertical)));
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

    /// <summary>
    /// How far a scroll bar can actually move its content: its whole range
    /// minus the part already on screen, never negative (a bar with nothing
    /// to scroll reports a page at least as large as its maximum).
    /// </summary>
    private static float ScrollRange(ScrollBar bar) => Mathf.Max(0f, (float)(bar.MaxValue - bar.Page));

    private static VBoxContainer BuildContractLine(ContractLine contract, TextSource textSource)
    {
        var block = new VBoxContainer();
        block.AddChild(BuildLabel(textSource.Resolve(contract.DisplayNameKey)));

        // One row, so the four facts about the offer read as four facts and
        // not as a column of unexplained numbers.
        var facts = Row();
        AddCaptioned(facts, textSource, FieldKeys.ContractPayment, Number(contract.Payment));
        AddCaptioned(
            facts, textSource, FieldKeys.ContractRisk, textSource.Resolve(QualitativeScale.KeyFor(contract.Risk)));
        AddCaptioned(facts, textSource, FieldKeys.ContractRequiredCrew, Number(contract.RequiredCrew));
        AddCaptioned(facts, textSource, FieldKeys.ContractAcceptedCount, Number(contract.AcceptedCount));
        block.AddChild(facts);

        if (!contract.TagKeys.IsEmpty)
        {
            var tags = Row();
            tags.AddChild(BuildLabel(textSource.Resolve(FieldKeys.ContractTags)));
            foreach (var tagKey in contract.TagKeys)
            {
                tags.AddChild(BuildLabel(textSource.Resolve(tagKey)));
            }

            block.AddChild(tags);
        }

        return block;
    }

    private static VBoxContainer BuildHeroCard(HeroCard hero, TextSource textSource)
    {
        var block = new VBoxContainer();

        // Name and the three scales on one line: six heroes at four lines
        // each already fill a 720px window on their own, and a hero's own
        // scales belong beside the hero, not under them.
        var scales = Row();
        scales.AddChild(BuildLabel(textSource.Resolve(hero.DisplayNameKey)));
        AddCaptioned(scales, textSource, FieldKeys.HeroGreed, textSource.Resolve(QualitativeScale.KeyFor(hero.Greed)));
        AddCaptioned(
            scales, textSource, FieldKeys.HeroCaution, textSource.Resolve(QualitativeScale.KeyFor(hero.Caution)));
        AddCaptioned(scales, textSource, FieldKeys.HeroPride, textSource.Resolve(QualitativeScale.KeyFor(hero.Pride)));
        block.AddChild(scales);

        AddKeyList(block, textSource, FieldKeys.HeroPrinciples, hero.PrincipleKeys);
        AddKeyList(block, textSource, FieldKeys.HeroInclinations, hero.InclinationKeys);

        return block;
    }

    private static VBoxContainer BuildResponseLine(ResponseLine response, TextSource textSource)
    {
        var block = new VBoxContainer();

        var answer = Row();
        answer.AddChild(BuildLabel(textSource.Resolve(response.HeroDisplayNameKey)));
        answer.AddChild(BuildLabel(textSource.Resolve(ActionKeys.For(response.Action))));
        block.AddChild(answer);

        foreach (var reason in response.Reasons)
        {
            var line = Row();
            line.AddChild(BuildLabel(textSource.Resolve(reason.ReasonCode)));

            // A branch on whether this specific reason carries a source
            // worth naming — a model fact (ReasonLine.SourceDisplayNameKey),
            // never a branch on reason.ReasonCode itself. See that field's
            // remarks: PaymentAttractive/RiskTooHigh name the contract,
            // TrustsTheGuild/UnpredictableMood name the responding hero,
            // both already on screen, so the factory leaves this null for
            // them rather than the screen deciding to skip it by code.
            if (reason.SourceDisplayNameKey is not null)
            {
                line.AddChild(BuildLabel(textSource.Resolve(reason.SourceDisplayNameKey)));
            }

            // Which way this reason pulled relative to the answer above it —
            // read off the model (ReasonLine.Direction), never worked out
            // here from response.Action, for the reason that field's own
            // remarks give.
            line.AddChild(BuildLabel(textSource.Resolve(ReasonDirectionKeys.For(reason.Direction))));
            AddCaptioned(
                line, textSource, FieldKeys.ReasonStrength,
                textSource.Resolve(QualitativeScale.KeyFor(reason.Strength)));

            block.AddChild(line);
        }

        // Same shape as a reason's source above: a branch on the model fact
        // ResponseLine.BlockedByDisplayNameKey (null exactly when nothing
        // blocked this hero), never on any code. HERO_DECISION_SPEC §3 and §4.2: a block names
        // its principle so the screen does not have to guess one from the
        // hero alone, and stays its own line so "too risky" reads
        // differently from "will not do this at all".
        if (response.BlockedByDisplayNameKey is not null)
        {
            var blocked = Row();
            blocked.AddChild(BuildLabel(textSource.Resolve(FieldKeys.ResponseBlockedBy)));
            blocked.AddChild(BuildLabel(textSource.Resolve(response.BlockedByDisplayNameKey)));
            block.AddChild(blocked);
        }

        block.AddChild(BuildLabel(textSource.Resolve(WaveredKeys.For(response.Wavered))));

        return block;
    }

    /// <summary>
    /// A caption label and the value it names, side by side. Two labels, never
    /// one composed string: see <see cref="FieldKeys"/> for why a player-facing
    /// string may not be assembled at a call site.
    /// </summary>
    private static void AddCaptioned(Container row, TextSource textSource, string captionKey, string value)
    {
        row.AddChild(BuildLabel(textSource.Resolve(captionKey)));
        row.AddChild(BuildLabel(value));
    }

    /// <summary>
    /// A captioned row of localization keys — a hero's principles, a hero's
    /// inclinations — or nothing at all when the list is empty, so no caption
    /// ever stands over an absence.
    /// </summary>
    private static void AddKeyList(
        Container block, TextSource textSource, string captionKey, ImmutableArray<string> keys)
    {
        if (keys.IsEmpty)
        {
            return;
        }

        var row = Row();
        row.AddChild(BuildLabel(textSource.Resolve(captionKey)));
        foreach (var key in keys)
        {
            row.AddChild(BuildLabel(textSource.Resolve(key)));
        }

        block.AddChild(row);
    }

    private static HBoxContainer Row() => new();

    private static string Number(int value) => value.ToString(CultureInfo.InvariantCulture);

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
