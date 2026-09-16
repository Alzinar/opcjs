import {
  CreateMonitoredItemsRequest,
  CreateMonitoredItemsResponse,
  DeleteMonitoredItemsRequest,
  DeleteMonitoredItemsResponse,
  DiagnosticInfo,
  ExtensionObject,
  type ILogger,
  type MonitoredItemCreateRequest,
  MonitoredItemCreateResult,
  type MonitoredItemModifyRequest,
  MonitoredItemModifyResult,
  type ModifyMonitoredItemsRequest,
  ModifyMonitoredItemsResponse,
  MonitoringModeEnum,
  NumericRange,
  type NodeId,
  type SetMonitoringModeRequest,
  SetMonitoringModeResponse,
  StatusCode,
  getLogger,
} from 'opcjs-base'

import type { SubscriptionManager } from '../subscription/subscriptionManager.js'
import { MAX_MONITORED_ITEMS_QUEUE_SIZE } from '../subscription/monitoredItem.js'
import { makeResponseHeader } from './responseHeader.js'

/**
 * Handles the OPC UA Monitored Items Service Set (Part 4 §5.13):
 *  - CreateMonitoredItems
 *  - ModifyMonitoredItems
 *  - DeleteMonitoredItems
 *  - SetMonitoringMode
 *
 * `SetTriggering` is not yet supported and falls through to the dispatcher's
 * default `BadServiceUnsupported`.
 */
export class MonitoredItemService {
  private readonly logger: ILogger

  constructor(private readonly subscriptionManager: SubscriptionManager) {
    this.logger = getLogger('services.MonitoredItemService')
  }

  // ── CreateMonitoredItems ──────────────────────────────────────────────

  createMonitoredItems(
    request: CreateMonitoredItemsRequest,
    authToken: NodeId,
  ): CreateMonitoredItemsResponse {
    const requestHandle = request.requestHeader?.requestHandle ?? 0
    const response = new CreateMonitoredItemsResponse()

    const sub = this.subscriptionManager.getOwned(request.subscriptionId, authToken)
    if (sub === undefined) {
      response.responseHeader = makeResponseHeader(
        requestHandle,
        StatusCode.BadSubscriptionIdInvalid,
      )
      response.results = []
      response.diagnosticInfos = []
      return response
    }

    const itemsToCreate: MonitoredItemCreateRequest[] = request.itemsToCreate ?? []
    const results: MonitoredItemCreateResult[] = itemsToCreate.map(itc => {
      const result = new MonitoredItemCreateResult()

      const itemToMonitor = itc.itemToMonitor
      if (itemToMonitor?.nodeId === undefined || itemToMonitor.nodeId === null) {
        result.statusCode = StatusCode.BadNodeIdInvalid
        result.monitoredItemId = 0
        result.revisedSamplingInterval = 0
        result.revisedQueueSize = 0
        result.filterResult = ExtensionObject.newEmpty()
        return result
      }

      const indexRange = itemToMonitor.indexRange || undefined
      if (indexRange !== undefined && NumericRange.parse(indexRange) === undefined) {
        result.statusCode = StatusCode.BadIndexRangeInvalid
        result.monitoredItemId = 0
        result.revisedSamplingInterval = 0
        result.revisedQueueSize = 0
        result.filterResult = ExtensionObject.newEmpty()
        return result
      }

      const params = itc.requestedParameters
      const monitoringMode = itc.monitoringMode ?? MonitoringModeEnum.Reporting
      const queueSize = Math.min(MAX_MONITORED_ITEMS_QUEUE_SIZE, Math.max(1, params?.queueSize ?? 1))

      const mi = sub.addMonitoredItem({
        nodeId: itemToMonitor.nodeId,
        attributeId: itemToMonitor.attributeId,
        clientHandle: params?.clientHandle ?? 0,
        queueSize,
        monitoringMode,
        indexRange,
      })

      result.statusCode = StatusCode.Good
      result.monitoredItemId = mi.monitoredItemId
      result.revisedSamplingInterval = mi.revisedSamplingInterval
      result.revisedQueueSize = mi.revisedQueueSize
      result.filterResult = ExtensionObject.newEmpty()
      return result
    })

    response.responseHeader = makeResponseHeader(requestHandle)
    response.results = results
    response.diagnosticInfos = new Array<DiagnosticInfo>(results.length).fill(
      new DiagnosticInfo(),
    )
    this.logger.debug(
      `Created ${results.length} monitored item(s) on subscription ${request.subscriptionId}`,
    )
    return response
  }

