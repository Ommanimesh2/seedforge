import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import * as os from 'node:os'
import {
  hashTableSchema,
  computeSchemaHashes,
  saveSchemaState,
  loadSchemaState,
  diffSchema,
  getTablesNeedingRegeneration,
} from '../diff.js'
import type { SchemaState } from '../diff.js'
import type { TableDef, ColumnDef, DatabaseSchema } from '../../types/schema.js'
import { NormalizedType, FKAction } from '../../types/schema.js'

function makeColumn(name: string, overrides: Partial<ColumnDef> = {}): ColumnDef {
  return {
    name,
    dataType: NormalizedType.INTEGER,
    nativeType: 'integer',
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

function makeTable(
  name: string,
  columns: [string, Partial<ColumnDef>][],
): TableDef {
  return {
    name,
    schema: 'public',
    columns: new Map(
      columns.map(([colName, overrides]) => [colName, makeColumn(colName, overrides)]),
    ),
    primaryKey: { columns: ['id'], name: `${name}_pkey` },
    foreignKeys: [],
    uniqueConstraints: [],
    checkConstraints: [],
    indexes: [],
    comment: null,
  }
}

function makeSchema(tables: TableDef[]): DatabaseSchema {
  const tableMap = new Map<string, TableDef>()
  for (const t of tables) {
    tableMap.set(`${t.schema}.${t.name}`, t)
  }
  return {
    name: 'test_db',
    tables: tableMap,
    enums: new Map(),
    schemas: ['public'],
  }
}

describe('hashTableSchema', () => {
  it('produces consistent hash for same schema', () => {
    const table = makeTable('users', [
      ['id', { dataType: NormalizedType.UUID }],
      ['name', { dataType: NormalizedType.VARCHAR }],
    ])

    const hash1 = hashTableSchema(table)
    const hash2 = hashTableSchema(table)

    expect(hash1).toBe(hash2)
  })

  it('produces different hash when column is added', () => {
    const table1 = makeTable('users', [
      ['id', { dataType: NormalizedType.UUID }],
      ['name', { dataType: NormalizedType.VARCHAR }],
    ])

    const table2 = makeTable('users', [
      ['id', { dataType: NormalizedType.UUID }],
      ['name', { dataType: NormalizedType.VARCHAR }],
      ['email', { dataType: NormalizedType.VARCHAR }],
    ])

    expect(hashTableSchema(table1)).not.toBe(hashTableSchema(table2))
  })

  it('produces different hash when column type changes', () => {
    const table1 = makeTable('users', [
      ['id', { dataType: NormalizedType.UUID }],
      ['age', { dataType: NormalizedType.INTEGER }],
    ])

    const table2 = makeTable('users', [
      ['id', { dataType: NormalizedType.UUID }],
      ['age', { dataType: NormalizedType.BIGINT }],
    ])

    expect(hashTableSchema(table1)).not.toBe(hashTableSchema(table2))
  })

  it('produces different hash when nullability changes', () => {
    const table1 = makeTable('users', [
      ['id', { dataType: NormalizedType.UUID }],
      ['name', { dataType: NormalizedType.VARCHAR, isNullable: false }],
    ])

    const table2 = makeTable('users', [
      ['id', { dataType: NormalizedType.UUID }],
      ['name', { dataType: NormalizedType.VARCHAR, isNullable: true }],
    ])

    expect(hashTableSchema(table1)).not.toBe(hashTableSchema(table2))
  })

  it('is not affected by column insertion order', () => {
    const table1 = makeTable('users', [
      ['id', { dataType: NormalizedType.UUID }],
      ['name', { dataType: NormalizedType.VARCHAR }],
    ])

    // Reversed column order
    const table2: TableDef = {
      ...table1,
      columns: new Map([
        ['name', makeColumn('name', { dataType: NormalizedType.VARCHAR })],
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
      ]),
    }

    expect(hashTableSchema(table1)).toBe(hashTableSchema(table2))
  })

  it('includes foreign key definitions in hash', () => {
    const table1 = makeTable('posts', [
      ['id', { dataType: NormalizedType.UUID }],
      ['user_id', {}],
    ])

    const table2 = makeTable('posts', [
      ['id', { dataType: NormalizedType.UUID }],
      ['user_id', {}],
    ])
    table2.foreignKeys = [{
      name: 'posts_user_fk',
      columns: ['user_id'],
      referencedTable: 'users',
      referencedSchema: 'public',
      referencedColumns: ['id'],
      onDelete: FKAction.CASCADE,
      onUpdate: FKAction.NO_ACTION,
      isDeferrable: false,
      isDeferred: false,
      isVirtual: false,
    }]

    expect(hashTableSchema(table1)).not.toBe(hashTableSchema(table2))
  })
})

describe('computeSchemaHashes', () => {
  it('computes hashes for all tables', () => {
    const schema = makeSchema([
      makeTable('users', [['id', { dataType: NormalizedType.UUID }]]),
      makeTable('posts', [['id', { dataType: NormalizedType.UUID }]]),
    ])

    const hashes = computeSchemaHashes(schema)

    expect(hashes['public.users']).toBeDefined()
    expect(hashes['public.posts']).toBeDefined()
    expect(typeof hashes['public.users']).toBe('string')
    expect(hashes['public.users'].length).toBe(64) // SHA-256 hex length
  })
})

describe('saveSchemaState / loadSchemaState', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seedforge-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('saves and loads state correctly', () => {
    const schema = makeSchema([
      makeTable('users', [['id', { dataType: NormalizedType.UUID }]]),
    ])

    saveSchemaState(tmpDir, schema)

    const loaded = loadSchemaState(tmpDir)
    expect(loaded).not.toBeNull()
    expect(loaded!.tableHashes['public.users']).toBeDefined()
    expect(loaded!.generatedAt).toBeDefined()
  })

  it('returns null when no state file exists', () => {
    const loaded = loadSchemaState(tmpDir)
    expect(loaded).toBeNull()
  })

  it('returns null for corrupted state file', () => {
    const filePath = path.join(tmpDir, '.seedforge.state.json')
    fs.writeFileSync(filePath, 'not valid json', 'utf-8')

    const loaded = loadSchemaState(tmpDir)
    expect(loaded).toBeNull()
  })
})

describe('diffSchema', () => {
  it('detects unchanged tables', () => {
    const usersTable = makeTable('users', [['id', { dataType: NormalizedType.UUID }]])
    const schema = makeSchema([usersTable])
    const hashes = computeSchemaHashes(schema)

    const state: SchemaState = {
      generatedAt: new Date().toISOString(),
      tableHashes: hashes,
    }

    const diff = diffSchema(schema, state)

    expect(diff.unchangedTables).toContain('public.users')
    expect(diff.changedTables).toHaveLength(0)
    expect(diff.addedTables).toHaveLength(0)
    expect(diff.removedTables).toHaveLength(0)
  })

  it('detects changed tables', () => {
    const originalSchema = makeSchema([
      makeTable('users', [['id', { dataType: NormalizedType.UUID }]]),
    ])

    const state: SchemaState = {
      generatedAt: new Date().toISOString(),
      tableHashes: computeSchemaHashes(originalSchema),
    }

    // Modify the table
    const modifiedSchema = makeSchema([
      makeTable('users', [
        ['id', { dataType: NormalizedType.UUID }],
        ['email', { dataType: NormalizedType.VARCHAR }],
      ]),
    ])

    const diff = diffSchema(modifiedSchema, state)

    expect(diff.changedTables).toContain('public.users')
    expect(diff.unchangedTables).toHaveLength(0)
  })

  it('detects added tables', () => {
    const originalSchema = makeSchema([
      makeTable('users', [['id', { dataType: NormalizedType.UUID }]]),
    ])

    const state: SchemaState = {
      generatedAt: new Date().toISOString(),
      tableHashes: computeSchemaHashes(originalSchema),
    }

    // Add a new table
    const newSchema = makeSchema([
      makeTable('users', [['id', { dataType: NormalizedType.UUID }]]),
      makeTable('posts', [['id', { dataType: NormalizedType.UUID }]]),
    ])

    const diff = diffSchema(newSchema, state)

    expect(diff.addedTables).toContain('public.posts')
    expect(diff.unchangedTables).toContain('public.users')
  })

  it('detects removed tables', () => {
    const originalSchema = makeSchema([
      makeTable('users', [['id', { dataType: NormalizedType.UUID }]]),
      makeTable('posts', [['id', { dataType: NormalizedType.UUID }]]),
    ])

    const state: SchemaState = {
      generatedAt: new Date().toISOString(),
      tableHashes: computeSchemaHashes(originalSchema),
    }

    // Remove a table
    const smallerSchema = makeSchema([
      makeTable('users', [['id', { dataType: NormalizedType.UUID }]]),
    ])

    const diff = diffSchema(smallerSchema, state)

    expect(diff.removedTables).toContain('public.posts')
    expect(diff.unchangedTables).toContain('public.users')
  })

  it('handles complex diff with adds, removes, changes, and unchanged', () => {
    const originalSchema = makeSchema([
      makeTable('users', [['id', { dataType: NormalizedType.UUID }]]),
      makeTable('posts', [['id', { dataType: NormalizedType.UUID }]]),
      makeTable('comments', [['id', { dataType: NormalizedType.UUID }]]),
    ])

    const state: SchemaState = {
      generatedAt: new Date().toISOString(),
      tableHashes: computeSchemaHashes(originalSchema),
    }

    // users: unchanged, posts: changed, comments: removed, tags: added
    const newSchema = makeSchema([
      makeTable('users', [['id', { dataType: NormalizedType.UUID }]]),
      makeTable('posts', [
        ['id', { dataType: NormalizedType.UUID }],
        ['title', { dataType: NormalizedType.VARCHAR }],
      ]),
      makeTable('tags', [['id', { dataType: NormalizedType.UUID }]]),
    ])

    const diff = diffSchema(newSchema, state)

    expect(diff.unchangedTables).toContain('public.users')
    expect(diff.changedTables).toContain('public.posts')
    expect(diff.removedTables).toContain('public.comments')
    expect(diff.addedTables).toContain('public.tags')
  })
})

describe('getTablesNeedingRegeneration', () => {
  let tmpDir: string

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seedforge-test-'))
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
  })

  it('returns null when no state file exists (regenerate all)', () => {
    const schema = makeSchema([
      makeTable('users', [['id', { dataType: NormalizedType.UUID }]]),
    ])

    const result = getTablesNeedingRegeneration(schema, tmpDir)
    expect(result).toBeNull()
  })

  it('returns changed and added tables', () => {
    // Save initial state
    const originalSchema = makeSchema([
      makeTable('users', [['id', { dataType: NormalizedType.UUID }]]),
      makeTable('posts', [['id', { dataType: NormalizedType.UUID }]]),
    ])
    saveSchemaState(tmpDir, originalSchema)

    // Modify schema
    const newSchema = makeSchema([
      makeTable('users', [['id', { dataType: NormalizedType.UUID }]]),
      makeTable('posts', [
        ['id', { dataType: NormalizedType.UUID }],
        ['body', { dataType: NormalizedType.TEXT }],
      ]),
      makeTable('tags', [['id', { dataType: NormalizedType.UUID }]]),
    ])

    const result = getTablesNeedingRegeneration(newSchema, tmpDir)
    expect(result).not.toBeNull()
    expect(result).toContain('public.posts')
    expect(result).toContain('public.tags')
    expect(result).not.toContain('public.users')
  })

  it('returns empty array when nothing changed', () => {
    const schema = makeSchema([
      makeTable('users', [['id', { dataType: NormalizedType.UUID }]]),
    ])
    saveSchemaState(tmpDir, schema)

    const result = getTablesNeedingRegeneration(schema, tmpDir)
    expect(result).not.toBeNull()
    expect(result).toHaveLength(0)
  })
})
