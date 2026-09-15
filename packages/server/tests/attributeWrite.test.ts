import { describe, it, expect } from 'vitest'

import {
  DataValue,
  NodeId,
  StatusCode,
  Variant,
  WriteRequest,
  WriteValue,
  uaInt32,
} from 'opcjs-base'

import { AddressSpace } from '../src/addressSpace/addressSpace.js'
import { AccessLevelExFlags, AccessLevelFlags, AttributeId } from '../src/addressSpace/node.js'
import { AttributeService } from '../src/services/attributeService.js'
import type { Session } from '../src/sessions/session.js'

// ── helpers ──────────────────────────────────────────────────────────────────

const stringTypeId = NodeId.newNumeric(0, 12)
const int32TypeId = NodeId.newNumeric(0, 6)

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

function makeWriteRequest(entries: WriteValue[]): WriteRequest {
  const req = new WriteRequest()
  req.requestHeader = { requestHandle: 1 } as never
  req.nodesToWrite = entries
  return req
}

function writeValue(nodeId: NodeId, value: DataValue, indexRange: string | null = null): WriteValue {
  const wv = new WriteValue()
  wv.nodeId = nodeId
  wv.attributeId = AttributeId.Value
  wv.indexRange = indexRange
  wv.value = value
  return wv
}

// ── Attribute Write Values ───────────────────────────────────────────────────

describe('AttributeService – Write (Attribute Write Values)', () => {
  it('writes a scalar value to a CurrentWrite-enabled Variable', () => {
    const as = new AddressSpace()
    const nodeId = NodeId.newNumeric(1, 100)
    as.addVariable(
      nodeId,
      'Writable',
      stringTypeId,
      Variant.newFrom('initial'),
      -1,
      undefined,
      AccessLevelFlags.CurrentRead | AccessLevelFlags.CurrentWrite,
    )
    const svc = new AttributeService(as)

    const req = makeWriteRequest([writeValue(nodeId, new DataValue(Variant.newFrom('updated'), StatusCode.Good))])
    const res = svc.write(req, makeSession())

    expect(res.results[0]).toBe(StatusCode.Good)
    expect(as.read(nodeId, AttributeId.Value).value?.value).toBe('updated')
  })

  it('rejects a write to a read-only Variable with Bad_NotWritable', () => {
    const as = new AddressSpace()
    const nodeId = NodeId.newNumeric(1, 101)
    as.addVariable(nodeId, 'ReadOnly', stringTypeId, Variant.newFrom('fixed'))
    const svc = new AttributeService(as)

    const req = makeWriteRequest([writeValue(nodeId, new DataValue(Variant.newFrom('changed'), StatusCode.Good))])
    const res = svc.write(req, makeSession())

    expect(res.results[0]).toBe(StatusCode.BadNotWritable)
  })

  it('rejects a write to a non-Value attribute with Bad_NotWritable', () => {
    const as = new AddressSpace()
    const nodeId = NodeId.newNumeric(1, 102)
    as.addVariable(
      nodeId,
      'W',
      stringTypeId,
      Variant.newFrom('x'),
      -1,
      undefined,
      AccessLevelFlags.CurrentRead | AccessLevelFlags.CurrentWrite,
    )
    const svc = new AttributeService(as)

    const wv = new WriteValue()
    wv.nodeId = nodeId
    wv.attributeId = AttributeId.DisplayName
    wv.indexRange = null
    wv.value = new DataValue(Variant.newFrom('Y'), StatusCode.Good)

    const res = svc.write(makeWriteRequest([wv]), makeSession())
    expect(res.results[0]).toBe(StatusCode.BadNotWritable)
  })

  it('returns Bad_NodeIdUnknown for an absent node', () => {
    const as = new AddressSpace()
    const svc = new AttributeService(as)
    const req = makeWriteRequest([
      writeValue(NodeId.newNumeric(1, 999999), new DataValue(Variant.newFrom('x'), StatusCode.Good)),
    ])
    const res = svc.write(req, makeSession())
    expect(res.results[0]).toBe(StatusCode.BadNodeIdUnknown)
  })
})

// ── Attribute Write Index ────────────────────────────────────────────────────

