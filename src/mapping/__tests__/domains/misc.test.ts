import { describe, it, expect, beforeEach } from 'vitest'
import { faker } from '@faker-js/faker'
import { mapColumn } from '../../mapper.js'
import { NormalizedType } from '../../../types/schema.js'
import type { ColumnDef } from '../../../types/schema.js'

function makeColumn(name: string, dataType: NormalizedType = NormalizedType.VARCHAR): ColumnDef {
  return {
    name,
    dataType,
    nativeType: 'varchar',
    isNullable: false,
    hasDefault: false,
    defaultValue: null,
    isAutoIncrement: false,
    isGenerated: false,
    maxLength: 255,
    numericPrecision: null,
    numericScale: null,
    enumValues: null,
    comment: null,
  }
}

describe('Commerce domain mapping', () => {
  beforeEach(() => {
    faker.seed(42)
  })

  it('product_name generates product name', () => {
    const result = mapColumn(makeColumn('product_name'), 'products')
    expect(result.domain).toBe('commerce')
    const value = result.generator!(faker, 0)
    expect(typeof value).toBe('string')
  })

  it('sku generates alphanumeric uppercase string', () => {
    const result = mapColumn(makeColumn('sku'), 'products')
    expect(result.domain).toBe('commerce')
    const value = result.generator!(faker, 0) as string
    expect(value).toMatch(/^[A-Z0-9]+$/)
    expect(value.length).toBe(8)
  })

  it('color generates color name', () => {
    const result = mapColumn(makeColumn('color'), 'products')
    expect(result.domain).toBe('commerce')
    const value = result.generator!(faker, 0)
    expect(typeof value).toBe('string')
  })

  it('quantity generates integer', () => {
    const result = mapColumn(makeColumn('quantity', NormalizedType.INTEGER), 'order_items')
    expect(result.domain).toBe('commerce')
    const value = result.generator!(faker, 0) as number
    expect(typeof value).toBe('number')
    expect(Number.isInteger(value)).toBe(true)
    expect(value).toBeGreaterThanOrEqual(1)
    expect(value).toBeLessThanOrEqual(100)
  })

  it('rating generates float between 1 and 5', () => {
    const result = mapColumn(makeColumn('rating', NormalizedType.REAL), 'reviews')
    expect(result.domain).toBe('commerce')
    const value = result.generator!(faker, 0) as number
    expect(value).toBeGreaterThanOrEqual(1)
    expect(value).toBeLessThanOrEqual(5)
  })
})

describe('Text domain mapping', () => {
  beforeEach(() => {
    faker.seed(42)
  })

  it('description generates paragraph', () => {
    const result = mapColumn(makeColumn('description'), 'products')
    expect(result.domain).toBe('text')
    const value = result.generator!(faker, 0) as string
    expect(typeof value).toBe('string')
    expect(value.length).toBeGreaterThan(20)
  })

  it('body generates multiple paragraphs', () => {
    const result = mapColumn(makeColumn('body'), 'posts')
    expect(result.domain).toBe('text')
    const value = result.generator!(faker, 0) as string
    expect(typeof value).toBe('string')
    expect(value.length).toBeGreaterThan(50)
  })

  it('content generates multiple paragraphs', () => {
    const result = mapColumn(makeColumn('content'), 'articles')
    expect(result.domain).toBe('text')
    const value = result.generator!(faker, 0) as string
    expect(typeof value).toBe('string')
    expect(value.length).toBeGreaterThan(50)
  })

  it('subject generates sentence', () => {
    const result = mapColumn(makeColumn('subject'), 'emails_table')
    expect(result.domain).toBe('text')
    const value = result.generator!(faker, 0) as string
    expect(typeof value).toBe('string')
  })

  it('headline generates sentence', () => {
    const result = mapColumn(makeColumn('headline'), 'articles')
    expect(result.domain).toBe('text')
    const value = result.generator!(faker, 0) as string
    expect(typeof value).toBe('string')
  })
})

describe('Identifiers domain mapping', () => {
  beforeEach(() => {
    faker.seed(42)
  })

  it('uuid generates UUID format string', () => {
    const result = mapColumn(makeColumn('uuid'), 'records')
    expect(result.domain).toBe('identifiers')
    const value = result.generator!(faker, 0) as string
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i)
  })

  it('hash generates hexadecimal string', () => {
    const result = mapColumn(makeColumn('hash'), 'files')
    expect(result.domain).toBe('identifiers')
    const value = result.generator!(faker, 0) as string
    expect(typeof value).toBe('string')
    expect(value).toMatch(/^[0-9a-f]+$/i)
  })

  it('tracking_number generates alphanumeric string', () => {
    const result = mapColumn(makeColumn('tracking_number'), 'shipments')
    expect(result.domain).toBe('identifiers')
    const value = result.generator!(faker, 0) as string
    expect(typeof value).toBe('string')
    expect(value).toMatch(/^[A-Z0-9]+$/)
  })

  it('code generates alphanumeric uppercase string', () => {
    const result = mapColumn(makeColumn('code'), 'coupons')
    expect(result.domain).toBe('identifiers')
    const value = result.generator!(faker, 0) as string
    expect(typeof value).toBe('string')
    expect(value).toMatch(/^[A-Z0-9]+$/)
  })

  it('suffix: order_code maps to identifiers via _code suffix', () => {
    const result = mapColumn(makeColumn('order_code'), 'shipments')
    expect(result.domain).toBe('identifiers')
  })
})
