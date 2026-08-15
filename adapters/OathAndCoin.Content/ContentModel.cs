using System.Collections.Immutable;
using OathAndCoin.Simulation.Ids;

namespace OathAndCoin.Content;

/// <summary>
/// Whether a trait contributes a strength to a decision or closes it outright
/// (spec §3.2).
/// </summary>
public enum TraitKind
{
    Inclination,
    Principle,
}

/// <summary>
/// A named trait a hero can carry. <see cref="Weight"/> is meaningful only
/// for <see cref="TraitKind.Inclination"/> and is always 0 for a principle:
/// a red line has no strength, it closes the path (spec §3.2).
/// </summary>
public sealed record TraitDefinition(
    ContentId Id,
    string DisplayNameKey,
    TraitKind Kind,
    ContentId Tag,
    int Weight);

/// <summary>
/// One-directional: this is what the hero holding the record thinks about
/// <paramref name="Hero"/>, never the other way round.
/// </summary>
public sealed record HeroRelationship(ContentId Hero, int Weight);

/// <summary>
/// A hero as authored in content — the template a <see cref="Simulation.State.HeroState"/>
/// instance is created from. Greed, caution, pride and trust are integers
/// within <see cref="ContentBounds.TraitMin"/>..<see cref="ContentBounds.TraitMax"/>,
/// checked by the loader. <see cref="Traits"/> and <see cref="Relationships"/>
/// name other content ids; whether those ids resolve to something that exists
/// is Task 2's concern, not this loader's (this task only enforces range and
/// list-size limits).
/// </summary>
public sealed record HeroDefinition(
    ContentId Id,
    string DisplayNameKey,
    int Greed,
    int Caution,
    int Pride,
    int TrustInGuild,
    ImmutableArray<ContentId> Traits,
    ImmutableArray<HeroRelationship> Relationships);

/// <summary>
/// A contract offer as authored in content. <see cref="Tags"/> are what a
/// hero's traits latch onto (spec §3.2) — a hero's trait names a
/// <c>Tag</c>, and a contract carrying that same tag is where the trait has
/// something to say.
/// </summary>
public sealed record ContractDefinition(
    ContentId Id,
    string DisplayNameKey,
    int Payment,
    int Risk,
    int RequiredCrew,
    ImmutableArray<ContentId> Tags);

/// <summary>
/// The on-disk shape of a hero file, separate from <see cref="HeroDefinition"/>
/// on purpose: deserialization targets are shaped by the file format
/// (snake_case names, every field independently present or absent), domain
/// records are shaped by the domain. Keeping them the same type would make
/// every future file-format concession a change to the domain model.
/// </summary>
/// <remarks>
/// <c>required</c> is what rejects a missing field:
/// <see cref="System.Text.Json"/> honours it and throws rather than leaving a
/// silent zero, which for a trait would be a perfectly plausible value.
///
/// Property names are mapped to <c>snake_case</c> by
/// <see cref="ContentSet"/>'s serializer options rather than by a
/// <c>JsonPropertyName</c> attribute per property: with a policy, a field
/// whose name is a single word cannot be silently spelled one way here and
/// another way in the schema, because neither spelling is written by hand.
/// </remarks>
internal sealed record HeroFile
{
    /// <summary>
    /// Which version of the content format this file was authored against
    /// (TDD §11.1). Required, so a file cannot omit it and be read under
    /// whatever the current build happens to assume.
    /// </summary>
    public required int SchemaVersion { get; init; }

    public required ContentId Id { get; init; }

    public required string DisplayNameKey { get; init; }

    public required int Greed { get; init; }

    public required int Caution { get; init; }

    public required int Pride { get; init; }

    public required int TrustInGuild { get; init; }

    public required ImmutableArray<ContentId> Traits { get; init; }

    public required ImmutableArray<RelationshipFile> Relationships { get; init; }
}

/// <summary>The on-disk shape of a contract file; see <see cref="HeroFile"/>.</summary>
internal sealed record ContractFile
{
    /// <summary>
    /// Which version of the content format this file was authored against
    /// (TDD §11.1). Required, so a file cannot omit it and be read under
    /// whatever the current build happens to assume.
    /// </summary>
    public required int SchemaVersion { get; init; }

    public required ContentId Id { get; init; }

    public required string DisplayNameKey { get; init; }

    public required int Payment { get; init; }

    public required int Risk { get; init; }

    public required int RequiredCrew { get; init; }

    public required ImmutableArray<ContentId> Tags { get; init; }
}

/// <summary>The on-disk shape of a trait file; see <see cref="HeroFile"/>.</summary>
internal sealed record TraitFile
{
    public required int SchemaVersion { get; init; }

    public required ContentId Id { get; init; }

    public required string DisplayNameKey { get; init; }

    public required string Kind { get; init; }

    public required ContentId Tag { get; init; }

    /// <summary>
    /// Nullable rather than required: its presence is what distinguishes the
    /// two kinds, so "absent" has to be representable in order to be rejected
    /// for a principle and demanded for an inclination.
    /// </summary>
    public int? Weight { get; init; }
}

/// <summary>The on-disk shape of one entry in a hero file's <c>relationships</c> list.</summary>
internal sealed record RelationshipFile
{
    public required ContentId Hero { get; init; }

    public required int Weight { get; init; }
}
