using OathAndCoin.Simulation.Ids;

namespace OathAndCoin.Simulation.Decisions;

/// <summary>
/// The fixed action vocabulary a hero's decision selects from
/// (<see cref="DecisionResult.SelectedAction"/>,
/// <see cref="DecisionResult.ConsideredActions"/>). These are actions, not
/// targets — which hero and which contract a decision concerned is carried
/// by the <see cref="Events.DomainEvent"/> the decision produces, not by the
/// action or by <see cref="CausalTrace"/> (see the remarks on
/// <see cref="CausalTrace"/>).
/// </summary>
/// <remarks>
/// Declared here as named constants — not built inline via
/// <c>ContentId.Parse("action:accept")</c> at each call site — for the same
/// reason <see cref="ReasonCodes"/> is: a value assembled ad hoc at the call
/// site can drift from every other call site that assembles "the same"
/// value independently.
///
/// <c>action:accept</c> and <c>action:decline</c> are fixed engine actions,
/// never content: no content pack defines an <c>action:</c>-namespaced
/// <see cref="ContentId"/>, and a content loader/validator must not attempt
/// to resolve these against loaded content — they do not need to exist
/// there, by design.
/// </remarks>
public static class Actions
{
    public static readonly ContentId Accept = ContentId.Parse("action:accept");
    public static readonly ContentId Decline = ContentId.Parse("action:decline");
}
