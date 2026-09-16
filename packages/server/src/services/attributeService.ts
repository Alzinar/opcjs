import {
  DataValue,
  DiagnosticInfo,
  NodeId,
  NumericRange,
  ReadRequest,
  ReadResponse,
  StatusCode,
  TimestampsToReturnEnum,
  Variant,
  WriteRequest,
  WriteResponse,
  getLogger,
} from 'opcjs-base'
import type { ILogger, NumericRangeDimension, VariantArrayValue, WriteValue } from 'opcjs-base'

import { AccessLevelExFlags, AccessLevelFlags, AttributeId } from '../addressSpace/node.js'
import { ReferenceTypeIds } from '../addressSpace/wellKnownIds.js'
import type { IAddressSpace } from '../addressSpace/iAddressSpace.js'
import type { Session } from '../sessions/session.js'
import type { SubscriptionManager } from '../subscription/subscriptionManager.js'
import { makeResponseHeader } from './responseHeader.js'
import { applyIndexRange } from './indexRangeUtil.js'

/**
 * BrowseNames of "semantic" Properties whose value change requires the
 * `SemanticsChanged` StatusCode bit to be set on the next reported DataValue
 * of the Variable they qualify (OPC UA Part 4 §7.39, Part 8 §5.2).
 */
const SEMANTIC_PROPERTY_BROWSE_NAMES = new Set([
  'EngineeringUnits',
  'EURange',
  'Definition',
  'ValuePrecision',
  'CurrencyUnit',
])
const HAS_PROPERTY = NodeId.newNumeric(0, ReferenceTypeIds.HasProperty)

/**
 * Handles the OPC UA `Read` service.
 *
 * Reads one or more node-attributes from the address space, applies the
 * `IndexRange` and `maxAge` parameters, and stamps results according to
 * `timestampsToReturn`.
 *
 * @see OPC UA Part 4 §5.11.2
 */
export class AttributeService {
  private readonly logger: ILogger

  constructor(
    private readonly addressSpace: IAddressSpace,
    /** Optional: used to set the `SemanticsChanged` bit on affected MonitoredItems (Base Info SemanticChange Bit CU). */
    private readonly subscriptionManager?: SubscriptionManager,
  ) {
    this.logger = getLogger('services.AttributeService')
  }

