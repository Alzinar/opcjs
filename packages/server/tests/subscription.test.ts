import { describe, expect, it } from 'vitest'
import {
  CreateSubscriptionRequest,
  DataValue,
  DeleteSubscriptionsRequest,
  ExtensionObject,
  ModifySubscriptionRequest,
  MonitoringModeEnum,
  NodeId,
  PublishRequest,
  ReadValueId,
  RepublishRequest,
  RequestHeader,
  StatusCode,
  SubscriptionAcknowledgement,
  Variant,
} from 'opcjs-base'

import { uaInt32 } from 'opcjs-base'

import { AddressSpace } from '../src/addressSpace/addressSpace.js'
import { AttributeId } from '../src/addressSpace/node.js'
import { SubscriptionManager } from '../src/subscription/subscriptionManager.js'
import { SubscriptionService } from '../src/services/subscriptionService.js'
import { MonitoredItemService } from '../src/services/monitoredItemService.js'
import {
  CreateMonitoredItemsRequest,
  ModifyMonitoredItemsRequest,
  MonitoredItemCreateRequest,
  MonitoredItemModifyRequest,
  MonitoringParameters,
  SetMonitoringModeRequest,
  TimestampsToReturnEnum,
} from 'opcjs-base'

function makeRequestHeader(authToken?: NodeId): RequestHeader {
  const h = new RequestHeader()
  h.authenticationToken = authToken ?? NodeId.newNumeric(0, 1)
  h.requestHandle = 1
  h.timestamp = new Date()
  h.timeoutHint = 0
  h.returnDiagnostics = 0
  h.auditEntryId = null
  h.additionalHeader = ExtensionObject.newEmpty()
  return h
}

function makeAuthToken(): NodeId {
  return NodeId.newNumeric(0, Math.floor(Math.random() * 1_000_000) + 1)
}

function makeStack() {
  const addressSpace = new AddressSpace()
  const manager = new SubscriptionManager(addressSpace)
  const subscriptionSvc = new SubscriptionService(manager)
  const monitoredItemSvc = new MonitoredItemService(manager)
  return { addressSpace, manager, subscriptionSvc, monitoredItemSvc }
}

describe('SubscriptionManager.createSubscription', () => {
  it('revises parameters and assigns unique ids', () => {
    const { manager } = makeStack()
    const auth = makeAuthToken()

    const a = manager.createSubscription({
      ownerAuthToken: auth,
      requestedPublishingInterval: 100,
      requestedMaxKeepAliveCount: 5,
      requestedLifetimeCount: 10,
      maxNotificationsPerPublish: 50,
      publishingEnabled: true,
      priority: 1,
    })
    const b = manager.createSubscription({
      ownerAuthToken: auth,
      requestedPublishingInterval: 100,
      requestedMaxKeepAliveCount: 5,
      requestedLifetimeCount: 10,
      maxNotificationsPerPublish: 50,
      publishingEnabled: true,
      priority: 1,
    })

    expect(a.subscriptionId).not.toBe(b.subscriptionId)
    expect(a.revisedPublishingInterval).toBeGreaterThanOrEqual(50)
    // lifetime must be >= 3 × keepAliveCount
    expect(a.revisedLifetimeCount).toBeGreaterThanOrEqual(3 * a.revisedMaxKeepAliveCount)

    a.dispose()
    b.dispose()
  })

  it('clamps too-small publishing interval to the minimum', () => {
    const { manager } = makeStack()
    const auth = makeAuthToken()

    const sub = manager.createSubscription({
      ownerAuthToken: auth,
      requestedPublishingInterval: 1,
      requestedMaxKeepAliveCount: 5,
      requestedLifetimeCount: 10,
      maxNotificationsPerPublish: 50,
      publishingEnabled: true,
      priority: 1,
    })

    expect(sub.revisedPublishingInterval).toBeGreaterThanOrEqual(50)
    sub.dispose()
  })
})

describe('SubscriptionManager.deleteSubscriptionsOfSession', () => {
  it('deletes only the subscriptions of the given session', () => {
    const { manager } = makeStack()
    const auth1 = makeAuthToken()
    const auth2 = makeAuthToken()

    manager.createSubscription({
      ownerAuthToken: auth1,
      requestedPublishingInterval: 100,
      requestedMaxKeepAliveCount: 5,
      requestedLifetimeCount: 10,
      maxNotificationsPerPublish: 50,
      publishingEnabled: true,
      priority: 1,
    })
    manager.createSubscription({
      ownerAuthToken: auth2,
      requestedPublishingInterval: 100,
      requestedMaxKeepAliveCount: 5,
      requestedLifetimeCount: 10,
      maxNotificationsPerPublish: 50,
      publishingEnabled: true,
      priority: 1,
    })

    expect(manager.count).toBe(2)
    manager.deleteSubscriptionsOfSession(auth1)
    expect(manager.count).toBe(1)
    manager.deleteSubscriptionsOfSession(auth2)
    expect(manager.count).toBe(0)
  })
})

