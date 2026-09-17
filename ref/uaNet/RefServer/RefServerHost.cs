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
}
