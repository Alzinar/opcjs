import {
  type NodeId,
  DataValue,
  StatusCode,
  Variant,
  QualifiedName,
  LocalizedText,
  NodeId as NodeIdClass,
  ExtensionObject,
  SamplingIntervalDiagnosticsDataType,
  ServerStatusDataType,
  BuildInfo,
  ServerStateEnum,
  TimeZoneDataType,
  EUInformation,
  CurrencyUnitType,
  uaByte,
  uaDouble,
  uaUint32,
  uaInt32,
} from 'opcjs-base'
import type { IAddressSpace } from './iAddressSpace.js'
import {
  ObjectNode,
  VariableNode,
  ObjectTypeNode,
  VariableTypeNode,
  ReferenceTypeNode,
  DataTypeNode,
  MethodNode,
  ViewNode,
  OpcUaNode,
  AccessLevelFlags,
  AccessLevelExFlags,
  AttributeId,
} from './node.js'
import { ObjectIds, ObjectTypeIds, ReferenceTypeIds, VariableTypeIds, DataTypeIds, CustomIds } from './wellKnownIds.js'
import { MAX_MONITORED_ITEMS_QUEUE_SIZE } from '../subscription/monitoredItem.js'

// Authoritative server identity strings used in standard address-space nodes.
const SERVER_URI = 'urn:opcjs-server:default-instance'
const OPCUA_NAMESPACE_URI = 'http://opcfoundation.org/UA/'
const SERVER_NAMESPACE_URI = 'urn:opcjs-server:default-namespace'
const CORE_2022_SERVER_FACET_URI = 'http://opcfoundation.org/UA-Profile/Server/Core2022Facet'

const stringTypeId = NodeIdClass.newNumeric(0, DataTypeIds.String)
const uint32TypeId = NodeIdClass.newNumeric(0, DataTypeIds.UInt32)
const doubleTypeId = NodeIdClass.newNumeric(0, DataTypeIds.Double)

// `Variant.newFrom` cannot infer an element BuiltInType from an empty array;
// reuse the type tag from a throwaway single-element ExtensionObject array
// instead (see `samplingIntervalDiagnosticsVariant` below).
const EXTENSION_OBJECT_ARRAY_TYPE = Variant.newFrom([ExtensionObject.newEmpty()]).type

/** Builds the `SamplingIntervalDiagnosticsArray` Value Variant, valid even when `items` is empty. */
function samplingIntervalDiagnosticsVariant(items: SamplingIntervalDiagnosticsDataType[]): Variant {
  if (items.length === 0) return new Variant(EXTENSION_OBJECT_ARRAY_TYPE, [])
  return Variant.newFrom(items.map(d => ExtensionObject.newBinary(d)))
}
const booleanTypeId = NodeIdClass.newNumeric(0, DataTypeIds.Boolean)
const nodeIdTypeId = NodeIdClass.newNumeric(0, DataTypeIds.NodeId)

/**
 * In-memory address space implementing the Address Space Base, Base Info
 * Core Structure 2, and Base Info Server Capabilities 2 conformance units.
 *
 * Nodes are stored in a `Map<string, OpcUaNode>` keyed by `NodeId.toString()`.
 * The standard entry points (`Root`, `Objects`, `Types`), the built-in
 * ReferenceType hierarchy, a handful of representative ObjectType /
 * VariableType / DataType nodes, and the `Server` object (with
 * `ServerCapabilities` and `OperationLimits`) are pre-populated at
 * construction time.
 */
export class AddressSpace implements IAddressSpace {
  private readonly nodes = new Map<string, OpcUaNode>()
  /** `Server/ServerDiagnostics/EnabledFlag` \u2014 gates {@link samplingIntervalDiagnosticsArray}. */
  private serverDiagnosticsEnabledFlag!: VariableNode
  /** `Server/ServerDiagnostics/SamplingIntervalDiagnosticsArray` \u2014 wired to live data by {@link wireSubscriptionDiagnostics}. */
  private samplingIntervalDiagnosticsArray!: VariableNode
  /** `Server/NamespaceArray` (ns=0;i=2255) \u2014 appended to by {@link addNamespace}. */
  private namespaceArray!: VariableNode
  /** `Server/ServerStatus/State` \u2014 mutated by {@link setServerState} to simulate a shutdown announcement. */
  private serverState: ServerStateEnum = ServerStateEnum.Running
  /** `Server/ServerStatus/EstimatedReturnTime` (ns=0;i=2992) node \u2014 written to by {@link setServerState}. */
  private serverStatusEstimatedReturnTime!: VariableNode

  constructor() {
    this.populateReferenceTypes()
    this.populateTypeSystem()
    this.populateCoreStructure()
    this.populateServerObject()
    this.populateOptionalExtras()
  }

  /**
   * Wires `Server/ServerDiagnostics/SamplingIntervalDiagnosticsArray` to live
   * data from the server's `SubscriptionManager` (Base Info Fixed
   * SamplingInterval CU). While `EnabledFlag` is `false` the array reads as
   * empty, per Part 5 §6.3.13. Called from `OpcUaServer.start()`.
   */
  wireSubscriptionDiagnostics(getDiagnostics: () => SamplingIntervalDiagnosticsDataType[]): void {
    this.samplingIntervalDiagnosticsArray.setValueProvider(() => {
      const enabled = this.serverDiagnosticsEnabledFlag.read(AttributeId.Value).value?.value === true
      return samplingIntervalDiagnosticsVariant(enabled ? getDiagnostics() : [])
    })
  }

  /**
   * Registers `uri` as an additional namespace, appending it to
   * `Server/NamespaceArray` (ns=0;i=2255) and returning its assigned
   * namespace index. ns=0 (`http://opcfoundation.org/UA/`) and ns=1 (this
   * server's own default namespace) are pre-registered, so the first call
   * returns `2`.
   *
   * @see OPC UA Part 3 \u00a76.3.4 (NamespaceArray); Part 5 \u00a78.2.2.
   */
  addNamespace(uri: string): number {
    const uris = [...((this.namespaceArray.read(AttributeId.Value).value as Variant).value as string[])]
    const index = uris.length
    uris.push(uri)
    this.namespaceArray.setValue(Variant.newFrom(uris))
    return index
  }

  /**
   * Sets `Server/ServerStatus/State` (and, optionally, `EstimatedReturnTime`), letting tests
   * simulate a server shutdown announcement (Session Client Detect Shutdown conformance unit).
   * Clients observe the change on their next keep-alive read of `Server_ServerStatus`
   * (ns=0;i=2256) or, once supported, a `StatusChangeNotification`.
   *
   * @see OPC UA Part 5 \u00a712.6
   */
  setServerState(state: ServerStateEnum, estimatedReturnTime?: Date): void {
    this.serverState = state
    if (estimatedReturnTime !== undefined) {
      this.serverStatusEstimatedReturnTime.setValue(Variant.newFrom(estimatedReturnTime))
    }
  }

  /**
   * Read a single attribute from a node.
   * Returns `BadNodeIdUnknown` when the node does not exist.
   * Returns `BadAttributeIdInvalid` when the attribute is not defined.
   */
  read(nodeId: NodeId, attributeId: number): DataValue {
    const node = this.nodes.get(nodeId.toString())
    if (node === undefined) {
      return new DataValue(undefined, StatusCode.BadNodeIdUnknown)
    }
    return node.read(attributeId)
  }

  /**
   * Write a single attribute of a node.
   * Returns `BadNodeIdUnknown` when the node does not exist.
   */
  write(nodeId: NodeId, attributeId: number, value: DataValue): StatusCode {
    const node = this.nodes.get(nodeId.toString())
    if (node === undefined) {
      return StatusCode.BadNodeIdUnknown
    }
    return node.write(attributeId, value)
  }

