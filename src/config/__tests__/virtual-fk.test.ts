import { describe, it, expect } from 'vitest'
import { injectVirtualForeignKeys } from '../virtual-fk.js'
import { ConfigError } from '../../errors/index.js'
import { NormalizedType, FKAction } from '../../types/schema.js'
import type { DatabaseSchema, TableDef, ColumnDef } from '../../types/schema.js'
import type { VirtualForeignKey } from '../types.js'

function makeColumn(name: string): ColumnDef {
  return {
    name,
    dataType: NormalizedType.INTEGER,
    nativeType: 'int4',
    isNullable: true,
    hasDefault: false,
    defaultValue: null,
    isAutoIncrement: false,
    isGenerated: false,
    maxLength: null,
    numericPrecision: null,
    numericScale: null,
    enumValues: null,
    comment: null,
  }
}

function makeTable(name: string, columns: string[]): TableDef {
  const colMap = new Map<string, ColumnDef>()
  for (const col of columns) {
    colMap.set(col, makeColumn(col))
  }
  return {
    name,
    schema: 'public',
    columns: colMap,
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
    tableMap.set(t.name, t)
  }
  return {
    name: 'testdb',
    tables: tableMap,
    enums: new Map(),
    schemas: ['public'],
  }
}

describe('injectVirtualForeignKeys', () => {
  it('valid virtual FK is injected with isVirtual: true', () => {
    const schema = makeSchema([
      makeTable('comments', ['id', 'commentable_id']),
      makeTable('posts', ['id', 'title']),
    ])

    const vfks: VirtualForeignKey[] = [
      {
        source: { table: 'comments', column: 'commentable_id' },
        target: { table: 'posts', column: 'id' },
      },
    ]

    const result = injectVirtualForeignKeys(schema, vfks)
    const commentsFKs = result.tables.get('comments')!.foreignKeys
    expect(commentsFKs).toHaveLength(1)
    expect(commentsFKs[0].isVirtual).toBe(true)
    expect(commentsFKs[0].name).toBe('virtual_fk_comments_commentable_id')
    expect(commentsFKs[0].columns).toEqual(['commentable_id'])
    expect(commentsFKs[0].referencedTable).toBe('posts')
    expect(commentsFKs[0].referencedColumns).toEqual(['id'])
    expect(commentsFKs[0].referencedSchema).toBe('public')
    expect(commentsFKs[0].onDelete).toBe(FKAction.NO_ACTION)
    expect(commentsFKs[0].onUpdate).toBe(FKAction.NO_ACTION)
    expect(commentsFKs[0].isDeferrable).toBe(false)
    expect(commentsFKs[0].isDeferred).toBe(false)
  })

  it('multiple virtual FKs are all injected', () => {
    const schema = makeSchema([
      makeTable('comments', ['id', 'commentable_id', 'author_id']),
      makeTable('posts', ['id']),
      makeTable('users', ['id']),
    ])

    const vfks: VirtualForeignKey[] = [
      {
        source: { table: 'comments', column: 'commentable_id' },
        target: { table: 'posts', column: 'id' },
      },
      {
        source: { table: 'comments', column: 'author_id' },
        target: { table: 'users', column: 'id' },
      },
    ]

    const result = injectVirtualForeignKeys(schema, vfks)
    const commentsFKs = result.tables.get('comments')!.foreignKeys
    expect(commentsFKs).toHaveLength(2)
    expect(commentsFKs[0].referencedTable).toBe('posts')
    expect(commentsFKs[1].referencedTable).toBe('users')
  })

  it('source table not found -> SF5014', () => {
    const schema = makeSchema([makeTable('posts', ['id'])])
    const vfks: VirtualForeignKey[] = [
      {
        source: { table: 'nonexistent', column: 'id' },
        target: { table: 'posts', column: 'id' },
      },
    ]

    try {
      injectVirtualForeignKeys(schema, vfks)
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError)
      expect((err as ConfigError).code).toBe('SF5014')
      expect((err as ConfigError).message).toContain('source table')
    }
  })

  it('source column not found -> SF5015', () => {
    const schema = makeSchema([
      makeTable('comments', ['id']),
      makeTable('posts', ['id']),
    ])
    const vfks: VirtualForeignKey[] = [
      {
        source: { table: 'comments', column: 'nonexistent_col' },
        target: { table: 'posts', column: 'id' },
      },
    ]

    try {
      injectVirtualForeignKeys(schema, vfks)
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError)
      expect((err as ConfigError).code).toBe('SF5015')
    }
  })

  it('target table not found -> SF5014', () => {
    const schema = makeSchema([
      makeTable('comments', ['id', 'commentable_id']),
    ])
    const vfks: VirtualForeignKey[] = [
      {
        source: { table: 'comments', column: 'commentable_id' },
        target: { table: 'nonexistent', column: 'id' },
      },
    ]

    try {
      injectVirtualForeignKeys(schema, vfks)
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError)
      expect((err as ConfigError).code).toBe('SF5014')
      expect((err as ConfigError).message).toContain('target table')
    }
  })

  it('target column not found -> SF5015', () => {
    const schema = makeSchema([
      makeTable('comments', ['id', 'commentable_id']),
      makeTable('posts', ['id']),
    ])
    const vfks: VirtualForeignKey[] = [
      {
        source: { table: 'comments', column: 'commentable_id' },
        target: { table: 'posts', column: 'nonexistent_col' },
      },
    ]

    try {
      injectVirtualForeignKeys(schema, vfks)
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError)
      expect((err as ConfigError).code).toBe('SF5015')
    }
  })

  it('self-referencing virtual FK works correctly', () => {
    const schema = makeSchema([
      makeTable('categories', ['id', 'parent_id']),
    ])
    const vfks: VirtualForeignKey[] = [
      {
        source: { table: 'categories', column: 'parent_id' },
        target: { table: 'categories', column: 'id' },
      },
    ]

    const result = injectVirtualForeignKeys(schema, vfks)
    const fks = result.tables.get('categories')!.foreignKeys
    expect(fks).toHaveLength(1)
    expect(fks[0].referencedTable).toBe('categories')
    expect(fks[0].isVirtual).toBe(true)
  })

  it('empty virtual FKs does nothing', () => {
    const schema = makeSchema([makeTable('posts', ['id'])])
    const result = injectVirtualForeignKeys(schema, [])
    expect(result.tables.get('posts')!.foreignKeys).toHaveLength(0)
  })
})
