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

describe('Location domain mapping', () => {
  beforeEach(() => {
    faker.seed(42)
  })

  it('city generates city name string', () => {
    const result = mapColumn(makeColumn('city'), 'addresses')
    expect(result.domain).toBe('location')
    const value = result.generator!(faker, 0)
    expect(typeof value).toBe('string')
  })

  it('state generates state name string', () => {
    const result = mapColumn(makeColumn('state'), 'addresses')
    expect(result.domain).toBe('location')
    const value = result.generator!(faker, 0)
    expect(typeof value).toBe('string')
  })

  it('country generates country name string', () => {
    const result = mapColumn(makeColumn('country'), 'addresses')
    expect(result.domain).toBe('location')
    const value = result.generator!(faker, 0)
    expect(typeof value).toBe('string')
  })

  it('country_code generates 2-3 character code', () => {
    const result = mapColumn(makeColumn('country_code'), 'addresses')
    expect(result.domain).toBe('location')
    const value = result.generator!(faker, 0) as string
    expect(typeof value).toBe('string')
    expect(value.length).toBeGreaterThanOrEqual(2)
    expect(value.length).toBeLessThanOrEqual(3)
  })

  it('latitude generates number between -90 and 90', () => {
    const result = mapColumn(makeColumn('latitude', NormalizedType.DOUBLE), 'locations')
    expect(result.domain).toBe('location')
    const value = result.generator!(faker, 0) as number
    expect(value).toBeGreaterThanOrEqual(-90)
    expect(value).toBeLessThanOrEqual(90)
  })

  it('lat generates number between -90 and 90', () => {
    const result = mapColumn(makeColumn('lat', NormalizedType.DOUBLE), 'locations')
    expect(result.domain).toBe('location')
    const value = result.generator!(faker, 0) as number
    expect(value).toBeGreaterThanOrEqual(-90)
    expect(value).toBeLessThanOrEqual(90)
  })

  it('longitude generates number between -180 and 180', () => {
    const result = mapColumn(makeColumn('longitude', NormalizedType.DOUBLE), 'locations')
    expect(result.domain).toBe('location')
    const value = result.generator!(faker, 0) as number
    expect(value).toBeGreaterThanOrEqual(-180)
    expect(value).toBeLessThanOrEqual(180)
  })

  it('zip_code generates postal code string', () => {
    const result = mapColumn(makeColumn('zip_code'), 'addresses')
    expect(result.domain).toBe('location')
    const value = result.generator!(faker, 0)
    expect(typeof value).toBe('string')
  })

  it('postal_code generates postal code string', () => {
    const result = mapColumn(makeColumn('postal_code'), 'addresses')
    expect(result.domain).toBe('location')
    const value = result.generator!(faker, 0)
    expect(typeof value).toBe('string')
  })

  it('timezone generates timezone string', () => {
    const result = mapColumn(makeColumn('timezone'), 'settings')
    expect(result.domain).toBe('location')
    const value = result.generator!(faker, 0) as string
    expect(typeof value).toBe('string')
    expect(value).toContain('/')
  })
})
