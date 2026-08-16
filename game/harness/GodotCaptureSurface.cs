using System.Runtime.ExceptionServices;
using System.Security.Cryptography;
using Godot;
using OathAndCoin.GameProtocol;

namespace OathAndCoin.Game.Harness;

/// <summary>
/// The engine-side implementation of <see cref="ICaptureSurface"/>: the steps
/// only, never their order. <see cref="CaptureProtocol.Run"/> decides the
/// order — see its own remarks — and this class exists only to give each step
/// a real body: <see cref="AwaitProcessFrame"/> waits for
/// <see cref="SceneTree"/>'s <c>process_frame</c> signal,
/// <see cref="AwaitPostDraw"/> for <see cref="RenderingServer"/>'s
/// <c>frame_post_draw</c>, <see cref="Capture"/> reads back the viewport and
/// saves it.
/// </summary>
/// <remarks>
/// <para>
/// <b>Why this needs a worker thread.</b>
/// <see cref="CaptureProtocol.Run"/> is one synchronous call with no yield
/// point between <see cref="Bind"/>, <see cref="AwaitProcessFrame"/>,
/// <see cref="AwaitPostDraw"/>, <see cref="Capture"/>, <see cref="Emit"/> and
/// <see cref="Quit"/>. Godot's <c>process_frame</c> and <c>frame_post_draw</c>
/// signals only fire while the engine's own main loop is running — and on a
/// single-threaded loop, that only happens between calls into script code,
/// never during one. Calling <see cref="CaptureProtocol.Run"/> from the
/// engine's own thread (e.g. from <c>Main._Ready</c> directly) would
/// therefore deadlock the instant <see cref="AwaitProcessFrame"/> blocked:
/// the frame it is waiting for can only happen once that call returns, and a
/// blocking wait never returns early to let it.
/// </para>
/// <para>
/// The fix is to run <see cref="CaptureProtocol.Run"/> on a worker thread
/// instead, so the engine's own thread stays free to keep looping while the
/// worker blocks. Every method below that actually touches the engine —
/// connecting a signal, reading back a frame, quitting the tree — is
/// therefore marshaled onto the main thread through
/// <see cref="RunOnMainThread(Action)"/>, which posts the work with
/// <see cref="Callable.CallDeferred"/> and blocks the calling (worker) thread
/// on a <see cref="ManualResetEventSlim"/> until it has run. From the worker
/// thread's point of view — the only thread <see cref="ICaptureSurface"/>'s
/// synchronous, non-<see langword="async"/> methods are contracted to work
/// on — each call still looks like exactly what the interface promises: one
/// blocking step, done when the method returns.
/// </para>
/// </remarks>
public sealed class GodotCaptureSurface : ICaptureSurface
{
    private readonly Viewport _viewport;
    private readonly SceneTree _tree;
    private readonly string _screenshotPath;

    private readonly ManualResetEventSlim _processFrameSignal = new(initialState: false);
    private readonly ManualResetEventSlim _postDrawSignal = new(initialState: false);

    public GodotCaptureSurface(Viewport viewport, SceneTree tree, string screenshotPath)
    {
        _viewport = viewport ?? throw new ArgumentNullException(nameof(viewport));
        _tree = tree ?? throw new ArgumentNullException(nameof(tree));
        ArgumentException.ThrowIfNullOrEmpty(screenshotPath);
        _screenshotPath = screenshotPath;
    }

    /// <summary>
    /// Connects one-shot handlers to the two signals this capture waits on.
    /// One-shot because a capture surface drives exactly one checkpoint —
    /// a handler still connected after that would only mean a leaked
    /// connection, never a legitimate second wait.
    /// </summary>
    public void Bind() => RunOnMainThread(() =>
    {
        _tree.Connect(
            SceneTree.SignalName.ProcessFrame,
            Callable.From(() => _processFrameSignal.Set()),
            (uint)GodotObject.ConnectFlags.OneShot);

        RenderingServer.Singleton.Connect(
            RenderingServer.SignalName.FramePostDraw,
            Callable.From(() => _postDrawSignal.Set()),
            (uint)GodotObject.ConnectFlags.OneShot);
    });

    public void AwaitProcessFrame() => _processFrameSignal.Wait();

    public void AwaitPostDraw() => _postDrawSignal.Wait();

    public CaptureResult Capture() => RunOnMainThread(CaptureOnMainThread);

