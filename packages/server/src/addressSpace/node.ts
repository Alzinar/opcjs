import {
  type NodeId,
  DataValue,
  StatusCode,
  Variant,
  QualifiedName,
  LocalizedText,
  NodeClassEnum,
  uaUint32,
  uaByte,
  uaInt32,
  uaDouble,
} from 'opcjs-base'

/**
 * OPC UA Attribute IDs (OPC UA Part 6 §A, Part 4 §7.1).
 */
export const AttributeId = {
  NodeId: 1,
  NodeClass: 2,
  BrowseName: 3,
  DisplayName: 4,
  Description: 5,
  WriteMask: 6,
  UserWriteMask: 7,
  IsAbstract: 8,
  Symmetric: 9,
  InverseName: 10,
  ContainsNoLoops: 11,
  EventNotifier: 12,
  Value: 13,
  DataType: 14,
  ValueRank: 15,
  ArrayDimensions: 16,
  AccessLevel: 17,
  UserAccessLevel: 18,
  MinimumSamplingInterval: 19,
  Historizing: 20,
  Executable: 21,
  UserExecutable: 22,
  DataTypeDefinition: 23,
  RolePermissions: 24,
  UserRolePermissions: 25,
  AccessRestrictions: 26,
  AccessLevelEx: 27,
} as const

/** AccessLevel / UserAccessLevel bit masks (OPC UA Part 3 §5.6.2). */
export const AccessLevelFlags = {
  CurrentRead: 0x01,
  CurrentWrite: 0x02,
  HistoryRead: 0x04,
  HistoryWrite: 0x08,
  SemanticChange: 0x10,
  StatusWrite: 0x20,
  TimestampWrite: 0x40,
} as const

/** AccessLevelEx bit masks (OPC UA Part 3 §5.6.2). */
export const AccessLevelExFlags = {
  CurrentRead: 0x01,
  CurrentWrite: 0x02,
  HistoryRead: 0x04,
  HistoryWrite: 0x08,
  SemanticChange: 0x10,
  StatusWrite: 0x20,
  TimestampWrite: 0x40,
  NonatomicRead: 0x100,
  NonatomicWrite: 0x200,
  WriteFullArrayOnly: 0x400,
  NoSubDataTypes: 0x800,
  NonVolatile: 0x1000,
  Constant: 0x2000,
} as const

/** A single Reference (forward or inverse) held by a {@link OpcUaNode}. */
export type ReferenceRecord = {
  readonly referenceTypeId: NodeId
  readonly isForward: boolean
  readonly targetNodeId: NodeId
}

/**
 * Base class for every node in the local address space.
 * Attributes are stored in a `Map<attributeId, DataValue>`; References are
 * stored as a flat list of forward/inverse {@link ReferenceRecord}s.
 */
export abstract class OpcUaNode {
  protected readonly attributes = new Map<number, DataValue>()
  private readonly references: ReferenceRecord[] = []

  readonly nodeId: NodeId
  readonly nodeClass: NodeClassEnum
  readonly browseName: QualifiedName
  readonly displayName: LocalizedText

  constructor(
    nodeId: NodeId,
    nodeClass: NodeClassEnum,
    browseName: QualifiedName,
    displayName: LocalizedText,
    description?: LocalizedText,
  ) {
    this.nodeId = nodeId
    this.nodeClass = nodeClass
    this.browseName = browseName
    this.displayName = displayName

    this.attributes.set(AttributeId.NodeId, dv(Variant.newFrom(nodeId)))
    this.attributes.set(AttributeId.NodeClass, dv(Variant.newFrom(uaUint32(nodeClass))))
    this.attributes.set(AttributeId.BrowseName, dv(Variant.newFrom(browseName)))
    this.attributes.set(AttributeId.DisplayName, dv(Variant.newFrom(displayName)))
    this.attributes.set(AttributeId.Description, dv(Variant.newFrom(description ?? displayName)))
    this.attributes.set(AttributeId.WriteMask, dv(Variant.newFrom(uaUint32(0))))
    this.attributes.set(AttributeId.UserWriteMask, dv(Variant.newFrom(uaUint32(0))))
  }

