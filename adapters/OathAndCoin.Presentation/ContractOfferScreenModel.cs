using System.Collections.Immutable;

namespace OathAndCoin.Presentation;

/// <summary>
/// Which of five shapes the contract-offer screen is in right now. Kept as
/// its own field on <see cref="ContractOfferScreenModel"/> rather than
/// inferred from which other fields happen to be populated: two states can
/// otherwise look identical from the outside (an empty roster before any
/// contract is offered and an empty roster because loading failed), and a
/// hash that never states the state explicitly would call them the same
/// screen.
/// </summary>
public enum ScreenState
{
    /// <summary>
    /// The game is still building a <see cref="OathAndCoin.Content.Scenarios.ScenarioOutcome"/>
    /// to build a model from. Never produced by
    /// <see cref="ContractOfferScreenModelFactory"/> — there is no outcome yet
    /// to build from — this exists only for the game itself to show before
    /// one arrives (a later task's screen, not this one's factory).
    /// </summary>
    Loading,

    /// <summary>The content set has no contract to offer at all.</summary>
    Empty,

    /// <summary>
    /// The run never reached a contract to offer — content failed to load, a
    /// scenario file was malformed, or similar. <see cref="ContractOfferScreenModel.ErrorCode"/>
    /// names which.
    /// </summary>
    Error,

    /// <summary>A contract is offered, and at least one hero has not yet answered.</summary>
    Incomplete,

    /// <summary>A contract is offered, and every hero in the roster has answered.</summary>
    Normal,
}

/// <summary>
/// One reason a hero's answer went the way it did, already translated onto
/// the qualitative scale (spec: the interface never shows the player a raw
/// number besides an objective fact like a payment in coins).
/// </summary>
/// <param name="ReasonCode">
/// A stable code from <see cref="OathAndCoin.Simulation.Decisions.ReasonCodes"/>
/// — itself a localization key, never assembled from free text.
/// </param>
/// <param name="SourceEntity">
/// The content id text of the entity this reason came from (see
/// <see cref="OathAndCoin.Simulation.Decisions.TraceFactor.SourceEntity"/>) —
/// a plain string, not a <see cref="OathAndCoin.Simulation.Ids.ContentId"/>,
/// for the same reason <c>SpikeScreenLine.HeroDefinition</c> was: this type
/// crosses to a tool process and eventually a screen, neither of which
/// should have to depend on the simulation's identifier type to read it.
/// </param>
/// <param name="Strength">
/// The reason's <see cref="OathAndCoin.Simulation.Decisions.TraceFactor.Magnitude"/>,
/// translated by <see cref="QualitativeScale.ForMagnitude"/> — never the raw
/// integer.
/// </param>
public sealed record ReasonLine(string ReasonCode, string SourceEntity, QualitativeGrade Strength);

/// <summary>
/// One hero in the roster, as the screen shows them: qualitative traits, and
/// the principles/inclinations that could make a contract land differently
/// for this hero than for another. Neither <see cref="PrincipleKeys"/> nor
/// <see cref="InclinationKeys"/> is a trait's own display name — the
/// simulation core carries a trait only as a resolved
/// <see cref="OathAndCoin.Simulation.Decisions.HeldTrait"/> (id, tag, kind,
/// weight; ADR-002 forbids it from referencing the content assembly that
/// would know an authored name) — so each key is the trait's <c>Tag</c> run
/// through <see cref="TagKeys.For"/>, the same convention
/// <see cref="ContractLine.TagKeys"/> uses for a contract's own tags.
/// </summary>
public sealed record HeroCard(
    string Definition,
    string DisplayNameKey,
    QualitativeGrade Greed,
    QualitativeGrade Caution,
    QualitativeGrade Pride,
    ImmutableArray<string> PrincipleKeys,
    ImmutableArray<string> InclinationKeys);

/// <summary>
/// One hero's answer to the offered contract.
/// </summary>
/// <param name="HeroDefinition">The content id text of the hero who answered.</param>
/// <param name="Action">The content id text of the chosen action (see <see cref="OathAndCoin.Simulation.Decisions.Actions"/>).</param>
/// <param name="Reasons">
/// At most three reasons, strongest first — see
/// <see cref="ContractOfferScreenModelFactory"/>'s remarks on ranking. Empty
/// exactly when <see cref="BlockedByEntity"/> is set: a red line closes the
/// decision before any reason has a magnitude to rank (spec §3.2), so there
/// is nothing here to show alongside it.
/// </param>
/// <param name="BlockedByEntity">
/// The content id text of the entity carrying the principle that blocked
/// this hero outright, or <c>null</c> when nothing did.
/// </param>
/// <param name="Wavered">
/// <c>true</c> when this hero's mood flipped the answer the rest of the
/// factors alone would have given — never set for a blocked line, which
/// never drew a mood at all (spec §3.2). See
/// <see cref="ContractOfferScreenModelFactory"/>'s remarks for exactly how
/// this is computed: it is arithmetic over the same trace that produced the
/// decision, not a separate judgment call.
/// </param>
public sealed record ResponseLine(
    string HeroDefinition,
    string Action,
    ImmutableArray<ReasonLine> Reasons,
    string? BlockedByEntity,
    bool Wavered);

