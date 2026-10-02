using System.Xml;
using Opc.Ua;
using Opc.Ua.Server;

namespace RefServer;

/// <summary>
/// Node manager that exposes the address space shared by all RefServers (see "Common address
/// space" in ref/README.md) in the custom namespace <c>http://opcjs.dev/UA/RefServer/</c>.
/// Expected values are verified by ref/opcjs/RefClientNode/tests/commonAddressSpace.ts.
/// </summary>
internal sealed class RefNodeManager : CustomNodeManager2
{
    private const string NamespaceUri = "http://opcjs.dev/UA/RefServer/";
    private const int ManyChildrenCount = 150;
    private const int LargeArrayLength = 20_000;

    private static readonly Guid[] GuidValues =
    {
        Guid.Parse("72962b91-fa75-4ae6-8d28-b404dc7daf63"),
        Guid.Parse("1b4e28ba-2fa1-11d2-883f-b9a761bde3fb"),
    };

    private IDictionary<NodeId, IList<IReference>> _externalReferences = null!;
    private BaseDataVariableState? _integerVariable;
    private BaseDataVariableState? _triangleVariable;
    private Timer? _changeTimer;
    private int _triangle;
    private int _triangleStep = 1;

    public RefNodeManager(IServerInternal server, ApplicationConfiguration configuration)
        : base(server, configuration, NamespaceUri)
    {
    }

    public override void CreateAddressSpace(IDictionary<NodeId, IList<IReference>> externalReferences)
    {
        lock (Lock)
        {
            _externalReferences = externalReferences;

            _integerVariable = CreateVariable(null, "Integer", DataTypeIds.Int32, ValueRanks.Scalar, 0);
            AddToObjectsFolder(_integerVariable);
            AddToObjectsFolder(CreateVariable(null, "Int64Array", DataTypeIds.Int64, ValueRanks.OneDimension, new long[] { 0 }));

            AddScalarsAndArrays();
            AddNodeIds();
            AddAccessLevelVariants();
            AddManyChildren();
            AddMethods();
            AddBaseInfo();

            _triangleVariable = CreateVariable(null, "Triangle", DataTypeIds.Double, ValueRanks.Scalar, 0.0);
            AddToObjectsFolder(_triangleVariable);
        }

        // Change the Integer and Triangle variables periodically so subscribing clients observe
        // changing values, without requiring a client-initiated Write.
        _changeTimer = new Timer(ChangeValues, null, 200, 200);
    }

