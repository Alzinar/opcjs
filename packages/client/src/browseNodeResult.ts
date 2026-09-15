import {
  ExpandedNodeId, LocalizedText, NodeClassEnum,
  NodeId, QualifiedName
} from "opcjs-base";
import { isRemoteNode } from "./remoteNode.js";

export class BrowseNodeResult {
  constructor(
    public referenceTypeId: NodeId,
    public isForward: boolean,
    public nodeId: ExpandedNodeId,
    public browseName: QualifiedName,
    public displayName: LocalizedText,
    public nodeClass: NodeClassEnum,
    public typeDefinition: ExpandedNodeId,
  ) {}

  /**
   * True when `nodeId` references a Node on a different OPC UA server
   * (Base Info Client Remote Nodes conformance unit). Use `resolveLocalNodeId()`
   * from `remoteNode.js` to safely unwrap `nodeId`/`typeDefinition`, or handle
   * this case explicitly (this client does not auto-connect to remote servers).
   */
  isRemote(): boolean {
    return isRemoteNode(this.nodeId) || isRemoteNode(this.typeDefinition);
  }
}