/// <summary>
/// The contract currently on offer, as the screen shows it.
/// </summary>
/// <param name="Payment">
/// The offered payment in coins — an objective fact, shown as a plain
/// number on purpose (spec: the interface hides chance, not the deal on the
/// table).
/// </param>
/// <param name="Risk">The contract's risk, translated to the qualitative scale — never the raw number.</param>
/// <param name="RequiredCrew">How many heroes must accept — an objective headcount, like <see cref="Payment"/>.</param>
/// <param name="AcceptedCount">How many heroes have accepted so far — an objective headcount, like <see cref="RequiredCrew"/>.</param>
public sealed record ContractLine(
    string Definition,
    string DisplayNameKey,
    int Payment,
    QualitativeGrade Risk,
    ImmutableArray<string> TagKeys,
    int RequiredCrew,
    int AcceptedCount);

/// <summary>
/// The read model for the contract-offer screen: everything the interface
/// needs to draw one of its five shapes, and nothing it would need to guess
/// at or compute itself. <see cref="ContractOfferScreenModelFactory"/> is the
/// only sanctioned way to build a correct one — the validation below only
/// rejects an inconsistent combination, it does not know how to build one
/// that is not.
/// </summary>
/// <remarks>
/// <para>
/// Each <see cref="ScreenState"/> owns its own set of populated fields, and
/// that ownership is enforced here, not left to callers to respect by
/// convention — the same "reject an inconsistent combination at
/// construction" stance <see cref="OathAndCoin.Simulation.Decisions.DecisionResult"/>
/// and <see cref="OathAndCoin.Simulation.Decisions.CausalTrace"/> already
/// take, applied to state instead of a decision. Every property below is
/// backed by an explicit field and an assigned-tracking flag, exactly like
/// those two types: object-initializer assignment order is not guaranteed by
/// the language, so <see cref="Validate"/> only ever runs once every
/// relevant property has actually been set, from whichever one happened to
/// be set last.
/// </para>
/// <para>
/// This also has to survive a <c>with</c> expression, which a plain field
/// initializer on a positional record would not: <c>with</c> copies every
/// backing field (including the assigned-tracking flags, already
/// <c>true</c>) through a synthesized copy constructor that never runs a
/// field initializer, and then re-invokes only the <c>init</c> accessors
/// named in the <c>with</c> block. Putting the check in each property's
/// <c>init</c> body — not in a one-time initializer expression — is what
/// makes <c>model with { State = ScreenState.Error }</c> re-validate against
/// whatever <see cref="Contract"/>/<see cref="Roster"/>/<see cref="Responses"/>
/// the copy carried over, instead of silently producing a roster this
/// screen's own state says cannot exist.
/// </para>
/// <para>
/// Not a positional record, unlike <c>SpikeScreenModel</c> before it: a
/// redeclared positional property whose <c>init</c> body does not read the
/// matching primary-constructor parameter directly is a compile error
/// (CS8907) — the compiler only lets a positional parameter feed a custom
/// accessor through a one-time initializer expression, and a one-time
/// initializer expression is exactly what does not rerun on <c>with</c> (see
/// above). <see cref="OathAndCoin.Simulation.Decisions.DecisionResult"/> and
/// <see cref="OathAndCoin.Simulation.Decisions.CausalTrace"/> face the same
/// constraint and are not positional records either, for the same reason.
/// </para>
/// </remarks>
public sealed record ContractOfferScreenModel
{
    private ScreenState _state;
    private ContractLine? _contract;
    private ImmutableArray<HeroCard> _roster;
    private ImmutableArray<ResponseLine> _responses;
    private string? _errorCode;
    private string? _errorDetail;

    private bool _stateAssigned;
    private bool _contractAssigned;
    private bool _rosterAssigned;
    private bool _responsesAssigned;
    private bool _errorCodeAssigned;
    private bool _errorDetailAssigned;

    public required ScreenState State
    {
        get => _state;
        init
        {
            _state = value;
            _stateAssigned = true;
            Validate();
        }
    }