    private void AddScalarsAndArrays()
    {
        FolderState scalars = CreateFolder("Scalars");
        FolderState arrays = CreateFolder("Arrays");

        var types = new (string Name, NodeId DataType, object First, object Second, Func<object[], object> MakeArray)[]
        {
            ("Boolean", DataTypeIds.Boolean, true, false, v => v.Cast<bool>().ToArray()),
            ("SByte", DataTypeIds.SByte, (sbyte)-5, (sbyte)5, v => v.Cast<sbyte>().ToArray()),
            ("Byte", DataTypeIds.Byte, (byte)5, (byte)250, v => v.Cast<byte>().ToArray()),
            ("Int16", DataTypeIds.Int16, (short)-300, (short)300, v => v.Cast<short>().ToArray()),
            ("UInt16", DataTypeIds.UInt16, (ushort)300, (ushort)60000, v => v.Cast<ushort>().ToArray()),
            ("Int32", DataTypeIds.Int32, -70000, 70000, v => v.Cast<int>().ToArray()),
            ("UInt32", DataTypeIds.UInt32, 70000u, 4000000000u, v => v.Cast<uint>().ToArray()),
            ("Int64", DataTypeIds.Int64, -5000000000L, 5000000000L, v => v.Cast<long>().ToArray()),
            ("UInt64", DataTypeIds.UInt64, 5000000000UL, 10000000000UL, v => v.Cast<ulong>().ToArray()),
            ("Float", DataTypeIds.Float, 1.5f, -2.5f, v => v.Cast<float>().ToArray()),
            ("Double", DataTypeIds.Double, 2.25, -4.5, v => v.Cast<double>().ToArray()),
            ("String", DataTypeIds.String, "hello", "world", v => v.Cast<string>().ToArray()),
            ("DateTime", DataTypeIds.DateTime,
                new DateTime(2020, 1, 1, 0, 0, 0, DateTimeKind.Utc), new DateTime(2021, 6, 15, 12, 30, 45, DateTimeKind.Utc),
                v => v.Cast<DateTime>().ToArray()),
            ("Guid", DataTypeIds.Guid, new Uuid(GuidValues[0]), new Uuid(GuidValues[1]), v => v.Cast<Uuid>().ToArray()),
            ("ByteString", DataTypeIds.ByteString, new byte[] { 1, 2, 3, 4 }, new byte[] { 5, 6 }, v => v.Cast<byte[]>().ToArray()),
            ("XmlElement", DataTypeIds.XmlElement, ToXml("<a>b</a>"), ToXml("<c>d</c>"), v => v.Cast<XmlElement>().ToArray()),
            ("NodeId", DataTypeIds.NodeId, new NodeId("Integer", NamespaceIndex), new NodeId(85u), v => v.Cast<NodeId>().ToArray()),
            ("ExpandedNodeId", DataTypeIds.ExpandedNodeId,
                new ExpandedNodeId(new NodeId("Integer", NamespaceIndex)), new ExpandedNodeId(new NodeId(85u)),
                v => v.Cast<ExpandedNodeId>().ToArray()),
            ("StatusCode", DataTypeIds.StatusCode, new StatusCode(StatusCodes.BadUnexpectedError), new StatusCode(StatusCodes.Good),
                v => v.Cast<StatusCode>().ToArray()),
            ("QualifiedName", DataTypeIds.QualifiedName, new QualifiedName("qname", NamespaceIndex), new QualifiedName("other", 0),
                v => v.Cast<QualifiedName>().ToArray()),
            ("LocalizedText", DataTypeIds.LocalizedText, new LocalizedText("en", "text"), new LocalizedText("de", "Text"),
                v => v.Cast<LocalizedText>().ToArray()),
        };

        foreach (var (name, dataType, first, second, makeArray) in types)
        {
            scalars.AddChild(CreateVariable(scalars, $"Scalar_{name}", dataType, ValueRanks.Scalar, first));
            arrays.AddChild(CreateVariable(arrays, $"Array_{name}", dataType, ValueRanks.OneDimension, makeArray(new[] { first, second })));
        }

        scalars.AddChild(CreateVariable(scalars, "Scalar_Variant", DataTypeIds.BaseDataType, ValueRanks.Scalar, "variant"));
        scalars.AddChild(CreateVariable(scalars, "Scalar_ExtensionObject", DataTypeIds.Structure, ValueRanks.Scalar,
            new ExtensionObject(new Opc.Ua.Range { Low = 1.5, High = 9.5 })));
        scalars.AddChild(CreateVariable(scalars, "Scalar_DataValue", DataTypeIds.DataValue, ValueRanks.Scalar,
            new DataValue(new Variant(7), StatusCodes.Good)));
        scalars.AddChild(CreateVariable(scalars, "Scalar_DiagnosticInfo", DataTypeIds.DiagnosticInfo, ValueRanks.Scalar,
            new DiagnosticInfo { SymbolicId = 1, AdditionalInfo = "info" }));

        // Larger than a single chunk, so reads/writes exercise multi-chunk messages.
        arrays.AddChild(CreateVariable(arrays, "LargeDoubleArray", DataTypeIds.Double, ValueRanks.OneDimension,
            Enumerable.Range(0, LargeArrayLength).Select(index => (double)index).ToArray()));

        AddToObjectsFolder(scalars);
        AddToObjectsFolder(arrays);
    }

    private void AddNodeIds()
    {
        FolderState nodeIds = CreateFolder("NodeIds");
        var identifiers = new (string Name, NodeId NodeId, int Value)[]
        {
            ("Id_Numeric", new NodeId(1000u, NamespaceIndex), 1),
            ("Id_String", new NodeId("Id_String", NamespaceIndex), 2),
            ("Id_Guid", new NodeId(GuidValues[1], NamespaceIndex), 3),
            ("Id_Opaque", new NodeId(new byte[] { 1, 2, 3, 4 }, NamespaceIndex), 4),
        };
        foreach (var (name, nodeId, value) in identifiers)
        {
            BaseDataVariableState variable = CreateVariable(nodeIds, name, DataTypeIds.Int32, ValueRanks.Scalar, value);
            variable.NodeId = nodeId;
            nodeIds.AddChild(variable);
        }
        AddToObjectsFolder(nodeIds);
    }

    private void AddAccessLevelVariants()
    {
        AddToObjectsFolder(CreateVariable(null, "ReadOnly_Int32", DataTypeIds.Int32, ValueRanks.Scalar, 42, AccessLevels.CurrentRead));
        AddToObjectsFolder(CreateVariable(null, "WriteOnly_Int32", DataTypeIds.Int32, ValueRanks.Scalar, 42, AccessLevels.CurrentWrite));
        AddToObjectsFolder(CreateVariable(null, "Timestamped_Int32", DataTypeIds.Int32, ValueRanks.Scalar, 42,
            (byte)(AccessLevels.CurrentReadOrWrite | AccessLevels.StatusWrite | AccessLevels.TimestampWrite)));

        BaseDataVariableState historizing = CreateVariable(null, "Historizing_Int32", DataTypeIds.Int32, ValueRanks.Scalar, 42,
            (byte)(AccessLevels.CurrentRead | AccessLevels.HistoryRead));
        historizing.Historizing = true;
        AddToObjectsFolder(historizing);

        AddToObjectsFolder(CreateVariable(null, "Static_Int32", DataTypeIds.Int32, ValueRanks.Scalar, 7));
    }