  // ── ModifyMonitoredItems ───────────────────────────────────────────────

  /**
   * Handles `ModifyMonitoredItemsRequest` → `ModifyMonitoredItemsResponse`
   * (Part 4 §5.13.3). Only `queueSize` is revisable in this implementation —
   * `samplingInterval` always mirrors the owning Subscription's
   * `publishingInterval` (Base Info Fixed SamplingInterval CU).
   */
  modifyMonitoredItems(
    request: ModifyMonitoredItemsRequest,
    authToken: NodeId,
  ): ModifyMonitoredItemsResponse {
    const requestHandle = request.requestHeader?.requestHandle ?? 0
    const response = new ModifyMonitoredItemsResponse()

    const sub = this.subscriptionManager.getOwned(request.subscriptionId, authToken)
    if (sub === undefined) {
      response.responseHeader = makeResponseHeader(
        requestHandle,
        StatusCode.BadSubscriptionIdInvalid,
      )
      response.results = []
      response.diagnosticInfos = []
      return response
    }

    const itemsToModify: MonitoredItemModifyRequest[] = request.itemsToModify ?? []
    const results = itemsToModify.map(itm => {
      const result = new MonitoredItemModifyResult()
      const queueSize = Math.min(
        MAX_MONITORED_ITEMS_QUEUE_SIZE,
        Math.max(1, itm.requestedParameters?.queueSize ?? 1),
      )
      const statusCode = sub.modifyMonitoredItem(itm.monitoredItemId, queueSize)
      const mi = statusCode === StatusCode.Good ? sub.getMonitoredItem(itm.monitoredItemId) : undefined

      result.statusCode = statusCode
      result.revisedSamplingInterval = mi?.revisedSamplingInterval ?? 0
      result.revisedQueueSize = mi?.revisedQueueSize ?? 0
      result.filterResult = ExtensionObject.newEmpty()
      return result
    })

    response.responseHeader = makeResponseHeader(requestHandle)
    response.results = results
    response.diagnosticInfos = new Array<DiagnosticInfo>(results.length).fill(new DiagnosticInfo())
    return response
  }

  // ── SetMonitoringMode ──────────────────────────────────────────────────

  /** Handles `SetMonitoringModeRequest` → `SetMonitoringModeResponse` (Part 4 §5.13.4). */
  setMonitoringMode(
    request: SetMonitoringModeRequest,
    authToken: NodeId,
  ): SetMonitoringModeResponse {
    const requestHandle = request.requestHeader?.requestHandle ?? 0
    const response = new SetMonitoringModeResponse()

    const sub = this.subscriptionManager.getOwned(request.subscriptionId, authToken)
    if (sub === undefined) {
      response.responseHeader = makeResponseHeader(
        requestHandle,
        StatusCode.BadSubscriptionIdInvalid,
      )
      response.results = []
      response.diagnosticInfos = []
      return response
    }

    const ids = request.monitoredItemIds ?? []
    const results = sub.setMonitoringMode(ids, request.monitoringMode)

    response.responseHeader = makeResponseHeader(requestHandle)
    response.results = results
    response.diagnosticInfos = []
    return response
  }

  // ── DeleteMonitoredItems ──────────────────────────────────────────────

  deleteMonitoredItems(
    request: DeleteMonitoredItemsRequest,
    authToken: NodeId,
  ): DeleteMonitoredItemsResponse {
    const requestHandle = request.requestHeader?.requestHandle ?? 0
    const response = new DeleteMonitoredItemsResponse()

    const sub = this.subscriptionManager.getOwned(request.subscriptionId, authToken)
    if (sub === undefined) {
      response.responseHeader = makeResponseHeader(
        requestHandle,
        StatusCode.BadSubscriptionIdInvalid,
      )
      response.results = []
      response.diagnosticInfos = []
      return response
    }

    const ids = request.monitoredItemIds ?? []
    const results = sub.deleteMonitoredItems(ids)

    response.responseHeader = makeResponseHeader(requestHandle)
    response.results = results
    response.diagnosticInfos = []
    return response
  }
}
