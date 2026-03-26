import { describe, it, expect } from 'vitest'
import { faker } from '@faker-js/faker'
import { handleEnumValues, handleCheckConstraint } from '../constraint-handlers.js'
import { NormalizedType } from '../../types/schema.js'
import type { ColumnDef, CheckConstraintDef } from '../../types/schema.js'
import { ConfidenceLevel, MappingSource } from '../types.js'

function makeColumn(overrides: Partial<ColumnDef> = {}): ColumnDef {
  return {
    name: 'status',
    dataType: NormalizedType.VARCHAR,
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
    ...overrides,
  }
}

describe('handleEnumValues', () => {
  it('returns mapping for column with enum values', () => {
    const column = makeColumn({ enumValues: ['active', 'inactive', 'pending'] })
    const result = handleEnumValues(column, 'users')

    expect(result).not.toBeNull()
    expect(result!.confidence).toBe(ConfidenceLevel.HIGH)
    expect(result!.source).toBe(MappingSource.ENUM_VALUES)
    expect(result!.domain).toBe('enum')
  })

  it('returns null for column with null enumValues', () => {
    const column = makeColumn({ enumValues: null })
    const result = handleEnumValues(column, 'users')
    expect(result).toBeNull()
  })

  it('returns null for column with empty enumValues', () => {
    const column = makeColumn({ enumValues: [] })
    const result = handleEnumValues(column, 'users')
    expect(result).toBeNull()
  })

  it('generator always picks from enum values (100 iterations)', () => {
    const values = ['active', 'inactive', 'pending']
    const column = makeColumn({ enumValues: values })
    const result = handleEnumValues(column, 'users')

    faker.seed(42)
    for (let i = 0; i < 100; i++) {
      const generated = result!.generator!(faker, i)
      expect(values).toContain(generated)
    }
  })

  it('truncates fakerMethod label when more than 5 values', () => {
    const values = ['a', 'b', 'c', 'd', 'e', 'f', 'g']
    const column = makeColumn({ enumValues: values })
    const result = handleEnumValues(column, 'users')

    expect(result!.fakerMethod).toContain('...+2')
  })
})

describe('handleCheckConstraint', () => {
  it('returns mapping for matching CHECK constraint with inferredValues', () => {
    const column = makeColumn({ name: 'status' })
    const constraints: CheckConstraintDef[] = [
      {
        expression: "status IN ('a', 'b', 'c')",
        name: 'chk_status',
        inferredValues: ['a', 'b', 'c'],
      },
    ]

    const result = handleCheckConstraint(column, 'users', constraints)
    expect(result).not.toBeNull()
    expect(result!.confidence).toBe(ConfidenceLevel.HIGH)
    expect(result!.source).toBe(MappingSource.CHECK_CONSTRAINT)
  })

  it('generator picks from CHECK constraint inferred values', () => {
    const column = makeColumn({ name: 'status' })
    const values = ['a', 'b', 'c']
    const constraints: CheckConstraintDef[] = [
      {
        expression: "status IN ('a', 'b', 'c')",
        name: 'chk_status',
        inferredValues: values,
      },
    ]

    const result = handleCheckConstraint(column, 'users', constraints)
    faker.seed(42)
    for (let i = 0; i < 50; i++) {
      const generated = result!.generator!(faker, i)
      expect(values).toContain(generated)
    }
  })

  it('returns null when no CHECK constraint references the column', () => {
    const column = makeColumn({ name: 'status' })
    const constraints: CheckConstraintDef[] = [
      {
        expression: "role IN ('admin', 'user')",
        name: 'chk_role',
        inferredValues: ['admin', 'user'],
      },
    ]

    const result = handleCheckConstraint(column, 'users', constraints)
    expect(result).toBeNull()
  })

  it('returns null when CHECK constraint has no inferredValues', () => {
    const column = makeColumn({ name: 'age' })
    const constraints: CheckConstraintDef[] = [
      {
        expression: 'age > 0',
        name: 'chk_age',
        inferredValues: null,
      },
    ]

    const result = handleCheckConstraint(column, 'users', constraints)
    expect(result).toBeNull()
  })

  it('returns null when CHECK constraint has empty inferredValues', () => {
    const column = makeColumn({ name: 'age' })
    const constraints: CheckConstraintDef[] = [
      {
        expression: 'age > 0',
        name: 'chk_age',
        inferredValues: [],
      },
    ]

    const result = handleCheckConstraint(column, 'users', constraints)
    expect(result).toBeNull()
  })
})