    private void AddManyChildren()
    {
        FolderState manyChildren = CreateFolder("ManyChildren");
        for (int index = 0; index < ManyChildrenCount; index++)
        {
            manyChildren.AddChild(CreateVariable(manyChildren, $"Child_{index:D3}", DataTypeIds.Int32, ValueRanks.Scalar, index));
        }
        AddToObjectsFolder(manyChildren);
    }

    private void AddMethods()
    {
        var methods = new BaseObjectState(null)
        {
            NodeId = new NodeId("Methods", NamespaceIndex),
            BrowseName = new QualifiedName("Methods", NamespaceIndex),
            DisplayName = new LocalizedText("Methods"),
            TypeDefinitionId = ObjectTypeIds.BaseObjectType,
            ReferenceTypeId = ReferenceTypeIds.Organizes,
            EventNotifier = EventNotifiers.None,
        };

        MethodState add = CreateMethod(methods, "Add",
            new[] { new Argument { Name = "a", DataType = DataTypeIds.Int32, ValueRank = ValueRanks.Scalar },
                    new Argument { Name = "b", DataType = DataTypeIds.Int32, ValueRank = ValueRanks.Scalar } },
            new[] { new Argument { Name = "sum", DataType = DataTypeIds.Int32, ValueRank = ValueRanks.Scalar } });
        add.OnCallMethod = (_, _, input, output) =>
        {
            output[0] = unchecked((int)input[0] + (int)input[1]);
            return ServiceResult.Good;
        };

        // Slow(ms): completes after `ms` milliseconds, or fails with BadRequestCancelledByClient when cancelled (Cancel service).
        MethodState slow = CreateMethod(methods, "Slow",
            new[] { new Argument { Name = "ms", DataType = DataTypeIds.UInt32, ValueRank = ValueRanks.Scalar } },
            Array.Empty<Argument>());
        slow.OnCallMethod2Async = async (_, _, _, input, _, cancellationToken) =>
        {
            try
            {
                await Task.Delay((int)(uint)input[0], cancellationToken);
                return ServiceResult.Good;
            }
            catch (OperationCanceledException)
            {
                return new ServiceResult(StatusCodes.BadRequestCancelledByClient);
            }
        };

        AddToObjectsFolder(methods);
    }

    private MethodState CreateMethod(NodeState parent, string name, Argument[] inputs, Argument[] outputs)
    {
        string baseId = $"{(string)parent.NodeId.Identifier}.{name}";
        var method = new MethodState(parent)
        {
            NodeId = new NodeId(baseId, NamespaceIndex),
            BrowseName = new QualifiedName(name, NamespaceIndex),
            DisplayName = new LocalizedText(name),
            ReferenceTypeId = ReferenceTypeIds.HasComponent,
            Executable = true,
            UserExecutable = true,
        };
        method.InputArguments = CreateArgumentsProperty(method, $"{baseId}.InputArguments", BrowseNames.InputArguments, inputs);
        method.OutputArguments = CreateArgumentsProperty(method, $"{baseId}.OutputArguments", BrowseNames.OutputArguments, outputs);
        parent.AddChild(method);
        return method;
    }

    private PropertyState<Argument[]> CreateArgumentsProperty(NodeState parent, string nodeId, string browseName, Argument[] arguments)
    {
        return new PropertyState<Argument[]>(parent)
        {
            NodeId = new NodeId(nodeId, NamespaceIndex),
            BrowseName = browseName,
            DisplayName = browseName,
            TypeDefinitionId = VariableTypeIds.PropertyType,
            ReferenceTypeId = ReferenceTypeIds.HasProperty,
            DataType = DataTypeIds.Argument,
            ValueRank = ValueRanks.OneDimension,
            Value = arguments,
        };
    }

