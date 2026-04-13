import { describe, expect, it } from 'vitest'
import { filterSchema } from '../filter.js'
import { inspectSchema, formatInspectReport } from '../inspect.js'
import type { ColumnDef, DatabaseSchema, TableDef } from '../../types/schema.js'
import { FKAction, NormalizedType } from '../../types/schema.js'

function col(name: string, type: NormalizedType, overrides: Partial<ColumnDef> = {}): ColumnDef {
  return {
    name,
    dataType: type,
    nativeType: type.toLowerCase(),
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

function table(
  name: string,
  columns: ColumnDef[],
  opts: Partial<Omit<TableDef, 'name' | 'columns'>> = {},
): TableDef {
  const colMap = new Map<string, ColumnDef>()
  for (const c of columns) colMap.set(c.name, c)
  return {
    name,
    schema: 'public',
    columns: colMap,
    primaryKey: null,
    foreignKeys: [],
    uniqueConstraints: [],
    checkConstraints: [],
    indexes: [],
    comment: null,
    ...opts,
  }
}

/**
 * Build a schema with the shape:
 *   users  ← posts ← comments
 *   users  ← sessions
 *   tags (standalone)
 *   audit_log (standalone, excluded-by-default in tests)
 */
function buildBlogSchema(): DatabaseSchema {
  const users = table(
    'users',
    [
      col('id', NormalizedType.INTEGER, { isAutoIncrement: true }),
      col('email', NormalizedType.TEXT),
    ],
    {
      primaryKey: { columns: ['id'], name: 'users_pkey' },
      uniqueConstraints: [{ columns: ['email'], name: 'users_email_key' }],
    },
  )
  const posts = table(
    'posts',
    [
      col('id', NormalizedType.INTEGER, { isAutoIncrement: true }),
      col('user_id', NormalizedType.INTEGER),
      col('title', NormalizedType.TEXT),
    ],
    {
      primaryKey: { columns: ['id'], name: 'posts_pkey' },
      foreignKeys: [
        {
          name: 'posts_user_id_fkey',
          columns: ['user_id'],
          referencedTable: 'users',
          referencedSchema: 'public',
          referencedColumns: ['id'],
          onDelete: FKAction.CASCADE,
          onUpdate: FKAction.NO_ACTION,
          isDeferrable: false,
          isDeferred: false,
          isVirtual: false,
        },
      ],
    },
  )
  const comments = table(
    'comments',
    [
      col('id', NormalizedType.INTEGER, { isAutoIncrement: true }),
      col('post_id', NormalizedType.INTEGER),
      col('body', NormalizedType.TEXT),
    ],
    {
      primaryKey: { columns: ['id'], name: 'comments_pkey' },
      foreignKeys: [
        {
          name: 'comments_post_id_fkey',
          columns: ['post_id'],
          referencedTable: 'posts',
          referencedSchema: 'public',
          referencedColumns: ['id'],
          onDelete: FKAction.CASCADE,
          onUpdate: FKAction.NO_ACTION,
          isDeferrable: false,
          isDeferred: false,
          isVirtual: false,
        },
      ],
      checkConstraints: [
        { name: 'body_length', expression: 'length(body) > 0', inferredValues: null },
      ],
    },
  )
  const sessions = table(
    'sessions',
    [col('id', NormalizedType.UUID), col('user_id', NormalizedType.INTEGER)],
    {
      primaryKey: { columns: ['id'], name: 'sessions_pkey' },
      foreignKeys: [
        {
          name: 'sessions_user_id_fkey',
          columns: ['user_id'],
          referencedTable: 'users',
          referencedSchema: 'public',
          referencedColumns: ['id'],
          onDelete: FKAction.CASCADE,
          onUpdate: FKAction.NO_ACTION,
          isDeferrable: false,
          isDeferred: false,
          isVirtual: false,
        },
      ],
    },
  )
  const tags = table(
    'tags',
    [col('id', NormalizedType.INTEGER), col('name', NormalizedType.TEXT)],
    {
      primaryKey: { columns: ['id'], name: 'tags_pkey' },
    },
  )
  const audit = table('audit_log', [col('id', NormalizedType.INTEGER)], {
    primaryKey: { columns: ['id'], name: 'audit_pkey' },
  })

  return {
    name: 'blog',
    tables: new Map([
      ['users', users],
      ['posts', posts],
      ['comments', comments],
      ['sessions', sessions],
      ['tags', tags],
      ['audit_log', audit],
    ]),
    enums: new Map(),
    schemas: ['public'],
  }
}

describe('filterSchema', () => {
  it('returns the full schema when no options given', () => {
    const schema = buildBlogSchema()
    const result = filterSchema(schema, {})
    expect(result.schema.tables.size).toBe(6)
    expect(result.missing).toEqual([])
  })

  it('keeps only requested tables and auto-includes FK ancestors', () => {
    const schema = buildBlogSchema()
    const result = filterSchema(schema, { only: ['comments'] })

    const keys = Array.from(result.schema.tables.keys()).sort()
    // comments → posts → users should all be kept
    expect(keys).toEqual(['comments', 'posts', 'users'])
    expect(result.selected).toEqual(['comments'])
    expect(result.autoIncluded.sort()).toEqual(['posts', 'users'])
  })

  it('respects --strict-only by not auto-including ancestors', () => {
    const schema = buildBlogSchema()
    const result = filterSchema(schema, {
      only: ['comments'],
      includeFKAncestors: false,
    })

    const keys = Array.from(result.schema.tables.keys())
    expect(keys).toEqual(['comments'])
    // The FK to a missing "posts" table is filtered out of the cloned table
    expect(result.schema.tables.get('comments')!.foreignKeys).toHaveLength(0)
  })

  it('reports missing tables', () => {
    const schema = buildBlogSchema()
    const result = filterSchema(schema, { only: ['nope'] })
    expect(result.missing).toEqual(['nope'])
  })

  it('supports exclude glob patterns', () => {
    const schema = buildBlogSchema()
    const result = filterSchema(schema, { exclude: ['audit_*'] })
    expect(Array.from(result.schema.tables.keys())).not.toContain('audit_log')
    expect(result.excluded).toEqual(['audit_log'])
  })

  it('combines only and exclude', () => {
    const schema = buildBlogSchema()
    const result = filterSchema(schema, {
      only: ['posts', 'audit_log'],
      exclude: ['audit_*'],
    })
    const keys = Array.from(result.schema.tables.keys()).sort()
    // posts auto-includes users; audit_log is then excluded
    expect(keys).toEqual(['posts', 'users'])
    expect(result.excluded).toEqual(['audit_log'])
  })

  it('accepts qualified names like "public.posts"', () => {
    const schema = buildBlogSchema()
    const result = filterSchema(schema, { only: ['public.posts'] })
    const keys = Array.from(result.schema.tables.keys()).sort()
    expect(keys).toEqual(['posts', 'users'])
  })
})

describe('inspectSchema', () => {
  it('reports tables, constraints, relationships, and insert order', () => {
    const schema = buildBlogSchema()
    const report = inspectSchema(schema)

    expect(report.summary.tableCount).toBe(6)
    expect(report.summary.foreignKeyCount).toBe(3)
    expect(report.summary.checkConstraintCount).toBe(1)

    // users must come before posts, posts before comments
    const usersIdx = report.insertOrder.indexOf('public.users')
    const postsIdx = report.insertOrder.indexOf('public.posts')
    const commentsIdx = report.insertOrder.indexOf('public.comments')
    expect(usersIdx).toBeLessThan(postsIdx)
    expect(postsIdx).toBeLessThan(commentsIdx)

    // comments has a check constraint reported
    const comments = report.tables.find((t) => t.name === 'comments')!
    expect(comments.checkConstraints).toHaveLength(1)
    expect(comments.checkConstraints[0].expression).toContain('length(body)')

    // users has 2 incoming FKs (posts + sessions)
    const users = report.tables.find((t) => t.name === 'users')!
    expect(users.incomingFKCount).toBeGreaterThanOrEqual(2)
  })

  it('formats a human-readable report', () => {
    const schema = buildBlogSchema()
    const report = inspectSchema(schema)
    const text = formatInspectReport(report)

    expect(text).toContain('seedforge schema inspection')
    expect(text).toContain('Insert order:')
    expect(text).toContain('public.users')
    expect(text).toContain('public.posts')
    expect(text).toContain('[PK')
    expect(text).toContain('length(body)')
  })
})
