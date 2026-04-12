import { describe, it, expect, vi, beforeEach } from 'vitest'
import type pg from 'pg'
import { NormalizedType, FKAction } from '../../types/index.js'
import type { EnumDef } from '../../types/index.js'
import { queryTables } from '../queries/tables.js'
import { queryPrimaryKeys } from '../queries/primary-keys.js'
import { queryForeignKeys } from '../queries/foreign-keys.js'
import { queryUniqueConstraints, queryIndexes } from '../queries/unique-indexes.js'
import { queryCheckConstraints } from '../queries/check-constraints.js'
import { queryEnums } from '../queries/enums.js'
import { parseArray } from '../queries/parse-array.js'

// ---------- mock pg client ----------
function createMockClient() {
  return { query: vi.fn() } as { query: ReturnType<typeof vi.fn> }
}

describe('parseArray', () => {
  it('returns JS arrays as-is', () => {
    expect(parseArray(['a', 'b'])).toEqual(['a', 'b'])
  })

  it('parses PG text array string "{a,b,c}"', () => {
    expect(parseArray('{a,b,c}')).toEqual(['a', 'b', 'c'])
  })

  it('returns empty array for non-string, non-array input', () => {
    expect(parseArray(null)).toEqual([])
    expect(parseArray(undefined)).toEqual([])
    expect(parseArray(42)).toEqual([])
  })

  it('returns empty array for empty PG array string "{}"', () => {
    expect(parseArray('{}')).toEqual([])
  })
})

describe('queryEnums', () => {
  let client: ReturnType<typeof createMockClient>

  beforeEach(() => {
    client = createMockClient()
  })

  it('returns a map of enum definitions', async () => {
    client.query.mockResolvedValueOnce({
      rows: [
        { enum_name: 'status', enum_schema: 'public', enum_values: ['active', 'inactive'] },
        { enum_name: 'role', enum_schema: 'public', enum_values: ['admin', 'user'] },
      ],
    })

    const enums = await queryEnums(client as unknown as pg.Client, 'public')

    expect(enums.size).toBe(2)
    expect(enums.get('status')).toEqual({
      name: 'status',
      schema: 'public',
      values: ['active', 'inactive'],
    })
    expect(enums.get('role')).toEqual({
      name: 'role',
      schema: 'public',
      values: ['admin', 'user'],
    })
  })

  it('passes the schema parameter to the SQL query', async () => {
    client.query.mockResolvedValueOnce({ rows: [] })

    await queryEnums(client as unknown as pg.Client, 'my_schema')

    expect(client.query).toHaveBeenCalledOnce()
    const [sql, params] = client.query.mock.calls[0]
    expect(params).toEqual(['my_schema'])
    expect(sql).toContain('pg_type')
    expect(sql).toContain('pg_enum')
  })

  it('returns empty map when no enums exist', async () => {
    client.query.mockResolvedValueOnce({ rows: [] })

    const enums = await queryEnums(client as unknown as pg.Client, 'public')

    expect(enums.size).toBe(0)
  })
})

describe('queryPrimaryKeys', () => {
  let client: ReturnType<typeof createMockClient>

  beforeEach(() => {
    client = createMockClient()
  })

  it('returns a map of primary key definitions keyed by table name', async () => {
    client.query.mockResolvedValueOnce({
      rows: [
        { table_name: 'users', constraint_name: 'users_pkey', columns: ['id'] },
        { table_name: 'orders', constraint_name: 'orders_pkey', columns: ['id'] },
      ],
    })

    const pks = await queryPrimaryKeys(client as unknown as pg.Client, 'public')

    expect(pks.size).toBe(2)
    expect(pks.get('users')).toEqual({ columns: ['id'], name: 'users_pkey' })
    expect(pks.get('orders')).toEqual({ columns: ['id'], name: 'orders_pkey' })
  })

  it('handles composite primary keys', async () => {
    client.query.mockResolvedValueOnce({
      rows: [
        {
          table_name: 'order_items',
          constraint_name: 'order_items_pkey',
          columns: ['order_id', 'product_id'],
        },
      ],
    })

    const pks = await queryPrimaryKeys(client as unknown as pg.Client, 'public')

    expect(pks.get('order_items')!.columns).toEqual(['order_id', 'product_id'])
  })

  it('handles PG text array string for columns', async () => {
    client.query.mockResolvedValueOnce({
      rows: [{ table_name: 'users', constraint_name: 'users_pkey', columns: '{id}' }],
    })

    const pks = await queryPrimaryKeys(client as unknown as pg.Client, 'public')

    expect(pks.get('users')!.columns).toEqual(['id'])
  })

  it('returns empty map when no tables have primary keys', async () => {
    client.query.mockResolvedValueOnce({ rows: [] })

    const pks = await queryPrimaryKeys(client as unknown as pg.Client, 'public')

    expect(pks.size).toBe(0)
  })
})

