import {
  BrowseDirectionEnum,
  BrowseNextRequest,
  BrowseNextResponse,
  BrowsePathResult,
  BrowsePathTarget,
  BrowseRequest,
  BrowseResponse,
  BrowseResult,
  BrowseResultMaskEnum,
  DiagnosticInfo,
  ExpandedNodeId,
  LocalizedText,
  NodeClassEnum,
  NodeId,
  QualifiedName,
  ReferenceDescription,
  RegisterNodesRequest,
  RegisterNodesResponse,
  StatusCode,
  TranslateBrowsePathsToNodeIdsRequest,
  TranslateBrowsePathsToNodeIdsResponse,
  UnregisterNodesRequest,
  UnregisterNodesResponse,
  getLogger,
} from 'opcjs-base'
import type { BrowseDescription, BrowsePath, ILogger } from 'opcjs-base'

import type { IAddressSpace } from '../addressSpace/iAddressSpace.js'
import { ReferenceTypeIds } from '../addressSpace/wellKnownIds.js'
import type { OpcUaNode, ReferenceRecord } from '../addressSpace/node.js'
import type { Session } from '../sessions/session.js'
import { makeResponseHeader } from './responseHeader.js'

const HAS_TYPE_DEFINITION = NodeId.newNumeric(0, ReferenceTypeIds.HasTypeDefinition)

/**
 * Per-session state kept for an outstanding `Browse` continuation.
 * Attached to {@link Session.continuationPoints}.
 */
export type ContinuationPointEntry = {
  readonly remaining: ReferenceDescription[]
  readonly maxReferencesPerNode: number
}

/**
 * Handles the View Service Set: `Browse`, `BrowseNext`,
 * `TranslateBrowsePathsToNodeIds`, `RegisterNodes`, and `UnregisterNodes`.
 *
 * @see OPC UA Part 4 §5.8
 */
export class ViewService {
  private readonly logger: ILogger

  constructor(private readonly addressSpace: IAddressSpace) {
    this.logger = getLogger('services.ViewService')
  }

  /** Handles `BrowseRequest` → `BrowseResponse` (OPC UA Part 4 §5.8.2). */
  browse(request: BrowseRequest, session: Session): BrowseResponse {
    const requestHandle = request.requestHeader?.requestHandle ?? 0
    const nodesToBrowse = request.nodesToBrowse ?? []
    const requestedMax = request.requestedMaxReferencesPerNode ?? 0

    this.logger.debug(`Browse ${nodesToBrowse.length} node(s)`)

    const results = nodesToBrowse.map(desc => this.browseOne(desc, session, requestedMax))

    const response = new BrowseResponse()
    response.responseHeader = makeResponseHeader(requestHandle)
    response.results = results
    response.diagnosticInfos = new Array<DiagnosticInfo>(results.length).fill(new DiagnosticInfo())
    return response
  }

  /** Handles `BrowseNextRequest` → `BrowseNextResponse` (OPC UA Part 4 §5.8.3). */
  browseNext(request: BrowseNextRequest, session: Session): BrowseNextResponse {
    const requestHandle = request.requestHeader?.requestHandle ?? 0
    const release = request.releaseContinuationPoints ?? false
    const continuationPoints = request.continuationPoints ?? []

    const results = continuationPoints.map(cp => {
      const key = toHex(cp)
      const entry = session.continuationPoints.get(key)
      session.continuationPoints.delete(key)

      if (entry === undefined) {
        return emptyBrowseResult(StatusCode.BadContinuationPointInvalid)
      }
      if (release) {
        return emptyBrowseResult(StatusCode.Good)
      }
      return this.paginate(entry.remaining, entry.maxReferencesPerNode, session)
    })

    const response = new BrowseNextResponse()
    response.responseHeader = makeResponseHeader(requestHandle)
    response.results = results
    response.diagnosticInfos = new Array<DiagnosticInfo>(results.length).fill(new DiagnosticInfo())
    return response
  }

  /**
   * Handles `TranslateBrowsePathsToNodeIdsRequest` → `...Response`
   * (OPC UA Part 4 §5.8.4).
   */
  translateBrowsePathsToNodeIds(
    request: TranslateBrowsePathsToNodeIdsRequest,
  ): TranslateBrowsePathsToNodeIdsResponse {
    const requestHandle = request.requestHeader?.requestHandle ?? 0
    const browsePaths = request.browsePaths ?? []

    const results = browsePaths.map(bp => this.translateOne(bp))

    const response = new TranslateBrowsePathsToNodeIdsResponse()
    response.responseHeader = makeResponseHeader(requestHandle)
    response.results = results
    response.diagnosticInfos = new Array<DiagnosticInfo>(results.length).fill(new DiagnosticInfo())
    return response
  }