  /**
   * Handles `ReadRequest` → `ReadResponse`.
   *
   * Iterates `nodesToRead`, calls {@link IAddressSpace.read} for each, slices
   * the result with `indexRange`, and stamps timestamps based on
   * `timestampsToReturn`.
   *
   * `maxAge` is validated (negative values are rejected with
   * `Bad_MaxAgeInvalid`) but otherwise has no observable effect: the address
   * space holds a single authoritative copy of each value, so the value
   * returned is always both the most recent cached copy and the current
   * "live" value — the "best effort" value required by the spec when the
   * requested `maxAge` cannot be met.
   *
   * @param request - Decoded `ReadRequest` from the client
   * @param session - Validated session (provided for audit / future use)
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  read(request: ReadRequest, session: Session): ReadResponse {
    const requestHandle = request.requestHeader?.requestHandle ?? 0

    if ((request.maxAge ?? 0) < 0) {
      const response = new ReadResponse()
      response.responseHeader = makeResponseHeader(requestHandle, StatusCode.BadMaxAgeInvalid)
      response.results = []
      response.diagnosticInfos = []
      return response
    }

    const nodesToRead = request.nodesToRead ?? []
    const timestampsToReturn = request.timestampsToReturn ?? TimestampsToReturnEnum.Neither

    this.logger.debug(`Read ${nodesToRead.length} node(s)`)

    const now = new Date()

    const results = nodesToRead.map(item => {
      if (item.nodeId == null) {
        return new DataValue(undefined, StatusCode.BadNodeIdInvalid)
      }

      const raw = this.addressSpace.read(item.nodeId, item.attributeId)
      const sliced = applyIndexRange(raw, item.indexRange)

      return applyTimestamps(sliced, timestampsToReturn, now)
    })

    const response = new ReadResponse()
    response.responseHeader = makeResponseHeader(requestHandle)
    response.results = results
    response.diagnosticInfos = new Array<DiagnosticInfo>(results.length).fill(new DiagnosticInfo())
    return response
  }

  /**
   * Handles `WriteRequest` → `WriteResponse` (OPC UA Part 4 §5.10.4).
   *
   * Only the `Value` attribute may be written (Attribute Write Values /
   * Attribute Write Index / Attribute Write StatusCode & Timestamp
   * conformance units); writing any other attribute returns
   * `Bad_NotWritable`.
   *
   * @param request - Decoded `WriteRequest` from the client
   * @param session - Validated session (provided for audit / future use)
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  write(request: WriteRequest, session: Session): WriteResponse {
    const requestHandle = request.requestHeader?.requestHandle ?? 0
    const nodesToWrite = request.nodesToWrite ?? []

    this.logger.debug(`Write ${nodesToWrite.length} node(s)`)

    const results = nodesToWrite.map(wv => this.writeOne(wv))

    const response = new WriteResponse()
    response.responseHeader = makeResponseHeader(requestHandle)
    response.results = results
    response.diagnosticInfos = new Array<DiagnosticInfo>(results.length).fill(new DiagnosticInfo())
    return response
  }

  private writeOne(wv: WriteValue): StatusCode {
    if (wv.nodeId == null) {
      return StatusCode.BadNodeIdInvalid
    }
    if (wv.value == null) {
      return StatusCode.BadTypeMismatch
    }
    if (wv.attributeId !== AttributeId.Value) {
      return StatusCode.BadNotWritable
    }

    const accessLevelDv = this.addressSpace.read(wv.nodeId, AttributeId.UserAccessLevel)
    if (accessLevelDv.statusCode === StatusCode.BadNodeIdUnknown) {
      return StatusCode.BadNodeIdUnknown
    }
    if (accessLevelDv.statusCode === StatusCode.BadAttributeIdInvalid) {
      // Not a Variable node — Value is not a valid attribute for it.
      return StatusCode.BadAttributeIdInvalid
    }
    const accessLevel = (accessLevelDv.value?.value as number | undefined) ?? 0
    if ((accessLevel & AccessLevelFlags.CurrentWrite) === 0) {
      return StatusCode.BadNotWritable
    }

    let newVariant = wv.value.value
    if (wv.indexRange) {
      const accessLevelExDv = this.addressSpace.read(wv.nodeId, AttributeId.AccessLevelEx)
      const accessLevelEx = (accessLevelExDv.value?.value as number | undefined) ?? 0
      if ((accessLevelEx & AccessLevelExFlags.WriteFullArrayOnly) !== 0) {
        return StatusCode.BadWriteNotSupported
      }
      const currentDv = this.addressSpace.read(wv.nodeId, AttributeId.Value)
      if (currentDv.value === undefined || newVariant === undefined) {
        return StatusCode.BadIndexRangeNoData
      }
      const merged = mergeIndexRange(currentDv.value, wv.indexRange, newVariant)
      if (typeof merged === 'number') {
        return merged
      }
      newVariant = merged
    }

    const statusCodeWv = wv.value.statusCode ?? StatusCode.Good
    const sourceTimestampWv = wv.value.sourceTimestamp
    const finalStatusCode =
      (accessLevel & AccessLevelFlags.StatusWrite) !== 0 ? statusCodeWv : StatusCode.Good
    const finalSourceTimestamp =
      (accessLevel & AccessLevelFlags.TimestampWrite) !== 0 ? (sourceTimestampWv ?? new Date()) : new Date()

    const result = this.addressSpace.write(
      wv.nodeId,
      AttributeId.Value,
      new DataValue(newVariant, finalStatusCode, finalSourceTimestamp),
    )

    if (result === StatusCode.Good) {
      this.notifySemanticChangeIfApplicable(wv.nodeId)
    }
    return result
  }

  /**
   * When `nodeId` is a "semantic" Property (`EngineeringUnits`, `EURange`,
   * `Definition`, `ValuePrecision`, `CurrencyUnit`), marks the owning
   * Variable's MonitoredItems so their next reported DataValue carries the
   * `SemanticsChanged` StatusCode bit (OPC UA Part 4 §7.39).
   */
  private notifySemanticChangeIfApplicable(nodeId: NodeId): void {
    if (this.subscriptionManager === undefined) return
    const node = this.addressSpace.getNode(nodeId)
    if (node === undefined || !SEMANTIC_PROPERTY_BROWSE_NAMES.has(node.browseName.name)) return
    const owner = node
      .getReferences()
      .find(r => !r.isForward && r.referenceTypeId.toString() === HAS_PROPERTY.toString())
    if (owner === undefined) return
    this.subscriptionManager.notifySemanticChange(owner.targetNodeId)
  }
}