    /// <summary>
    /// Writes the wire-format line to stdout. Plain <see cref="Console"/> I/O,
    /// not a Godot API — it needs no marshaling to the main thread and runs
    /// directly on whichever thread <see cref="CaptureProtocol.Run"/> is
    /// driving from.
    /// </summary>
    public void Emit(string terminalLine) => Console.WriteLine(terminalLine);

    public void Quit(int code) => RunOnMainThread(() => _tree.Quit(code));

    /// <summary>
    /// Runs <paramref name="function"/> on the engine's own thread and hands
    /// back what it returned — the marshaling this class already does for
    /// every step of <see cref="ICaptureSurface"/>, made available to the one
    /// caller outside those steps that also has to touch the engine from the
    /// capture worker: the terminal line's own screen measurement, which is
    /// only meaningful once the tree has been laid out and drawn (see
    /// <c>ContractOfferScreen.Measure</c>). Exposed rather than duplicated in
    /// <c>Main</c>: a second hand-written copy of <see cref="RunOnMainThread{T}(Func{T})"/>
    /// is exactly where this file's own overload-resolution bug lived, and
    /// once was enough.
    /// </summary>
    public T OnEngineThread<T>(Func<T> function) => RunOnMainThread(function);

    private CaptureResult CaptureOnMainThread()
    {
        var image = _viewport.GetTexture().GetImage();

        var fullPath = Path.GetFullPath(_screenshotPath);
        var directory = Path.GetDirectoryName(fullPath);
        if (!string.IsNullOrEmpty(directory))
        {
            Directory.CreateDirectory(directory);
        }

        var saveError = image.SavePng(fullPath);
        if (saveError != Error.Ok)
        {
            return CaptureResult.Failure($"Saving the frame to '{fullPath}' failed: {saveError}.");
        }

        // Hashed from the bytes actually on disk, not from the in-memory
        // Image: a tool reading this back later reads the file, and nothing
        // here guarantees a second in-memory PNG encoding is byte-identical
        // to what SavePng just wrote.
        var frameBytes = File.ReadAllBytes(fullPath);
        var frameSha256 = Convert.ToHexString(SHA256.HashData(frameBytes)).ToLowerInvariant();

        return CaptureResult.Success(frameSha256, image.GetWidth(), image.GetHeight(), CountDistinctColors(image));
    }

    /// <summary>
    /// Counts distinct colors from the image's raw bytes rather than calling
    /// <see cref="Image.GetPixel"/> once per pixel — at 1280x720 that is
    /// close to a million marshaled engine calls for one screenshot, and the
    /// raw buffer answers the same question directly.
    /// </summary>
    private static int CountDistinctColors(Image image)
    {
        image.Convert(Image.Format.Rgba8);
        var data = image.GetData();

        var seen = new HashSet<uint>();
        for (var offset = 0; offset + 3 < data.Length; offset += 4)
        {
            var packed = (uint)((data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]);
            seen.Add(packed);
        }

        return seen.Count;
    }

    /// <summary>
    /// Runs <paramref name="action"/> on the main thread via
    /// <see cref="Callable.CallDeferred"/> and blocks the calling thread until
    /// it has finished — see the remarks on this class for why every actual
    /// engine call goes through this.
    /// </summary>
    private void RunOnMainThread(Action action)
    {
        Exception? failure = null;
        using var completed = new ManualResetEventSlim(initialState: false);

        Callable.From(() =>
        {
            try
            {
                action();
            }
            catch (Exception exception)
            {
                failure = exception;
            }
            finally
            {
                completed.Set();
            }
        }).CallDeferred();

        completed.Wait();

        if (failure is not null)
        {
            // Rethrown with its original stack trace preserved, rather than
            // wrapped, so a failure inside a deferred engine call still
            // points at where it actually happened.
            ExceptionDispatchInfo.Capture(failure).Throw();
        }
    }

    private T RunOnMainThread<T>(Func<T> function)
    {
        var result = default(T);

        // A statement body, not the expression form `() => result =
        // function()`. An expression lambda whose body has a value is
        // convertible to both Action and Func<T>, and overload resolution
        // prefers Func<T> — which is this method itself. The expression form
        // therefore called this overload again, once per frame of an
        // infinite recursion, and the first real capture run died with
        // STATUS_STACK_OVERFLOW (exit code -1073741571) before the engine
        // had drawn anything. A statement body with no return value is
        // convertible to Action alone, so the intended overload is the only
        // candidate.
        RunOnMainThread(() => { result = function(); });

        return result!;
    }
}
