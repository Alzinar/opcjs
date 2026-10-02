using System.Collections;
using System.Reflection;
using Opc.Ua;
using Opc.Ua.Server;

namespace RefServer;

/// <summary>
/// Minimal OPC UA server that hosts a single <see cref="RefNodeManager"/>.
/// </summary>
internal sealed class RefServerHost : StandardServer
{
    protected override MasterNodeManager CreateMasterNodeManager(
        IServerInternal server,
        ApplicationConfiguration configuration)
    {
        return new MasterNodeManager(
            server,
            configuration,
            dynamicNamespaceUri: null,
            new RefNodeManager(server, configuration));
    }

    /// <summary>
    /// Test-only hook for the Session Client Detect Shutdown conformance unit's ref test
    /// (see ref/opcjs/RefClientNode/tests/uaNet.test.ts): flips the real, standard
    /// <c>Server/ServerStatus/State</c> to <see cref="ServerState.Shutdown"/> using the SDK's
    /// own <see cref="StandardServer.SetServerState"/> — not part of the OPC UA protocol itself.
    /// </summary>
    public void SimulateShutdown() => SetServerState(ServerState.Shutdown);

    /// <summary>Reverses <see cref="SimulateShutdown"/>, restoring the normal reported state.</summary>
    public void SimulateRunning() => SetServerState(ServerState.Running);

    /// <summary>Number of sessions currently held by the server.</summary>
    public int SessionCount => ServerInternal.SessionManager.GetSessions().Count;

    /// <summary>Closes every session without notifying the clients.</summary>
    public void CloseSessions()
    {
        ISessionManager sessionManager = ServerInternal.SessionManager;
        foreach (ISession session in sessionManager.GetSessions())
        {
            sessionManager.CloseSession(session.Id);
        }
    }

    /// <summary>Appends <paramref name="uri"/> to the server's NamespaceArray (if absent) and returns its index.</summary>
    public int AddNamespace(string uri) => ServerInternal.NamespaceUris.GetIndexOrAppend(uri);

    /// <summary>Limits the number of concurrent sessions.</summary>
    public void SetMaxSessions(int count) => SetSessionManagerField("m_maxSessionCount", count);

    /// <summary>Sets the upper bound (ms) a client's requested session timeout is revised to.</summary>
    public void SetMaxSessionTimeout(int milliseconds) => SetSessionManagerField("m_maxSessionTimeout", milliseconds);

    // The SDK reads these limits from its configuration once at startup into private fields, with no
    // public way to change them at runtime.
    private void SetSessionManagerField(string name, int value)
    {
        object sessionManager = ServerInternal.SessionManager;
        FieldInfo field = sessionManager.GetType().GetField(name, BindingFlags.Instance | BindingFlags.NonPublic)
            ?? throw new InvalidOperationException($"SessionManager has no field {name}");
        field.SetValue(sessionManager, value);
    }

    /// <summary>
    /// Abruptly disposes every open transport channel while the listeners keep accepting new ones. The SDK has
    /// no public API for this, so it reaches into each listener's private channel table.
    /// </summary>
    public void DropConnections()
    {
        foreach (ITransportListener listener in TransportListeners)
        {
            FieldInfo? channels = listener.GetType().GetField("m_channels", BindingFlags.Instance | BindingFlags.NonPublic);
            if (channels?.GetValue(listener) is not IDictionary table)
            {
                continue;
            }
            foreach (object? channel in table.Values.Cast<object?>().ToArray())
            {
                (channel as IDisposable)?.Dispose();
            }
        }
    }
}

