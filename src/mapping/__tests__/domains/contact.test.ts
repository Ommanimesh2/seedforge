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

describe('Contact domain mapping', () => {
  beforeEach(() => {
    faker.seed(42)
  })

  it('email generates RFC 2606 safe email', () => {
    const result = mapColumn(makeColumn('email'), 'contacts')
    expect(result.domain).toBe('contact')
    const value = result.generator!(faker, 0) as string
    expect(value).toContain('@')
    expect(value).toMatch(/@example\.(com|net|org)$/)
  })

  it('phone generates a string', () => {
    const result = mapColumn(makeColumn('phone'), 'contacts')
    expect(result.domain).toBe('contact')
    const value = result.generator!(faker, 0)
    expect(typeof value).toBe('string')
  })

  it('phone_number maps to contact domain', () => {
    const result = mapColumn(makeColumn('phone_number'), 'contacts')
    expect(result.domain).toBe('contact')
  })

  it('website generates URL string', () => {
    const result = mapColumn(makeColumn('website'), 'contacts')
    expect(result.domain).toBe('contact')
    const value = result.generator!(faker, 0) as string
    expect(value).toContain('http')
  })

  it('url generates URL string', () => {
    const result = mapColumn(makeColumn('url'), 'contacts')
    expect(result.domain).toBe('contact')
    const value = result.generator!(faker, 0) as string
    expect(value).toContain('http')
  })

  it('suffix: contact_email maps to email generator', () => {
    const result = mapColumn(makeColumn('contact_email'), 'people')
    expect(result.domain).toBe('contact')
    const value = result.generator!(faker, 0) as string
    expect(value).toMatch(/@example\.(com|net|org)$/)
  })

  it('suffix: work_phone maps to phone generator', () => {
    const result = mapColumn(makeColumn('work_phone'), 'people')
    expect(result.domain).toBe('contact')
    const value = result.generator!(faker, 0)
    expect(typeof value).toBe('string')
  })
})
