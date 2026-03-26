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

describe('Internet domain mapping', () => {
  beforeEach(() => {
    faker.seed(42)
  })

  it('ip_address generates valid IPv4 string', () => {
    const result = mapColumn(makeColumn('ip_address'), 'logs')
    expect(result.domain).toBe('internet')
    const value = result.generator!(faker, 0) as string
    expect(value).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)
  })

  it('ipv4 generates valid IPv4 string', () => {
    const result = mapColumn(makeColumn('ipv4'), 'logs')
    expect(result.domain).toBe('internet')
    const value = result.generator!(faker, 0) as string
    expect(value).toMatch(/^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/)
  })

  it('ipv6 generates valid IPv6 string', () => {
    const result = mapColumn(makeColumn('ipv6'), 'logs')
    expect(result.domain).toBe('internet')
    const value = result.generator!(faker, 0) as string
    expect(value).toMatch(/^[0-9a-f:]+$/i)
  })

  it('mac_address generates MAC string', () => {
    const result = mapColumn(makeColumn('mac_address'), 'devices')
    expect(result.domain).toBe('internet')
    const value = result.generator!(faker, 0) as string
    expect(value).toMatch(/^([0-9a-f]{2}:){5}[0-9a-f]{2}$/i)
  })

  it('slug generates slug string', () => {
    const result = mapColumn(makeColumn('slug'), 'posts')
    expect(result.domain).toBe('internet')
    const value = result.generator!(faker, 0) as string
    expect(typeof value).toBe('string')
    expect(value).toMatch(/^[a-z0-9-]+$/)
  })

  it('token generates alphanumeric string', () => {
    const result = mapColumn(makeColumn('token'), 'sessions')
    expect(result.domain).toBe('internet')
    const value = result.generator!(faker, 0) as string
    expect(typeof value).toBe('string')
    expect(value.length).toBe(32)
  })

  it('api_key generates alphanumeric string', () => {
    const result = mapColumn(makeColumn('api_key'), 'apps')
    expect(result.domain).toBe('internet')
    const value = result.generator!(faker, 0) as string
    expect(typeof value).toBe('string')
    expect(value.length).toBe(32)
  })

  it('password generates string', () => {
    const result = mapColumn(makeColumn('password'), 'users')
    expect(result.domain).toBe('internet')
    const value = result.generator!(faker, 0)
    expect(typeof value).toBe('string')
  })
})
