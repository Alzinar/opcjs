using Opc.Ua;
using Opc.Ua.Server;

namespace RefServer;

/// <summary>
/// Node manager that exposes a single writable Int32 variable ("Integer")
/// under the standard Objects folder.
/// </summary>
internal sealed class RefNodeManager : CustomNodeManager2
{
    private const string NamespaceUri = "http://opcjs.dev/UA/RefServer/";

    public RefNodeManager(IServerInternal server, ApplicationConfiguration configuration)
        : base(server, configuration, NamespaceUri)
    {
    }

    public override void CreateAddressSpace(IDictionary<NodeId, IList<IReference>> externalReferences)
    {
        lock (Lock)
        {
            var integerVariable = new BaseDataVariableState(null)
            {
                NodeId = new NodeId("Integer", NamespaceIndex),
                BrowseName = new QualifiedName("Integer", NamespaceIndex),
                DisplayName = new LocalizedText("Integer"),
                TypeDefinitionId = VariableTypeIds.BaseDataVariableType,
                ReferenceTypeId = ReferenceTypeIds.Organizes,
                DataType = DataTypeIds.Int32,
                ValueRank = ValueRanks.Scalar,
                AccessLevel = AccessLevels.CurrentReadOrWrite,
                UserAccessLevel = AccessLevels.CurrentReadOrWrite,
                Value = 0,
            };

            // Link the variable to the standard Objects folder in both directions
            // so it shows up when browsing from the root of the address space.
            integerVariable.AddReference(ReferenceTypeIds.Organizes, true, ObjectIds.ObjectsFolder);

            if (!externalReferences.TryGetValue(ObjectIds.ObjectsFolder, out IList<IReference>? references))
            {
                externalReferences[ObjectIds.ObjectsFolder] = references = new List<IReference>();
            }
            references.Add(new NodeStateReference(ReferenceTypeIds.Organizes, false, integerVariable.NodeId));

            AddPredefinedNode(SystemContext, integerVariable);
        }
    }
}