describe('queryForeignKeys', () => {
  let client: ReturnType<typeof createMockClient>

  beforeEach(() => {
    client = createMockClient()
  })

  it('returns a map of foreign key arrays keyed by table name', async () => {
    client.query.mockResolvedValueOnce({
      rows: [
        {
          table_name: 'orders',
          constraint_name: 'orders_user_id_fkey',
          columns: ['user_id'],
          referenced_table: 'users',
          referenced_schema: 'public',
          referenced_columns: ['id'],
          delete_action: 'a',
          update_action: 'a',
          is_deferrable: false,
          is_deferred: false,
        },
      ],
    })

    const fks = await queryForeignKeys(client as unknown as pg.Client, 'public')

    expect(fks.size).toBe(1)
    const orderFks = fks.get('orders')!
    expect(orderFks).toHaveLength(1)
    expect(orderFks[0]).toEqual({
      name: 'orders_user_id_fkey',
      columns: ['user_id'],
      referencedTable: 'users',
      referencedSchema: 'public',
      referencedColumns: ['id'],
      onDelete: FKAction.NO_ACTION,
      onUpdate: FKAction.NO_ACTION,
      isDeferrable: false,
      isDeferred: false,
      isVirtual: false,
    })
  })

  it('maps FK action codes correctly', async () => {
    client.query.mockResolvedValueOnce({
      rows: [
        {
          table_name: 'posts',
          constraint_name: 'posts_author_fkey',
          columns: ['author_id'],
          referenced_table: 'users',
          referenced_schema: 'public',
          referenced_columns: ['id'],
          delete_action: 'c',
          update_action: 'r',
          is_deferrable: true,
          is_deferred: true,
        },
      ],
    })

    const fks = await queryForeignKeys(client as unknown as pg.Client, 'public')
    const fk = fks.get('posts')![0]

    expect(fk.onDelete).toBe(FKAction.CASCADE)
    expect(fk.onUpdate).toBe(FKAction.RESTRICT)
    expect(fk.isDeferrable).toBe(true)
    expect(fk.isDeferred).toBe(true)
  })

  it('maps SET NULL and SET DEFAULT action codes', async () => {
    client.query.mockResolvedValueOnce({
      rows: [
        {
          table_name: 'comments',
          constraint_name: 'comments_post_fkey',
          columns: ['post_id'],
          referenced_table: 'posts',
          referenced_schema: 'public',
          referenced_columns: ['id'],
          delete_action: 'n',
          update_action: 'd',
          is_deferrable: false,
          is_deferred: false,
        },
      ],
    })

    const fks = await queryForeignKeys(client as unknown as pg.Client, 'public')
    const fk = fks.get('comments')![0]

    expect(fk.onDelete).toBe(FKAction.SET_NULL)
    expect(fk.onUpdate).toBe(FKAction.SET_DEFAULT)
  })

  it('defaults unknown action codes to NO_ACTION', async () => {
    client.query.mockResolvedValueOnce({
      rows: [
        {
          table_name: 'items',
          constraint_name: 'items_fkey',
          columns: ['ref_id'],
          referenced_table: 'refs',
          referenced_schema: 'public',
          referenced_columns: ['id'],
          delete_action: 'z',
          update_action: 'z',
          is_deferrable: false,
          is_deferred: false,
        },
      ],
    })

    const fks = await queryForeignKeys(client as unknown as pg.Client, 'public')
    const fk = fks.get('items')![0]

    expect(fk.onDelete).toBe(FKAction.NO_ACTION)
    expect(fk.onUpdate).toBe(FKAction.NO_ACTION)
  })

  it('groups multiple FKs under the same table', async () => {
    client.query.mockResolvedValueOnce({
      rows: [
        {
          table_name: 'orders',
          constraint_name: 'orders_user_fkey',
          columns: ['user_id'],
          referenced_table: 'users',
          referenced_schema: 'public',
          referenced_columns: ['id'],
          delete_action: 'a',
          update_action: 'a',
          is_deferrable: false,
          is_deferred: false,
        },
        {
          table_name: 'orders',
          constraint_name: 'orders_product_fkey',
          columns: ['product_id'],
          referenced_table: 'products',
          referenced_schema: 'public',
          referenced_columns: ['id'],
          delete_action: 'c',
          update_action: 'a',
          is_deferrable: false,
          is_deferred: false,
        },
      ],
    })

    const fks = await queryForeignKeys(client as unknown as pg.Client, 'public')

    expect(fks.get('orders')).toHaveLength(2)
  })
})

