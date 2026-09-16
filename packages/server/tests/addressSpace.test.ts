import { describe, it, expect } from 'vitest'

import {
  DataValue,
  NodeId,
  SamplingIntervalDiagnosticsDataType,
  Variant,
  StatusCode,
  uaInt32,
  uaDouble,
} from 'opcjs-base'

// BuiltInType numeric constants (OPC UA Part 6 §5.1.2) — not yet exported from opcjs-base
const BUILTIN_STRING = 12
const BUILTIN_QUALIFIED_NAME = 20
const BUILTIN_LOCALIZED_TEXT = 21

import { AddressSpace } from '../src/addressSpace/addressSpace.js'
import { AttributeId } from '../src/addressSpace/node.js'
import { CustomIds } from '../src/addressSpace/wellKnownIds.js'

// ── helpers ──────────────────────────────────────────────────────────────────

const stringTypeId = NodeId.newNumeric(0, 12)

// ── AddressSpace pre-populated nodes ─────────────────────────────────────────

describe('AddressSpace – pre-populated nodes', () => {
  it('Server node (i=2253) exists and has NodeClass attribute', () => {
    const as = new AddressSpace()
    const nodeId = NodeId.newNumeric(0, 2253)
    const dv = as.read(nodeId, AttributeId.NodeClass)
    expect(dv.statusCode).toBe(StatusCode.Good)
  })

  it('ServerArray node (i=2254) returns a string array value', () => {
    const as = new AddressSpace()
    const nodeId = NodeId.newNumeric(0, 2254)
    const dv = as.read(nodeId, AttributeId.Value)
    expect(dv.statusCode).toBe(StatusCode.Good)
    expect(dv.value?.type).toBe(BUILTIN_STRING)
    expect(Array.isArray(dv.value?.value)).toBe(true)
    expect((dv.value?.value as string[]).length).toBeGreaterThan(0)
  })

  it('NamespaceArray node (i=2255) contains the OPC UA namespace URI', () => {
    const as = new AddressSpace()
    const dv = as.read(NodeId.newNumeric(0, 2255), AttributeId.Value)
    expect(dv.statusCode).toBe(StatusCode.Good)
    const ns = dv.value?.value as string[]
    expect(ns).toContain('http://opcfoundation.org/UA/')
  })

  it('ServerStatus node (i=2256) exists', () => {
    const as = new AddressSpace()
    const dv = as.read(NodeId.newNumeric(0, 2256), AttributeId.NodeId)
    expect(dv.statusCode).toBe(StatusCode.Good)
  })
})

// ── read – error codes ────────────────────────────────────────────────────────

describe('AddressSpace – read error codes', () => {
  it('returns BadNodeIdUnknown for an absent node', () => {
    const as = new AddressSpace()
    const dv = as.read(NodeId.newNumeric(0, 9999), AttributeId.Value)
    expect(dv.statusCode).toBe(StatusCode.BadNodeIdUnknown)
  })

  it('returns BadAttributeIdInvalid when attribute is missing on the node', () => {
    const as = new AddressSpace()
    const nodeId = NodeId.newNumeric(0, 99)
    as.addObject(nodeId, 'TestObj')
    // Attribute 13 (Value) does not exist on an Object node
    const dv = as.read(nodeId, AttributeId.Value)
    expect(dv.statusCode).toBe(StatusCode.BadAttributeIdInvalid)
  })
})

// ── addObject ─────────────────────────────────────────────────────────────────

describe('AddressSpace – addObject', () => {
  it('creates a readable Object node with BrowseName', () => {
    const as = new AddressSpace()
    const nodeId = NodeId.newNumeric(0, 100)
    as.addObject(nodeId, 'MyObject')
    const dv = as.read(nodeId, AttributeId.BrowseName)
    expect(dv.statusCode).toBe(StatusCode.Good)
    expect(dv.value?.type).toBe(BUILTIN_QUALIFIED_NAME)
  })

  it('uses displayName argument when provided', () => {
    const as = new AddressSpace()
    const nodeId = NodeId.newNumeric(0, 101)
    as.addObject(nodeId, 'Obj', 'My Object Label')
    const dv = as.read(nodeId, AttributeId.DisplayName)
    expect(dv.statusCode).toBe(StatusCode.Good)
    expect(dv.value?.type).toBe(BUILTIN_LOCALIZED_TEXT)
  })
})

// ── addVariable ──────────────────────────────────────────────────────────────

