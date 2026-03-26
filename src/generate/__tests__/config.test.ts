import { describe, it, expect } from 'vitest'
import { createGenerationConfig, getRowCount } from '../config.js'

describe('createGenerationConfig', () => {
  it('returns correct defaults when no overrides provided', () => {
    const config = createGenerationConfig()
    expect(config.globalRowCount).toBe(50)
    expect(config.nullableRate).toBe(0.1)
    expect(config.seed).toBeUndefined()
    expect(config.tableRowCounts).toBeInstanceOf(Map)
    expect(config.tableRowCounts.size).toBe(0)
  })

  it('applies globalRowCount override', () => {
    const config = createGenerationConfig({ globalRowCount: 100 })
    expect(config.globalRowCount).toBe(100)
  })

  it('applies nullableRate override', () => {
    const config = createGenerationConfig({ nullableRate: 0.5 })
    expect(config.nullableRate).toBe(0.5)
  })

  it('applies seed override', () => {
    const config = createGenerationConfig({ seed: 42 })
    expect(config.seed).toBe(42)
  })

  it('applies tableRowCounts override', () => {
    const overrides = new Map([['public.users', 10]])
    const config = createGenerationConfig({ tableRowCounts: overrides })
    expect(config.tableRowCounts.get('public.users')).toBe(10)
  })

  it('preserves existing defaults when applying partial overrides', () => {
    const config = createGenerationConfig({ globalRowCount: 25 })
    expect(config.nullableRate).toBe(0.1) // default preserved
    expect(config.seed).toBeUndefined()   // default preserved
    expect(config.tableRowCounts.size).toBe(0)
  })

  it('merges tableRowCounts into a new Map', () => {
    const overrides = new Map([['public.users', 10], ['public.posts', 20]])
    const config = createGenerationConfig({ tableRowCounts: overrides })
    expect(config.tableRowCounts.size).toBe(2)
    expect(config.tableRowCounts.get('public.users')).toBe(10)
    expect(config.tableRowCounts.get('public.posts')).toBe(20)
  })
})

describe('getRowCount', () => {
  it('returns per-table override when present', () => {
    const config = createGenerationConfig({
      globalRowCount: 50,
      tableRowCounts: new Map([['public.users', 10]]),
    })
    expect(getRowCount(config, 'public.users')).toBe(10)
  })

  it('returns global count when no per-table override', () => {
    const config = createGenerationConfig({ globalRowCount: 75 })
    expect(getRowCount(config, 'public.users')).toBe(75)
  })

  it('returns 1 for invalid row count (zero)', () => {
    const config = createGenerationConfig({
      tableRowCounts: new Map([['public.users', 0]]),
    })
    expect(getRowCount(config, 'public.users')).toBe(1)
  })

  it('returns 1 for negative row count', () => {
    const config = createGenerationConfig({
      tableRowCounts: new Map([['public.users', -5]]),
    })
    expect(getRowCount(config, 'public.users')).toBe(1)
  })
})