describe('queryUniqueConstraints', () => {
  let client: ReturnType<typeof createMockClient>

  beforeEach(() => {
    client = createMockClient()
  })

  it('returns a map of unique constraint arrays keyed by table name', async () => {
    client.query.mockResolvedValueOnce({
      rows: [{ table_name: 'users', constraint_name: 'users_email_key', columns: ['email'] }],
    })

    const ucs = await queryUniqueConstraints(client as unknown as pg.Client, 'public')

    expect(ucs.size).toBe(1)
    expect(ucs.get('users')![0]).toEqual({
      columns: ['email'],
      name: 'users_email_key',
    })
  })

  it('returns empty map when no unique constraints exist', async () => {
    client.query.mockResolvedValueOnce({ rows: [] })

    const ucs = await queryUniqueConstraints(client as unknown as pg.Client, 'public')

    expect(ucs.size).toBe(0)
  })
})

describe('queryIndexes', () => {
  let client: ReturnType<typeof createMockClient>

  beforeEach(() => {
    client = createMockClient()
  })

  it('returns a map of index arrays keyed by table name', async () => {
    client.query.mockResolvedValueOnce({
      rows: [
        { table_name: 'users', index_name: 'idx_users_name', columns: ['name'], is_unique: false },
        { table_name: 'users', index_name: 'idx_users_email', columns: ['email'], is_unique: true },
      ],
    })

    const indexes = await queryIndexes(client as unknown as pg.Client, 'public')

    expect(indexes.size).toBe(1)
    const userIndexes = indexes.get('users')!
    expect(userIndexes).toHaveLength(2)
    expect(userIndexes[0]).toEqual({ columns: ['name'], name: 'idx_users_name', isUnique: false })
    expect(userIndexes[1]).toEqual({ columns: ['email'], name: 'idx_users_email', isUnique: true })
  })

  it('returns empty map when no indexes exist', async () => {
    client.query.mockResolvedValueOnce({ rows: [] })

    const indexes = await queryIndexes(client as unknown as pg.Client, 'public')

    expect(indexes.size).toBe(0)
  })
})

describe('queryCheckConstraints', () => {
  let client: ReturnType<typeof createMockClient>

  beforeEach(() => {
    client = createMockClient()
  })

  it('returns a map of check constraint arrays keyed by table name', async () => {
    client.query.mockResolvedValueOnce({
      rows: [
        {
          table_name: 'users',
          constraint_name: 'users_age_check',
          expression: 'CHECK ((age > 0))',
        },
      ],
    })

    const checks = await queryCheckConstraints(client as unknown as pg.Client, 'public')

    expect(checks.size).toBe(1)
    const userChecks = checks.get('users')!
    expect(userChecks).toHaveLength(1)
    expect(userChecks[0].name).toBe('users_age_check')
    expect(userChecks[0].expression).toBe('CHECK ((age > 0))')
    expect(userChecks[0].inferredValues).toBeNull()
  })

  it('extracts inferred enum values from check constraints', async () => {
    client.query.mockResolvedValueOnce({
      rows: [
        {
          table_name: 'orders',
          constraint_name: 'orders_status_check',
          expression: "CHECK ((status = ANY (ARRAY['pending'::text, 'shipped'::text])))",
        },
      ],
    })

    const checks = await queryCheckConstraints(client as unknown as pg.Client, 'public')
    const orderChecks = checks.get('orders')!

    expect(orderChecks[0].inferredValues).toEqual(['pending', 'shipped'])
  })

  it('returns empty map when no check constraints exist', async () => {
    client.query.mockResolvedValueOnce({ rows: [] })

    const checks = await queryCheckConstraints(client as unknown as pg.Client, 'public')

    expect(checks.size).toBe(0)
  })
})

