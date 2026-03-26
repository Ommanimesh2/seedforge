import { describe, it, expect } from 'vitest'
import { extractEnumLikeValues } from '../queries/check-constraints.js'

describe('extractEnumLikeValues', () => {
  it('extracts from ANY (ARRAY[...]) pattern', () => {
    const expr = "CHECK ((status = ANY (ARRAY['active'::text, 'pending'::text, 'closed'::text])))"
    expect(extractEnumLikeValues(expr)).toEqual(['active', 'pending', 'closed'])
  })

  it('extracts from ANY ARRAY with cast prefix', () => {
    const expr = "CHECK (((status)::text = ANY (ARRAY['draft'::text, 'published'::text])))"
    expect(extractEnumLikeValues(expr)).toEqual(['draft', 'published'])
  })

  it('extracts from IN (...) pattern', () => {
    const expr = "CHECK ((status IN ('a', 'b', 'c')))"
    expect(extractEnumLikeValues(expr)).toEqual(['a', 'b', 'c'])
  })

  it('extracts from IN with type casts', () => {
    const expr = "CHECK (((action)::text IN ('INSERT'::text, 'UPDATE'::text, 'DELETE'::text)))"
    expect(extractEnumLikeValues(expr)).toEqual(['INSERT', 'UPDATE', 'DELETE'])
  })

  it('extracts from OR chain pattern', () => {
    const expr = "CHECK (((col)::text = 'x'::text) OR ((col)::text = 'y'::text))"
    expect(extractEnumLikeValues(expr)).toEqual(['x', 'y'])
  })

  it('returns null for numeric CHECK', () => {
    expect(extractEnumLikeValues('CHECK ((age > 0))')).toBeNull()
  })

  it('returns null for range CHECK', () => {
    expect(extractEnumLikeValues('CHECK ((price >= 0.00))')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(extractEnumLikeValues('')).toBeNull()
  })

  it('returns null for null-ish input', () => {
    expect(extractEnumLikeValues(null as unknown as string)).toBeNull()
  })
})