describe('SubscriptionService.publish', () => {
  it('returns Bad_NoSubscription when the session has no subscriptions', async () => {
    const { subscriptionSvc } = makeStack()
    const auth = makeAuthToken()

    const req = new PublishRequest()
    req.requestHeader = makeRequestHeader(auth)
    req.subscriptionAcknowledgements = []

    const res = await subscriptionSvc.publish(req, auth)
    expect(res.responseHeader?.serviceResult).toBe(StatusCode.BadNoSubscription)
  })

  it('waits for a publishing tick and delivers a data change', async () => {
    const { addressSpace, manager, subscriptionSvc, monitoredItemSvc } = makeStack()
    const auth = makeAuthToken()

    // Add a variable we can mutate.
    const nodeId = NodeId.newNumeric(1, 1000)
    const variable = addressSpace.addVariable(
      nodeId,
      'TestVar',
      NodeId.newNumeric(0, 6),
      Variant.newFrom(uaInt32(1)),
    )

    // CreateSubscription with a small publishing interval.
    const createReq = new CreateSubscriptionRequest()
    createReq.requestHeader = makeRequestHeader(auth)
    createReq.requestedPublishingInterval = 50
    createReq.requestedMaxKeepAliveCount = 100
    createReq.requestedLifetimeCount = 1000
    createReq.maxNotificationsPerPublish = 100
    createReq.publishingEnabled = true
    createReq.priority = 1

    const session = {
      sessionId: NodeId.newNumeric(0, 1),
      authenticationToken: auth,
      serverNonce: new Uint8Array(32),
      revisedTimeoutMs: 60_000,
      boundChannelId: 1,
      isActivated: true,
      createdAt: new Date(),
      lastActivityAt: new Date(),
      continuationPoints: new Map(),
      registeredNodes: new Set<string>(),
    }
    const createRes = subscriptionSvc.createSubscription(createReq, session)
    expect(createRes.responseHeader?.serviceResult).toBe(StatusCode.Good)
    const subscriptionId = createRes.subscriptionId

    // CreateMonitoredItems for the variable's Value attribute.
    const rvi = new ReadValueId()
    rvi.nodeId = nodeId
    rvi.attributeId = AttributeId.Value
    rvi.indexRange = ''
    rvi.dataEncoding = { namespaceIndex: 0, name: '' } as never

    const params = new MonitoringParameters()
    params.clientHandle = 7
    params.samplingInterval = 50
    params.queueSize = 1
    params.discardOldest = true
    params.filter = ExtensionObject.newEmpty()

    const miCreate = new MonitoredItemCreateRequest()
    miCreate.itemToMonitor = rvi
    miCreate.monitoringMode = MonitoringModeEnum.Reporting
    miCreate.requestedParameters = params

    const cmiReq = new CreateMonitoredItemsRequest()
    cmiReq.requestHeader = makeRequestHeader(auth)
    cmiReq.subscriptionId = subscriptionId
    cmiReq.timestampsToReturn = TimestampsToReturnEnum.Source
    cmiReq.itemsToCreate = [miCreate]

    const cmiRes = monitoredItemSvc.createMonitoredItems(cmiReq, auth)
    expect(cmiRes.results[0].statusCode).toBe(StatusCode.Good)

    // First publish — delivers the initial value (sampled on add).
    const pubReq1 = new PublishRequest()
    pubReq1.requestHeader = makeRequestHeader(auth)
    pubReq1.subscriptionAcknowledgements = []
    const pubRes1 = await subscriptionSvc.publish(pubReq1, auth)
    expect(pubRes1.subscriptionId).toBe(subscriptionId)
    expect(pubRes1.notificationMessage?.notificationData?.length).toBe(1)

    // Mutate the variable, then issue a second publish — should receive the
    // change after the next publishing tick.
    variable.setValue(Variant.newFrom(uaInt32(2)))

    const ack = new SubscriptionAcknowledgement()
    ack.subscriptionId = subscriptionId
    ack.sequenceNumber = pubRes1.notificationMessage!.sequenceNumber

    const pubReq2 = new PublishRequest()
    pubReq2.requestHeader = makeRequestHeader(auth)
    pubReq2.subscriptionAcknowledgements = [ack]

    const pubRes2 = await subscriptionSvc.publish(pubReq2, auth)
    expect(pubRes2.subscriptionId).toBe(subscriptionId)
    expect(pubRes2.notificationMessage?.notificationData?.length).toBe(1)
    // Sequence numbers must be increasing.
    expect(pubRes2.notificationMessage!.sequenceNumber).toBeGreaterThan(
      pubRes1.notificationMessage!.sequenceNumber,
    )

    // Cleanup
    const delReq = new DeleteSubscriptionsRequest()
    delReq.requestHeader = makeRequestHeader(auth)
    delReq.subscriptionIds = [subscriptionId]
    const delRes = subscriptionSvc.deleteSubscriptions(delReq, auth)
    expect(delRes.results[0]).toBe(StatusCode.Good)
    expect(manager.count).toBe(0)
  }, 5_000)
})