  /** Look up a node by NodeId. Returns `undefined` when absent. */
  getNode(nodeId: NodeId): OpcUaNode | undefined {
    return this.nodes.get(nodeId.toString())
  }

  /**
   * Returns `true` when `candidateTypeId` is `baseTypeId` or a (transitive)
   * subtype of it, walking the `HasSubtype` Reference hierarchy.
   *
   * Used to evaluate the `includeSubtypes` flag on Browse's ReferenceType
   * filter and on TranslateBrowsePathsToNodeIds's RelativePathElement.
   */
  isSameOrSubtypeOf(candidateTypeId: NodeId, baseTypeId: NodeId): boolean {
    if (candidateTypeId.toString() === baseTypeId.toString()) {
      return true
    }
    const seen = new Set<string>()
    let current = candidateTypeId
    for (;;) {
      const key = current.toString()
      if (seen.has(key)) {
        return false
      }
      seen.add(key)
      const node = this.getNode(current)
      if (node === undefined) {
        return false
      }
      const parentRef = node
        .getReferences()
        .find(r => !r.isForward && r.referenceTypeId.toString() === HAS_SUBTYPE.toString())
      if (parentRef === undefined) {
        return false
      }
      if (parentRef.targetNodeId.toString() === baseTypeId.toString()) {
        return true
      }
      current = parentRef.targetNodeId
    }
  }

  /**
   * Add an Object node to the address space.
   * @returns The created node
   */
  addObject(nodeId: NodeId, browseName: string, displayName?: string, description?: string): ObjectNode {
    const qn = new QualifiedName(nodeId.namespace, browseName)
    const lt = new LocalizedText(undefined, displayName ?? browseName)
    const desc = description === undefined ? undefined : new LocalizedText(undefined, description)
    const node = new ObjectNode(nodeId, qn, lt, desc)
    this.nodes.set(nodeId.toString(), node)
    return node
  }

  /**
   * Add a Variable node to the address space.
   * @param dataTypeId - NodeId of the data type (e.g. `NodeId.newNumeric(0, 12)` for String)
   * @param value - Initial variant value
   * @param valueRank - -1 = scalar, 1 = 1-D array
   * @returns The created node
   */
  addVariable(
    nodeId: NodeId,
    browseName: string,
    dataTypeId: NodeId,
    value: Variant,
    valueRank: number = -1,
    displayName?: string,
    accessLevel: number = AccessLevelFlags.CurrentRead,
    description?: string,
    accessLevelEx: number = 0,
  ): VariableNode {
    const qn = new QualifiedName(nodeId.namespace, browseName)
    const lt = new LocalizedText(undefined, displayName ?? browseName)
    const desc = description === undefined ? undefined : new LocalizedText(undefined, description)
    const node = new VariableNode(nodeId, qn, lt, dataTypeId, value, valueRank, accessLevel, desc, accessLevelEx)
    this.nodes.set(nodeId.toString(), node)
    return node
  }

  /** Add an ObjectType node to the address space. */
  addObjectType(nodeId: NodeId, browseName: string, isAbstract = false, displayName?: string): ObjectTypeNode {
    const qn = new QualifiedName(nodeId.namespace, browseName)
    const lt = new LocalizedText(undefined, displayName ?? browseName)
    const node = new ObjectTypeNode(nodeId, qn, lt, isAbstract)
    this.nodes.set(nodeId.toString(), node)
    return node
  }

  /** Add a VariableType node to the address space. */
  addVariableType(
    nodeId: NodeId,
    browseName: string,
    dataTypeId: NodeId,
    valueRank = -2,
    isAbstract = false,
    displayName?: string,
  ): VariableTypeNode {
    const qn = new QualifiedName(nodeId.namespace, browseName)
    const lt = new LocalizedText(undefined, displayName ?? browseName)
    const node = new VariableTypeNode(nodeId, qn, lt, dataTypeId, valueRank, isAbstract)
    this.nodes.set(nodeId.toString(), node)
    return node
  }

  /** Add a ReferenceType node to the address space. */
  addReferenceType(
    nodeId: NodeId,
    browseName: string,
    inverseName: string,
    isAbstract = false,
    symmetric = false,
  ): ReferenceTypeNode {
    const qn = new QualifiedName(nodeId.namespace, browseName)
    const lt = new LocalizedText(undefined, browseName)
    const node = new ReferenceTypeNode(nodeId, qn, lt, inverseName, isAbstract, symmetric)
    this.nodes.set(nodeId.toString(), node)
    return node
  }

  /** Add a DataType node to the address space. */
  addDataType(nodeId: NodeId, browseName: string, isAbstract = false): DataTypeNode {
    const qn = new QualifiedName(nodeId.namespace, browseName)
    const lt = new LocalizedText(undefined, browseName)
    const node = new DataTypeNode(nodeId, qn, lt, isAbstract)
    this.nodes.set(nodeId.toString(), node)
    return node
  }

  /** Add a Method node to the address space. */
  addMethod(nodeId: NodeId, browseName: string, executable = true, displayName?: string): MethodNode {
    const qn = new QualifiedName(nodeId.namespace, browseName)
    const lt = new LocalizedText(undefined, displayName ?? browseName)
    const node = new MethodNode(nodeId, qn, lt, executable)
    this.nodes.set(nodeId.toString(), node)
    return node
  }

  /** Add a View node to the address space. */
  addView(nodeId: NodeId, browseName: string, displayName?: string): ViewNode {
    const qn = new QualifiedName(nodeId.namespace, browseName)
    const lt = new LocalizedText(undefined, displayName ?? browseName)
    const node = new ViewNode(nodeId, qn, lt)
    this.nodes.set(nodeId.toString(), node)
    return node
  }

  /**
   * Adds a forward Reference from `sourceId` to `targetId`, and — when the
   * target node also exists locally — the matching inverse Reference.
   */
  addReference(sourceId: NodeId, referenceTypeId: NodeId, targetId: NodeId): void {
    const source = this.nodes.get(sourceId.toString())
    if (source === undefined) {
      throw new Error(`addReference: unknown source node ${sourceId.toString()}`)
    }
    source.addReference(referenceTypeId, targetId, true)

    const target = this.nodes.get(targetId.toString())
    if (target !== undefined) {
      target.addReference(referenceTypeId, sourceId, false)
    }
  }

  // ---------------------------------------------------------------------------
  // Built-in ReferenceType hierarchy (OPC UA Part 3 §7, Part 5 §8.3)
  // ---------------------------------------------------------------------------

