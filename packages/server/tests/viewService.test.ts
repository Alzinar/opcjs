import { describe, it, expect } from 'vitest'

import {
  BrowseDescription,
  BrowseDirectionEnum,
  BrowsePath,
  BrowseRequest,
  NodeId,
  RelativePathElement,
  RegisterNodesRequest,
  RequestHeader,
  TranslateBrowsePathsToNodeIdsRequest,
  UnregisterNodesRequest,
  QualifiedName,
  StatusCode,
} from 'opcjs-base'

import { AddressSpace } from '../src/addressSpace/addressSpace.js'
import { ReferenceTypeIds, ObjectIds } from '../src/addressSpace/wellKnownIds.js'
import { ViewService } from '../src/services/viewService.js'
import type { Session } from '../src/sessions/session.js'

// ── helpers ──────────────────────────────────────────────────────────────────

function makeRequestHeader(): RequestHeader {
  const h = new RequestHeader()
  h.authenticationToken = new NodeId()
  h.requestHandle = 0
  h.timestamp = new Date()
  h.timeoutHint = 0
  h.returnDiagnostics = 0
  h.auditEntryId = null
  return h
}

function makeSession(): Session {
  return {
    sessionId: new NodeId(0, 1),
    authenticationToken: new NodeId(0, 2),
    serverNonce: new Uint8Array(32),
    revisedTimeoutMs: 60_000,
    boundChannelId: 1,
    isActivated: true,
    createdAt: new Date(),
    lastActivityAt: new Date(),
    continuationPoints: new Map(),
    registeredNodes: new Set<string>(),
  }
}

// ── Browse / BrowseNext ──────────────────────────────────────────────────────

describe('ViewService – Browse', () => {
  it('browses forward Organizes references from Root', () => {
    const addressSpace = new AddressSpace()
    const svc = new ViewService(addressSpace)

    const desc = new BrowseDescription()
    desc.nodeId = NodeId.newNumeric(0, ObjectIds.RootFolder)
    desc.browseDirection = BrowseDirectionEnum.Forward
    desc.referenceTypeId = NodeId.newNumeric(0, ReferenceTypeIds.Organizes)
    desc.includeSubtypes = false
    desc.nodeClassMask = 0
    desc.resultMask = 0x3f

    const req = new BrowseRequest()
    req.requestHeader = makeRequestHeader()
    req.nodesToBrowse = [desc]
    req.requestedMaxReferencesPerNode = 0

    const res = svc.browse(req, makeSession())
    expect(res.results).toHaveLength(1)
    expect(res.results[0].statusCode).toBe(StatusCode.Good)
    const names = res.results[0].references.map(r => r.browseName.name)
    expect(names).toContain('Objects')
    expect(names).toContain('Types')
  })

  it('returns BadNodeIdUnknown for a non-existent starting node', () => {
    const addressSpace = new AddressSpace()
    const svc = new ViewService(addressSpace)

    const desc = new BrowseDescription()
    desc.nodeId = NodeId.newNumeric(0, 999999)
    desc.browseDirection = BrowseDirectionEnum.Forward

    const req = new BrowseRequest()
    req.requestHeader = makeRequestHeader()
    req.nodesToBrowse = [desc]
    req.requestedMaxReferencesPerNode = 0

    const res = svc.browse(req, makeSession())
    expect(res.results[0].statusCode).toBe(StatusCode.BadNodeIdUnknown)
  })

  it('paginates with a continuation point when maxReferencesPerNode is exceeded', () => {
    const addressSpace = new AddressSpace()
    const svc = new ViewService(addressSpace)
    const session = makeSession()

    const desc = new BrowseDescription()
    desc.nodeId = NodeId.newNumeric(0, ObjectIds.RootFolder)
    desc.browseDirection = BrowseDirectionEnum.Forward
    desc.referenceTypeId = NodeId.newNumeric(0, ReferenceTypeIds.Organizes)
    desc.resultMask = 0x3f

    const req = new BrowseRequest()
    req.requestHeader = makeRequestHeader()
    req.nodesToBrowse = [desc]
    req.requestedMaxReferencesPerNode = 1

    const res = svc.browse(req, session)
    expect(res.results[0].references).toHaveLength(1)
    expect(res.results[0].continuationPoint?.length).toBeGreaterThan(0)
    expect(session.continuationPoints.size).toBe(1)

    const bnReq = {
      requestHeader: makeRequestHeader(),
      releaseContinuationPoints: false,
      continuationPoints: [res.results[0].continuationPoint],
    }
    const bnRes = svc.browseNext(bnReq as never, session)
    expect(bnRes.results[0].statusCode).toBe(StatusCode.Good)
    expect(bnRes.results[0].references.length).toBeGreaterThan(0)
  })

  it('BrowseNext returns BadContinuationPointInvalid for an unknown token', () => {
    const addressSpace = new AddressSpace()
    const svc = new ViewService(addressSpace)

    const bnReq = {
      requestHeader: makeRequestHeader(),
      releaseContinuationPoints: false,
      continuationPoints: [new Uint8Array([1, 2, 3, 4])],
    }
    const res = svc.browseNext(bnReq as never, makeSession())
    expect(res.results[0].statusCode).toBe(StatusCode.BadContinuationPointInvalid)
  })
})

