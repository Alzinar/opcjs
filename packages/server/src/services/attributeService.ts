import {
  DataValue,
  DiagnosticInfo,
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
import type { IAddressSpace } from '../addressSpace/iAddressSpace.js'
import type { Session } from '../sessions/session.js'
import { makeResponseHeader } from './responseHeader.js'

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

  constructor(private readonly addressSpace: IAddressSpace) {
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

    return this.addressSpace.write(
      wv.nodeId,
      AttributeId.Value,
      new DataValue(newVariant, finalStatusCode, finalSourceTimestamp),
    )
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
 * Applies the `IndexRange` parameter (OPC UA Part 4 §7.27) to a `DataValue`.
 *
 * - An empty/absent range returns `dv` unchanged.
 * - A range is only applied to a `Good` value; existing errors take priority.
 * - Invalid `NumericRange` syntax returns `Bad_IndexRangeInvalid`.
 * - A syntactically valid range that cannot be satisfied (multi-dimensional
 *   ranges — this address space only holds scalars and 1-D arrays —, an
 *   out-of-bounds lower index, or a range applied to a non-array/non-string
 *   scalar) returns `Bad_IndexRangeNoData`.
 * - An out-of-bounds upper index is clamped (partial result, no error).
 */
function applyIndexRange(dv: DataValue, indexRange: string | null | undefined): DataValue {
  if (!indexRange) {
    return dv
  }
  if (dv.statusCode !== StatusCode.Good || dv.value === undefined) {
    return dv
  }

  const range = NumericRange.parse(indexRange)
  if (range === undefined) {
    return new DataValue(undefined, StatusCode.BadIndexRangeInvalid)
  }

  const sliced = sliceVariant(dv.value, range.dimensions)
  if (sliced === undefined) {
    return new DataValue(undefined, StatusCode.BadIndexRangeNoData)
  }

  return new DataValue(
    sliced,
    dv.statusCode,
    dv.sourceTimestamp,
    dv.serverTimestamp,
    dv.sourcePicoseconds,
    dv.serverPicoseconds,
  )
}

/** Slices an element range out of a string / ByteString, returning `undefined` when out of bounds. */
function sliceStringOrBytes<T extends string | Uint8Array>(
  value: T,
  dim: NumericRangeDimension,
): T | undefined {
  if (dim.start >= value.length) {
    return undefined
  }
  const end = Math.min(dim.end, value.length - 1)
  return value.slice(dim.start, end + 1) as T
}

/**
 * Slices a `Variant` per the parsed `NumericRange` dimensions.
 * Returns `undefined` when the range cannot be satisfied (→ `Bad_IndexRangeNoData`).
 *
 * Only single-dimension ranges are supported, matching the scalar and 1-D
 * array values held by this address space (Part 4 §7.27 requires all
 * dimensions of the ArrayDimensions Attribute to be specified; a Node here
 * never has more than one).
 */
function sliceVariant(variant: Variant, dims: readonly NumericRangeDimension[]): Variant | undefined {
  if (dims.length !== 1) {
    return undefined
  }
  const dim = dims[0]

  if (variant.isArray()) {
    const array = variant.value as unknown[]
    const sliced = sliceArrayByRange(array, dim)
    if (sliced === undefined) {
      return undefined
    }
    return new Variant(variant.type, sliced as VariantArrayValue, [sliced.length])
  }

  // Scalar: only String / ByteString support IndexRange (treated as a 1-D char/byte array).
  if (typeof variant.value === 'string' || variant.value instanceof Uint8Array) {
    const sliced = sliceStringOrBytes(variant.value, dim)
    if (sliced === undefined) {
      return undefined
    }
    return new Variant(variant.type, sliced)
  }

  return undefined
}

/** Slices an array by element index, returning `undefined` when the lower bound is out of range. */
function sliceArrayByRange(array: unknown[], dim: NumericRangeDimension): unknown[] | undefined {
  if (dim.start >= array.length) {
    return undefined
  }
  const end = Math.min(dim.end, array.length - 1)
  return array.slice(dim.start, end + 1)
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