  /** Handles `RegisterNodesRequest` → `RegisterNodesResponse` (OPC UA Part 4 §5.8.5). */
  registerNodes(request: RegisterNodesRequest, session: Session): RegisterNodesResponse {
    const requestHandle = request.requestHeader?.requestHandle ?? 0
    const nodesToRegister = request.nodesToRegister ?? []

    for (const id of nodesToRegister) {
      session.registeredNodes.add(id.toString())
    }

    const response = new RegisterNodesResponse()
    response.responseHeader = makeResponseHeader(requestHandle)
    // Minimal compliant implementation: NodeIds are returned unchanged.
    response.registeredNodeIds = nodesToRegister
    return response
  }

  /** Handles `UnregisterNodesRequest` → `UnregisterNodesResponse` (OPC UA Part 4 §5.8.6). */
  unregisterNodes(request: UnregisterNodesRequest, session: Session): UnregisterNodesResponse {
    const requestHandle = request.requestHeader?.requestHandle ?? 0
    const nodesToUnregister = request.nodesToUnregister ?? []

    for (const id of nodesToUnregister) {
      session.registeredNodes.delete(id.toString())
    }

    const response = new UnregisterNodesResponse()
    response.responseHeader = makeResponseHeader(requestHandle)
    return response
  }

  // ── internals ──────────────────────────────────────────────────────────

  private browseOne(desc: BrowseDescription, session: Session, requestedMax: number): BrowseResult {
    if (desc.nodeId == null) {
      return emptyBrowseResult(StatusCode.BadNodeIdInvalid)
    }
    const node = this.addressSpace.getNode(desc.nodeId)
    if (node === undefined) {
      return emptyBrowseResult(StatusCode.BadNodeIdUnknown)
    }

    const direction = desc.browseDirection ?? BrowseDirectionEnum.Forward
    if (direction === BrowseDirectionEnum.Invalid) {
      return emptyBrowseResult(StatusCode.BadBrowseDirectionInvalid)
    }
    const refTypeFilter = desc.referenceTypeId
    const includeSubtypes = desc.includeSubtypes ?? false
    const nodeClassMask = desc.nodeClassMask ?? 0
    const resultMask = desc.resultMask ?? BrowseResultMaskEnum.All

    const matched = node.getReferences().filter(ref => {
      if (direction === BrowseDirectionEnum.Forward && !ref.isForward) return false
      if (direction === BrowseDirectionEnum.Inverse && ref.isForward) return false

      if (refTypeFilter != null && !refTypeFilter.isNull()) {
        const matchesType = includeSubtypes
          ? this.addressSpace.isSameOrSubtypeOf(ref.referenceTypeId, refTypeFilter)
          : ref.referenceTypeId.toString() === refTypeFilter.toString()
        if (!matchesType) return false
      }

      if (nodeClassMask !== 0) {
        const targetNode = this.addressSpace.getNode(ref.targetNodeId)
        if (targetNode === undefined || (nodeClassMask & targetNode.nodeClass) === 0) return false
      }

      return true
    })

    const referenceDescriptions = matched.map(ref => this.buildReferenceDescription(ref, resultMask))
    return this.paginate(referenceDescriptions, requestedMax, session)
  }

  private paginate(all: ReferenceDescription[], requestedMax: number, session: Session): BrowseResult {
    const max = requestedMax > 0 ? requestedMax : all.length
    const page = all.slice(0, max)
    const remaining = all.slice(page.length)

    const result = new BrowseResult()
    result.statusCode = StatusCode.Good
    result.references = page
    if (remaining.length > 0) {
      const token = randomToken()
      session.continuationPoints.set(toHex(token), { remaining, maxReferencesPerNode: requestedMax })
      result.continuationPoint = token
    } else {
      result.continuationPoint = new Uint8Array(0)
    }
    return result
  }