  private populateReferenceTypes(): void {
    const rt = (id: number) => NodeIdClass.newNumeric(0, id)

    this.addReferenceType(rt(ReferenceTypeIds.References), 'References', 'References', true, true)
    this.addReferenceType(
      rt(ReferenceTypeIds.HierarchicalReferences),
      'HierarchicalReferences',
      'HierarchicalReferences',
      true,
      false,
    )
    this.addReferenceType(
      rt(ReferenceTypeIds.NonHierarchicalReferences),
      'NonHierarchicalReferences',
      'NonHierarchicalReferences',
      true,
      false,
    )
    this.addReferenceType(rt(ReferenceTypeIds.HasChild), 'HasChild', 'ChildOf', true, false)
    this.addReferenceType(rt(ReferenceTypeIds.Organizes), 'Organizes', 'OrganizedBy', false, false)
    this.addReferenceType(rt(ReferenceTypeIds.HasEventSource), 'HasEventSource', 'EventSourceOf', false, false)
    this.addReferenceType(rt(ReferenceTypeIds.HasNotifier), 'HasNotifier', 'NotifierOf', false, false)
    this.addReferenceType(rt(ReferenceTypeIds.Aggregates), 'Aggregates', 'AggregatedBy', true, false)
    this.addReferenceType(rt(ReferenceTypeIds.HasSubtype), 'HasSubtype', 'HasSupertype', false, false)
    this.addReferenceType(rt(ReferenceTypeIds.HasComponent), 'HasComponent', 'ComponentOf', false, false)
    this.addReferenceType(rt(ReferenceTypeIds.HasProperty), 'HasProperty', 'PropertyOf', false, false)
    this.addReferenceType(
      rt(ReferenceTypeIds.HasOrderedComponent),
      'HasOrderedComponent',
      'OrderedComponentOf',
      false,
      false,
    )
    this.addReferenceType(rt(ReferenceTypeIds.HasTypeDefinition), 'HasTypeDefinition', 'TypeDefinitionOf', false, false)
    this.addReferenceType(rt(ReferenceTypeIds.HasModellingRule), 'HasModellingRule', 'ModellingRuleOf', false, false)
    this.addReferenceType(rt(ReferenceTypeIds.HasEncoding), 'HasEncoding', 'EncodingOf', false, false)
    this.addReferenceType(rt(ReferenceTypeIds.HasDescription), 'HasDescription', 'DescriptionOf', false, false)
    this.addReferenceType(rt(ReferenceTypeIds.GeneratesEvent), 'GeneratesEvent', 'GeneratedBy', false, false)

    // HasSubtype's forward direction runs from supertype to subtype.
    const link = (parent: number, child: number) =>
      this.addReference(rt(parent), rt(ReferenceTypeIds.HasSubtype), rt(child))

    link(ReferenceTypeIds.References, ReferenceTypeIds.HierarchicalReferences)
    link(ReferenceTypeIds.References, ReferenceTypeIds.NonHierarchicalReferences)
    link(ReferenceTypeIds.HierarchicalReferences, ReferenceTypeIds.HasChild)
    link(ReferenceTypeIds.HierarchicalReferences, ReferenceTypeIds.Organizes)
    link(ReferenceTypeIds.HierarchicalReferences, ReferenceTypeIds.HasEventSource)
    link(ReferenceTypeIds.HierarchicalReferences, ReferenceTypeIds.HasNotifier)
    link(ReferenceTypeIds.HasChild, ReferenceTypeIds.Aggregates)
    link(ReferenceTypeIds.HasChild, ReferenceTypeIds.HasSubtype)
    link(ReferenceTypeIds.Aggregates, ReferenceTypeIds.HasComponent)
    link(ReferenceTypeIds.Aggregates, ReferenceTypeIds.HasProperty)
    link(ReferenceTypeIds.Aggregates, ReferenceTypeIds.HasOrderedComponent)
    link(ReferenceTypeIds.NonHierarchicalReferences, ReferenceTypeIds.HasTypeDefinition)
    link(ReferenceTypeIds.NonHierarchicalReferences, ReferenceTypeIds.HasModellingRule)
    link(ReferenceTypeIds.NonHierarchicalReferences, ReferenceTypeIds.HasEncoding)
    link(ReferenceTypeIds.NonHierarchicalReferences, ReferenceTypeIds.HasDescription)
    link(ReferenceTypeIds.NonHierarchicalReferences, ReferenceTypeIds.GeneratesEvent)
  }

  // ---------------------------------------------------------------------------
  // Representative ObjectType / VariableType / DataType nodes
  // ---------------------------------------------------------------------------

  private populateTypeSystem(): void {
    const ot = (id: number) => NodeIdClass.newNumeric(0, id)

    this.addObjectType(ot(ObjectTypeIds.BaseObjectType), 'BaseObjectType', true)
    this.addObjectType(ot(ObjectTypeIds.FolderType), 'FolderType', false)
    this.addReference(ot(ObjectTypeIds.BaseObjectType), NodeIdClass.newNumeric(0, ReferenceTypeIds.HasSubtype), ot(ObjectTypeIds.FolderType))
    this.addObjectType(ot(ObjectTypeIds.ServerType), 'ServerType', false)
    this.addReference(ot(ObjectTypeIds.BaseObjectType), NodeIdClass.newNumeric(0, ReferenceTypeIds.HasSubtype), ot(ObjectTypeIds.ServerType))
    this.addObjectType(ot(ObjectTypeIds.ServerCapabilitiesType), 'ServerCapabilitiesType', false)
    this.addReference(
      ot(ObjectTypeIds.BaseObjectType),
      NodeIdClass.newNumeric(0, ReferenceTypeIds.HasSubtype),
      ot(ObjectTypeIds.ServerCapabilitiesType),
    )

    this.addVariableType(NodeIdClass.newNumeric(0, VariableTypeIds.BaseVariableType), 'BaseVariableType', nodeIdTypeId, -2, true)
    this.addVariableType(
      NodeIdClass.newNumeric(0, VariableTypeIds.BaseDataVariableType),
      'BaseDataVariableType',
      nodeIdTypeId,
      -2,
      false,
    )
    this.addVariableType(NodeIdClass.newNumeric(0, VariableTypeIds.PropertyType), 'PropertyType', nodeIdTypeId, -2, false)
    const varSubtype = NodeIdClass.newNumeric(0, ReferenceTypeIds.HasSubtype)
    this.addReference(
      NodeIdClass.newNumeric(0, VariableTypeIds.BaseVariableType),
      varSubtype,
      NodeIdClass.newNumeric(0, VariableTypeIds.BaseDataVariableType),
    )
    this.addReference(
      NodeIdClass.newNumeric(0, VariableTypeIds.BaseVariableType),
      varSubtype,
      NodeIdClass.newNumeric(0, VariableTypeIds.PropertyType),
    )

    this.addDataType(NodeIdClass.newNumeric(0, DataTypeIds.BaseDataType), 'BaseDataType', true)
    const dataTypeSubtype = NodeIdClass.newNumeric(0, ReferenceTypeIds.HasSubtype)
    const leafDataTypes: Array<keyof typeof DataTypeIds> = [
      'Boolean',
      'Int32',
      'UInt32',
      'Double',
      'String',
      'DateTime',
      'Guid',
      'ByteString',
      'NodeId',
      'StatusCode',
      'QualifiedName',
      'LocalizedText',
    ]
    for (const key of leafDataTypes) {
      const id = NodeIdClass.newNumeric(0, DataTypeIds[key])
      this.addDataType(id, key, false)
      this.addReference(NodeIdClass.newNumeric(0, DataTypeIds.BaseDataType), dataTypeSubtype, id)
    }
  }

  // ---------------------------------------------------------------------------
  // Root / Objects / Types entry points (OPC UA Part 3 §8.2.4)
  // ---------------------------------------------------------------------------