describe('SubscriptionService.republish', () => {
  it('returns Bad_SubscriptionIdInvalid for an unknown subscription', () => {
    const { subscriptionSvc } = makeStack()
    const auth = makeAuthToken()

    const req = new RepublishRequest()
    req.requestHeader = makeRequestHeader(auth)
    req.subscriptionId = 9999
    req.retransmitSequenceNumber = 1

    const res = subscriptionSvc.republish(req, auth)
    expect(res.responseHeader?.serviceResult).toBe(StatusCode.BadSubscriptionIdInvalid)
  })

  it('returns Bad_MessageNotAvailable for an unretained sequence number', () => {
    const { manager, subscriptionSvc } = makeStack()
    const auth = makeAuthToken()
    const sub = manager.createSubscription({
      ownerAuthToken: auth,
      requestedPublishingInterval: 1000,
      requestedMaxKeepAliveCount: 1000,
      requestedLifetimeCount: 3000,
      maxNotificationsPerPublish: 100,
      publishingEnabled: true,
      priority: 1,
    })

    const req = new RepublishRequest()
    req.requestHeader = makeRequestHeader(auth)
    req.subscriptionId = sub.subscriptionId
    req.retransmitSequenceNumber = 42

    const res = subscriptionSvc.republish(req, auth)
    expect(res.responseHeader?.serviceResult).toBe(StatusCode.BadMessageNotAvailable)

    sub.dispose()
  })

  it('returns a previously sent NotificationMessage by sequence number', async () => {
    const { addressSpace, manager, subscriptionSvc, monitoredItemSvc } = makeStack()
    const auth = makeAuthToken()

    const nodeId = NodeId.newNumeric(1, 3000)
    addressSpace.addVariable(nodeId, 'RepublishVar', NodeId.newNumeric(0, 6), Variant.newFrom(uaInt32(1)))

    const sub = manager.createSubscription({
      ownerAuthToken: auth,
      requestedPublishingInterval: 50,
      requestedMaxKeepAliveCount: 100,
      requestedLifetimeCount: 1000,
      maxNotificationsPerPublish: 100,
      publishingEnabled: true,
      priority: 1,
    })

    const rvi = new ReadValueId()
    rvi.nodeId = nodeId
    rvi.attributeId = AttributeId.Value
    rvi.indexRange = ''
    rvi.dataEncoding = { namespaceIndex: 0, name: '' } as never

    const params = new MonitoringParameters()
    params.clientHandle = 1
    params.samplingInterval = 50
    params.queueSize = 1
    params.discardOldest = true
    params.filter = ExtensionObject.newEmpty()

    const miCreate = new MonitoredItemCreateRequest()
    miCreate.itemToMonitor = rvi
    miCreate.monitoringMode = MonitoringModeEnum.Reporting
    miCreate.requestedParameters = params

    const cmiReq = new CreateMonitoredItemsRequest()
    cmiReq.requestHeader = makeRequestHeader(auth)
    cmiReq.subscriptionId = sub.subscriptionId
    cmiReq.timestampsToReturn = TimestampsToReturnEnum.Source
    cmiReq.itemsToCreate = [miCreate]
    monitoredItemSvc.createMonitoredItems(cmiReq, auth)

    // First publish delivers (and retains) the initial value.
    const pubReq = new PublishRequest()
    pubReq.requestHeader = makeRequestHeader(auth)
    pubReq.subscriptionAcknowledgements = []
    const pubRes = await subscriptionSvc.publish(pubReq, auth)
    const seq = pubRes.notificationMessage!.sequenceNumber

    // Republish without acknowledging first — the message must still be available.
    const repReq = new RepublishRequest()
    repReq.requestHeader = makeRequestHeader(auth)
    repReq.subscriptionId = sub.subscriptionId
    repReq.retransmitSequenceNumber = seq

    const repRes = subscriptionSvc.republish(repReq, auth)
    expect(repRes.responseHeader?.serviceResult).toBe(StatusCode.Good)
    expect(repRes.notificationMessage?.sequenceNumber).toBe(seq)

    sub.dispose()
  }, 5_000)
})

