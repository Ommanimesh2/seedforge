import { describe, expect, it } from 'vitest'
import { generateFromSchema } from '../browser.js'
import type { ColumnDef, DatabaseSchema, TableDef } from '../types/schema.js'
import { NormalizedType } from '../types/schema.js'

/**
 * Build a minimal "users" table schema by hand. The browser entry point
 * must accept a plain DatabaseSchema without any live-DB machinery, so
 * this test verifies end-to-end row generation for a hand-written schema.
 */
function buildUsersSchema(): DatabaseSchema {
  const column = (
    name: string,
    dataType: NormalizedType,
    overrides: Partial<ColumnDef> = {},
  ): ColumnDef => ({
    name,
    dataType,
    nativeType: dataType.toLowerCase(),
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
  })

  const columns = new Map<string, ColumnDef>()
  columns.set('id', column('id', NormalizedType.INTEGER, { isAutoIncrement: true }))
  columns.set('email', column('email', NormalizedType.TEXT, { maxLength: 255 }))
  columns.set('name', column('name', NormalizedType.TEXT, { maxLength: 255 }))

  const users: TableDef = {
    name: 'users',
    schema: 'public',
    columns,
    primaryKey: { columns: ['id'], name: 'users_pkey' },
    foreignKeys: [],
    uniqueConstraints: [{ columns: ['email'], name: 'users_email_key' }],
    checkConstraints: [],
    indexes: [],
    comment: null,
  }

  const schema: DatabaseSchema = {
    name: 'playground',
    tables: new Map([['public.users', users]]),
    enums: new Map(),
    schemas: ['public'],
  }

  return schema
}

describe('browser entry — generateFromSchema', () => {
  it('generates rows for a hand-built schema', () => {
    const schema = buildUsersSchema()
    const result = generateFromSchema(schema, { count: 3, seed: 42 })

    const tableResult = result.tables.get('public.users')
    expect(tableResult).toBeDefined()
    expect(tableResult!.rows).toHaveLength(3)

    const ids = new Set<unknown>()
    for (const row of tableResult!.rows) {
      expect(typeof row.email).toBe('string')
      expect((row.email as string).length).toBeGreaterThan(0)
      expect(typeof row.name).toBe('string')
      expect((row.name as string).length).toBeGreaterThan(0)
      ids.add(row.id)
    }
    // All ids should be unique
    expect(ids.size).toBe(3)
  })

  it('is deterministic for a given seed', () => {
    const schema1 = buildUsersSchema()
    const schema2 = buildUsersSchema()

    const first = generateFromSchema(schema1, { count: 3, seed: 42 })
    const second = generateFromSchema(schema2, { count: 3, seed: 42 })

    const firstRows = first.tables.get('public.users')!.rows
    const secondRows = second.tables.get('public.users')!.rows

    expect(secondRows).toEqual(firstRows)
  })
})