  /**
   * Read a single attribute. Returns `BadAttributeIdInvalid` when the
   * attribute is not present on this node.
   */
  read(attributeId: number): DataValue {
    return this.attributes.get(attributeId) ?? new DataValue(undefined, StatusCode.BadAttributeIdInvalid)
  }

  /**
   * Directly overwrite an attribute value (used by the `Write` service).
   * Returns `BadAttributeIdInvalid` when the attribute is not defined on
   * this NodeClass (writing a brand-new attribute is not permitted).
   */
  write(attributeId: number, value: DataValue): StatusCode {
    if (!this.attributes.has(attributeId)) {
      return StatusCode.BadAttributeIdInvalid
    }
    this.attributes.set(attributeId, value)
    return StatusCode.Good
  }

  /** Adds a Reference (forward or inverse) to this node. */
  addReference(referenceTypeId: NodeId, targetNodeId: NodeId, isForward: boolean): void {
    this.references.push({ referenceTypeId, isForward, targetNodeId })
  }

  /** All References (forward and inverse) held by this node. */
  getReferences(): readonly ReferenceRecord[] {
    return this.references
  }
}

/**
 * An OPC UA Object node.
 */
export class ObjectNode extends OpcUaNode {
  constructor(
    nodeId: NodeId,
    browseName: QualifiedName,
    displayName: LocalizedText,
    description?: LocalizedText,
    eventNotifier: number = 0,
  ) {
    super(nodeId, NodeClassEnum.Object, browseName, displayName, description)
    this.attributes.set(AttributeId.EventNotifier, dv(Variant.newFrom(uaByte(eventNotifier))))
  }
}

/**
 * An OPC UA Variable node.
 * Holds a live `DataValue` for the Value attribute (id=13).
 */
export class VariableNode extends OpcUaNode {
  private valueProvider?: () => Variant

  constructor(
    nodeId: NodeId,
    browseName: QualifiedName,
    displayName: LocalizedText,
    dataTypeId: NodeId,
    value: Variant,
    valueRank: number = -1,
    accessLevel: number = AccessLevelFlags.CurrentRead,
    description?: LocalizedText,
    accessLevelEx: number = 0,
  ) {
    super(nodeId, NodeClassEnum.Variable, browseName, displayName, description)
    this.attributes.set(AttributeId.Value, new DataValue(value, StatusCode.Good))
    this.attributes.set(AttributeId.DataType, dv(Variant.newFrom(dataTypeId)))
    this.attributes.set(AttributeId.ValueRank, dv(Variant.newFrom(uaInt32(valueRank))))
    if (valueRank > 0 && Array.isArray(value.value)) {
      this.attributes.set(AttributeId.ArrayDimensions, dv(Variant.newFrom([uaUint32(value.value.length)])))
    }
    this.attributes.set(AttributeId.AccessLevel, dv(Variant.newFrom(uaByte(accessLevel))))
    this.attributes.set(AttributeId.UserAccessLevel, dv(Variant.newFrom(uaByte(accessLevel))))
    // AccessLevelEx defaults to 0: this single-process, in-memory address space
    // can always read/write values atomically (a single synchronous Map lookup),
    // so the NonatomicRead/NonatomicWrite bits are never set. WriteFullArrayOnly
    // may be set explicitly per-node (see Address Space Full Array Only CU).
    this.attributes.set(AttributeId.AccessLevelEx, dv(Variant.newFrom(uaUint32(accessLevelEx))))
    this.attributes.set(AttributeId.MinimumSamplingInterval, dv(Variant.newFrom(uaDouble(0.0))))
    this.attributes.set(AttributeId.Historizing, dv(Variant.newFrom(false)))
  }


  /**
   * Update the live value of this variable.
   */
  setValue(value: Variant, sourceTimestamp?: Date): void {
    this.attributes.set(
      AttributeId.Value,
      new DataValue(value, StatusCode.Good, sourceTimestamp ?? new Date()),
    )
  }

  /**
   * Installs a provider function that computes the Value attribute on demand
   * (e.g. `Server_ServerStatus.CurrentTime`) instead of the last `setValue`.
   */
  setValueProvider(provider: () => Variant): void {
    this.valueProvider = provider
  }