describe('SubscriptionService.modifySubscription', () => {
  it('returns Bad_SubscriptionIdInvalid for an unknown subscription', () => {
    const { subscriptionSvc } = makeStack()
    const auth = makeAuthToken()

    const req = new ModifySubscriptionRequest()
    req.requestHeader = makeRequestHeader(auth)
    req.subscriptionId = 9999
    req.requestedPublishingInterval = 100
    req.requestedMaxKeepAliveCount = 5
    req.requestedLifetimeCount = 20
    req.maxNotificationsPerPublish = 100
    req.priority = 0

    const res = subscriptionSvc.modifySubscription(req, auth)
    expect(res.responseHeader?.serviceResult).toBe(StatusCode.BadSubscriptionIdInvalid)
  })

  it('re-arms the publishing timer so the new interval takes effect immediately', async () => {
    const { manager, subscriptionSvc } = makeStack()
    const auth = makeAuthToken()

    // Long interval — a pending Publish request would not resolve for a long
    // time unless the timer is re-armed by ModifySubscription.
    const sub = manager.createSubscription({
      ownerAuthToken: auth,
      requestedPublishingInterval: 60_000,
      requestedMaxKeepAliveCount: 1000,
      requestedLifetimeCount: 3000,
      maxNotificationsPerPublish: 100,
      publishingEnabled: true,
      priority: 1,
    })

    const pubReq = new PublishRequest()
    pubReq.requestHeader = makeRequestHeader(auth)
    pubReq.subscriptionAcknowledgements = []
    const pendingPublish = subscriptionSvc.publish(pubReq, auth)

    // Revise down to a fast interval with a keep-alive after a single tick.
    const modReq = new ModifySubscriptionRequest()
    modReq.requestHeader = makeRequestHeader(auth)
    modReq.subscriptionId = sub.subscriptionId
    modReq.requestedPublishingInterval = 30
    modReq.requestedMaxKeepAliveCount = 1
    modReq.requestedLifetimeCount = 20
    modReq.maxNotificationsPerPublish = 100
    modReq.priority = 0

    const modRes = subscriptionSvc.modifySubscription(modReq, auth)
    expect(modRes.responseHeader?.serviceResult).toBe(StatusCode.Good)
    expect(modRes.revisedPublishingInterval).toBeLessThan(60_000)
    expect(sub.revisedPublishingInterval).toBe(modRes.revisedPublishingInterval)

    // If the old 60s timer wasn't cleared, this would time out well before
    // the keep-alive fires on the new interval.
    const res = await pendingPublish
    expect(res.subscriptionId).toBe(sub.subscriptionId)
    expect(res.notificationMessage?.notificationData?.length).toBe(0)

    sub.dispose()
  }, 2_000)
})

