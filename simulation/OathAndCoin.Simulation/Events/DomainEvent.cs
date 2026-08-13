using OathAndCoin.Simulation.Ids;

namespace OathAndCoin.Simulation.Events;

/// <summary>
/// Base type for everything that happens in a campaign (ADR-007, planned —
/// TDD §21). Every event carries its own place in the log
/// (<see cref="EventId"/>), the
/// campaign's logical time when it happened, and — optionally — the id of a
/// <see cref="Decisions.CausalTrace"/> stored in
/// <see cref="State.GameState.Traces"/> that explains it. The trace itself
/// does not live on the event: only its id does, so the event stays small
/// and the explanation is looked up from state, not carried around
/// redundantly (see <see cref="State.GameState.WithEvent"/>).
/// </summary>
public abstract record DomainEvent(long EventId, long LogicalTime, long? CausalTraceId);

/// <summary>A hero accepted a contract offer.</summary>
public sealed record HeroAcceptedContract(
    long EventId,
    long LogicalTime,
    long? CausalTraceId,
    HeroId HeroId,
    ContentId ContractId) : DomainEvent(EventId, LogicalTime, CausalTraceId);

/// <summary>
/// A hero declined a contract offer. Declining does not close the offer for
/// other heroes — see <see cref="State.ContractStatus"/> and
/// <see cref="State.ContractState.RespondedBy"/>.
/// </summary>
public sealed record HeroDeclinedContract(
    long EventId,
    long LogicalTime,
    long? CausalTraceId,
    HeroId HeroId,
    ContentId ContractId) : DomainEvent(EventId, LogicalTime, CausalTraceId);