describe('AttributeService – Write (Attribute Write Index)', () => {
  it('writes a partial array range via IndexRange', () => {
    const as = new AddressSpace()
    const nodeId = NodeId.newNumeric(1, 200)
    as.addVariable(
      nodeId,
      'Arr',
      int32TypeId,
      Variant.newFrom([uaInt32(1), uaInt32(2), uaInt32(3), uaInt32(4)]),
      1,
      undefined,
      AccessLevelFlags.CurrentRead | AccessLevelFlags.CurrentWrite,
    )
    const svc = new AttributeService(as)

    const req = makeWriteRequest([
      writeValue(nodeId, new DataValue(Variant.newFrom([uaInt32(20), uaInt32(30)]), StatusCode.Good), '1:2'),
    ])
    const res = svc.write(req, makeSession())

    expect(res.results[0]).toBe(StatusCode.Good)
    expect(as.read(nodeId, AttributeId.Value).value?.value).toEqual([1, 20, 30, 4])
  })

  it('rejects a partial write with Bad_WriteNotSupported when WriteFullArrayOnly is set', () => {
    const as = new AddressSpace()
    // ns=1;i=3 is the pre-populated FullArrayOnlyArray demonstration node.
    const nodeId = NodeId.newNumeric(1, 3)
    expect(as.read(nodeId, AttributeId.AccessLevelEx).value?.value).toBe(AccessLevelExFlags.WriteFullArrayOnly)

    const svc = new AttributeService(as)
    const req = makeWriteRequest([
      writeValue(nodeId, new DataValue(Variant.newFrom([uaInt32(9)]), StatusCode.Good), '0:0'),
    ])
    const res = svc.write(req, makeSession())
    expect(res.results[0]).toBe(StatusCode.BadWriteNotSupported)
  })

  it('allows a full-array write (no IndexRange) even when WriteFullArrayOnly is set', () => {
    const as = new AddressSpace()
    const nodeId = NodeId.newNumeric(1, 3)
    const svc = new AttributeService(as)

    const req = makeWriteRequest([
      writeValue(nodeId, new DataValue(Variant.newFrom([uaInt32(1), uaInt32(2), uaInt32(3)]), StatusCode.Good)),
    ])
    const res = svc.write(req, makeSession())
    expect(res.results[0]).toBe(StatusCode.Good)
  })
})

// ── Attribute Write StatusCode & Timestamp ───────────────────────────────────

describe('AttributeService – Write (Attribute Write StatusCode & Timestamp)', () => {
  it('applies the client-supplied statusCode/sourceTimestamp when StatusWrite/TimestampWrite bits are set', () => {
    const as = new AddressSpace()
    const nodeId = NodeId.newNumeric(1, 300)
    as.addVariable(
      nodeId,
      'Historian',
      stringTypeId,
      Variant.newFrom('x'),
      -1,
      undefined,
      AccessLevelFlags.CurrentRead |
        AccessLevelFlags.CurrentWrite |
        AccessLevelFlags.StatusWrite |
        AccessLevelFlags.TimestampWrite,
    )
    const svc = new AttributeService(as)

    const sourceTs = new Date('2020-01-01T00:00:00Z')
    const req = makeWriteRequest([
      writeValue(nodeId, new DataValue(Variant.newFrom('replayed'), StatusCode.BadSensorFailure, sourceTs)),
    ])
    const res = svc.write(req, makeSession())

    expect(res.results[0]).toBe(StatusCode.Good)
    const dv = as.read(nodeId, AttributeId.Value)
    expect(dv.statusCode).toBe(StatusCode.BadSensorFailure)
    expect(dv.sourceTimestamp).toEqual(sourceTs)
  })

  it('ignores a supplied statusCode/timestamp when the write bits are not set', () => {
    const as = new AddressSpace()
    const nodeId = NodeId.newNumeric(1, 301)
    as.addVariable(
      nodeId,
      'Plain',
      stringTypeId,
      Variant.newFrom('x'),
      -1,
      undefined,
      AccessLevelFlags.CurrentRead | AccessLevelFlags.CurrentWrite,
    )
    const svc = new AttributeService(as)

    const req = makeWriteRequest([
      writeValue(nodeId, new DataValue(Variant.newFrom('y'), StatusCode.BadSensorFailure, new Date(0))),
    ])
    const res = svc.write(req, makeSession())

    expect(res.results[0]).toBe(StatusCode.Good)
    const dv = as.read(nodeId, AttributeId.Value)
    expect(dv.statusCode).toBe(StatusCode.Good)
  })
})

// ── Address Space Atomicity ───────────────────────────────────────────────────

describe('AddressSpace – Atomicity (AccessLevelEx Nonatomic bits)', () => {
  it('never sets NonatomicRead/NonatomicWrite: the in-memory Map guarantees atomic access', () => {
    const as = new AddressSpace()
    const nodeId = NodeId.newNumeric(1, 400)
    as.addVariable(nodeId, 'AnyVar', stringTypeId, Variant.newFrom([uaInt32(1), uaInt32(2), uaInt32(3)]), 1)

    const accessLevelEx = as.read(nodeId, AttributeId.AccessLevelEx).value?.value as number
    expect(accessLevelEx & AccessLevelExFlags.NonatomicRead).toBe(0)
    expect(accessLevelEx & AccessLevelExFlags.NonatomicWrite).toBe(0)
  })

  it('allows an explicit accessLevelEx override for future non-atomic backends', () => {
    const as = new AddressSpace()
    const nodeId = NodeId.newNumeric(1, 401)
    as.addVariable(
      nodeId,
      'Custom',
      stringTypeId,
      Variant.newFrom('x'),
      -1,
      undefined,
      AccessLevelFlags.CurrentRead,
      undefined,
      AccessLevelExFlags.NonatomicRead,
    )
    const accessLevelEx = as.read(nodeId, AttributeId.AccessLevelEx).value?.value as number
    expect(accessLevelEx & AccessLevelExFlags.NonatomicRead).toBe(AccessLevelExFlags.NonatomicRead)
  })
})