  override read(attributeId: number): DataValue {
    if (attributeId === AttributeId.Value && this.valueProvider) {
      return new DataValue(this.valueProvider(), StatusCode.Good, new Date())
    }
    return super.read(attributeId)
  }
}

/** An OPC UA ObjectType node (type definition for Object instances). */
export class ObjectTypeNode extends OpcUaNode {
  constructor(
    nodeId: NodeId,
    browseName: QualifiedName,
    displayName: LocalizedText,
    isAbstract: boolean = false,
    description?: LocalizedText,
  ) {
    super(nodeId, NodeClassEnum.ObjectType, browseName, displayName, description)
    this.attributes.set(AttributeId.IsAbstract, dv(Variant.newFrom(isAbstract)))
  }
}

/** An OPC UA VariableType node (type definition for Variable instances). */
export class VariableTypeNode extends OpcUaNode {
  constructor(
    nodeId: NodeId,
    browseName: QualifiedName,
    displayName: LocalizedText,
    dataTypeId: NodeId,
    valueRank: number = -2,
    isAbstract: boolean = false,
    description?: LocalizedText,
  ) {
    super(nodeId, NodeClassEnum.VariableType, browseName, displayName, description)
    this.attributes.set(AttributeId.DataType, dv(Variant.newFrom(dataTypeId)))
    this.attributes.set(AttributeId.ValueRank, dv(Variant.newFrom(uaInt32(valueRank))))
    this.attributes.set(AttributeId.IsAbstract, dv(Variant.newFrom(isAbstract)))
  }
}

/** An OPC UA ReferenceType node (defines the semantics of a kind of Reference). */
export class ReferenceTypeNode extends OpcUaNode {
  constructor(
    nodeId: NodeId,
    browseName: QualifiedName,
    displayName: LocalizedText,
    inverseName: string,
    isAbstract: boolean = false,
    symmetric: boolean = false,
    description?: LocalizedText,
  ) {
    super(nodeId, NodeClassEnum.ReferenceType, browseName, displayName, description)
    this.attributes.set(AttributeId.IsAbstract, dv(Variant.newFrom(isAbstract)))
    this.attributes.set(AttributeId.Symmetric, dv(Variant.newFrom(symmetric)))
    this.attributes.set(
      AttributeId.InverseName,
      dv(Variant.newFrom(new LocalizedText(undefined, inverseName))),
    )
  }
}

/** An OPC UA DataType node (defines the structure of a data type). */
export class DataTypeNode extends OpcUaNode {
  constructor(
    nodeId: NodeId,
    browseName: QualifiedName,
    displayName: LocalizedText,
    isAbstract: boolean = false,
    description?: LocalizedText,
  ) {
    super(nodeId, NodeClassEnum.DataType, browseName, displayName, description)
    this.attributes.set(AttributeId.IsAbstract, dv(Variant.newFrom(isAbstract)))
  }
}

/** An OPC UA Method node (a callable operation). */
export class MethodNode extends OpcUaNode {
  constructor(
    nodeId: NodeId,
    browseName: QualifiedName,
    displayName: LocalizedText,
    executable: boolean = true,
    description?: LocalizedText,
  ) {
    super(nodeId, NodeClassEnum.Method, browseName, displayName, description)
    this.attributes.set(AttributeId.Executable, dv(Variant.newFrom(executable)))
    this.attributes.set(AttributeId.UserExecutable, dv(Variant.newFrom(executable)))
  }
}

/** An OPC UA View node (a named subset of the AddressSpace). */
export class ViewNode extends OpcUaNode {
  constructor(
    nodeId: NodeId,
    browseName: QualifiedName,
    displayName: LocalizedText,
    description?: LocalizedText,
    containsNoLoops: boolean = true,
    eventNotifier: number = 0,
  ) {
    super(nodeId, NodeClassEnum.View, browseName, displayName, description)
    this.attributes.set(AttributeId.ContainsNoLoops, dv(Variant.newFrom(containsNoLoops)))
    this.attributes.set(AttributeId.EventNotifier, dv(Variant.newFrom(uaByte(eventNotifier))))
  }
}

/** Convenience wrapper: Good DataValue for a simple variant. */
function dv(variant: Variant): DataValue {
  return new DataValue(variant, StatusCode.Good)
}