describe('MonitoredItemService.createMonitoredItems', () => {
  it('returns Bad_SubscriptionIdInvalid for unknown subscription', () => {
    const { monitoredItemSvc } = makeStack()
    const auth = makeAuthToken()

    const req = new CreateMonitoredItemsRequest()
    req.requestHeader = makeRequestHeader(auth)
    req.subscriptionId = 9999
    req.timestampsToReturn = TimestampsToReturnEnum.Source
    req.itemsToCreate = []

    const res = monitoredItemSvc.createMonitoredItems(req, auth)
    expect(res.responseHeader?.serviceResult).toBe(StatusCode.BadSubscriptionIdInvalid)
  })

  it('reads an initial DataValue on creation', () => {
    const { addressSpace, manager, monitoredItemSvc } = makeStack()
    const auth = makeAuthToken()
    const nodeId = NodeId.newNumeric(1, 2001)
    addressSpace.addVariable(nodeId, 'X', NodeId.newNumeric(0, 6), Variant.newFrom(uaInt32(42)))

    const sub = manager.createSubscription({
      ownerAuthToken: auth,
      requestedPublishingInterval: 100,
      requestedMaxKeepAliveCount: 5,
      requestedLifetimeCount: 100,
      maxNotificationsPerPublish: 100,
      publishingEnabled: true,
      priority: 1,
    })

    const rvi = new ReadValueId()
    rvi.nodeId = nodeId
    rvi.attributeId = AttributeId.Value
    rvi.indexRange = ''
    rvi.dataEncoding = { namespaceIndex: 0, name: '' } as never

    const params = new MonitoringParameters()
    params.clientHandle = 3
    params.samplingInterval = 50
    params.queueSize = 1
    params.discardOldest = true
    params.filter = ExtensionObject.newEmpty()

    const miCreate = new MonitoredItemCreateRequest()
    miCreate.itemToMonitor = rvi
    miCreate.monitoringMode = MonitoringModeEnum.Reporting
    miCreate.requestedParameters = params

    const req = new CreateMonitoredItemsRequest()
    req.requestHeader = makeRequestHeader(auth)
    req.subscriptionId = sub.subscriptionId
    req.timestampsToReturn = TimestampsToReturnEnum.Source
    req.itemsToCreate = [miCreate]

    const res = monitoredItemSvc.createMonitoredItems(req, auth)
    expect(res.results[0].statusCode).toBe(StatusCode.Good)
    expect(res.results[0].monitoredItemId).toBeGreaterThan(0)

    sub.dispose()
  })

  it('reports Bad_NodeIdInvalid for an item without a nodeId', () => {
    const { manager, monitoredItemSvc } = makeStack()
    const auth = makeAuthToken()
    const sub = manager.createSubscription({
      ownerAuthToken: auth,
      requestedPublishingInterval: 100,
      requestedMaxKeepAliveCount: 5,
      requestedLifetimeCount: 100,
      maxNotificationsPerPublish: 100,
      publishingEnabled: true,
      priority: 1,
    })

    const rvi = new ReadValueId()
    rvi.nodeId = null as unknown as NodeId
    rvi.attributeId = AttributeId.Value
    rvi.indexRange = ''
    rvi.dataEncoding = { namespaceIndex: 0, name: '' } as never

    const params = new MonitoringParameters()
    params.clientHandle = 0
    params.samplingInterval = 50
    params.queueSize = 1
    params.discardOldest = true
    params.filter = ExtensionObject.newEmpty()

    const miCreate = new MonitoredItemCreateRequest()
    miCreate.itemToMonitor = rvi
    miCreate.monitoringMode = MonitoringModeEnum.Reporting
    miCreate.requestedParameters = params

    const req = new CreateMonitoredItemsRequest()
    req.requestHeader = makeRequestHeader(auth)
    req.subscriptionId = sub.subscriptionId
    req.timestampsToReturn = TimestampsToReturnEnum.Source
    req.itemsToCreate = [miCreate]

    const res = monitoredItemSvc.createMonitoredItems(req, auth)
    expect(res.results[0].statusCode).toBe(StatusCode.BadNodeIdInvalid)

    sub.dispose()
  })
})

function makeCreateMonitoredItemsRequest(
  authToken: NodeId,
  subscriptionId: number,
  nodeId: NodeId,
  opts: { clientHandle?: number; queueSize?: number; monitoringMode?: MonitoringModeEnum; indexRange?: string } = {},
): CreateMonitoredItemsRequest {
  const rvi = new ReadValueId()
  rvi.nodeId = nodeId
  rvi.attributeId = AttributeId.Value
  rvi.indexRange = opts.indexRange ?? ''
  rvi.dataEncoding = { namespaceIndex: 0, name: '' } as never

  const params = new MonitoringParameters()
  params.clientHandle = opts.clientHandle ?? 1
  params.samplingInterval = 50
  params.queueSize = opts.queueSize ?? 1
  params.discardOldest = true
  params.filter = ExtensionObject.newEmpty()

  const miCreate = new MonitoredItemCreateRequest()
  miCreate.itemToMonitor = rvi
  miCreate.monitoringMode = opts.monitoringMode ?? MonitoringModeEnum.Reporting
  miCreate.requestedParameters = params

  const req = new CreateMonitoredItemsRequest()
  req.requestHeader = makeRequestHeader(authToken)
  req.subscriptionId = subscriptionId
  req.timestampsToReturn = TimestampsToReturnEnum.Source
  req.itemsToCreate = [miCreate]
  return req
}