/**
 * Merges `newValue` into `current` at the given `IndexRange` (OPC UA Part 4 §7.27).
 * Returns the merged `Variant`, or a `StatusCode` describing why the merge failed.
 */
function mergeIndexRange(current: Variant, indexRange: string, newValue: Variant): Variant | StatusCode {
  const range = NumericRange.parse(indexRange)
  if (range === undefined) {
    return StatusCode.BadIndexRangeInvalid
  }
  if (range.dimensions.length !== 1) {
    return StatusCode.BadIndexRangeNoData
  }
  const dim = range.dimensions[0]

  if (current.isArray()) {
    const array = (current.value as unknown[]).slice()
    const replacement = Array.isArray(newValue.value) ? (newValue.value as unknown[]) : [newValue.value]
    if (dim.start >= array.length) {
      return StatusCode.BadIndexRangeNoData
    }
    const end = Math.min(dim.end, array.length - 1)
    if (replacement.length !== end - dim.start + 1) {
      return StatusCode.BadIndexRangeNoData
    }
    for (let i = 0; i < replacement.length; i++) {
      array[dim.start + i] = replacement[i]
    }
    return new Variant(current.type, array as VariantArrayValue, current.arrayDimensions)
  }

  if (typeof current.value === 'string' && typeof newValue.value === 'string') {
    return mergeStringRange(current, newValue.value, dim)
  }

  return StatusCode.BadIndexRangeNoData
}

function mergeStringRange(
  current: Variant,
  replacement: string,
  dim: NumericRangeDimension,
): Variant | StatusCode {
  const value = current.value as string
  if (dim.start >= value.length) {
    return StatusCode.BadIndexRangeNoData
  }
  const end = Math.min(dim.end, value.length - 1)
  if (replacement.length !== end - dim.start + 1) {
    return StatusCode.BadIndexRangeNoData
  }
  const merged = value.slice(0, dim.start) + replacement + value.slice(end + 1)
  return new Variant(current.type, merged)
}

/**
 * Copy a `DataValue` applying the `timestampsToReturn` filter.
 *
 * OPC UA Part 4 §7.35:
 *   - Source: only sourceTimestamp is set (as provided by the address space)
 *   - Server: only serverTimestamp is set
 *   - Both: both are set
 *   - Neither: no timestamps are set
 */
function applyTimestamps(
  dv: DataValue,
  ttr: TimestampsToReturnEnum,
  serverNow: Date,
): DataValue {
  const wantSource =
    ttr === TimestampsToReturnEnum.Source || ttr === TimestampsToReturnEnum.Both
  const wantServer =
    ttr === TimestampsToReturnEnum.Server || ttr === TimestampsToReturnEnum.Both

  return new DataValue(
    dv.value,
    dv.statusCode,
    // Source timestamp is the responsibility of the address space; never substitute server time.
    wantSource ? dv.sourceTimestamp : undefined,
    wantServer ? serverNow : undefined,
  )
}