  private populateCoreStructure(): void {
    const organizes = NodeIdClass.newNumeric(0, ReferenceTypeIds.Organizes)
    const hasTypeDefinition = NodeIdClass.newNumeric(0, ReferenceTypeIds.HasTypeDefinition)
    const folderType = NodeIdClass.newNumeric(0, ObjectTypeIds.FolderType)

    const root = this.addObject(NodeIdClass.newNumeric(0, ObjectIds.RootFolder), 'Root')
    this.addReference(root.nodeId, hasTypeDefinition, folderType)

    const objects = this.addObject(NodeIdClass.newNumeric(0, ObjectIds.ObjectsFolder), 'Objects')
    this.addReference(objects.nodeId, hasTypeDefinition, folderType)
    this.addReference(root.nodeId, organizes, objects.nodeId)

    const types = this.addObject(NodeIdClass.newNumeric(0, ObjectIds.TypesFolder), 'Types')
    this.addReference(types.nodeId, hasTypeDefinition, folderType)
    this.addReference(root.nodeId, organizes, types.nodeId)

    const views = this.addObject(NodeIdClass.newNumeric(0, ObjectIds.ViewsFolder), 'Views')
    this.addReference(views.nodeId, hasTypeDefinition, folderType)
    this.addReference(root.nodeId, organizes, views.nodeId)

    const objectTypesFolder = this.addObject(NodeIdClass.newNumeric(0, ObjectIds.ObjectTypesFolder), 'ObjectTypes')
    this.addReference(objectTypesFolder.nodeId, hasTypeDefinition, folderType)
    this.addReference(types.nodeId, organizes, objectTypesFolder.nodeId)
    this.addReference(objectTypesFolder.nodeId, organizes, NodeIdClass.newNumeric(0, ObjectTypeIds.BaseObjectType))

    const variableTypesFolder = this.addObject(NodeIdClass.newNumeric(0, ObjectIds.VariableTypesFolder), 'VariableTypes')
    this.addReference(variableTypesFolder.nodeId, hasTypeDefinition, folderType)
    this.addReference(types.nodeId, organizes, variableTypesFolder.nodeId)
    this.addReference(
      variableTypesFolder.nodeId,
      organizes,
      NodeIdClass.newNumeric(0, VariableTypeIds.BaseVariableType),
    )

    const dataTypesFolder = this.addObject(NodeIdClass.newNumeric(0, ObjectIds.DataTypesFolder), 'DataTypes')
    this.addReference(dataTypesFolder.nodeId, hasTypeDefinition, folderType)
    this.addReference(types.nodeId, organizes, dataTypesFolder.nodeId)
    this.addReference(dataTypesFolder.nodeId, organizes, NodeIdClass.newNumeric(0, DataTypeIds.BaseDataType))

    const referenceTypesFolder = this.addObject(NodeIdClass.newNumeric(0, ObjectIds.ReferenceTypesFolder), 'ReferenceTypes')
    this.addReference(referenceTypesFolder.nodeId, hasTypeDefinition, folderType)
    this.addReference(types.nodeId, organizes, referenceTypesFolder.nodeId)
    this.addReference(
      referenceTypesFolder.nodeId,
      organizes,
      NodeIdClass.newNumeric(0, ReferenceTypeIds.References),
    )

    // A single representative View, demonstrating View NodeClass support (Address Space Base).
    const serverView = this.addView(NodeIdClass.newNumeric(1, 1), 'ServerView')
    this.addReference(views.nodeId, organizes, serverView.nodeId)

    // A single representative Method, demonstrating Method NodeClass support (Address Space Base).
    const ping = this.addMethod(NodeIdClass.newNumeric(1, 2), 'Ping', true)
    this.addReference(objects.nodeId, NodeIdClass.newNumeric(0, ReferenceTypeIds.HasComponent), ping.nodeId)

    // A representative array Variable that only accepts full-array writes (Address
    // Space Full Array Only): AccessLevelEx.WriteFullArrayOnly is set, so a Write
    // with a non-empty IndexRange is rejected with Bad_WriteNotSupported.
    const fullArrayOnly = this.addVariable(
      NodeIdClass.newNumeric(1, 3),
      'FullArrayOnlyArray',
      NodeIdClass.newNumeric(0, DataTypeIds.Int32),
      Variant.newFrom([uaInt32(0), uaInt32(0), uaInt32(0)]),
      1,
      undefined,
      AccessLevelFlags.CurrentRead | AccessLevelFlags.CurrentWrite,
      undefined,
      AccessLevelExFlags.WriteFullArrayOnly,
    )
    this.addReference(objects.nodeId, NodeIdClass.newNumeric(0, ReferenceTypeIds.HasComponent), fullArrayOnly.nodeId)
  }

  // ---------------------------------------------------------------------------
  // Standard OPC UA Server object (OPC UA Part 5 §8)
  // ---------------------------------------------------------------------------