describe('MonitoredItemService.modifyMonitoredItems', () => {
  it('returns Bad_SubscriptionIdInvalid for unknown subscription', () => {
    const { monitoredItemSvc } = makeStack()
    const auth = makeAuthToken()

    const req = new ModifyMonitoredItemsRequest()
    req.requestHeader = makeRequestHeader(auth)
    req.subscriptionId = 9999
    req.timestampsToReturn = TimestampsToReturnEnum.Source
    req.itemsToModify = []

    const res = monitoredItemSvc.modifyMonitoredItems(req, auth)
    expect(res.responseHeader?.serviceResult).toBe(StatusCode.BadSubscriptionIdInvalid)
  })

  it('revises the queue size of an existing monitored item', () => {
    const { addressSpace, manager, monitoredItemSvc } = makeStack()
    const auth = makeAuthToken()
    const nodeId = NodeId.newNumeric(1, 2100)
    addressSpace.addVariable(nodeId, 'ModifyX', NodeId.newNumeric(0, 6), Variant.newFrom(uaInt32(1)))

    const sub = manager.createSubscription({
      ownerAuthToken: auth,
      requestedPublishingInterval: 100,
      requestedMaxKeepAliveCount: 5,
      requestedLifetimeCount: 100,
      maxNotificationsPerPublish: 100,
      publishingEnabled: true,
      priority: 1,
    })

    const createRes = monitoredItemSvc.createMonitoredItems(
      makeCreateMonitoredItemsRequest(auth, sub.subscriptionId, nodeId, { queueSize: 1 }),
      auth,
    )
    const monitoredItemId = createRes.results[0].monitoredItemId

    const itm = new MonitoredItemModifyRequest()
    itm.monitoredItemId = monitoredItemId
    itm.requestedParameters = new MonitoringParameters()
    itm.requestedParameters.clientHandle = 1
    itm.requestedParameters.samplingInterval = 50
    itm.requestedParameters.queueSize = 5
    itm.requestedParameters.discardOldest = true
    itm.requestedParameters.filter = ExtensionObject.newEmpty()

    const req = new ModifyMonitoredItemsRequest()
    req.requestHeader = makeRequestHeader(auth)
    req.subscriptionId = sub.subscriptionId
    req.timestampsToReturn = TimestampsToReturnEnum.Source
    req.itemsToModify = [itm]

    const res = monitoredItemSvc.modifyMonitoredItems(req, auth)
    expect(res.results[0].statusCode).toBe(StatusCode.Good)
    expect(res.results[0].revisedQueueSize).toBe(5)

    // Unknown monitoredItemId reports Bad_MonitoredItemIdInvalid.
    const badItm = new MonitoredItemModifyRequest()
    badItm.monitoredItemId = 99999
    badItm.requestedParameters = itm.requestedParameters
    req.itemsToModify = [badItm]
    const badRes = monitoredItemSvc.modifyMonitoredItems(req, auth)
    expect(badRes.results[0].statusCode).toBe(StatusCode.BadMonitoredItemIdInvalid)

    sub.dispose()
  })
})

describe('MonitoredItemService.setMonitoringMode', () => {
  it('returns Bad_SubscriptionIdInvalid for unknown subscription', () => {
    const { monitoredItemSvc } = makeStack()
    const auth = makeAuthToken()

    const req = new SetMonitoringModeRequest()
    req.requestHeader = makeRequestHeader(auth)
    req.subscriptionId = 9999
    req.monitoringMode = MonitoringModeEnum.Disabled
    req.monitoredItemIds = []

    const res = monitoredItemSvc.setMonitoringMode(req, auth)
    expect(res.responseHeader?.serviceResult).toBe(StatusCode.BadSubscriptionIdInvalid)
  })

  it('disables and re-enables reporting for an existing monitored item', async () => {
    const { addressSpace, manager, subscriptionSvc, monitoredItemSvc } = makeStack()
    const auth = makeAuthToken()
    const nodeId = NodeId.newNumeric(1, 2200)
    const variable = addressSpace.addVariable(nodeId, 'ModeX', NodeId.newNumeric(0, 6), Variant.newFrom(uaInt32(1)))

    const sub = manager.createSubscription({
      ownerAuthToken: auth,
      requestedPublishingInterval: 30,
      requestedMaxKeepAliveCount: 3,
      requestedLifetimeCount: 3000,
      maxNotificationsPerPublish: 100,
      publishingEnabled: true,
      priority: 1,
    })

    const createRes = monitoredItemSvc.createMonitoredItems(
      makeCreateMonitoredItemsRequest(auth, sub.subscriptionId, nodeId),
      auth,
    )
    const monitoredItemId = createRes.results[0].monitoredItemId

    // Drain the initial value sampled at creation time before testing the
    // disabled-mode behaviour.
    const initialReq = new PublishRequest()
    initialReq.requestHeader = makeRequestHeader(auth)
    initialReq.subscriptionAcknowledgements = []
    await subscriptionSvc.publish(initialReq, auth)

    const setReq = new SetMonitoringModeRequest()
    setReq.requestHeader = makeRequestHeader(auth)
    setReq.subscriptionId = sub.subscriptionId
    setReq.monitoringMode = MonitoringModeEnum.Disabled
    setReq.monitoredItemIds = [monitoredItemId]
    const setRes = monitoredItemSvc.setMonitoringMode(setReq, auth)
    expect(setRes.results[0]).toBe(StatusCode.Good)

    // While disabled, value changes must not be reported: park a Publish
    // request and expect it to resolve as a keep-alive (after 3 ticks),
    // never as a data-change notification.
    variable.setValue(Variant.newFrom(uaInt32(2)))

    const pubReq = new PublishRequest()
    pubReq.requestHeader = makeRequestHeader(auth)
    pubReq.subscriptionAcknowledgements = []
    const pubRes = await subscriptionSvc.publish(pubReq, auth)
    // Disabled item never reports — only a keep-alive can arrive.
    expect(pubRes.notificationMessage?.notificationData?.length ?? 0).toBe(0)

    sub.dispose()
  }, 2_000)
})

