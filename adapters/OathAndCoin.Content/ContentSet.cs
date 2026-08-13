using System.Collections.Immutable;
using OathAndCoin.Simulation.Decisions;
using OathAndCoin.Simulation.Events;
using OathAndCoin.Simulation.Ids;
using OathAndCoin.Simulation.State;

namespace OathAndCoin.Content;

/// <summary>
/// Everything the game was authored with, read from disk once and handed to
/// the simulation as an initial <see cref="GameState"/>. This assembly is
/// where files, paths and encodings live; the simulation core never touches
/// any of them (ADR-002, planned — TDD §21), which is what lets the core's
/// boundary guard ban <see cref="System.IO.File"/> outright.
/// </summary>
public sealed class ContentSet
{
    /// <summary>
    /// Version of the save envelope this initial state is built for (TDD §12).
    /// It travels in <see cref="GameMetadata"/> from the first state onward,
    /// so a save written today can be recognized — or refused — by a later
    /// build, instead of being read with today's assumptions silently applied
    /// to yesterday's bytes.
    /// </summary>
    public const int SaveSchemaVersion = 1;

    private ContentSet(
        ImmutableSortedDictionary<ContentId, HeroDefinition> heroes,
        ImmutableSortedDictionary<ContentId, ContractDefinition> contracts,
        string contentVersion)
    {
        Heroes = heroes;
        Contracts = contracts;
        ContentVersion = contentVersion;
    }

    public ImmutableSortedDictionary<ContentId, HeroDefinition> Heroes { get; }

    public ImmutableSortedDictionary<ContentId, ContractDefinition> Contracts { get; }

    /// <summary>
    /// A digest of the loaded files (see <see cref="ContentDigest"/>), not a
    /// declared constant: it is wrong to claim "same content" for a tree that
    /// was edited, and this is the value a replay or bug report pins down
    /// (TDD §7.1).
    /// </summary>
    public string ContentVersion { get; }

    /// <summary>
    /// Reads <c>heroes/</c> and <c>contracts/</c> under
    /// <paramref name="contentRoot"/>.
    /// </summary>
    /// <exception cref="InvalidDataException">
    /// A file is missing, unreadable, malformed, has an unknown property, has
    /// a value outside <see cref="ContentBounds"/>, or reuses an id another
    /// file already defined. The message always names the file, and the JSON
    /// path when there is one.
    /// </exception>
    public static ContentSet Load(string contentRoot)
    {
        ArgumentException.ThrowIfNullOrEmpty(contentRoot);

        var root = Path.GetFullPath(contentRoot);
        if (!Directory.Exists(root))
        {
            throw new InvalidDataException($"Content root '{root}' does not exist.");
        }

        var seenIds = new Dictionary<ContentId, string>();

        var heroes = ImmutableSortedDictionary.CreateBuilder<ContentId, HeroDefinition>();
        foreach (var (relativePath, file) in ReadFiles<HeroFile>(root, "heroes"))
        {
            RequireUniqueId(seenIds, file.Id, relativePath);
            heroes.Add(file.Id, new HeroDefinition(
                file.Id,
                RequireLocalizationKey(file.DisplayNameKey, relativePath),
                RequireInRange(file.Greed, ContentBounds.TraitMin, ContentBounds.TraitMax, "greed", relativePath),
                RequireInRange(file.Caution, ContentBounds.TraitMin, ContentBounds.TraitMax, "caution", relativePath),
                RequireInRange(
                    file.TrustInGuild,
                    ContentBounds.TraitMin,
                    ContentBounds.TraitMax,
                    "trust_in_guild",
                    relativePath)));
        }

        var contracts = ImmutableSortedDictionary.CreateBuilder<ContentId, ContractDefinition>();
        foreach (var (relativePath, file) in ReadFiles<ContractFile>(root, "contracts"))
        {
            RequireUniqueId(seenIds, file.Id, relativePath);
            contracts.Add(file.Id, new ContractDefinition(
                file.Id,
                RequireLocalizationKey(file.DisplayNameKey, relativePath),
                RequireInRange(
                    file.Payment,
                    ContentBounds.PaymentMin,
                    ContentBounds.PaymentMax,
                    "payment",
                    relativePath),
                RequireInRange(file.Risk, ContentBounds.RiskMin, ContentBounds.RiskMax, "risk", relativePath)));
        }

        return new ContentSet(
            heroes.ToImmutable(),
            contracts.ToImmutable(),
            ContentDigest.Compute(root)[..ContentDigest.VersionLength]);
    }

