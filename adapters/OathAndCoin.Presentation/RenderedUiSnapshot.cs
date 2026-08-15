using System.Collections.Generic;
using System.Collections.Immutable;
using System.Globalization;
using System.Linq;
using System.Security.Cryptography;
using System.Text;

namespace OathAndCoin.Presentation;

/// <summary>
/// A flat list of texts, in the order a control tree would present them —
/// the second of the two hashes this task adds (see the remarks on
/// <see cref="ContractOfferScreenModelFactory"/>).
/// </summary>
/// <remarks>
/// <see cref="ContractOfferScreenModelFactory.ReadModelHash"/> proves the
/// tool and the game built the same <see cref="ContractOfferScreenModel"/>.
/// It proves nothing about whether that model reached the screen: a
/// forgotten <c>Label</c> binding, two swapped lines, or a dropped reason all
/// leave it green. This type is what closes that gap. <see cref="Expected"/>
/// builds the snapshot a correctly bound screen should produce, resolving
/// every field that is actually a localization key through
/// <paramref name="catalogue"/> — never by walking any actual node tree, and
/// never by showing the model's own raw key or a raw content id, which no
/// real screen ever puts on a label either (see the remarks on
/// <c>ContractOfferScreen</c>). The game side builds its own
/// <see cref="RenderedUiSnapshot"/> by walking its real Godot control tree in
/// tree order (see <c>ContractOfferScreen.Snapshot</c>; not part of this
/// assembly, which stays engine-free — see <see cref="PresentationBoundaryTests"/>
/// in the test project). The two snapshots are produced by unrelated code
/// paths on purpose: a binding mistake breaks the match precisely because
/// nothing here can "know" what the game actually rendered.
/// </remarks>
/// <param name="Texts">Every shown text, in the order a reader encounters it.</param>
public sealed record RenderedUiSnapshot(ImmutableArray<string> Texts)
{
    // 0x1F (Unit Separator) cannot occur inside ordinary UTF-8 text produced
    // by this codebase's own identifiers and scores, so joining texts with it
    // before hashing keeps "ab" + "c" from hashing the same as "a" + "bc" —
    // the same trick ContentDigest uses for file paths and content.
    private const byte Separator = 0x1F;

    /// <summary>
    /// The snapshot a correctly bound screen should produce for
    /// <paramref name="model"/>, resolved against <paramref name="catalogue"/>:
    /// the title, a text naming which of the five <see cref="ScreenState"/>
    /// shapes this is (see <see cref="ScreenStateKeys"/> — otherwise
    /// <see cref="ScreenState.Loading"/> and <see cref="ScreenState.Empty"/>,
    /// both title-only, would render as byte-identical frames with nothing
    /// but a hidden model field telling them apart), the error text if the
    /// run failed, and then the contract, the roster and every response
    /// line. Every content id the model carries for bookkeeping —
    /// <see cref="ContractLine.Definition"/>, <see cref="HeroCard.Definition"/>,
    /// <see cref="ResponseLine.HeroDefinition"/>,
    /// <see cref="ReasonLine.SourceEntity"/>,
    /// <see cref="ResponseLine.BlockedByEntity"/> — stays out of this
    /// snapshot entirely: <see cref="ContractOfferScreenModelFactory.ReadModelHash"/>
    /// still hashes every one of them, but none of them is a name a player
    /// reads, and showing one next to the resolved name it duplicates is
    /// exactly the raw-identifier leak TDD §11.1 forbids. Deliberately
    /// excludes <see cref="ContractOfferScreenModel.ErrorDetail"/>, for the
    /// same reason <c>ReadModelHash</c> does (see its remarks): it is not a
    /// value either side can agree on ahead of time.
    /// </summary>
    /// <exception cref="InvalidOperationException">
    /// <paramref name="catalogue"/> has no entry for a key the model carries.
    /// A missing translation must fail loudly rather than let a raw key reach
    /// this snapshot silently — the same contract <c>TextSource</c> (the
    /// game's own resolver) upholds, kept here as a second, independent
    /// implementation on purpose (see this type's own remarks on why the tool
    /// and the game must reach the same text without sharing code).
    /// </exception>
    public static RenderedUiSnapshot Expected(
        ContractOfferScreenModel model, IReadOnlyDictionary<string, string> catalogue)
    {
        ArgumentNullException.ThrowIfNull(model);
        ArgumentNullException.ThrowIfNull(catalogue);

        var texts = ImmutableArray.CreateBuilder<string>();
        texts.Add(Resolve(catalogue, model.TitleKey));
        texts.Add(Resolve(catalogue, ScreenStateKeys.For(model.State)));

        if (model.ErrorCode is not null)
        {
            texts.Add(Resolve(catalogue, ErrorKeys.For(model.ErrorCode)));
        }

        if (model.Contract is { } contract)
        {
            texts.Add(Resolve(catalogue, contract.DisplayNameKey));
            texts.Add(contract.Payment.ToString(CultureInfo.InvariantCulture));
            texts.Add(Resolve(catalogue, QualitativeScale.KeyFor(contract.Risk)));
            texts.AddRange(contract.TagKeys.Select(key => Resolve(catalogue, key)));
            texts.Add(contract.RequiredCrew.ToString(CultureInfo.InvariantCulture));
            texts.Add(contract.AcceptedCount.ToString(CultureInfo.InvariantCulture));
        }

        foreach (var hero in model.Roster)
        {
            texts.Add(Resolve(catalogue, hero.DisplayNameKey));
            texts.Add(Resolve(catalogue, QualitativeScale.KeyFor(hero.Greed)));
            texts.Add(Resolve(catalogue, QualitativeScale.KeyFor(hero.Caution)));
            texts.Add(Resolve(catalogue, QualitativeScale.KeyFor(hero.Pride)));
            texts.AddRange(hero.PrincipleKeys.Select(key => Resolve(catalogue, key)));
            texts.AddRange(hero.InclinationKeys.Select(key => Resolve(catalogue, key)));
        }

        foreach (var response in model.Responses)
        {
            texts.Add(Resolve(catalogue, response.HeroDisplayNameKey));
            texts.Add(Resolve(catalogue, ActionKeys.For(response.Action)));

            foreach (var reason in response.Reasons)
            {
                texts.Add(Resolve(catalogue, reason.ReasonCode));
                texts.Add(Resolve(catalogue, QualitativeScale.KeyFor(reason.Strength)));
            }

            texts.Add(Resolve(catalogue, WaveredKeys.For(response.Wavered)));
        }

        return new RenderedUiSnapshot(texts.ToImmutable());
    }

    private static string Resolve(IReadOnlyDictionary<string, string> catalogue, string key) =>
        catalogue.TryGetValue(key, out var text)
            ? text
            : throw new InvalidOperationException(
                $"Locale catalogue has no entry for key '{key}'. A missing translation must fail loudly, not "
                + "let the key itself reach this snapshot as if that were the design.");

    /// <summary>SHA-256 over <see cref="Texts"/>, in order, lowercase hex.</summary>
    public static string Hash(RenderedUiSnapshot snapshot)
    {
        ArgumentNullException.ThrowIfNull(snapshot);

        using var hash = IncrementalHash.CreateHash(HashAlgorithmName.SHA256);
        foreach (var text in snapshot.Texts)
        {
            hash.AppendData(Encoding.UTF8.GetBytes(text));
            hash.AppendData(new[] { Separator });
        }

        return Convert.ToHexString(hash.GetHashAndReset()).ToLowerInvariant();
    }
}
