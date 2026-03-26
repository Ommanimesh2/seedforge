import { describe, it, expect, beforeEach } from 'vitest'
import { faker } from '@faker-js/faker'
import { mapColumn } from '../../mapper.js'
import { NormalizedType } from '../../../types/schema.js'
import type { ColumnDef } from '../../../types/schema.js'

function makeColumn(name: string, dataType: NormalizedType = NormalizedType.DECIMAL): ColumnDef {
  return {
    name,
    dataType,
    nativeType: 'decimal',
    isNullable: false,
    hasDefault: false,
    defaultValue: null,
    isAutoIncrement: false,
    isGenerated: false,
    maxLength: null,
    numericPrecision: 10,
    numericScale: 2,
    enumValues: null,
    comment: null,
  }
}

describe('Finance domain mapping', () => {
  beforeEach(() => {
    faker.seed(42)
  })

  it('price generates numeric string or number', () => {
    const result = mapColumn(makeColumn('price'), 'products')
    expect(result.domain).toBe('finance')
    const value = result.generator!(faker, 0)
    expect(typeof value).toBe('string')
    expect(parseFloat(value as string)).toBeGreaterThan(0)
  })

  it('amount maps to finance domain', () => {
    const result = mapColumn(makeColumn('amount'), 'transactions')
    expect(result.domain).toBe('finance')
  })

  it('currency_code generates 3-character code', () => {
    const result = mapColumn(makeColumn('currency_code', NormalizedType.VARCHAR), 'transactions')
    expect(result.domain).toBe('finance')
    const value = result.generator!(faker, 0) as string
    expect(typeof value).toBe('string')
    expect(value.length).toBe(3)
  })

  it('currency generates currency code', () => {
    const result = mapColumn(makeColumn('currency', NormalizedType.VARCHAR), 'transactions')
    expect(result.domain).toBe('finance')
    const value = result.generator!(faker, 0) as string
    expect(typeof value).toBe('string')
  })

  it('iban generates IBAN string', () => {
    const result = mapColumn(makeColumn('iban', NormalizedType.VARCHAR), 'bank_accounts')
    expect(result.domain).toBe('finance')
    const value = result.generator!(faker, 0) as string
    expect(typeof value).toBe('string')
    expect(value.length).toBeGreaterThan(10)
  })

  it('suffix: order_total maps to finance amount generator', () => {
    const result = mapColumn(makeColumn('order_total'), 'invoices')
    expect(result.domain).toBe('finance')
    const value = result.generator!(faker, 0) as string
    expect(parseFloat(value)).toBeGreaterThan(0)
  })

  it('suffix: tax_rate maps to rate generator with value between 0 and 1', () => {
    const result = mapColumn(makeColumn('tax_rate'), 'settings')
    expect(result.domain).toBe('finance')
    const value = result.generator!(faker, 0) as string
    const num = parseFloat(value)
    expect(num).toBeGreaterThanOrEqual(0)
    expect(num).toBeLessThanOrEqual(1)
  })
})