    /// <summary>
    /// Builds the campaign's starting state: one <see cref="HeroState"/> per
    /// hero definition and one offered <see cref="ContractState"/> per
    /// contract definition.
    /// </summary>
    /// <remarks>
    /// <see cref="HeroId"/>s are assigned in <see cref="ContentId"/> order, not
    /// in the order the filesystem returned the files. Filesystem order is not
    /// a property of the content — it varies by platform, by filesystem and by
    /// how the tree was checked out — so deriving ids from it would make the
    /// same content produce different states on different machines, and every
    /// "same seed, same result" claim built on top of it would be false in a
    /// way no test on one machine could see.
    /// </remarks>
    public GameState CreateInitialState(ulong campaignSeed, string rulesetVersion)
    {
        ArgumentException.ThrowIfNullOrEmpty(rulesetVersion);

        var heroes = ImmutableSortedDictionary.CreateBuilder<HeroId, HeroState>();
        var nextHeroIndex = 0;
        foreach (var definition in Heroes.Values)
        {
            var heroId = new HeroId(nextHeroIndex);
            nextHeroIndex++;

            heroes.Add(heroId, new HeroState
            {
                Id = heroId,
                Definition = definition.Id,
                DisplayNameKey = definition.DisplayNameKey,
                Greed = definition.Greed,
                Caution = definition.Caution,
                TrustInGuild = definition.TrustInGuild,
            });
        }

        var contracts = ImmutableSortedDictionary.CreateBuilder<ContentId, ContractState>();
        foreach (var definition in Contracts.Values)
        {
            contracts.Add(definition.Id, new ContractState
            {
                Id = definition.Id,
                Payment = definition.Payment,
                Risk = definition.Risk,
                Status = ContractStatus.Offered,
                RespondedBy = ImmutableSortedSet<HeroId>.Empty,
            });
        }

        return new GameState
        {
            Metadata = new GameMetadata
            {
                SaveSchemaVersion = SaveSchemaVersion,
                RulesetVersion = rulesetVersion,
                ContentVersion = ContentVersion,
                CampaignSeed = campaignSeed,
                StateVersion = 0,
                LogicalTime = 0,
                NextEventId = 0,
                NextTraceId = 0,
                NextDecisionOrdinal = 0,
            },
            Heroes = heroes.ToImmutable(),
            Contracts = contracts.ToImmutable(),
            Traces = ImmutableSortedDictionary<long, CausalTrace>.Empty,
            History = ImmutableArray<DomainEvent>.Empty,
        };
    }

    private static IEnumerable<(string RelativePath, TFile File)> ReadFiles<TFile>(string root, string subdirectory)
    {
        var directory = Path.Combine(root, subdirectory);
        if (!Directory.Exists(directory))
        {
            throw new InvalidDataException(
                $"Content root '{root}' has no '{subdirectory}' directory.");
        }

        // Ordinal order, never the filesystem's: enumeration order differs
        // between platforms and filesystems, and it decides which of two
        // duplicate definitions is reported as "the second one".
        var files = Directory.GetFiles(directory, "*.json", SearchOption.AllDirectories)
            .Select(fullPath => (
                RelativePath: ContentDigest.ToRelativePosixPath(root, fullPath),
                FullPath: fullPath))
            .OrderBy(file => file.RelativePath, StringComparer.Ordinal);

        foreach (var file in files)
        {
            yield return (file.RelativePath, StrictJson.ReadFile<TFile>(file.RelativePath, file.FullPath));
        }
    }

    private static void RequireUniqueId(
        Dictionary<ContentId, string> seenIds,
        ContentId id,
        string relativePath)
    {
        if (seenIds.TryGetValue(id, out var firstPath))
        {
            throw new InvalidDataException(
                $"Duplicate content id '{id}': defined in both '{firstPath}' and '{relativePath}'.");
        }

        seenIds.Add(id, relativePath);
    }

    private static int RequireInRange(int value, int min, int max, string propertyName, string relativePath)
    {
        if (value < min || value > max)
        {
            throw new InvalidDataException(
                $"Content file '{relativePath}' has '{propertyName}' = {value}, "
                + $"outside the allowed range {min}..{max}.");
        }

        return value;
    }

    private static string RequireLocalizationKey(string value, string relativePath)
    {
        if (string.IsNullOrWhiteSpace(value))
        {
            throw new InvalidDataException(
                $"Content file '{relativePath}' has an empty 'display_name_key'; "
                + "a display name must be a localization key (TDD §11.1).");
        }

        return value;
    }
}