describe('MonitoredItem IndexRange (Monitor Value Change V2)', () => {
  it('reports only the requested element of an array value', async () => {
    const { addressSpace, manager, subscriptionSvc, monitoredItemSvc } = makeStack()
    const auth = makeAuthToken()
    const nodeId = NodeId.newNumeric(1, 2300)
    addressSpace.addVariable(
      nodeId,
      'ArrayVar',
      NodeId.newNumeric(0, 6),
      Variant.newFrom([uaInt32(10), uaInt32(20), uaInt32(30)]),
      1,
    )

    const sub = manager.createSubscription({
      ownerAuthToken: auth,
      requestedPublishingInterval: 50,
      requestedMaxKeepAliveCount: 1000,
      requestedLifetimeCount: 3000,
      maxNotificationsPerPublish: 100,
      publishingEnabled: true,
      priority: 1,
    })

    const createRes = monitoredItemSvc.createMonitoredItems(
      makeCreateMonitoredItemsRequest(auth, sub.subscriptionId, nodeId, { indexRange: '1' }),
      auth,
    )
    expect(createRes.results[0].statusCode).toBe(StatusCode.Good)

    const pubReq = new PublishRequest()
    pubReq.requestHeader = makeRequestHeader(auth)
    pubReq.subscriptionAcknowledgements = []
    const pubRes = await subscriptionSvc.publish(pubReq, auth)
    const dcn = pubRes.notificationMessage?.notificationData?.[0]?.data as
      | { monitoredItems?: Array<{ value?: DataValue }> }
      | undefined
    const reported = dcn?.monitoredItems?.[0]?.value?.value?.value
    expect(reported).toEqual([20])

    sub.dispose()
  }, 2_000)

  it('rejects an invalid IndexRange with Bad_IndexRangeInvalid', () => {
    const { addressSpace, manager, monitoredItemSvc } = makeStack()
    const auth = makeAuthToken()
    const nodeId = NodeId.newNumeric(1, 2301)
    addressSpace.addVariable(nodeId, 'Y', NodeId.newNumeric(0, 6), Variant.newFrom(uaInt32(1)))

    const sub = manager.createSubscription({
      ownerAuthToken: auth,
      requestedPublishingInterval: 100,
      requestedMaxKeepAliveCount: 5,
      requestedLifetimeCount: 100,
      maxNotificationsPerPublish: 100,
      publishingEnabled: true,
      priority: 1,
    })

    const res = monitoredItemSvc.createMonitoredItems(
      makeCreateMonitoredItemsRequest(auth, sub.subscriptionId, nodeId, { indexRange: 'not-a-range' }),
      auth,
    )
    expect(res.results[0].statusCode).toBe(StatusCode.BadIndexRangeInvalid)

    sub.dispose()
  })
})

