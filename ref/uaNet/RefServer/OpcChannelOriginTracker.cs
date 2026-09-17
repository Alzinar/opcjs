using System.Collections.Concurrent;

namespace RefServer;

/// <summary>
/// Tracks whether an OPC-UA WebSocket channel originated from a local (loopback)
/// or external network address.
/// </summary>
/// <remarks>
/// <see cref="WebSockets.WebSocketTransportListener"/> registers a channel's origin here
/// while it still has the <c>HttpContext</c> (at WebSocket upgrade time); the record is
/// keyed by the channel's <c>GlobalChannelId</c>, which equals <c>session.SecureChannelId</c>
/// once a session is activated on that channel, so later session-scoped code can look up
/// whether a given session came from a loopback connection.
/// </remarks>
internal static class OpcChannelOriginTracker
{
    // Maps globalChannelId → isLocal (true = loopback, false = external/unknown).
    // ConcurrentDictionary is used because registration happens on the WebSocket accept
    // thread while lookups happen on session-manager threads.
    private static readonly ConcurrentDictionary<string, bool> channelOrigins = new();

    /// <summary>
    /// Registers the network origin of a newly established WebSocket channel.
    /// Call this immediately after <c>channel.Attach()</c> while <c>GlobalChannelId</c>
    /// is available.
    /// </summary>
    /// <param name="globalChannelId">The channel's global ID (<c>channel.GlobalChannelId</c>).</param>
    /// <param name="isLocal">
    /// <c>true</c> when <c>RemoteIpAddress</c> is a loopback address; <c>false</c> otherwise.
    /// </param>
    public static void Register(string globalChannelId, bool isLocal)
    {
        channelOrigins[globalChannelId] = isLocal;
    }

    /// <summary>
    /// Removes the origin record for a closed channel. Safe to call even if the
    /// channel was never registered (e.g. rejected before <c>Attach</c>).
    /// </summary>
    /// <param name="globalChannelId">The channel's global ID.</param>
    public static void Remove(string globalChannelId)
    {
        channelOrigins.TryRemove(globalChannelId, out _);
    }

    /// <summary>
    /// Returns whether the channel was opened from a local (loopback) address.
    /// </summary>
    /// <param name="globalChannelId">
    /// The channel's global ID, typically from <c>session.SecureChannelId</c>.
    /// </param>
    /// <returns>
    /// <c>true</c> when the channel was opened from a loopback address;
    /// <c>false</c> when the origin is external or the channel is not registered.
    /// </returns>
    public static bool IsLocal(string? globalChannelId) =>
        globalChannelId is not null
        && channelOrigins.TryGetValue(globalChannelId, out var isLocal)
        && isLocal;
}
