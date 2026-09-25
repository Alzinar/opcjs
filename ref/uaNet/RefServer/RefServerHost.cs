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
    /// (see ref/opcjs/RefClient/tests/uaNet.test.ts): flips the real, standard
    /// <c>Server/ServerStatus/State</c> to <see cref="ServerState.Shutdown"/> using the SDK's
    /// own <see cref="StandardServer.SetServerState"/> — not part of the OPC UA protocol itself.
    /// </summary>
    public void SimulateShutdown() => SetServerState(ServerState.Shutdown);

    /// <summary>Reverses <see cref="SimulateShutdown"/>, restoring the normal reported state.</summary>
    public void SimulateRunning() => SetServerState(ServerState.Running);
}

