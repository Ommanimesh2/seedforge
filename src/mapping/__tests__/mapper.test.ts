import { describe, it, expect } from 'vitest'
import { faker } from '@faker-js/faker'
import { mapColumn, mapTable } from '../mapper.js'
import { ConfidenceLevel, MappingSource } from '../types.js'
import { NormalizedType } from '../../types/schema.js'
import type { ColumnDef, TableDef, CheckConstraintDef } from '../../types/schema.js'

function makeColumn(overrides: Partial<ColumnDef> = {}): ColumnDef {
  return {
    name: 'test_col',
    dataType: NormalizedType.TEXT,
    nativeType: 'text',
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
    ...overrides,
  }
}

describe('mapColumn', () => {
  beforeEach(() => {
    faker.seed(42)
  })

  it('Tier 1: exact name match for "email" with HIGH confidence', () => {
    const col = makeColumn({ name: 'email', dataType: NormalizedType.TEXT })
    const result = mapColumn(col, 'users')

    expect(result.confidence).toBe(ConfidenceLevel.HIGH)
    expect(result.source).toBe(MappingSource.EXACT_NAME)
    expect(result.domain).toBe('contact')

    // Should generate RFC 2606 safe email
    const value = result.generator!(faker, 0) as string
    expect(value).toContain('@')
    expect(value).toMatch(/@example\.(com|net|org)$/)
  })

  it('Tier 2: suffix match for "customer_phone" with MEDIUM confidence', () => {
    const col = makeColumn({ name: 'customer_phone', dataType: NormalizedType.VARCHAR })
    const result = mapColumn(col, 'contacts')

    expect(result.confidence).toBe(ConfidenceLevel.MEDIUM)
    expect(result.source).toBe(MappingSource.SUFFIX)
    expect(result.domain).toBe('contact')
  })

  it('Tier 3: type fallback for unknown column name with LOW confidence', () => {
    const col = makeColumn({ name: 'xyzzy', dataType: NormalizedType.INTEGER })
    const result = mapColumn(col, 'test_table')

    expect(result.confidence).toBe(ConfidenceLevel.LOW)
    expect(result.source).toBe(MappingSource.TYPE_FALLBACK)
    expect(result.domain).toBe('type_fallback')

    const value = result.generator!(faker, 0) as number
    expect(typeof value).toBe('number')
  })

  it('enum values take priority over name match', () => {
    const col = makeColumn({
      name: 'email',
      dataType: NormalizedType.TEXT,
      enumValues: ['a@b.com', 'c@d.com'],
    })
    const result = mapColumn(col, 'users')

    expect(result.confidence).toBe(ConfidenceLevel.HIGH)
    expect(result.source).toBe(MappingSource.ENUM_VALUES)
    expect(result.domain).toBe('enum')

    const value = result.generator!(faker, 0) as string
    expect(['a@b.com', 'c@d.com']).toContain(value)
  })

  it('auto-increment column is marked as skip', () => {
    const col = makeColumn({ name: 'id', isAutoIncrement: true })
    const result = mapColumn(col, 'users')

    expect(result.confidence).toBe(ConfidenceLevel.HIGH)
    expect(result.source).toBe(MappingSource.AUTO_INCREMENT)
    expect(result.generator).toBeNull()
  })

  it('generated column is marked as skip', () => {
    const col = makeColumn({ name: 'total', isGenerated: true })
    const result = mapColumn(col, 'orders')

    expect(result.confidence).toBe(ConfidenceLevel.HIGH)
    expect(result.source).toBe(MappingSource.AUTO_INCREMENT)
    expect(result.generator).toBeNull()
  })

  it('table prefix stripping: user_email on users table matches email exact', () => {
    const col = makeColumn({ name: 'user_email', dataType: NormalizedType.VARCHAR })
    const result = mapColumn(col, 'users')

    expect(result.confidence).toBe(ConfidenceLevel.HIGH)
    expect(result.source).toBe(MappingSource.EXACT_NAME)
    expect(result.domain).toBe('contact')
  })

  it('boolean type guard: is_active with VARCHAR does NOT match boolean domain', () => {
    const col = makeColumn({ name: 'is_active', dataType: NormalizedType.VARCHAR })
    const result = mapColumn(col, 'users')

    // Should not be matched as boolean because it's not a BOOLEAN type
    expect(result.domain).not.toBe('boolean')
  })

  it('boolean prefix match: is_active with BOOLEAN type matches boolean domain', () => {
    const col = makeColumn({ name: 'is_active', dataType: NormalizedType.BOOLEAN })
    const result = mapColumn(col, 'users')

    expect(result.domain).toBe('boolean')
    expect(result.confidence).toBe(ConfidenceLevel.MEDIUM)
    expect(result.source).toBe(MappingSource.PREFIX)
  })

  it('CHECK constraint values used when no name match', () => {
    const col = makeColumn({ name: 'priority_level', dataType: NormalizedType.VARCHAR })
    const constraints: CheckConstraintDef[] = [
      {
        expression: "priority_level IN ('low', 'medium', 'high')",
        name: 'chk_priority',
        inferredValues: ['low', 'medium', 'high'],
      },
    ]
    const result = mapColumn(col, 'tasks', constraints)

    expect(result.confidence).toBe(ConfidenceLevel.HIGH)
    expect(result.source).toBe(MappingSource.CHECK_CONSTRAINT)
    const value = result.generator!(faker, 0)
    expect(['low', 'medium', 'high']).toContain(value)
  })
})

