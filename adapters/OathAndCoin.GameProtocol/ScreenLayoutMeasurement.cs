namespace OathAndCoin.GameProtocol;

/// <summary>
/// What a rendered screen measured about itself: how big its content really
/// is, and how much of that a person at this window can reach. The four
/// <c>layout_*</c> fields of <see cref="TerminalEvent"/>, kept together as one
/// value so the game builds them in one place and cannot hand the terminal
/// line a width where a height belongs.
/// </summary>
/// <remarks>
/// Lives in the protocol assembly beside <see cref="TerminalEvent"/> rather
/// than in <c>game/</c>: <c>game/</c> has no test project, and this is a
/// value both sides of the process boundary talk about. It states facts and
/// judges nothing — whether content that does not fit is a failed run is the
/// tool's decision (<c>SmokeVerdict</c>), the same division
/// <see cref="TerminalEvent.FrameDistinctColors"/> already follows.
/// </remarks>
/// <param name="ContentWidth">The content's own natural width in pixels, before any clipping.</param>
/// <param name="ContentHeight">The content's own natural height in pixels, before any clipping.</param>
/// <param name="ReachableWidth">The window's width plus however far the content can be scrolled sideways.</param>
/// <param name="ReachableHeight">The window's height plus however far the content can be scrolled down.</param>
public sealed record ScreenLayoutMeasurement(
    int ContentWidth, int ContentHeight, int ReachableWidth, int ReachableHeight);