describe('AddressSpace – addVariable', () => {
  it('creates a readable Variable node with the supplied value', () => {
    const as = new AddressSpace()
    const nodeId = NodeId.newNumeric(0, 200)
    as.addVariable(nodeId, 'Temperature', stringTypeId, Variant.newFrom('hot'))
    const dv = as.read(nodeId, AttributeId.Value)
    expect(dv.statusCode).toBe(StatusCode.Good)
    expect(dv.value?.value).toBe('hot')
  })

  it('AccessLevel defaults to 1 (CurrentRead)', () => {
    const as = new AddressSpace()
    const nodeId = NodeId.newNumeric(0, 201)
    as.addVariable(nodeId, 'Sensor', stringTypeId, Variant.newFrom(true))
    const dv = as.read(nodeId, AttributeId.AccessLevel)
    expect(dv.statusCode).toBe(StatusCode.Good)
    expect(dv.value?.value).toBe(1)
  })

  it('ValueRank defaults to -1 (scalar)', () => {
    const as = new AddressSpace()
    const nodeId = NodeId.newNumeric(0, 202)
    as.addVariable(nodeId, 'Counter', stringTypeId, Variant.newFrom(uaInt32(0)))
    const dv = as.read(nodeId, AttributeId.ValueRank)
    expect(dv.statusCode).toBe(StatusCode.Good)
    expect(dv.value?.value).toBe(-1)
  })

  it('can update value via setValue', () => {
    const as = new AddressSpace()
    const nodeId = NodeId.newNumeric(0, 203)
    const node = as.addVariable(nodeId, 'Speed', stringTypeId, Variant.newFrom(uaDouble(0)))
    node.setValue(Variant.newFrom(uaDouble(99.9)))
    const dv = as.read(nodeId, AttributeId.Value)
    expect(dv.value?.value).toBe(99.9)
  })
})

// ── Embedded DataChange Subscription 2022 Server Facet ───────────────────────

describe('AddressSpace – Base Info Server Capabilities Subscriptions', () => {
  it('exposes MaxSubscriptions, MaxMonitoredItems, MaxSubscriptionsPerSession, MaxMonitoredItemsPerSubscription and MaxMonitoredItemsQueueSize', () => {
    const as = new AddressSpace()
    for (const id of [
      CustomIds.ServerCapabilities_MaxSubscriptions,
      CustomIds.ServerCapabilities_MaxMonitoredItems,
      CustomIds.ServerCapabilities_MaxSubscriptionsPerSession,
      CustomIds.ServerCapabilities_MaxMonitoredItemsPerSubscription,
      CustomIds.ServerCapabilities_MaxMonitoredItemsQueueSize,
    ]) {
      const dv = as.read(NodeId.newNumeric(1, id), AttributeId.Value)
      expect(dv.statusCode).toBe(StatusCode.Good)
      expect(dv.value?.value).toBeGreaterThan(0)
    }
  })

  it('exposes MaxMonitoredItemsPerCall under OperationLimits', () => {
    const as = new AddressSpace()
    const dv = as.read(NodeId.newNumeric(1, CustomIds.OperationLimits_MaxMonitoredItemsPerCall), AttributeId.Value)
    expect(dv.statusCode).toBe(StatusCode.Good)
    expect(dv.value?.value).toBeGreaterThan(0)
  })

  it('exposes an AggregateFunctions folder', () => {
    const as = new AddressSpace()
    const dv = as.read(NodeId.newNumeric(1, CustomIds.ServerCapabilities_AggregateFunctions), AttributeId.NodeClass)
    expect(dv.statusCode).toBe(StatusCode.Good)
  })
})

describe('AddressSpace – Base Info Fixed SamplingInterval', () => {
  it('SamplingIntervalDiagnosticsArray reads as empty until wired', () => {
    const as = new AddressSpace()
    const dv = as.read(
      NodeId.newNumeric(1, CustomIds.ServerDiagnostics_SamplingIntervalDiagnosticsArray),
      AttributeId.Value,
    )
    expect(dv.statusCode).toBe(StatusCode.Good)
    expect(dv.value?.value).toEqual([])
  })

  it('reads as empty while EnabledFlag is false, even once wired to live data', () => {
    const as = new AddressSpace()
    const diag = new SamplingIntervalDiagnosticsDataType()
    diag.samplingInterval = 100
    diag.monitoredItemCount = 2
    diag.maxMonitoredItemCount = 2
    diag.disabledMonitoredItemCount = 0
    as.wireSubscriptionDiagnostics(() => [diag])

    const dv = as.read(
      NodeId.newNumeric(1, CustomIds.ServerDiagnostics_SamplingIntervalDiagnosticsArray),
      AttributeId.Value,
    )
    expect(dv.value?.value).toEqual([])
  })

  it('reports live diagnostics once EnabledFlag is set to true', () => {
    const as = new AddressSpace()
    const diag = new SamplingIntervalDiagnosticsDataType()
    diag.samplingInterval = 100
    diag.monitoredItemCount = 2
    diag.maxMonitoredItemCount = 2
    diag.disabledMonitoredItemCount = 0
    as.wireSubscriptionDiagnostics(() => [diag])

    as.write(
      NodeId.newNumeric(1, CustomIds.ServerDiagnostics_EnabledFlag),
      AttributeId.Value,
      new DataValue(Variant.newFrom(true), StatusCode.Good),
    )

    const dv = as.read(
      NodeId.newNumeric(1, CustomIds.ServerDiagnostics_SamplingIntervalDiagnosticsArray),
      AttributeId.Value,
    )
    expect(dv.statusCode).toBe(StatusCode.Good)
    expect(Array.isArray(dv.value?.value)).toBe(true)
    expect((dv.value?.value as unknown[]).length).toBe(1)
  })
})