  private populateServerObject(): void {
    const hasComponent = NodeIdClass.newNumeric(0, ReferenceTypeIds.HasComponent)
    const hasProperty = NodeIdClass.newNumeric(0, ReferenceTypeIds.HasProperty)
    const hasTypeDefinition = NodeIdClass.newNumeric(0, ReferenceTypeIds.HasTypeDefinition)
    const organizes = NodeIdClass.newNumeric(0, ReferenceTypeIds.Organizes)

    // ns=0;i=2253   Server  (Object)
    const server = this.addObject(NodeIdClass.newNumeric(0, ObjectIds.Server), 'Server', 'Server')
    this.addReference(server.nodeId, hasTypeDefinition, NodeIdClass.newNumeric(0, ObjectTypeIds.ServerType))
    this.addReference(NodeIdClass.newNumeric(0, ObjectIds.ObjectsFolder), organizes, server.nodeId)

    // ns=0;i=2254   ServerArray  (Variable, String[])
    const serverArray = this.addVariable(
      NodeIdClass.newNumeric(0, ObjectIds.Server_ServerArray),
      'ServerArray',
      stringTypeId,
      Variant.newFrom([SERVER_URI]),
      1,
    )
    this.addReference(server.nodeId, hasProperty, serverArray.nodeId)

    // ns=0;i=2255   NamespaceArray  (Variable, String[])
    this.namespaceArray = this.addVariable(
      NodeIdClass.newNumeric(0, ObjectIds.Server_NamespaceArray),
      'NamespaceArray',
      stringTypeId,
      Variant.newFrom([OPCUA_NAMESPACE_URI, SERVER_NAMESPACE_URI]),
      1,
    )
    this.addReference(server.nodeId, hasProperty, this.namespaceArray.nodeId)

    // ns=0;i=2256   ServerStatus  (Variable, ServerStatusDataType)
    const startTime = new Date()
    const buildInfo = new BuildInfo()
    buildInfo.productUri = SERVER_URI
    buildInfo.manufacturerName = 'opcjs'
    buildInfo.productName = 'opcjs-server'
    buildInfo.softwareVersion = '0.0.0'
    buildInfo.buildNumber = ''
    buildInfo.buildDate = startTime

    const serverStatus = this.addVariable(
      NodeIdClass.newNumeric(0, ObjectIds.Server_ServerStatus),
      'ServerStatus',
      NodeIdClass.newNumeric(0, 862 /* ServerStatusDataType */),
      Variant.newFrom(makeServerStatusExtensionObject(startTime, buildInfo, this.serverState)),
      -1,
    )
    serverStatus.setValueProvider(() => Variant.newFrom(makeServerStatusExtensionObject(startTime, buildInfo, this.serverState)))
    this.addReference(server.nodeId, hasComponent, serverStatus.nodeId)

    // ns=0;i=2267   ServiceLevel  (Variable, Byte) — 255 = fully available.
    const serviceLevel = this.addVariable(
      NodeIdClass.newNumeric(0, ObjectIds.Server_ServiceLevel),
      'ServiceLevel',
      NodeIdClass.newNumeric(0, 3 /* Byte */),
      Variant.newFrom(uaByte(255)),
      -1,
    )
    this.addReference(server.nodeId, hasProperty, serviceLevel.nodeId)

    // ns=0;i=2994   Auditing  (Variable, Boolean)
    const auditing = this.addVariable(
      NodeIdClass.newNumeric(0, ObjectIds.Server_Auditing),
      'Auditing',
      booleanTypeId,
      Variant.newFrom(false),
      -1,
    )
    this.addReference(server.nodeId, hasProperty, auditing.nodeId)

    // ns=0;i=2295   VendorServerInfo  (Object)
    const vendorServerInfo = this.addObject(
      NodeIdClass.newNumeric(0, ObjectIds.Server_VendorServerInfo),
      'VendorServerInfo',
    )
    this.addReference(server.nodeId, hasComponent, vendorServerInfo.nodeId)

    // ns=0;i=2296   ServerRedundancy  (Object)
    const serverRedundancy = this.addObject(
      NodeIdClass.newNumeric(0, ObjectIds.Server_ServerRedundancy),
      'ServerRedundancy',
    )
    this.addReference(server.nodeId, hasComponent, serverRedundancy.nodeId)

    // ns=0;i=2268   ServerCapabilities  (Object)
    const serverCapabilities = this.addObject(
      NodeIdClass.newNumeric(0, ObjectIds.Server_ServerCapabilities),
      'ServerCapabilities',
    )
    this.addReference(
      serverCapabilities.nodeId,
      hasTypeDefinition,
      NodeIdClass.newNumeric(0, ObjectTypeIds.ServerCapabilitiesType),
    )
    this.addReference(server.nodeId, hasComponent, serverCapabilities.nodeId)

    const serverProfileArray = this.addVariable(
      NodeIdClass.newNumeric(0, ObjectIds.ServerCapabilities_ServerProfileArray),
      'ServerProfileArray',
      stringTypeId,
      Variant.newFrom([CORE_2022_SERVER_FACET_URI]),
      1,
    )
    this.addReference(serverCapabilities.nodeId, hasProperty, serverProfileArray.nodeId)

    const localeIdArray = this.addVariable(
      NodeIdClass.newNumeric(0, ObjectIds.ServerCapabilities_LocaleIdArray),
      'LocaleIdArray',
      stringTypeId,
      Variant.newFrom(['en']),
      1,
    )
    this.addReference(serverCapabilities.nodeId, hasProperty, localeIdArray.nodeId)

    const minSupportedSampleRate = this.addVariable(
      NodeIdClass.newNumeric(0, ObjectIds.ServerCapabilities_MinSupportedSampleRate),
      'MinSupportedSampleRate',
      doubleTypeId,
      Variant.newFrom(uaDouble(0)),
      -1,
    )
    this.addReference(serverCapabilities.nodeId, hasProperty, minSupportedSampleRate.nodeId)

    const maxBrowseContinuationPoints = this.addVariable(
      NodeIdClass.newNumeric(0, ObjectIds.ServerCapabilities_MaxBrowseContinuationPoints),
      'MaxBrowseContinuationPoints',
      NodeIdClass.newNumeric(0, 5 /* UInt16 */),
      Variant.newFrom(uaUint32(10)),
      -1,
    )
    this.addReference(serverCapabilities.nodeId, hasProperty, maxBrowseContinuationPoints.nodeId)

    const maxArrayLength = this.addVariable(
      NodeIdClass.newNumeric(0, ObjectIds.ServerCapabilities_MaxArrayLength),
      'MaxArrayLength',
      uint32TypeId,
      Variant.newFrom(uaUint32(1000)),
      -1,
    )
    this.addReference(serverCapabilities.nodeId, hasProperty, maxArrayLength.nodeId)

    const maxStringLength = this.addVariable(
      NodeIdClass.newNumeric(0, ObjectIds.ServerCapabilities_MaxStringLength),
      'MaxStringLength',
      uint32TypeId,
      Variant.newFrom(uaUint32(4096)),
      -1,
    )
    this.addReference(serverCapabilities.nodeId, hasProperty, maxStringLength.nodeId)

    const maxByteStringLength = this.addVariable(
      NodeIdClass.newNumeric(0, ObjectIds.ServerCapabilities_MaxByteStringLength),
      'MaxByteStringLength',
      uint32TypeId,
      Variant.newFrom(uaUint32(65535)),
      -1,
    )
    this.addReference(serverCapabilities.nodeId, hasProperty, maxByteStringLength.nodeId)

    const maxSessions = this.addVariable(
      NodeIdClass.newNumeric(1, CustomIds.ServerCapabilities_MaxSessions),
      'MaxSessions',
      uint32TypeId,
      Variant.newFrom(uaUint32(100)),
      -1,
    )
    this.addReference(serverCapabilities.nodeId, hasProperty, maxSessions.nodeId)

    // Embedded DataChange Subscription 2022 Server Facet: subscription-related
    // ServerCapabilities variables (Part 5 §6.3.2). Optional / vendor-configured
    // limits — values chosen generously so normal clients never hit them.
    const maxSubscriptions = this.addVariable(
      NodeIdClass.newNumeric(1, CustomIds.ServerCapabilities_MaxSubscriptions),
      'MaxSubscriptions',
      uint32TypeId,
      Variant.newFrom(uaUint32(1000)),
      -1,
    )
    this.addReference(serverCapabilities.nodeId, hasProperty, maxSubscriptions.nodeId)

    const maxMonitoredItems = this.addVariable(
      NodeIdClass.newNumeric(1, CustomIds.ServerCapabilities_MaxMonitoredItems),
      'MaxMonitoredItems',
      uint32TypeId,
      Variant.newFrom(uaUint32(10000)),
      -1,
    )
    this.addReference(serverCapabilities.nodeId, hasProperty, maxMonitoredItems.nodeId)

    const maxSubscriptionsPerSession = this.addVariable(
      NodeIdClass.newNumeric(1, CustomIds.ServerCapabilities_MaxSubscriptionsPerSession),
      'MaxSubscriptionsPerSession',
      uint32TypeId,
      Variant.newFrom(uaUint32(100)),
      -1,
    )
    this.addReference(serverCapabilities.nodeId, hasProperty, maxSubscriptionsPerSession.nodeId)

    const maxMonitoredItemsPerSubscription = this.addVariable(
      NodeIdClass.newNumeric(1, CustomIds.ServerCapabilities_MaxMonitoredItemsPerSubscription),
      'MaxMonitoredItemsPerSubscription',
      uint32TypeId,
      Variant.newFrom(uaUint32(1000)),
      -1,
    )
    this.addReference(serverCapabilities.nodeId, hasProperty, maxMonitoredItemsPerSubscription.nodeId)

    const maxMonitoredItemsQueueSize = this.addVariable(
      NodeIdClass.newNumeric(1, CustomIds.ServerCapabilities_MaxMonitoredItemsQueueSize),
      'MaxMonitoredItemsQueueSize',
      uint32TypeId,
      Variant.newFrom(uaUint32(MAX_MONITORED_ITEMS_QUEUE_SIZE)),
      -1,
    )
    this.addReference(serverCapabilities.nodeId, hasProperty, maxMonitoredItemsQueueSize.nodeId)

    // AggregateFunctions  (Object, Folder) — entry point to browse supported
    // AggregateFunctionType instances (Part 5 §6.3.2). Empty: this server does
    // not implement HistoryRead aggregates.
    const aggregateFunctions = this.addObject(
      NodeIdClass.newNumeric(1, CustomIds.ServerCapabilities_AggregateFunctions),
      'AggregateFunctions',
    )
    this.addReference(
      aggregateFunctions.nodeId,
      hasTypeDefinition,
      NodeIdClass.newNumeric(0, ObjectTypeIds.FolderType),
    )
    this.addReference(serverCapabilities.nodeId, hasComponent, aggregateFunctions.nodeId)

    // ModellingRules  (Object, Folder)
    const modellingRules = this.addObject(
      NodeIdClass.newNumeric(0, ObjectIds.ServerCapabilities_ModellingRules),
      'ModellingRules',
    )
    this.addReference(modellingRules.nodeId, hasTypeDefinition, NodeIdClass.newNumeric(0, ObjectTypeIds.FolderType))
    this.addReference(serverCapabilities.nodeId, organizes, modellingRules.nodeId)

    // OperationLimits  (Object)
    const operationLimits = this.addObject(
      NodeIdClass.newNumeric(0, ObjectIds.ServerCapabilities_OperationLimits),
      'OperationLimits',
    )
    this.addReference(serverCapabilities.nodeId, hasComponent, operationLimits.nodeId)

    const opLimit = (id: number, name: string, max: number) => {
      const node = this.addVariable(NodeIdClass.newNumeric(0, id), name, uint32TypeId, Variant.newFrom(uaUint32(max)), -1)
      this.addReference(operationLimits.nodeId, hasProperty, node.nodeId)
    }
    opLimit(ObjectIds.OperationLimits_MaxNodesPerRead, 'MaxNodesPerRead', 1000)
    opLimit(ObjectIds.OperationLimits_MaxNodesPerWrite, 'MaxNodesPerWrite', 1000)
    opLimit(ObjectIds.OperationLimits_MaxNodesPerBrowse, 'MaxNodesPerBrowse', 1000)
    opLimit(ObjectIds.OperationLimits_MaxNodesPerRegisterNodes, 'MaxNodesPerRegisterNodes', 1000)
    opLimit(
      ObjectIds.OperationLimits_MaxNodesPerTranslateBrowsePathsToNodeIds,
      'MaxNodesPerTranslateBrowsePathsToNodeIds',
      1000,
    )

    // Embedded DataChange Subscription 2022 Server Facet: MaxMonitoredItemsPerCall
    // (Part 5 §6.3.11 OperationLimitsType) — no fixed ns=0 NodeId available.
    const maxMonitoredItemsPerCall = this.addVariable(
      NodeIdClass.newNumeric(1, CustomIds.OperationLimits_MaxMonitoredItemsPerCall),
      'MaxMonitoredItemsPerCall',
      uint32TypeId,
      Variant.newFrom(uaUint32(1000)),
      -1,
    )
    this.addReference(operationLimits.nodeId, hasProperty, maxMonitoredItemsPerCall.nodeId)

    // ns=1   ServerDiagnostics  (Object) — Base Info Fixed SamplingInterval CU:
    // `EnabledFlag` gates whether `SamplingIntervalDiagnosticsArray` is populated.
    // `wireSubscriptionDiagnostics()` (called from `OpcUaServer.start()`) hooks
    // the array up to live SubscriptionManager data.
    const serverDiagnostics = this.addObject(
      NodeIdClass.newNumeric(1, CustomIds.Server_ServerDiagnostics),
      'ServerDiagnostics',
    )
    this.addReference(server.nodeId, hasComponent, serverDiagnostics.nodeId)

    this.serverDiagnosticsEnabledFlag = this.addVariable(
      NodeIdClass.newNumeric(1, CustomIds.ServerDiagnostics_EnabledFlag),
      'EnabledFlag',
      NodeIdClass.newNumeric(0, DataTypeIds.Boolean),
      Variant.newFrom(false),
      -1,
      undefined,
      AccessLevelFlags.CurrentRead | AccessLevelFlags.CurrentWrite,
    )
    this.addReference(serverDiagnostics.nodeId, hasProperty, this.serverDiagnosticsEnabledFlag.nodeId)

    this.samplingIntervalDiagnosticsArray = this.addVariable(
      NodeIdClass.newNumeric(1, CustomIds.ServerDiagnostics_SamplingIntervalDiagnosticsArray),
      'SamplingIntervalDiagnosticsArray',
      NodeIdClass.newNumeric(0, 856 /* SamplingIntervalDiagnosticsDataType */),
      samplingIntervalDiagnosticsVariant([]),
      1,
    )
    this.addReference(serverDiagnostics.nodeId, hasComponent, this.samplingIntervalDiagnosticsArray.nodeId)
  }