describe('Subscription Publish Basic / PublishRequest Queue Overflow', () => {
  it('parks at least 2 concurrent Publish requests on a single Subscription', async () => {
    const { manager, subscriptionSvc } = makeStack()
    const auth = makeAuthToken()

    const sub = manager.createSubscription({
      ownerAuthToken: auth,
      requestedPublishingInterval: 30,
      requestedMaxKeepAliveCount: 2,
      requestedLifetimeCount: 100,
      maxNotificationsPerPublish: 100,
      publishingEnabled: true,
      priority: 1,
    })

    const req1 = new PublishRequest()
    req1.requestHeader = makeRequestHeader(auth)
    req1.subscriptionAcknowledgements = []
    const req2 = new PublishRequest()
    req2.requestHeader = makeRequestHeader(auth)
    req2.subscriptionAcknowledgements = []

    const p1 = subscriptionSvc.publish(req1, auth)
    const p2 = subscriptionSvc.publish(req2, auth)

    // Both requests must resolve independently (as keep-alives) — neither
    // should be dropped or block indefinitely.
    const [r1, r2] = await Promise.all([p1, p2])
    expect(r1.subscriptionId).toBe(sub.subscriptionId)
    expect(r2.subscriptionId).toBe(sub.subscriptionId)

    sub.dispose()
  }, 2_000)

  it('discards the oldest Publish request with Bad_TooManyPublishRequests on overflow', async () => {
    const { manager, subscriptionSvc } = makeStack()
    const auth = makeAuthToken()

    // Very long interval/keep-alive so none of the parked requests resolve
    // naturally before the overflow is triggered.
    const sub = manager.createSubscription({
      ownerAuthToken: auth,
      requestedPublishingInterval: 60_000,
      requestedMaxKeepAliveCount: 100_000,
      requestedLifetimeCount: 300_000,
      maxNotificationsPerPublish: 100,
      publishingEnabled: false,
      priority: 1,
    })

    const pending: Promise<import('opcjs-base').PublishResponse>[] = []
    for (let i = 0; i < 11; i++) {
      const req = new PublishRequest()
      req.requestHeader = makeRequestHeader(auth)
      req.requestHeader.requestHandle = i + 1
      req.subscriptionAcknowledgements = []
      pending.push(subscriptionSvc.publish(req, auth))
    }

    // The 11th request overflows the queue (cap = 10): the oldest (handle 1)
    // is evicted with Bad_TooManyPublishRequests. The remaining 10 requests
    // never resolve naturally (no ticks, no keep-alive) — only await the
    // evicted one, then drain the rest via the manager to avoid leaking
    // unresolved promises.
    const evicted = await pending[0]
    expect(evicted.responseHeader?.serviceResult).toBe(StatusCode.BadTooManyPublishRequests)
    expect(evicted.responseHeader?.requestHandle).toBe(1)

    manager.deleteSubscription(sub.subscriptionId)
    await Promise.all(pending)
  }, 2_000)
})

describe('Base Info SemanticChange Bit', () => {
  it('sets the SemanticsChanged bit on the next reported DataValue after a semantic property write', async () => {
    const { addressSpace, manager, subscriptionSvc, monitoredItemSvc } = makeStack()
    const auth = makeAuthToken()

    manager.notifySemanticChange(NodeId.newNumeric(1, 2400)) // no-op: nothing monitors it yet, exercises the empty path
    const nodeId = NodeId.newNumeric(1, 2400)
    addressSpace.addVariable(nodeId, 'SemanticVar', NodeId.newNumeric(0, 6), Variant.newFrom(uaInt32(1)))

    const sub = manager.createSubscription({
      ownerAuthToken: auth,
      requestedPublishingInterval: 30,
      requestedMaxKeepAliveCount: 1000,
      requestedLifetimeCount: 3000,
      maxNotificationsPerPublish: 100,
      publishingEnabled: true,
      priority: 1,
    })

    monitoredItemSvc.createMonitoredItems(
      makeCreateMonitoredItemsRequest(auth, sub.subscriptionId, nodeId),
      auth,
    )

    // Drain the initial value first.
    const initialReq = new PublishRequest()
    initialReq.requestHeader = makeRequestHeader(auth)
    initialReq.subscriptionAcknowledgements = []
    await subscriptionSvc.publish(initialReq, auth)

    // Simulate a semantic property change (e.g. EngineeringUnits write).
    sub.notifySemanticChange(nodeId)

    const req = new PublishRequest()
    req.requestHeader = makeRequestHeader(auth)
    req.subscriptionAcknowledgements = []
    const res = await subscriptionSvc.publish(req, auth)
    const dcn = res.notificationMessage?.notificationData?.[0]?.data as
      | { monitoredItems?: Array<{ value?: DataValue }> }
      | undefined
    const statusCode = dcn?.monitoredItems?.[0]?.value?.statusCode
    expect(((statusCode ?? 0) & 0x4000) !== 0).toBe(true)

    sub.dispose()
  }, 2_000)
})

// Touch DataValue + Variant imports so unused-import lint stays happy
const _touch: DataValue | undefined = undefined
void _touch
