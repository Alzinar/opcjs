import type { DataValue, NodeId, StatusCode } from 'opcjs-base'

import type { OpcUaNode } from './node.js'

/**
 * Read-only + write view of the address space used by the Attribute and
 * View service handlers.
 *
 * A concrete implementation is provided by {@link AddressSpace}.
 * Returns a `DataValue` with `StatusCode.BadNodeIdUnknown` when the node does
 * not exist, or `StatusCode.BadAttributeIdInvalid` when the attribute is
 * not defined on the node.
 */
export interface IAddressSpace {
  /**
   * Read a single attribute from a node.
   *
   * @param nodeId - The node to read
   * @param attributeId - The attribute to read (OPC UA attribute ID constant)
   */
  read(nodeId: NodeId, attributeId: number): DataValue

  /**
   * Write a single attribute of a node. Returns `BadNodeIdUnknown` when the
   * node does not exist, `BadAttributeIdInvalid` when the attribute is not
   * defined on the node's NodeClass.
   */
  write(nodeId: NodeId, attributeId: number, value: DataValue): StatusCode

  /** Look up a node by NodeId, for use by the View services. Returns `undefined` when absent. */
  getNode(nodeId: NodeId): OpcUaNode | undefined

  /**
   * Returns `true` when `candidateTypeId` is `baseTypeId` or a (transitive)
   * `HasSubtype` descendant of it. Used by the View services to evaluate
   * `includeSubtypes` filters.
   */
  isSameOrSubtypeOf(candidateTypeId: NodeId, baseTypeId: NodeId): boolean
}
