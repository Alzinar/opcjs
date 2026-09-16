import { DataValue, NumericRange, StatusCode, Variant } from 'opcjs-base'
import type { NumericRangeDimension, VariantArrayValue } from 'opcjs-base'

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
 *
 * Shared by {@link AttributeService.read} (Read service) and
 * `MonitoredItem.sample` (data-change sampling), so both apply `IndexRange`
 * identically.
 */
export function applyIndexRange(dv: DataValue, indexRange: string | null | undefined): DataValue {
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
 * array values held by this address space.
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