describe('queryTables', () => {
  let client: ReturnType<typeof createMockClient>
  const emptyEnumMap = new Map<string, EnumDef>()

  beforeEach(() => {
    client = createMockClient()
  })

  it('throws noTablesFound when schema has no tables', async () => {
    client.query.mockResolvedValueOnce({ rows: [] })

    await expect(
      queryTables(client as unknown as pg.Client, 'empty_schema', emptyEnumMap),
    ).rejects.toThrow('No tables found in schema "empty_schema"')
  })

  it('returns a map of table definitions with columns', async () => {
    // First call: tables query
    client.query.mockResolvedValueOnce({
      rows: [{ table_name: 'users', table_comment: 'User accounts' }],
    })
    // Second call: columns query
    client.query.mockResolvedValueOnce({
      rows: [
        {
          table_name: 'users',
          column_name: 'id',
          data_type: 'integer',
          udt_name: 'int4',
          is_nullable: 'NO',
          column_default: "nextval('users_id_seq'::regclass)",
          character_maximum_length: null,
          numeric_precision: 32,
          numeric_scale: 0,
          is_identity: 'NO',
          identity_generation: null,
          is_generated: 'NEVER',
          generation_expression: null,
          column_comment: null,
        },
        {
          table_name: 'users',
          column_name: 'email',
          data_type: 'character varying',
          udt_name: 'varchar',
          is_nullable: 'NO',
          column_default: null,
          character_maximum_length: 255,
          numeric_precision: null,
          numeric_scale: null,
          is_identity: 'NO',
          identity_generation: null,
          is_generated: 'NEVER',
          generation_expression: null,
          column_comment: 'User email address',
        },
      ],
    })

    const tables = await queryTables(client as unknown as pg.Client, 'public', emptyEnumMap)

    expect(tables.size).toBe(1)
    const usersTable = tables.get('users')!
    expect(usersTable.name).toBe('users')
    expect(usersTable.schema).toBe('public')
    expect(usersTable.comment).toBe('User accounts')
    expect(usersTable.primaryKey).toBeNull()
    expect(usersTable.foreignKeys).toEqual([])
    expect(usersTable.columns.size).toBe(2)

    const idCol = usersTable.columns.get('id')!
    expect(idCol.dataType).toBe(NormalizedType.INTEGER)
    expect(idCol.isNullable).toBe(false)
    expect(idCol.isAutoIncrement).toBe(true)
    expect(idCol.hasDefault).toBe(true)

    const emailCol = usersTable.columns.get('email')!
    expect(emailCol.dataType).toBe(NormalizedType.VARCHAR)
    expect(emailCol.maxLength).toBe(255)
    expect(emailCol.isNullable).toBe(false)
    expect(emailCol.hasDefault).toBe(false)
    expect(emailCol.comment).toBe('User email address')
  })

  it('resolves enum columns using the enum map', async () => {
    const enumMap = new Map<string, EnumDef>([
      ['status_type', { name: 'status_type', schema: 'public', values: ['active', 'inactive'] }],
    ])

    client.query.mockResolvedValueOnce({
      rows: [{ table_name: 'accounts', table_comment: null }],
    })
    client.query.mockResolvedValueOnce({
      rows: [
        {
          table_name: 'accounts',
          column_name: 'status',
          data_type: 'USER-DEFINED',
          udt_name: 'status_type',
          is_nullable: 'YES',
          column_default: null,
          character_maximum_length: null,
          numeric_precision: null,
          numeric_scale: null,
          is_identity: 'NO',
          identity_generation: null,
          is_generated: 'NEVER',
          generation_expression: null,
          column_comment: null,
        },
      ],
    })

    const tables = await queryTables(client as unknown as pg.Client, 'public', enumMap)
    const statusCol = tables.get('accounts')!.columns.get('status')!

    expect(statusCol.dataType).toBe(NormalizedType.ENUM)
    expect(statusCol.enumValues).toEqual(['active', 'inactive'])
    expect(statusCol.isNullable).toBe(true)
  })

  it('marks identity columns as generated', async () => {
    client.query.mockResolvedValueOnce({
      rows: [{ table_name: 'items', table_comment: null }],
    })
    client.query.mockResolvedValueOnce({
      rows: [
        {
          table_name: 'items',
          column_name: 'id',
          data_type: 'integer',
          udt_name: 'int4',
          is_nullable: 'NO',
          column_default: null,
          character_maximum_length: null,
          numeric_precision: 32,
          numeric_scale: 0,
          is_identity: 'YES',
          identity_generation: 'ALWAYS',
          is_generated: 'NEVER',
          generation_expression: null,
          column_comment: null,
        },
      ],
    })

    const tables = await queryTables(client as unknown as pg.Client, 'public', emptyEnumMap)
    const idCol = tables.get('items')!.columns.get('id')!

    expect(idCol.isGenerated).toBe(true)
    expect(idCol.hasDefault).toBe(true)
  })

  it('handles a table with no columns gracefully', async () => {
    client.query.mockResolvedValueOnce({
      rows: [{ table_name: 'empty_table', table_comment: null }],
    })
    client.query.mockResolvedValueOnce({ rows: [] })

    const tables = await queryTables(client as unknown as pg.Client, 'public', emptyEnumMap)

    expect(tables.size).toBe(1)
    const emptyTable = tables.get('empty_table')!
    expect(emptyTable.columns.size).toBe(0)
  })
})