  private buildReferenceDescription(ref: ReferenceRecord, resultMask: number): ReferenceDescription {
    const targetNode = this.addressSpace.getNode(ref.targetNodeId)

    const rd = new ReferenceDescription()
    rd.referenceTypeId =
      (resultMask & BrowseResultMaskEnum.ReferenceTypeId) !== 0 ? ref.referenceTypeId : new NodeId(0, 0)
    rd.isForward = (resultMask & BrowseResultMaskEnum.IsForward) !== 0 ? ref.isForward : true
    rd.nodeId = new ExpandedNodeId(ref.targetNodeId)
    rd.browseName =
      (resultMask & BrowseResultMaskEnum.BrowseName) !== 0 && targetNode
        ? targetNode.browseName
        : new QualifiedName(0, '')
    rd.displayName =
      (resultMask & BrowseResultMaskEnum.DisplayName) !== 0 && targetNode
        ? targetNode.displayName
        : new LocalizedText(undefined, '')
    rd.nodeClass =
      (resultMask & BrowseResultMaskEnum.NodeClass) !== 0 && targetNode
        ? targetNode.nodeClass
        : NodeClassEnum.Unspecified
    rd.typeDefinition =
      (resultMask & BrowseResultMaskEnum.TypeDefinition) !== 0
        ? findTypeDefinition(targetNode)
        : new ExpandedNodeId(new NodeId(0, 0))
    return rd
  }

  private translateOne(bp: BrowsePath): BrowsePathResult {
    if (bp.startingNode == null) {
      return emptyPathResult(StatusCode.BadNodeIdInvalid)
    }
    if (this.addressSpace.getNode(bp.startingNode) === undefined) {
      return emptyPathResult(StatusCode.BadNodeIdUnknown)
    }

    const elements = bp.relativePath?.elements ?? []
    let current: NodeId[] = [bp.startingNode]

    for (const el of elements) {
      const wantForward = !(el.isInverse ?? false)
      const next: NodeId[] = []

      for (const curId of current) {
        const node = this.addressSpace.getNode(curId)
        if (node === undefined) continue

        for (const ref of node.getReferences()) {
          if (ref.isForward !== wantForward) continue

          if (el.referenceTypeId != null && !el.referenceTypeId.isNull()) {
            const matches = el.includeSubtypes
              ? this.addressSpace.isSameOrSubtypeOf(ref.referenceTypeId, el.referenceTypeId)
              : ref.referenceTypeId.toString() === el.referenceTypeId.toString()
            if (!matches) continue
          }

          const targetNode = this.addressSpace.getNode(ref.targetNodeId)
          if (targetNode === undefined) continue
          if (el.targetName != null && !browseNameEquals(targetNode.browseName, el.targetName)) continue

          next.push(ref.targetNodeId)
        }
      }

      current = dedupeNodeIds(next)
      if (current.length === 0) {
        return emptyPathResult(StatusCode.BadNoMatch)
      }
    }

    const result = new BrowsePathResult()
    result.statusCode = StatusCode.Good
    result.targets = current.map(id => {
      const target = new BrowsePathTarget()
      target.targetId = new ExpandedNodeId(id)
      // Only meaningful for targets on a remote server; 0xFFFFFFFF = fully resolved locally.
      target.remainingPathIndex = 0xffffffff
      return target
    })
    return result
  }
}

function findTypeDefinition(node: OpcUaNode | undefined): ExpandedNodeId {
  if (node === undefined) {
    return new ExpandedNodeId(new NodeId(0, 0))
  }
  const ref = node
    .getReferences()
    .find(r => r.isForward && r.referenceTypeId.toString() === HAS_TYPE_DEFINITION.toString())
  return ref ? new ExpandedNodeId(ref.targetNodeId) : new ExpandedNodeId(new NodeId(0, 0))
}

function browseNameEquals(a: QualifiedName, b: QualifiedName): boolean {
  return a.namespaceIndex === b.namespaceIndex && a.name === b.name
}

function dedupeNodeIds(ids: NodeId[]): NodeId[] {
  const seen = new Set<string>()
  const result: NodeId[] = []
  for (const id of ids) {
    const key = id.toString()
    if (!seen.has(key)) {
      seen.add(key)
      result.push(id)
    }
  }
  return result
}

function randomToken(): Uint8Array {
  const bytes = new Uint8Array(8)
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = Math.floor(Math.random() * 256)
  }
  return bytes
}

function toHex(bytes: Uint8Array | null | undefined): string {
  return Array.from(bytes ?? [])
    .map(b => b.toString(16).padStart(2, '0'))
    .join('')
}

function emptyBrowseResult(status: StatusCode): BrowseResult {
  const r = new BrowseResult()
  r.statusCode = status
  r.references = []
  r.continuationPoint = new Uint8Array(0)
  return r
}

function emptyPathResult(status: StatusCode): BrowsePathResult {
  const r = new BrowsePathResult()
  r.statusCode = status
  r.targets = []
  return r
}
