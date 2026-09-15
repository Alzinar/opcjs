/**
 * Unit tests for NumericRange.parse() (OPC UA Part 4 §7.27).
 */
import { describe, expect, it } from 'vitest'

import { NumericRange } from '../../src/types/numericRange.js'

describe('NumericRange.parse', () => {
  it('parses a single index', () => {
    const range = NumericRange.parse('6')
    expect(range?.dimensions).toEqual([{ start: 6, end: 6 }])
  })

  it('parses a range', () => {
    const range = NumericRange.parse('5:7')
    expect(range?.dimensions).toEqual([{ start: 5, end: 7 }])
  })

  it('parses multiple comma-separated dimensions', () => {
    const range = NumericRange.parse('1:2,0:1')
    expect(range?.dimensions).toEqual([
      { start: 1, end: 2 },
      { start: 0, end: 1 },
    ])
  })

  it('rejects a reversed range (end < start)', () => {
    expect(NumericRange.parse('7:5')).toBeUndefined()
  })

  it('rejects an equal range (end === start)', () => {
    expect(NumericRange.parse('5:5')).toBeUndefined()
  })

  it('rejects malformed input', () => {
    expect(NumericRange.parse('abc')).toBeUndefined()
    expect(NumericRange.parse('-1')).toBeUndefined()
    expect(NumericRange.parse('1: 2')).toBeUndefined()
    expect(NumericRange.parse('1:2:3')).toBeUndefined()
    expect(NumericRange.parse('1,')).toBeUndefined()
    expect(NumericRange.parse('')).toBeUndefined()
  })
})
