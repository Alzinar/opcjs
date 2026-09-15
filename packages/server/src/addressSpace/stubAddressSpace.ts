import { DataValue, StatusCode } from 'opcjs-base'
import type { NodeId } from 'opcjs-base'

import type { IAddressSpace } from './iAddressSpace.js'
import type { OpcUaNode } from './node.js'

/**
 * Stub address space that returns `BadNodeIdUnknown` for every read/write.
 *
 * Used by {@link OpcUaServer} until Phase 4 provides a concrete
 * {@link AddressSpace} implementation.  Replace via
 * {@link OpcUaServer.addressSpace} or by constructing the server with a
 * fully-populated address space.
 */
export class StubAddressSpace implements IAddressSpace {
  read(nodeId: NodeId, attributeId: number): DataValue {
    void nodeId
    void attributeId
    return new DataValue(undefined, StatusCode.BadNodeIdUnknown)
  }

  write(nodeId: NodeId, attributeId: number, value: DataValue): StatusCode {
    void nodeId
    void attributeId
    void value
    return StatusCode.BadNodeIdUnknown
  }

  getNode(nodeId: NodeId): OpcUaNode | undefined {
    void nodeId
    return undefined
  }

  isSameOrSubtypeOf(candidateTypeId: NodeId, baseTypeId: NodeId): boolean {
    return candidateTypeId.toString() === baseTypeId.toString()
  }
}
