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

describe('Person domain mapping', () => {
  beforeEach(() => {
    faker.seed(42)
  })

  it('first_name generates a string with firstName', () => {
    const result = mapColumn(makeColumn('first_name'), 'people')
    expect(result.domain).toBe('person')
    expect(result.fakerMethod).toContain('firstName')
    const value = result.generator!(faker, 0)
    expect(typeof value).toBe('string')
    expect((value as string).length).toBeGreaterThan(0)
  })

  it('last_name generates a string with lastName', () => {
    const result = mapColumn(makeColumn('last_name'), 'people')
    expect(result.domain).toBe('person')
    expect(result.fakerMethod).toContain('lastName')
    const value = result.generator!(faker, 0)
    expect(typeof value).toBe('string')
  })

  it('full_name generates a string (first + last)', () => {
    const result = mapColumn(makeColumn('full_name'), 'people')
    expect(result.domain).toBe('person')
    const value = result.generator!(faker, 0) as string
    expect(typeof value).toBe('string')
    expect(value).toContain(' ')
  })

  it('name generates a full name', () => {
    const result = mapColumn(makeColumn('name'), 'people')
    expect(result.domain).toBe('person')
    const value = result.generator!(faker, 0) as string
    expect(typeof value).toBe('string')
  })

  it('gender generates one of expected values', () => {
    const result = mapColumn(makeColumn('gender'), 'people')
    expect(result.domain).toBe('person')
    const value = result.generator!(faker, 0) as string
    expect(typeof value).toBe('string')
    expect(['female', 'male']).toContain(value.toLowerCase())
  })

  it('dob generates a Date', () => {
    const result = mapColumn(makeColumn('dob'), 'people')
    expect(result.domain).toBe('person')
    const value = result.generator!(faker, 0)
    expect(value).toBeInstanceOf(Date)
  })

  it('date_of_birth generates a Date', () => {
    const result = mapColumn(makeColumn('date_of_birth'), 'people')
    expect(result.domain).toBe('person')
    const value = result.generator!(faker, 0)
    expect(value).toBeInstanceOf(Date)
  })

  it('age generates number between 18 and 85', () => {
    const result = mapColumn(makeColumn('age', NormalizedType.INTEGER), 'people')
    expect(result.domain).toBe('person')
    for (let i = 0; i < 20; i++) {
      const value = result.generator!(faker, i) as number
      expect(value).toBeGreaterThanOrEqual(18)
      expect(value).toBeLessThanOrEqual(85)
    }
  })

  it('avatar generates a URL string', () => {
    const result = mapColumn(makeColumn('avatar'), 'people')
    expect(result.domain).toBe('person')
    const value = result.generator!(faker, 0) as string
    expect(typeof value).toBe('string')
    expect(value).toContain('http')
  })

  it('table prefix stripping: users.user_first_name maps same as first_name', () => {
    const result = mapColumn(makeColumn('user_first_name'), 'users')
    expect(result.domain).toBe('person')
    expect(result.fakerMethod).toContain('firstName')
  })

  it('nickname maps to username generator', () => {
    const result = mapColumn(makeColumn('nickname'), 'people')
    expect(result.domain).toBe('person')
    const value = result.generator!(faker, 0)
    expect(typeof value).toBe('string')
  })

  it('bio generates a paragraph', () => {
    const result = mapColumn(makeColumn('bio'), 'people')
    expect(result.domain).toBe('person')
    const value = result.generator!(faker, 0) as string
    expect(typeof value).toBe('string')
    expect(value.length).toBeGreaterThan(20)
  })
})
