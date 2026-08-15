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
/// builds the snapshot a correct screen should produce, from the model
/// alone — never by walking any actual node tree. The game side builds its
/// own <see cref="RenderedUiSnapshot"/> by walking its real Godot control
/// tree in tree order (a later runtime-harness task; not part of this
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
    /// <paramref name="model"/>: the title key, the error code if the run
    /// failed, and then the contract, the roster and every response line —
    /// each field the model carries, in the same order
    /// <see cref="ContractOfferScreenModelFactory.ReadModelHash"/> reads
    /// them in. Deliberately excludes
    /// <see cref="ContractOfferScreenModel.ErrorDetail"/>, for the same
    /// reason <c>ReadModelHash</c> does (see its remarks): it is not a value
    /// either side can agree on ahead of time.
    /// </summary>
    public static RenderedUiSnapshot Expected(ContractOfferScreenModel model)
    {
        ArgumentNullException.ThrowIfNull(model);

        var texts = ImmutableArray.CreateBuilder<string>();
        texts.Add(model.TitleKey);

        if (model.ErrorCode is not null)
        {
            texts.Add(model.ErrorCode);
        }

        if (model.Contract is { } contract)
        {
            texts.Add(contract.Definition);
            texts.Add(contract.DisplayNameKey);
            texts.Add(contract.Payment.ToString(CultureInfo.InvariantCulture));
            texts.Add(contract.Risk.ToString());
            texts.AddRange(contract.TagKeys);
            texts.Add(contract.RequiredCrew.ToString(CultureInfo.InvariantCulture));
            texts.Add(contract.AcceptedCount.ToString(CultureInfo.InvariantCulture));
        }

        foreach (var hero in model.Roster)
        {
            texts.Add(hero.Definition);
            texts.Add(hero.DisplayNameKey);
            texts.Add(hero.Greed.ToString());
            texts.Add(hero.Caution.ToString());
            texts.Add(hero.Pride.ToString());
            texts.AddRange(hero.PrincipleKeys);
            texts.AddRange(hero.InclinationKeys);
        }

        foreach (var response in model.Responses)
        {
            texts.Add(response.HeroDefinition);
            texts.Add(response.Action);

            foreach (var reason in response.Reasons)
            {
                texts.Add(reason.ReasonCode);
                texts.Add(reason.SourceEntity);
                texts.Add(reason.Strength.ToString());
            }

            if (response.BlockedByEntity is not null)
            {
                texts.Add(response.BlockedByEntity);
            }

            texts.Add(response.Wavered.ToString());
        }

        return new RenderedUiSnapshot(texts.ToImmutable());
    }

    /// <summary>
    /// The snapshot a correctly bound <em>product</em> screen should produce
    /// for <paramref name="model"/>: the same walk as
    /// <see cref="Expected(ContractOfferScreenModel)"/>, except every field
    /// that is actually a localization key (<see cref="ContractOfferScreenModel.TitleKey"/>,
    /// a display-name key, a tag key, a reason code, a
    /// <see cref="QualitativeGrade"/> by way of <see cref="QualitativeScale.KeyFor"/>)
    /// is resolved through <paramref name="catalogue"/> first, because that is
    /// what a screen resolving keys through a locale catalogue actually shows
    /// a player — the read model's raw key would never appear on such a
    /// screen's own control tree. Fields that were never keys to begin with
    /// (a content id, a payment, a bool) pass through unresolved, exactly as
    /// in the single-argument overload — the game shows those literally too
    /// (see <c>ContractOfferScreen</c>'s remarks).
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

        if (model.ErrorCode is not null)
        {
            texts.Add(model.ErrorCode);
        }

        if (model.Contract is { } contract)
        {
            texts.Add(contract.Definition);
            texts.Add(Resolve(catalogue, contract.DisplayNameKey));
            texts.Add(contract.Payment.ToString(CultureInfo.InvariantCulture));
            texts.Add(Resolve(catalogue, QualitativeScale.KeyFor(contract.Risk)));
            texts.AddRange(contract.TagKeys.Select(key => Resolve(catalogue, key)));
            texts.Add(contract.RequiredCrew.ToString(CultureInfo.InvariantCulture));
            texts.Add(contract.AcceptedCount.ToString(CultureInfo.InvariantCulture));
        }

        foreach (var hero in model.Roster)
        {
            texts.Add(hero.Definition);
            texts.Add(Resolve(catalogue, hero.DisplayNameKey));
            texts.Add(Resolve(catalogue, QualitativeScale.KeyFor(hero.Greed)));
            texts.Add(Resolve(catalogue, QualitativeScale.KeyFor(hero.Caution)));
            texts.Add(Resolve(catalogue, QualitativeScale.KeyFor(hero.Pride)));
            texts.AddRange(hero.PrincipleKeys.Select(key => Resolve(catalogue, key)));
            texts.AddRange(hero.InclinationKeys.Select(key => Resolve(catalogue, key)));
        }

        foreach (var response in model.Responses)
        {
            texts.Add(response.HeroDefinition);
            texts.Add(response.Action);

            foreach (var reason in response.Reasons)
            {
                texts.Add(Resolve(catalogue, reason.ReasonCode));
                texts.Add(reason.SourceEntity);
                texts.Add(Resolve(catalogue, QualitativeScale.KeyFor(reason.Strength)));
            }

            if (response.BlockedByEntity is not null)
            {
                texts.Add(response.BlockedByEntity);
            }

            texts.Add(response.Wavered.ToString());
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