    private void AddBaseInfo()
    {
        BaseDataVariableState temperature = CreateVariable(null, "Temperature", DataTypeIds.Double, ValueRanks.Scalar, 20.0);
        AddProperty(temperature, "EngineeringUnits", DataTypeIds.EUInformation, ValueRanks.Scalar, new EUInformation
        {
            NamespaceUri = "http://www.opcfoundation.org/UA/units/un/cefact",
            UnitId = 4408652,
            DisplayName = new LocalizedText("°C"),
            Description = new LocalizedText("degree Celsius"),
        });
        AddProperty(temperature, "EURange", DataTypeIds.Range, ValueRanks.Scalar, new Opc.Ua.Range { Low = 0, High = 100 });
        AddToObjectsFolder(temperature);

        BaseDataVariableState price = CreateVariable(null, "Price", DataTypeIds.Double, ValueRanks.Scalar, 0.0);
        AddProperty(price, "CurrencyUnit", new NodeId(23498u), ValueRanks.Scalar, new CurrencyUnitType
        {
            NumericCode = 978,
            Exponent = 2,
            AlphabeticCode = "EUR",
            Currency = new LocalizedText("Euro"),
        });
        AddToObjectsFolder(price);

        BaseDataVariableState mode = CreateVariable(null, "Mode", DataTypeIds.String, ValueRanks.Scalar, "Auto");
        AddProperty(mode, "Selections", DataTypeIds.String, ValueRanks.OneDimension, new[] { "Auto", "Manual", "Off" });
        AddProperty(mode, "SelectionDescriptions", DataTypeIds.LocalizedText, ValueRanks.OneDimension, new[]
        {
            new LocalizedText("Automatic control"), new LocalizedText("Manual control"), new LocalizedText("Disabled"),
        });
        AddProperty(mode, "RestrictToList", DataTypeIds.Boolean, ValueRanks.Scalar, true);
        AddToObjectsFolder(mode);
    }

    private void AddProperty<T>(BaseDataVariableState owner, string name, NodeId dataType, int valueRank, T value)
    {
        var property = new PropertyState<T>(owner)
        {
            NodeId = new NodeId($"{(string)owner.NodeId.Identifier}.{name}", NamespaceIndex),
            BrowseName = new QualifiedName(name, NamespaceIndex),
            DisplayName = new LocalizedText(name),
            TypeDefinitionId = VariableTypeIds.PropertyType,
            ReferenceTypeId = ReferenceTypeIds.HasProperty,
            DataType = dataType,
            ValueRank = valueRank,
            AccessLevel = AccessLevels.CurrentRead,
            UserAccessLevel = AccessLevels.CurrentRead,
            Value = value,
        };
        owner.AddChild(property);
    }

    private FolderState CreateFolder(string name)
    {
        return new FolderState(null)
        {
            NodeId = new NodeId(name, NamespaceIndex),
            BrowseName = new QualifiedName(name, NamespaceIndex),
            DisplayName = new LocalizedText(name),
            TypeDefinitionId = ObjectTypeIds.FolderType,
            ReferenceTypeId = ReferenceTypeIds.Organizes,
            EventNotifier = EventNotifiers.None,
        };
    }

    private BaseDataVariableState CreateVariable(
        NodeState? parent, string name, NodeId dataType, int valueRank, object value, byte accessLevel = AccessLevels.CurrentReadOrWrite)
    {
        var variable = new BaseDataVariableState(parent)
        {
            NodeId = new NodeId(name, NamespaceIndex),
            BrowseName = new QualifiedName(name, NamespaceIndex),
            DisplayName = new LocalizedText(name),
            TypeDefinitionId = VariableTypeIds.BaseDataVariableType,
            ReferenceTypeId = ReferenceTypeIds.Organizes,
            DataType = dataType,
            ValueRank = valueRank,
            AccessLevel = accessLevel,
            UserAccessLevel = accessLevel,
            Value = value,
        };
        if (valueRank == ValueRanks.OneDimension)
        {
            variable.ArrayDimensions = new ReadOnlyList<uint>(new List<uint> { 0 });
        }
        return variable;
    }

    /// <summary>Links <paramref name="node"/> (and, recursively, its children) below the standard Objects folder.</summary>
    private void AddToObjectsFolder(NodeState node)
    {
        node.AddReference(ReferenceTypeIds.Organizes, true, ObjectIds.ObjectsFolder);

        if (!_externalReferences.TryGetValue(ObjectIds.ObjectsFolder, out IList<IReference>? references))
        {
            _externalReferences[ObjectIds.ObjectsFolder] = references = new List<IReference>();
        }
        references.Add(new NodeStateReference(ReferenceTypeIds.Organizes, false, node.NodeId));

        AddPredefinedNode(SystemContext, node);
    }

    private static XmlElement ToXml(string xml)
    {
        var document = new XmlDocument();
        document.LoadXml(xml);
        return document.DocumentElement!;
    }

    private void ChangeValues(object? state)
    {
        lock (Lock)
        {
            if (_integerVariable is null || _triangleVariable is null)
            {
                return;
            }

            _integerVariable.Value = ((int)_integerVariable.Value) + 1;
            _integerVariable.Timestamp = DateTime.UtcNow;
            _integerVariable.ClearChangeMasks(SystemContext, false);

            _triangle += _triangleStep;
            if (_triangle >= 100 || _triangle <= 0)
            {
                _triangleStep = -_triangleStep;
            }
            _triangleVariable.Value = (double)_triangle;
            _triangleVariable.Timestamp = DateTime.UtcNow;
            _triangleVariable.ClearChangeMasks(SystemContext, false);
        }
    }
}
