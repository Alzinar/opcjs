/**
 * Well-known OPC UA NodeId numeric identifiers (namespace 0) used to build
 * the standard AddressSpace structure (Root/Objects/Types folders, the
 * built-in ReferenceType hierarchy, and the Server object).
 *
 * @see OPC UA Part 5, Part 6 §A (NodeIds for well-known Nodes)
 */

/** Well-known ReferenceType NodeIds (ns=0). */
export const ReferenceTypeIds = {
  References: 31,
  NonHierarchicalReferences: 32,
  HierarchicalReferences: 33,
  HasChild: 34,
  Organizes: 35,
  HasEventSource: 36,
  HasModellingRule: 37,
  HasEncoding: 38,
  HasDescription: 39,
  HasTypeDefinition: 40,
  GeneratesEvent: 41,
  Aggregates: 44,
  HasSubtype: 45,
  HasProperty: 46,
  HasComponent: 47,
  HasNotifier: 48,
  HasOrderedComponent: 49,
  HasInterface: 17603,
} as const

/** Well-known Object / entry-point NodeIds (ns=0). */
export const ObjectIds = {
  RootFolder: 84,
  ObjectsFolder: 85,
  TypesFolder: 86,
  ViewsFolder: 87,
  ObjectTypesFolder: 88,
  VariableTypesFolder: 89,
  DataTypesFolder: 90,
  ReferenceTypesFolder: 91,
  InterfaceTypesFolder: 17708,
  Server: 2253,
  Server_ServerArray: 2254,
  Server_NamespaceArray: 2255,
  Server_ServerStatus: 2256,
  Server_ServiceLevel: 2267,
  Server_Auditing: 2994,
  Server_ServerCapabilities: 2268,
  Server_VendorServerInfo: 2295,
  Server_ServerRedundancy: 2296,
  Server_ServerStatus_EstimatedReturnTime: 2992,
  Server_LocalTime: 3711,
  ServerCapabilities_ServerProfileArray: 2269,
  ServerCapabilities_LocaleIdArray: 2271,
  ServerCapabilities_MinSupportedSampleRate: 2272,
  ServerCapabilities_MaxBrowseContinuationPoints: 2735,
  ServerCapabilities_ModellingRules: 2019,
  ServerCapabilities_MaxArrayLength: 11549,
  ServerCapabilities_MaxStringLength: 11550,
  ServerCapabilities_MaxByteStringLength: 12911,
  ServerCapabilities_OperationLimits: 11704,
  OperationLimits_MaxNodesPerRead: 11705,
  OperationLimits_MaxNodesPerWrite: 11710,
  OperationLimits_MaxNodesPerBrowse: 11714,
  OperationLimits_MaxNodesPerRegisterNodes: 11727,
  OperationLimits_MaxNodesPerTranslateBrowsePathsToNodeIds: 11731,
} as const

/** Well-known ObjectType NodeIds (ns=0). */
export const ObjectTypeIds = {
  BaseObjectType: 58,
  FolderType: 61,
  ServerType: 2004,
  ServerCapabilitiesType: 2013,
  BaseInterfaceType: 17602,
} as const

/** Well-known VariableType NodeIds (ns=0). */
export const VariableTypeIds = {
  BaseVariableType: 62,
  BaseDataVariableType: 63,
  PropertyType: 68,
  OptionSetType: 11488,
  SelectionListType: 19726,
} as const

/** Well-known DataType NodeIds (ns=0). */
export const DataTypeIds = {
  BaseDataType: 24,
  Boolean: 1,
  Int32: 6,
  UInt32: 7,
  Double: 11,
  String: 12,
  DateTime: 13,
  Guid: 14,
  ByteString: 15,
  NodeId: 17,
  StatusCode: 19,
  QualifiedName: 20,
  LocalizedText: 21,
} as const

/**
 * Custom (server-vendor-specific) NodeIds allocated in namespace 1 for
 * entities that OPC UA does not assign a standard numeric NodeId to
 * (e.g. `MaxSessions`, which the spec leaves vendor-defined), or for
 * well-known types whose canonical ns=0 NodeId was not available in this
 * codebase's reference tables (`HasAddIn`, `Server_Namespaces`,
 * `NamespaceMetadataType`).
 *
 * `ns=1;i=1` through `i=3` are already used by `ServerView`, `Ping`, and
 * `FullArrayOnlyArray` (see `AddressSpace.populateCoreStructure()`); this
 * map starts at `i=4` to avoid colliding with them.
 */
export const CustomIds = {
  ServerCapabilities_MaxSessions: 4,
  HasAddInReferenceType: 5,
  DemoInterfaceType: 6,
  Server_Locations: 7,
  Server_Namespaces: 8,
  NamespaceMetadata_Opcua: 9,
  NamespaceMetadata_Opcua_NamespaceUri: 10,
  NamespaceMetadata_Opcua_IsNamespaceSubset: 11,
  NamespaceMetadata_Server: 12,
  NamespaceMetadata_Server_NamespaceUri: 13,
  NamespaceMetadata_Server_IsNamespaceSubset: 14,
  ConstantDemoVariable: 15,
  TemperatureDemoVariable: 16,
  TemperatureEngineeringUnitsProperty: 17,
  PriceDemoVariable: 18,
  PriceCurrencyUnitProperty: 19,
  StatusFlagsDemoVariable: 20,
  StatusFlagsOptionSetValuesProperty: 21,
  SelectionListDemoVariable: 22,
  SelectionListSelectionsProperty: 23,
  SelectionListSelectionDescriptionsProperty: 24,
  TrafficLightDemoVariable: 25,
  TrafficLightValueAsTextProperty: 26,
  DefaultInstanceBrowseNameProperty: 27,
  // Embedded DataChange Subscription 2022 Server Facet: ServerCapabilities /
  // OperationLimits subscription-related variables (Part 5 §6.3.2 / §6.3.11
  // mark these Optional and vendor-configured; no fixed ns=0 NodeId to reuse).
  ServerCapabilities_MaxSubscriptions: 28,
  ServerCapabilities_MaxMonitoredItems: 29,
  ServerCapabilities_MaxSubscriptionsPerSession: 30,
  ServerCapabilities_MaxMonitoredItemsPerSubscription: 31,
  OperationLimits_MaxMonitoredItemsPerCall: 32,
  ServerCapabilities_AggregateFunctions: 33,
  ServerCapabilities_MaxMonitoredItemsQueueSize: 34,
  Server_ServerDiagnostics: 35,
  ServerDiagnostics_EnabledFlag: 36,
  ServerDiagnostics_SamplingIntervalDiagnosticsArray: 37,
} as const
