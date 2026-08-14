using System.Collections.Immutable;
using System.Globalization;
using System.Security.Cryptography;
using System.Text;

namespace OathAndCoin.Presentation;

/// <summary>
/// A flat list of texts, in the order a control tree would present them —
/// the second of the two hashes this task adds (see the remarks on
/// <see cref="SpikeScreenModelFactory"/>).
/// </summary>
/// <remarks>
/// <see cref="SpikeScreenModelFactory.ReadModelHash"/> proves the tool and
/// the game built the same <see cref="SpikeScreenModel"/>. It proves nothing
/// about whether that model reached the screen: a forgotten <c>Label</c>
/// binding, two swapped lines, or a dropped reason all leave it green. This
/// type is what closes that gap. <see cref="Expected"/> builds the snapshot
/// a correct screen should produce, from the model alone — never by walking
/// any actual node tree. The game side builds its own
/// <see cref="RenderedUiSnapshot"/> by walking its real Godot control tree in
/// tree order (later runtime-harness task; not part of this assembly, which
/// stays engine-free — see <see cref="PresentationBoundaryTests"/>). The two
/// snapshots are produced by unrelated code paths on purpose: a binding
/// mistake breaks the match precisely because nothing here can "know" what
/// the game actually rendered.
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
    /// <paramref name="model"/>: the title, the error code if the run
    /// failed, and per line the hero, the action, the score and every reason
    /// — for, then against. Deliberately excludes
    /// <see cref="SpikeScreenModel.ErrorDetail"/>, for the same reason
    /// <see cref="SpikeScreenModelFactory.ReadModelHash"/> does (see its
    /// remarks): it is not a value either side can agree on ahead of time.
    /// </summary>
    public static RenderedUiSnapshot Expected(SpikeScreenModel model)
    {
        ArgumentNullException.ThrowIfNull(model);

        var texts = ImmutableArray.CreateBuilder<string>();
        texts.Add(model.Title);

        if (model.ErrorCode is not null)
        {
            texts.Add(model.ErrorCode);
        }

        foreach (var line in model.Lines)
        {
            texts.Add(line.HeroDefinition);
            texts.Add(line.Action);
            texts.Add(line.Score.ToString(CultureInfo.InvariantCulture));
            texts.AddRange(line.For);
            texts.AddRange(line.Against);
        }

        return new RenderedUiSnapshot(texts.ToImmutable());
    }

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