describe('mapTable', () => {
  it('maps all columns in a table', () => {
    const columns = new Map<string, ColumnDef>()
    columns.set('id', makeColumn({ name: 'id', dataType: NormalizedType.INTEGER, isAutoIncrement: true }))
    columns.set('email', makeColumn({ name: 'email', dataType: NormalizedType.VARCHAR }))
    columns.set('first_name', makeColumn({ name: 'first_name', dataType: NormalizedType.VARCHAR }))
    columns.set('is_active', makeColumn({ name: 'is_active', dataType: NormalizedType.BOOLEAN }))
    columns.set('created_at', makeColumn({ name: 'created_at', dataType: NormalizedType.TIMESTAMP }))
    columns.set('xyzzy', makeColumn({ name: 'xyzzy', dataType: NormalizedType.INTEGER }))

    const table: TableDef = {
      name: 'users',
      schema: 'public',
      columns,
      primaryKey: null,
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
      indexes: [],
      comment: null,
    }

    const result = mapTable(table)

    expect(result.tableName).toBe('users')
    expect(result.mappings.size).toBe(6)
    expect(result.unmapped).toHaveLength(0)

    // Verify individual mappings
    expect(result.mappings.get('id')!.source).toBe(MappingSource.AUTO_INCREMENT)
    expect(result.mappings.get('email')!.domain).toBe('contact')
    expect(result.mappings.get('first_name')!.domain).toBe('person')
    expect(result.mappings.get('is_active')!.domain).toBe('boolean')
    expect(result.mappings.get('created_at')!.domain).toBe('temporal')
    expect(result.mappings.get('xyzzy')!.source).toBe(MappingSource.TYPE_FALLBACK)
  })

  it('produces deterministic output with same seed', () => {
    const columns = new Map<string, ColumnDef>()
    columns.set('first_name', makeColumn({ name: 'first_name', dataType: NormalizedType.VARCHAR }))
    columns.set('email', makeColumn({ name: 'email', dataType: NormalizedType.VARCHAR }))

    const table: TableDef = {
      name: 'users',
      schema: 'public',
      columns,
      primaryKey: null,
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
      indexes: [],
      comment: null,
    }

    // Run 1
    faker.seed(42)
    const result1 = mapTable(table)
    const values1 = Array.from(result1.mappings.values()).map((m) =>
      m.generator ? m.generator(faker, 0) : null,
    )

    // Run 2
    faker.seed(42)
    const result2 = mapTable(table)
    const values2 = Array.from(result2.mappings.values()).map((m) =>
      m.generator ? m.generator(faker, 0) : null,
    )

    expect(values1).toEqual(values2)
  })
})