    /// <summary>
    /// This screen's title — a localization key, never resolved text (TDD
    /// §11.1; see the remarks on <see cref="ContractOfferScreenModelFactory"/>).
    /// </summary>
    public required string TitleKey { get; init; }

    /// <summary>The contract on offer; <c>null</c> exactly when <see cref="State"/> has nothing to offer.</summary>
    public required ContractLine? Contract
    {
        get => _contract;
        init
        {
            _contract = value;
            _contractAssigned = true;
            Validate();
        }
    }

    /// <summary>Every hero in the campaign, in a fixed order; empty exactly when <see cref="State"/> has nothing to offer.</summary>
    public required ImmutableArray<HeroCard> Roster
    {
        get => _roster;
        init
        {
            _roster = RejectDefault(value, nameof(Roster));
            _rosterAssigned = true;
            Validate();
        }
    }

    /// <summary>One line per hero who has answered so far, in the order the scenario made them.</summary>
    public required ImmutableArray<ResponseLine> Responses
    {
        get => _responses;
        init
        {
            _responses = RejectDefault(value, nameof(Responses));
            _responsesAssigned = true;
            Validate();
        }
    }

    /// <summary>
    /// A stable, machine-comparable identifier when <see cref="State"/> is
    /// <see cref="ScreenState.Error"/>; <c>null</c> otherwise.
    /// </summary>
    public required string? ErrorCode
    {
        get => _errorCode;
        init
        {
            _errorCode = value;
            _errorCodeAssigned = true;
            Validate();
        }
    }

    /// <summary>
    /// The human-readable half of an error — deliberately excluded from
    /// <see cref="ContractOfferScreenModelFactory.ReadModelHash"/> (see its
    /// remarks): it can carry a machine-specific path or an OS message, and
    /// differs between runs of the same failure, so hashing it would make
    /// "the same error" look like a mismatch.
    /// </summary>
    public required string? ErrorDetail
    {
        get => _errorDetail;
        init
        {
            _errorDetail = value;
            _errorDetailAssigned = true;
            Validate();
        }
    }

    private static ImmutableArray<T> RejectDefault<T>(ImmutableArray<T> value, string propertyName) =>
        !value.IsDefault
            ? value
            : throw new ArgumentException(
                $"{propertyName} must not be a default(ImmutableArray<{typeof(T).Name}>); "
                + $"use ImmutableArray<{typeof(T).Name}>.Empty instead.",
                propertyName);

    /// <summary>
    /// Cross-field validation, run from every property's <c>init</c> accessor
    /// but only actually checked once every property below has been assigned
    /// at least once — see the remarks on this type for why that guard
    /// matters both for object-initializer order and for <c>with</c>.
    /// </summary>
    private void Validate()
    {
        if (!(_stateAssigned && _contractAssigned && _rosterAssigned && _responsesAssigned
            && _errorCodeAssigned && _errorDetailAssigned))
        {
            return;
        }

        if (_errorDetail is not null && _errorCode is null)
        {
            throw new ArgumentException(
                "ErrorDetail must not be set without ErrorCode: a detail with nothing to detail is not "
                + "an error, it is an orphaned string.",
                nameof(ErrorDetail));
        }

        switch (_state)
        {
            case ScreenState.Error:
                if (_errorCode is null)
                {
                    throw new ArgumentException("ErrorCode must be set when State is Error.", nameof(ErrorCode));
                }

                RequireNoContractContent();
                break;

            case ScreenState.Loading:
            case ScreenState.Empty:
                if (_errorCode is not null)
                {
                    throw new ArgumentException(
                        $"ErrorCode must be null when State is {_state}.", nameof(ErrorCode));
                }

                RequireNoContractContent();
                break;

            case ScreenState.Incomplete:
            case ScreenState.Normal:
                if (_errorCode is not null)
                {
                    throw new ArgumentException(
                        $"ErrorCode must be null when State is {_state}.", nameof(ErrorCode));
                }

                if (_contract is null)
                {
                    throw new ArgumentException(
                        $"Contract must not be null when State is {_state}: there is nothing to offer "
                        + "without one.",
                        nameof(Contract));
                }

                break;

            default:
                throw new ArgumentOutOfRangeException(nameof(State), _state, "Unknown screen state.");
        }
    }

    private void RequireNoContractContent()
    {
        if (_contract is not null || !_roster.IsEmpty || !_responses.IsEmpty)
        {
            throw new ArgumentException(
                $"Contract, Roster and Responses must all be empty when State is {_state}: a screen with "
                + "nothing to offer must not carry a roster from some other offer.",
                nameof(State));
        }
    }
}
