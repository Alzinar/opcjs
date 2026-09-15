/**
 * OPC UA NumericRange (Part 4 §7.27)
 *
 * A `NumericRange` selects a subset of an array, String, or ByteString value
 * for the `IndexRange` parameter of `ReadValueId` / `WriteValue`.
 *
 * Grammar (informative BNF in Annex A.3):
 *   NumericRange ::= Dimension [',' Dimension]*
 *   Dimension    ::= Index [':' Index]
 *   Index        ::= digit+
 *
 * A single `Index` selects one element; `start:end` selects an inclusive
 * range and requires `end > start`. No other characters (including
 * whitespace, signs, or leading '+') are permitted.
 */

/** A single dimension of a parsed `NumericRange`; `start === end` for a single index. */
export interface NumericRangeDimension {
  readonly start: number
  readonly end: number
}

const SINGLE_INDEX = /^\d+$/
const RANGE = /^(\d+):(\d+)$/

export class NumericRange {
  private constructor(public readonly dimensions: readonly NumericRangeDimension[]) {}

  /**
   * Parses a `NumericRange` string.
   *
   * @returns The parsed range, or `undefined` if the syntax is invalid
   * (callers should map that to `Bad_IndexRangeInvalid`).
   */
  static parse(text: string): NumericRange | undefined {
    const parts = text.split(',')
    const dimensions: NumericRangeDimension[] = []

    for (const part of parts) {
      const rangeMatch = RANGE.exec(part)
      if (rangeMatch) {
        const start = Number(rangeMatch[1])
        const end = Number(rangeMatch[2])
        if (end <= start) return undefined
        dimensions.push({ start, end })
        continue
      }

      if (SINGLE_INDEX.test(part)) {
        const index = Number(part)
        dimensions.push({ start: index, end: index })
        continue
      }

      return undefined
    }

    return new NumericRange(dimensions)
  }
}