// ── TranslateBrowsePathsToNodeIds ────────────────────────────────────────────

describe('ViewService – TranslateBrowsePathsToNodeIds', () => {
  it('resolves Root/Objects/Server by BrowseName path', () => {
    const addressSpace = new AddressSpace()
    const svc = new ViewService(addressSpace)

    const el1 = new RelativePathElement()
    el1.referenceTypeId = NodeId.newNumeric(0, ReferenceTypeIds.Organizes)
    el1.isInverse = false
    el1.includeSubtypes = true
    el1.targetName = new QualifiedName(0, 'Objects')

    const el2 = new RelativePathElement()
    el2.referenceTypeId = NodeId.newNumeric(0, ReferenceTypeIds.Organizes)
    el2.isInverse = false
    el2.includeSubtypes = true
    el2.targetName = new QualifiedName(0, 'Server')

    const bp = new BrowsePath()
    bp.startingNode = NodeId.newNumeric(0, ObjectIds.RootFolder)
    bp.relativePath = { elements: [el1, el2] } as never

    const req = new TranslateBrowsePathsToNodeIdsRequest()
    req.requestHeader = makeRequestHeader()
    req.browsePaths = [bp]

    const res = svc.translateBrowsePathsToNodeIds(req)
    expect(res.results[0].statusCode).toBe(StatusCode.Good)
    expect(res.results[0].targets[0].targetId.nodeId.toString()).toBe(
      NodeId.newNumeric(0, ObjectIds.Server).toString(),
    )
  })

  it('returns BadNoMatch when no reference matches the requested BrowseName', () => {
    const addressSpace = new AddressSpace()
    const svc = new ViewService(addressSpace)

    const el1 = new RelativePathElement()
    el1.referenceTypeId = NodeId.newNumeric(0, ReferenceTypeIds.Organizes)
    el1.isInverse = false
    el1.includeSubtypes = true
    el1.targetName = new QualifiedName(0, 'DoesNotExist')

    const bp = new BrowsePath()
    bp.startingNode = NodeId.newNumeric(0, ObjectIds.RootFolder)
    bp.relativePath = { elements: [el1] } as never

    const req = new TranslateBrowsePathsToNodeIdsRequest()
    req.requestHeader = makeRequestHeader()
    req.browsePaths = [bp]

    const res = svc.translateBrowsePathsToNodeIds(req)
    expect(res.results[0].statusCode).toBe(StatusCode.BadNoMatch)
  })
})

// ── RegisterNodes / UnregisterNodes ──────────────────────────────────────────

describe('ViewService – RegisterNodes / UnregisterNodes', () => {
  it('registers and unregisters NodeIds against the session', () => {
    const addressSpace = new AddressSpace()
    const svc = new ViewService(addressSpace)
    const session = makeSession()

    const nodeId = NodeId.newNumeric(0, ObjectIds.Server)
    const regReq = new RegisterNodesRequest()
    regReq.requestHeader = makeRequestHeader()
    regReq.nodesToRegister = [nodeId]

    const regRes = svc.registerNodes(regReq, session)
    expect(regRes.registeredNodeIds).toHaveLength(1)
    expect(session.registeredNodes.has(nodeId.toString())).toBe(true)

    const unregReq = new UnregisterNodesRequest()
    unregReq.requestHeader = makeRequestHeader()
    unregReq.nodesToUnregister = [nodeId]
    svc.unregisterNodes(unregReq, session)
    expect(session.registeredNodes.has(nodeId.toString())).toBe(false)
  })
})