  // ---------------------------------------------------------------------------
  // Optional conformance units: representative nodes demonstrating each
  // Base Info / Address Space AddIn / Interfaces optional CU (Core 2022
  // Server Facet). Each block below is self-contained and independently
  // documented in doc/backlog/core-2022-server-facet/.
  // ---------------------------------------------------------------------------

  private populateOptionalExtras(): void {
    const hasComponent = NodeIdClass.newNumeric(0, ReferenceTypeIds.HasComponent)
    const hasProperty = NodeIdClass.newNumeric(0, ReferenceTypeIds.HasProperty)
    const hasTypeDefinition = NodeIdClass.newNumeric(0, ReferenceTypeIds.HasTypeDefinition)
    const organizes = NodeIdClass.newNumeric(0, ReferenceTypeIds.Organizes)
    const hasSubtype = NodeIdClass.newNumeric(0, ReferenceTypeIds.HasSubtype)
    const dateTimeTypeId = NodeIdClass.newNumeric(0, DataTypeIds.DateTime)
    const qualifiedNameTypeId = NodeIdClass.newNumeric(0, DataTypeIds.QualifiedName)
    const localizedTextTypeId = NodeIdClass.newNumeric(0, DataTypeIds.LocalizedText)

    const serverId = NodeIdClass.newNumeric(0, ObjectIds.Server)
    const serverStatusId = NodeIdClass.newNumeric(0, ObjectIds.Server_ServerStatus)
    const objectsId = NodeIdClass.newNumeric(0, ObjectIds.ObjectsFolder)
    const typesId = NodeIdClass.newNumeric(0, ObjectIds.TypesFolder)
    const serverCapabilitiesTypeId = NodeIdClass.newNumeric(0, ObjectTypeIds.ServerCapabilitiesType)
    const baseObjectTypeId = NodeIdClass.newNumeric(0, ObjectTypeIds.BaseObjectType)
    const baseVariableTypeId = NodeIdClass.newNumeric(0, VariableTypeIds.BaseVariableType)
    const baseDataTypeId = NodeIdClass.newNumeric(0, DataTypeIds.BaseDataType)

    // ── Base Info Estimated Return Time (ns=0;i=2992): EstimatedReturnTime
    //    component of ServerStatus. `MinDateTime` = "no planned shutdown".
    const estimatedReturnTime = this.addVariable(
      NodeIdClass.newNumeric(0, ObjectIds.Server_ServerStatus_EstimatedReturnTime),
      'EstimatedReturnTime',
      dateTimeTypeId,
      Variant.newFrom(new Date(-11_644_473_600_000)),
      -1,
      undefined,
      AccessLevelFlags.CurrentRead | AccessLevelFlags.CurrentWrite,
    )
    this.serverStatusEstimatedReturnTime = estimatedReturnTime
    this.addReference(serverStatusId, hasComponent, estimatedReturnTime.nodeId)

    // Register the ExtensionObject-encoded DataTypes used below as proper
    // DataType nodes (subtypes of BaseDataType, organized under DataTypes).
    const registerStructureDataType = (id: number, name: string) => {
      this.addDataType(NodeIdClass.newNumeric(0, id), name, false)
      this.addReference(NodeIdClass.newNumeric(0, DataTypeIds.BaseDataType), hasSubtype, NodeIdClass.newNumeric(0, id))
      this.addReference(NodeIdClass.newNumeric(0, ObjectIds.DataTypesFolder), organizes, NodeIdClass.newNumeric(0, id))
    }
    registerStructureDataType(8912, 'TimeZoneDataType')
    registerStructureDataType(887, 'EUInformation')
    registerStructureDataType(23498, 'CurrencyUnitType')

    // ── Base Info LocalTime (ns=0;i=3711): LocalTime property of Server,
    //    typed TimeZoneDataType (offset in minutes + DST flag).
    const localTimeValue = new TimeZoneDataType()
    localTimeValue.offset = 0
    localTimeValue.daylightSavingInOffset = false
    const localTime = this.addVariable(
      NodeIdClass.newNumeric(0, ObjectIds.Server_LocalTime),
      'LocalTime',
      NodeIdClass.newNumeric(0, 8912 /* TimeZoneDataType */),
      Variant.newFrom(new ExtensionObject(NodeIdClass.newNumeric(0, 8912), 1, localTimeValue)),
      -1,
    )
    this.addReference(serverId, hasProperty, localTime.nodeId)

    // ── Base Info Locations Object: entry point for location information.
    const locations = this.addObject(
      NodeIdClass.newNumeric(1, CustomIds.Server_Locations),
      'Locations',
    )
    this.addReference(serverId, hasComponent, locations.nodeId)

    // ── Base Info Namespace Metadata: one NamespaceMetadataType Object per
    //    namespace with static NodeIds (ns=0 and this server's ns=1).
    const namespaces = this.addObject(NodeIdClass.newNumeric(1, CustomIds.Server_Namespaces), 'Namespaces')
    this.addReference(serverId, hasComponent, namespaces.nodeId)
    const addNamespaceMetadata = (metaId: number, uriId: number, subsetId: number, uri: string) => {
      const meta = this.addObject(NodeIdClass.newNumeric(1, metaId), uri === OPCUA_NAMESPACE_URI ? 'http://opcfoundation.org/UA/' : uri)
      this.addReference(namespaces.nodeId, organizes, meta.nodeId)
      const namespaceUri = this.addVariable(
        NodeIdClass.newNumeric(1, uriId),
        'NamespaceUri',
        stringTypeId,
        Variant.newFrom(uri),
        -1,
      )
      this.addReference(meta.nodeId, hasProperty, namespaceUri.nodeId)
      const isNamespaceSubset = this.addVariable(
        NodeIdClass.newNumeric(1, subsetId),
        'IsNamespaceSubset',
        booleanTypeId,
        Variant.newFrom(false),
        -1,
      )
      this.addReference(meta.nodeId, hasProperty, isNamespaceSubset.nodeId)
      return meta
    }
    addNamespaceMetadata(
      CustomIds.NamespaceMetadata_Opcua,
      CustomIds.NamespaceMetadata_Opcua_NamespaceUri,
      CustomIds.NamespaceMetadata_Opcua_IsNamespaceSubset,
      OPCUA_NAMESPACE_URI,
    )
    addNamespaceMetadata(
      CustomIds.NamespaceMetadata_Server,
      CustomIds.NamespaceMetadata_Server_NamespaceUri,
      CustomIds.NamespaceMetadata_Server_IsNamespaceSubset,
      SERVER_NAMESPACE_URI,
    )

    // ── Address Space NonVolatile and Constant: a Constant + NonVolatile demo Variable.
    const constantVar = this.addVariable(
      NodeIdClass.newNumeric(1, CustomIds.ConstantDemoVariable),
      'PiConstant',
      doubleTypeId,
      Variant.newFrom(uaDouble(Math.PI)),
      -1,
      undefined,
      AccessLevelFlags.CurrentRead,
      undefined,
      AccessLevelExFlags.Constant | AccessLevelExFlags.NonVolatile,
    )
    this.addReference(objectsId, hasComponent, constantVar.nodeId)

    // ── Base Info Engineering Units: EngineeringUnits Property (EUInformation).
    const temperature = this.addVariable(
      NodeIdClass.newNumeric(1, CustomIds.TemperatureDemoVariable),
      'Temperature',
      doubleTypeId,
      Variant.newFrom(uaDouble(20.0)),
      -1,
      undefined,
      AccessLevelFlags.CurrentRead | AccessLevelFlags.CurrentWrite,
    )
    this.addReference(objectsId, hasComponent, temperature.nodeId)
    const euInfo = new EUInformation()
    euInfo.namespaceUri = 'http://www.opcfoundation.org/UA/units/un/cefact'
    euInfo.unitId = 4408652 // UN/CEFACT code 'Cel' (degree Celsius)
    euInfo.displayName = new LocalizedText(undefined, '°C')
    euInfo.description = new LocalizedText(undefined, 'degree Celsius')
    const engineeringUnits = this.addVariable(
      NodeIdClass.newNumeric(1, CustomIds.TemperatureEngineeringUnitsProperty),
      'EngineeringUnits',
      NodeIdClass.newNumeric(0, 887 /* EUInformation */),
      Variant.newFrom(new ExtensionObject(NodeIdClass.newNumeric(0, 887), 1, euInfo)),
      -1,
    )
    this.addReference(temperature.nodeId, hasProperty, engineeringUnits.nodeId)

    // ── Base Info Currency: CurrencyUnit Property (CurrencyUnitType).
    const price = this.addVariable(
      NodeIdClass.newNumeric(1, CustomIds.PriceDemoVariable),
      'Price',
      doubleTypeId,
      Variant.newFrom(uaDouble(0)),
      -1,
      undefined,
      AccessLevelFlags.CurrentRead | AccessLevelFlags.CurrentWrite,
    )
    this.addReference(objectsId, hasComponent, price.nodeId)
    const currency = new CurrencyUnitType()
    currency.numericCode = 978
    currency.exponent = 2
    currency.alphabeticCode = 'EUR'
    currency.currency = new LocalizedText(undefined, 'Euro')
    const currencyUnit = this.addVariable(
      NodeIdClass.newNumeric(1, CustomIds.PriceCurrencyUnitProperty),
      'CurrencyUnit',
      NodeIdClass.newNumeric(0, 23498 /* CurrencyUnitType */),
      Variant.newFrom(new ExtensionObject(NodeIdClass.newNumeric(0, 23498), 1, currency)),
      -1,
    )
    this.addReference(price.nodeId, hasProperty, currencyUnit.nodeId)

    // ── Base Info OptionSet: OptionSetType VariableType + OptionSetValues Property.
    this.addVariableType(NodeIdClass.newNumeric(0, VariableTypeIds.OptionSetType), 'OptionSetType', uint32TypeId, -1, false)
    this.addReference(baseVariableTypeId, hasSubtype, NodeIdClass.newNumeric(0, VariableTypeIds.OptionSetType))
    const statusFlags = this.addVariable(
      NodeIdClass.newNumeric(1, CustomIds.StatusFlagsDemoVariable),
      'StatusFlags',
      uint32TypeId,
      Variant.newFrom(uaUint32(0b101)),
      -1,
    )
    this.addReference(objectsId, hasComponent, statusFlags.nodeId)
    this.addReference(statusFlags.nodeId, hasTypeDefinition, NodeIdClass.newNumeric(0, VariableTypeIds.OptionSetType))
    const optionSetValues = this.addVariable(
      NodeIdClass.newNumeric(1, CustomIds.StatusFlagsOptionSetValuesProperty),
      'OptionSetValues',
      localizedTextTypeId,
      Variant.newFrom([
        new LocalizedText(undefined, 'Running'),
        new LocalizedText(undefined, 'Alarm'),
        new LocalizedText(undefined, 'Maintenance'),
      ]),
      1,
    )
    this.addReference(statusFlags.nodeId, hasProperty, optionSetValues.nodeId)

    // ── Base Info Selection List: SelectionListType VariableType (ns=0;i=19726)
    //    + Selections / SelectionDescriptions Properties.
    this.addVariableType(
      NodeIdClass.newNumeric(0, VariableTypeIds.SelectionListType),
      'SelectionListType',
      baseDataTypeId,
      -2,
      false,
    )
    this.addReference(baseVariableTypeId, hasSubtype, NodeIdClass.newNumeric(0, VariableTypeIds.SelectionListType))
    const selectionListVar = this.addVariable(
      NodeIdClass.newNumeric(1, CustomIds.SelectionListDemoVariable),
      'Mode',
      stringTypeId,
      Variant.newFrom('Auto'),
      -1,
      undefined,
      AccessLevelFlags.CurrentRead | AccessLevelFlags.CurrentWrite,
    )
    this.addReference(objectsId, hasComponent, selectionListVar.nodeId)
    this.addReference(selectionListVar.nodeId, hasTypeDefinition, NodeIdClass.newNumeric(0, VariableTypeIds.SelectionListType))
    const selections = this.addVariable(
      NodeIdClass.newNumeric(1, CustomIds.SelectionListSelectionsProperty),
      'Selections',
      stringTypeId,
      Variant.newFrom(['Auto', 'Manual', 'Off']),
      1,
    )
    this.addReference(selectionListVar.nodeId, hasProperty, selections.nodeId)
    const selectionDescriptions = this.addVariable(
      NodeIdClass.newNumeric(1, CustomIds.SelectionListSelectionDescriptionsProperty),
      'SelectionDescriptions',
      localizedTextTypeId,
      Variant.newFrom([
        new LocalizedText(undefined, 'Automatic control'),
        new LocalizedText(undefined, 'Manual control'),
        new LocalizedText(undefined, 'Disabled'),
      ]),
      1,
    )
    this.addReference(selectionListVar.nodeId, hasProperty, selectionDescriptions.nodeId)

    // ── Base Info ValueAsText: ValueAsText Property mirroring an enumerated Variable.
    const trafficLight = this.addVariable(
      NodeIdClass.newNumeric(1, CustomIds.TrafficLightDemoVariable),
      'TrafficLight',
      NodeIdClass.newNumeric(0, DataTypeIds.Int32),
      Variant.newFrom(uaInt32(1)),
      -1,
      undefined,
      AccessLevelFlags.CurrentRead | AccessLevelFlags.CurrentWrite,
    )
    this.addReference(objectsId, hasComponent, trafficLight.nodeId)
    const valueAsText = this.addVariable(
      NodeIdClass.newNumeric(1, CustomIds.TrafficLightValueAsTextProperty),
      'ValueAsText',
      localizedTextTypeId,
      Variant.newFrom(new LocalizedText(undefined, 'Yellow')),
      -1,
    )
    this.addReference(trafficLight.nodeId, hasProperty, valueAsText.nodeId)

    // ── Address Space Interfaces: InterfaceTypes Folder (ns=0;i=17708),
    //    BaseInterfaceType (ns=0;i=17602), HasInterface (ns=0;i=17603),
    //    and a demo ObjectType implementing an interface.
    const interfaceTypesFolder = this.addObject(NodeIdClass.newNumeric(0, ObjectIds.InterfaceTypesFolder), 'InterfaceTypes')
    this.addReference(interfaceTypesFolder.nodeId, hasTypeDefinition, NodeIdClass.newNumeric(0, ObjectTypeIds.FolderType))
    this.addReference(typesId, organizes, interfaceTypesFolder.nodeId)
    this.addObjectType(NodeIdClass.newNumeric(0, ObjectTypeIds.BaseInterfaceType), 'BaseInterfaceType', true)
    this.addReference(baseObjectTypeId, hasSubtype, NodeIdClass.newNumeric(0, ObjectTypeIds.BaseInterfaceType))
    this.addReference(
      interfaceTypesFolder.nodeId,
      organizes,
      NodeIdClass.newNumeric(0, ObjectTypeIds.BaseInterfaceType),
    )
    this.addReferenceType(NodeIdClass.newNumeric(0, ReferenceTypeIds.HasInterface), 'HasInterface', 'InterfaceOf', false, false)
    this.addReference(
      NodeIdClass.newNumeric(0, ReferenceTypeIds.NonHierarchicalReferences),
      hasSubtype,
      NodeIdClass.newNumeric(0, ReferenceTypeIds.HasInterface),
    )
    this.addObjectType(NodeIdClass.newNumeric(1, CustomIds.DemoInterfaceType), 'IDemoCapabilityType', false)
    this.addReference(
      NodeIdClass.newNumeric(0, ObjectTypeIds.BaseInterfaceType),
      hasSubtype,
      NodeIdClass.newNumeric(1, CustomIds.DemoInterfaceType),
    )
    // ServerCapabilitiesType "implements" the demo interface, demonstrating HasInterface usage.
    this.addReference(serverCapabilitiesTypeId, NodeIdClass.newNumeric(0, ReferenceTypeIds.HasInterface), NodeIdClass.newNumeric(1, CustomIds.DemoInterfaceType))

    // ── Address Space AddIn Reference: HasAddIn (custom NodeId — the
    //    canonical ns=0 NodeId was not available in this codebase's
    //    reference tables) linking Server to its Locations AddIn Object.
    this.addReferenceType(
      NodeIdClass.newNumeric(1, CustomIds.HasAddInReferenceType),
      'HasAddIn',
      'AddInOf',
      false,
      false,
    )
    this.addReference(
      NodeIdClass.newNumeric(0, ReferenceTypeIds.NonHierarchicalReferences),
      hasSubtype,
      NodeIdClass.newNumeric(1, CustomIds.HasAddInReferenceType),
    )
    this.addReference(serverId, NodeIdClass.newNumeric(1, CustomIds.HasAddInReferenceType), locations.nodeId)

    // ── Address Space AddIn DefaultInstanceBrowsename: DefaultInstanceBrowseName
    //    Property (QualifiedName) on ServerCapabilitiesType.
    const defaultInstanceBrowseName = this.addVariable(
      NodeIdClass.newNumeric(1, CustomIds.DefaultInstanceBrowseNameProperty),
      'DefaultInstanceBrowseName',
      qualifiedNameTypeId,
      Variant.newFrom(new QualifiedName(0, 'ServerCapabilities')),
      -1,
    )
    this.addReference(serverCapabilitiesTypeId, hasProperty, defaultInstanceBrowseName.nodeId)
  }
}

/** Well-known `HasSubtype` NodeId, used by {@link AddressSpace.isSameOrSubtypeOf}. */
const HAS_SUBTYPE = NodeIdClass.newNumeric(0, ReferenceTypeIds.HasSubtype)

/** Builds the `ServerStatus` value: an ExtensionObject wrapping `ServerStatusDataType`. */
function makeServerStatusExtensionObject(startTime: Date, buildInfo: BuildInfo, state: ServerStateEnum): ExtensionObject {
  const status = new ServerStatusDataType()
  status.startTime = startTime
  status.currentTime = new Date()
  status.state = state
  status.buildInfo = buildInfo
  status.secondsTillShutdown = 0
  status.shutdownReason = new LocalizedText(undefined, '')
  // ExtensionObject.typeId must be the binary *encoding* ID (864), not the DataType ID
  // (862) — decodeWithEncodingId() looks up the former in the decoder's encodingIdMap.
  return new ExtensionObject(NodeIdClass.newNumeric(0, 864), 1 /* ExtensionObjectEncoding.Binary */, status)
}
