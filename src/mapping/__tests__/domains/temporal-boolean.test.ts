import { describe, it, expect, beforeEach } from 'vitest'
import { faker } from '@faker-js/faker'
import { mapColumn } from '../../mapper.js'
import { NormalizedType } from '../../../types/schema.js'
import type { ColumnDef } from '../../../types/schema.js'

function makeColumn(name: string, dataType: NormalizedType = NormalizedType.TIMESTAMP): ColumnDef {
  return {
    name,
    dataType,
    nativeType: 'timestamp',
    isNullable: false,
    hasDefault: false,
    defaultValue: null,
    isAutoIncrement: false,
    isGenerated: false,
    maxLength: null,
    numericPrecision: null,
    numericScale: null,
    enumValues: null,
    comment: null,
  }
}

describe('Temporal domain mapping', () => {
  beforeEach(() => {
    faker.seed(42)
  })

  it('created_at generates Date in the past', () => {
    const result = mapColumn(makeColumn('created_at'), 'posts')
    expect(result.domain).toBe('temporal')
    const value = result.generator!(faker, 0) as Date
    expect(value).toBeInstanceOf(Date)
    expect(value.getTime()).toBeLessThan(Date.now())
  })

  it('updated_at generates recent Date', () => {
    const result = mapColumn(makeColumn('updated_at'), 'posts')
    expect(result.domain).toBe('temporal')
    const value = result.generator!(faker, 0) as Date
    expect(value).toBeInstanceOf(Date)
  })

  it('expires_at generates future Date', () => {
    const result = mapColumn(makeColumn('expires_at'), 'tokens')
    expect(result.domain).toBe('temporal')
    const value = result.generator!(faker, 0) as Date
    expect(value).toBeInstanceOf(Date)
    expect(value.getTime()).toBeGreaterThan(Date.now())
  })

  it('start_date generates Date', () => {
    const result = mapColumn(makeColumn('start_date'), 'projects')
    expect(result.domain).toBe('temporal')
    const value = result.generator!(faker, 0)
    expect(value).toBeInstanceOf(Date)
  })

  it('end_date generates Date', () => {
    const result = mapColumn(makeColumn('end_date'), 'projects')
    expect(result.domain).toBe('temporal')
    const value = result.generator!(faker, 0)
    expect(value).toBeInstanceOf(Date)
  })

  it('suffix: published_on maps to date generator via _on suffix', () => {
    const result = mapColumn(makeColumn('published_on'), 'articles')
    expect(result.domain).toBe('temporal')
    const value = result.generator!(faker, 0)
    expect(value).toBeInstanceOf(Date)
  })

  it('year generates integer 2000-2026', () => {
    const result = mapColumn(makeColumn('year', NormalizedType.INTEGER), 'records')
    expect(result.domain).toBe('temporal')
    for (let i = 0; i < 20; i++) {
      const value = result.generator!(faker, i) as number
      expect(value).toBeGreaterThanOrEqual(2000)
      expect(value).toBeLessThanOrEqual(2026)
    }
  })

  it('month generates integer 1-12', () => {
    const result = mapColumn(makeColumn('month', NormalizedType.INTEGER), 'records')
    expect(result.domain).toBe('temporal')
    for (let i = 0; i < 20; i++) {
      const value = result.generator!(faker, i) as number
      expect(value).toBeGreaterThanOrEqual(1)
      expect(value).toBeLessThanOrEqual(12)
    }
  })
})

describe('Boolean domain mapping', () => {
  beforeEach(() => {
    faker.seed(42)
  })

  it('is_active generates boolean (prefix match is_)', () => {
    const result = mapColumn(
      makeColumn('is_active', NormalizedType.BOOLEAN),
      'users',
    )
    expect(result.domain).toBe('boolean')
    const value = result.generator!(faker, 0)
    expect(typeof value).toBe('boolean')
  })

  it('has_subscription generates boolean (prefix match has_)', () => {
    const result = mapColumn(
      makeColumn('has_subscription', NormalizedType.BOOLEAN),
      'users',
    )
    expect(result.domain).toBe('boolean')
    const value = result.generator!(faker, 0)
    expect(typeof value).toBe('boolean')
  })

  it('active generates boolean (exact match)', () => {
    const result = mapColumn(
      makeColumn('active', NormalizedType.BOOLEAN),
      'users',
    )
    expect(result.domain).toBe('boolean')
    const value = result.generator!(faker, 0)
    expect(typeof value).toBe('boolean')
  })

  it('verified generates boolean (exact match)', () => {
    const result = mapColumn(
      makeColumn('verified', NormalizedType.BOOLEAN),
      'users',
    )
    expect(result.domain).toBe('boolean')
    const value = result.generator!(faker, 0)
    expect(typeof value).toBe('boolean')
  })

  it('enabled generates boolean (exact match)', () => {
    const result = mapColumn(
      makeColumn('enabled', NormalizedType.BOOLEAN),
      'users',
    )
    expect(result.domain).toBe('boolean')
    const value = result.generator!(faker, 0)
    expect(typeof value).toBe('boolean')
  })

  it('is_active on VARCHAR column does NOT match boolean domain', () => {
    const result = mapColumn(
      makeColumn('is_active', NormalizedType.VARCHAR),
      'users',
    )
    expect(result.domain).not.toBe('boolean')
  })

  it('active on VARCHAR column does NOT match boolean domain', () => {
    const result = mapColumn(
      makeColumn('active', NormalizedType.VARCHAR),
      'users',
    )
    expect(result.domain).not.toBe('boolean')
  })
})
