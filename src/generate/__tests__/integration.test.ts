import { describe, it, expect } from 'vitest'
import { generate } from '../generate.js'
import { buildInsertPlan } from '../../graph/plan.js'
import type {
  DatabaseSchema,
  TableDef,
  ColumnDef,
  ForeignKeyDef,
} from '../../types/schema.js'
import { NormalizedType, FKAction } from '../../types/schema.js'

function makeColumn(
  name: string,
  overrides: Partial<ColumnDef> = {},
): ColumnDef {
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

function makeFK(
  name: string,
  columns: string[],
  referencedTable: string,
  overrides: Partial<ForeignKeyDef> = {},
): ForeignKeyDef {
  return {
    name,
    columns,
    referencedTable,
    referencedSchema: 'public',
    referencedColumns: ['id'],
    onDelete: FKAction.NO_ACTION,
    onUpdate: FKAction.NO_ACTION,
    isDeferrable: false,
    isDeferred: false,
    isVirtual: false,
    ...overrides,
  }
}

function makeTable(
  name: string,
  columns: Map<string, ColumnDef>,
  foreignKeys: ForeignKeyDef[] = [],
  overrides: Partial<TableDef> = {},
): TableDef {
  return {
    name,
    schema: 'public',
    columns,
    primaryKey: { columns: ['id'], name: `${name}_pkey` },
    foreignKeys,
    uniqueConstraints: [],
    checkConstraints: [],
    indexes: [],
    comment: null,
    ...overrides,
  }
}

function makeSchema(tables: TableDef[]): DatabaseSchema {
  const tableMap = new Map<string, TableDef>()
  for (const table of tables) {
    tableMap.set(`${table.schema}.${table.name}`, table)
  }
  return {
    name: 'test_db',
    tables: tableMap,
    enums: new Map(),
    schemas: ['public'],
  }
}

describe('Integration: Blog schema', () => {
  const schema = makeSchema([
    makeTable(
      'users',
      new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
        ['username', makeColumn('username', { dataType: NormalizedType.VARCHAR, maxLength: 50 })],
        ['email', makeColumn('email', { dataType: NormalizedType.VARCHAR, maxLength: 100 })],
        ['created_at', makeColumn('created_at', { dataType: NormalizedType.TIMESTAMPTZ })],
        ['updated_at', makeColumn('updated_at', { dataType: NormalizedType.TIMESTAMPTZ })],
      ]),
      [],
      {
        uniqueConstraints: [
          { columns: ['username'], name: 'users_username_key' },
          { columns: ['email'], name: 'users_email_key' },
        ],
      },
    ),
    makeTable(
      'posts',
      new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
        ['user_id', makeColumn('user_id', { dataType: NormalizedType.UUID })],
        ['title', makeColumn('title', { dataType: NormalizedType.VARCHAR, maxLength: 200 })],
        ['body', makeColumn('body', { dataType: NormalizedType.TEXT })],
        ['status', makeColumn('status', {
          dataType: NormalizedType.ENUM,
          enumValues: ['draft', 'published', 'archived'],
        })],
        ['created_at', makeColumn('created_at', { dataType: NormalizedType.TIMESTAMPTZ })],
      ]),
      [makeFK('posts_user_fk', ['user_id'], 'users', { referencedColumns: ['id'] })],
    ),
    makeTable(
      'comments',
      new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
        ['post_id', makeColumn('post_id', { dataType: NormalizedType.UUID })],
        ['user_id', makeColumn('user_id', { dataType: NormalizedType.UUID })],
        ['body', makeColumn('body', { dataType: NormalizedType.TEXT })],
        ['created_at', makeColumn('created_at', { dataType: NormalizedType.TIMESTAMPTZ })],
      ]),
      [
        makeFK('comments_post_fk', ['post_id'], 'posts', { referencedColumns: ['id'] }),
        makeFK('comments_user_fk', ['user_id'], 'users', { referencedColumns: ['id'] }),
      ],
    ),
    makeTable(
      'tags',
      new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
        ['name', makeColumn('name', { dataType: NormalizedType.VARCHAR, maxLength: 50 })],
      ]),
      [],
      {
        uniqueConstraints: [{ columns: ['name'], name: 'tags_name_key' }],
      },
    ),
    makeTable(
      'post_tags',
      new Map([
        ['post_id', makeColumn('post_id', { dataType: NormalizedType.UUID })],
        ['tag_id', makeColumn('tag_id', { dataType: NormalizedType.UUID })],
      ]),
      [
        makeFK('pt_post_fk', ['post_id'], 'posts', { referencedColumns: ['id'] }),
        makeFK('pt_tag_fk', ['tag_id'], 'tags', { referencedColumns: ['id'] }),
      ],
      {
        primaryKey: { columns: ['post_id', 'tag_id'], name: 'post_tags_pkey' },
      },
    ),
  ])

  it('generates all tables in correct order', async () => {
    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 10,
      seed: 42,
    })

    const tableOrder = [...result.tables.keys()]
    const usersIdx = tableOrder.indexOf('public.users')
    const postsIdx = tableOrder.indexOf('public.posts')
    const commentsIdx = tableOrder.indexOf('public.comments')
    const tagsIdx = tableOrder.indexOf('public.tags')
    const postTagsIdx = tableOrder.indexOf('public.post_tags')

    expect(usersIdx).toBeLessThan(postsIdx)
    expect(postsIdx).toBeLessThan(commentsIdx)
    expect(tagsIdx).toBeLessThan(postTagsIdx)
    expect(postsIdx).toBeLessThan(postTagsIdx)
  })

  it('comments.user_id and comments.post_id reference valid PKs', async () => {
    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 10,
      seed: 42,
    })

    const userPKs = new Set(
      result.tables.get('public.users')!.generatedPKs.map((pk) => pk[0]),
    )
    const postPKs = new Set(
      result.tables.get('public.posts')!.generatedPKs.map((pk) => pk[0]),
    )

    for (const row of result.tables.get('public.comments')!.rows) {
      expect(userPKs.has(row.user_id)).toBe(true)
      expect(postPKs.has(row.post_id)).toBe(true)
    }
  })

  it('users.username and users.email are unique', async () => {
    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 20,
      seed: 42,
    })

    const users = result.tables.get('public.users')!.rows
    const usernames = users.map((r) => r.username)
    const emails = users.map((r) => r.email)

    expect(new Set(usernames).size).toBe(usernames.length)
    expect(new Set(emails).size).toBe(emails.length)
  })

  it('users.created_at < users.updated_at', async () => {
    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 10,
      seed: 42,
    })

    for (const row of result.tables.get('public.users')!.rows) {
      const created = row.created_at as Date
      const updated = row.updated_at as Date
      expect(created.getTime()).toBeLessThanOrEqual(updated.getTime())
    }
  })

  it('posts.status is a valid enum value', async () => {
    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 10,
      seed: 42,
    })

    for (const row of result.tables.get('public.posts')!.rows) {
      expect(['draft', 'published', 'archived']).toContain(row.status)
    }
  })
})

describe('Integration: Self-referencing categories', () => {
  const schema = makeSchema([
    makeTable(
      'categories',
      new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
        ['name', makeColumn('name', { dataType: NormalizedType.VARCHAR })],
        ['parent_id', makeColumn('parent_id', {
          dataType: NormalizedType.UUID,
          isNullable: true,
        })],
      ]),
      [makeFK('cat_parent_fk', ['parent_id'], 'categories', {
        referencedColumns: ['id'],
      })],
    ),
    makeTable(
      'products',
      new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
        ['category_id', makeColumn('category_id', { dataType: NormalizedType.UUID })],
        ['name', makeColumn('name', { dataType: NormalizedType.VARCHAR })],
        ['price', makeColumn('price', {
          dataType: NormalizedType.DECIMAL,
          numericPrecision: 10,
          numericScale: 2,
        })],
      ]),
      [makeFK('products_cat_fk', ['category_id'], 'categories', {
        referencedColumns: ['id'],
      })],
    ),
  ])

  it('categories generated with NULL parent_id initially', async () => {
    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 20,
      seed: 42,
    })

    for (const row of result.tables.get('public.categories')!.rows) {
      expect(row.parent_id).toBeNull()
    }
  })

  it('deferred updates populate parent_id with valid IDs', async () => {
    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 20,
      seed: 42,
    })

    const catPKs = new Set(
      result.tables.get('public.categories')!.generatedPKs.map((pk) => String(pk[0])),
    )

    const catUpdates = result.deferredUpdates.filter(
      (u) => u.tableName === 'public.categories',
    )
    expect(catUpdates.length).toBeGreaterThan(0)

    for (const update of catUpdates) {
      expect(catPKs.has(String(update.setValues[0]))).toBe(true)
    }
  })

  it('~15% of categories remain root nodes', async () => {
    const plan = buildInsertPlan(schema)
    const rowCount = 40
    const result = await generate(schema, plan, null, {
      globalRowCount: rowCount,
      seed: 42,
    })

    const catUpdates = result.deferredUpdates.filter(
      (u) => u.tableName === 'public.categories',
    )

    const rootCount = rowCount - catUpdates.length
    // 15% of 40 = 6, allow some tolerance
    expect(rootCount).toBeGreaterThanOrEqual(3)
    expect(rootCount).toBeLessThanOrEqual(12)
  })

  it('no category directly references itself', async () => {
    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 20,
      seed: 42,
    })

    const catUpdates = result.deferredUpdates.filter(
      (u) => u.tableName === 'public.categories',
    )

    for (const update of catUpdates) {
      expect(String(update.pkValues[0])).not.toBe(String(update.setValues[0]))
    }
  })

  it('products.category_id references valid category IDs', async () => {
    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 10,
      seed: 42,
    })

    const catPKs = new Set(
      result.tables.get('public.categories')!.generatedPKs.map((pk) => pk[0]),
    )

    for (const row of result.tables.get('public.products')!.rows) {
      expect(catPKs.has(row.category_id)).toBe(true)
    }
  })
})

describe('Integration: Cycle (orders <-> invoices)', () => {
  const schema = makeSchema([
    makeTable('customers', new Map([
      ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
      ['name', makeColumn('name', { dataType: NormalizedType.VARCHAR })],
    ])),
    makeTable(
      'orders',
      new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
        ['customer_id', makeColumn('customer_id', { dataType: NormalizedType.UUID })],
        ['invoice_id', makeColumn('invoice_id', {
          dataType: NormalizedType.UUID,
          isNullable: true,
        })],
      ]),
      [
        makeFK('orders_customer_fk', ['customer_id'], 'customers', {
          referencedColumns: ['id'],
        }),
        makeFK('orders_invoice_fk', ['invoice_id'], 'invoices', {
          referencedColumns: ['id'],
        }),
      ],
    ),
    makeTable(
      'invoices',
      new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
        ['order_id', makeColumn('order_id', { dataType: NormalizedType.UUID })],
      ]),
      [makeFK('invoices_order_fk', ['order_id'], 'orders', {
        referencedColumns: ['id'],
      })],
    ),
  ])

  it('cycle is broken: orders.invoice_id is NULL in rows', async () => {
    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 5,
      seed: 42,
    })

    // The cycle should have been broken at orders.invoice_id
    for (const row of result.tables.get('public.orders')!.rows) {
      expect(row.invoice_id).toBeNull()
    }
  })

  it('deferred updates set orders.invoice_id to valid invoice IDs', async () => {
    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 5,
      seed: 42,
    })

    const invoicePKs = new Set(
      result.tables.get('public.invoices')!.generatedPKs.map((pk) => String(pk[0])),
    )

    const orderUpdates = result.deferredUpdates.filter(
      (u) => u.tableName === 'public.orders',
    )
    expect(orderUpdates.length).toBeGreaterThan(0)

    for (const update of orderUpdates) {
      expect(invoicePKs.has(String(update.setValues[0]))).toBe(true)
    }
  })

  it('invoices.order_id references valid order IDs', async () => {
    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 5,
      seed: 42,
    })

    const orderPKs = new Set(
      result.tables.get('public.orders')!.generatedPKs.map((pk) => pk[0]),
    )

    for (const row of result.tables.get('public.invoices')!.rows) {
      expect(orderPKs.has(row.order_id)).toBe(true)
    }
  })
})

describe('Integration: Large e-commerce schema', () => {
  const schema = makeSchema([
    makeTable('users', new Map([
      ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
      ['username', makeColumn('username', { dataType: NormalizedType.VARCHAR })],
      ['email', makeColumn('email', { dataType: NormalizedType.VARCHAR })],
    ]), [], {
      uniqueConstraints: [
        { columns: ['username'], name: 'users_username_key' },
        { columns: ['email'], name: 'users_email_key' },
      ],
    }),
    makeTable('profiles', new Map([
      ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
      ['user_id', makeColumn('user_id', { dataType: NormalizedType.UUID })],
      ['bio', makeColumn('bio', { dataType: NormalizedType.TEXT, isNullable: true })],
    ]), [makeFK('profiles_user_fk', ['user_id'], 'users', { referencedColumns: ['id'] })]),
    makeTable(
      'categories',
      new Map([
        ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
        ['name', makeColumn('name', { dataType: NormalizedType.VARCHAR })],
        ['parent_id', makeColumn('parent_id', { dataType: NormalizedType.UUID, isNullable: true })],
      ]),
      [makeFK('cat_parent_fk', ['parent_id'], 'categories', { referencedColumns: ['id'] })],
    ),
    makeTable('products', new Map([
      ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
      ['category_id', makeColumn('category_id', { dataType: NormalizedType.UUID })],
      ['name', makeColumn('name', { dataType: NormalizedType.VARCHAR })],
      ['price', makeColumn('price', { dataType: NormalizedType.DECIMAL, numericPrecision: 10, numericScale: 2 })],
    ]), [makeFK('products_cat_fk', ['category_id'], 'categories', { referencedColumns: ['id'] })]),
    makeTable('orders', new Map([
      ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
      ['user_id', makeColumn('user_id', { dataType: NormalizedType.UUID })],
      ['status', makeColumn('status', { dataType: NormalizedType.VARCHAR })],
      ['created_at', makeColumn('created_at', { dataType: NormalizedType.TIMESTAMPTZ })],
    ]), [makeFK('orders_user_fk', ['user_id'], 'users', { referencedColumns: ['id'] })]),
    makeTable('order_items', new Map([
      ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
      ['order_id', makeColumn('order_id', { dataType: NormalizedType.UUID })],
      ['product_id', makeColumn('product_id', { dataType: NormalizedType.UUID })],
      ['quantity', makeColumn('quantity', { dataType: NormalizedType.INTEGER })],
    ]), [
      makeFK('oi_order_fk', ['order_id'], 'orders', { referencedColumns: ['id'] }),
      makeFK('oi_product_fk', ['product_id'], 'products', { referencedColumns: ['id'] }),
    ]),
    makeTable('payments', new Map([
      ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
      ['order_id', makeColumn('order_id', { dataType: NormalizedType.UUID })],
      ['amount', makeColumn('amount', { dataType: NormalizedType.DECIMAL, numericPrecision: 10, numericScale: 2 })],
    ]), [makeFK('payments_order_fk', ['order_id'], 'orders', { referencedColumns: ['id'] })]),
    makeTable('shipping_addresses', new Map([
      ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
      ['user_id', makeColumn('user_id', { dataType: NormalizedType.UUID })],
      ['address', makeColumn('address', { dataType: NormalizedType.TEXT })],
    ]), [makeFK('shipping_user_fk', ['user_id'], 'users', { referencedColumns: ['id'] })]),
    makeTable('reviews', new Map([
      ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
      ['user_id', makeColumn('user_id', { dataType: NormalizedType.UUID })],
      ['product_id', makeColumn('product_id', { dataType: NormalizedType.UUID })],
      ['rating', makeColumn('rating', { dataType: NormalizedType.SMALLINT })],
      ['body', makeColumn('body', { dataType: NormalizedType.TEXT, isNullable: true })],
    ]), [
      makeFK('reviews_user_fk', ['user_id'], 'users', { referencedColumns: ['id'] }),
      makeFK('reviews_product_fk', ['product_id'], 'products', { referencedColumns: ['id'] }),
    ]),
    makeTable('wishlists', new Map([
      ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
      ['user_id', makeColumn('user_id', { dataType: NormalizedType.UUID })],
      ['product_id', makeColumn('product_id', { dataType: NormalizedType.UUID })],
    ]), [
      makeFK('wishlists_user_fk', ['user_id'], 'users', { referencedColumns: ['id'] }),
      makeFK('wishlists_product_fk', ['product_id'], 'products', { referencedColumns: ['id'] }),
    ]),
    makeTable('coupons', new Map([
      ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
      ['code', makeColumn('code', { dataType: NormalizedType.VARCHAR })],
      ['discount', makeColumn('discount', { dataType: NormalizedType.DECIMAL, numericPrecision: 5, numericScale: 2 })],
    ]), [], {
      uniqueConstraints: [{ columns: ['code'], name: 'coupons_code_key' }],
    }),
    makeTable('coupon_usages', new Map([
      ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
      ['coupon_id', makeColumn('coupon_id', { dataType: NormalizedType.UUID })],
      ['user_id', makeColumn('user_id', { dataType: NormalizedType.UUID })],
      ['order_id', makeColumn('order_id', { dataType: NormalizedType.UUID })],
    ]), [
      makeFK('cu_coupon_fk', ['coupon_id'], 'coupons', { referencedColumns: ['id'] }),
      makeFK('cu_user_fk', ['user_id'], 'users', { referencedColumns: ['id'] }),
      makeFK('cu_order_fk', ['order_id'], 'orders', { referencedColumns: ['id'] }),
    ]),
    makeTable('product_images', new Map([
      ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
      ['product_id', makeColumn('product_id', { dataType: NormalizedType.UUID })],
      ['url', makeColumn('url', { dataType: NormalizedType.VARCHAR })],
    ]), [makeFK('pi_product_fk', ['product_id'], 'products', { referencedColumns: ['id'] })]),
    makeTable('inventory', new Map([
      ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
      ['product_id', makeColumn('product_id', { dataType: NormalizedType.UUID })],
      ['quantity', makeColumn('quantity', { dataType: NormalizedType.INTEGER })],
    ]), [makeFK('inv_product_fk', ['product_id'], 'products', { referencedColumns: ['id'] })]),
    makeTable('audit_log', new Map([
      ['id', makeColumn('id', { dataType: NormalizedType.UUID })],
      ['user_id', makeColumn('user_id', { dataType: NormalizedType.UUID })],
      ['action', makeColumn('action', { dataType: NormalizedType.VARCHAR })],
      ['created_at', makeColumn('created_at', { dataType: NormalizedType.TIMESTAMPTZ })],
      ['data', makeColumn('data', { dataType: NormalizedType.JSONB, isNullable: true })],
    ]), [makeFK('audit_user_fk', ['user_id'], 'users', { referencedColumns: ['id'] })]),
  ])

  it('generates all 15 tables with valid FK references', async () => {
    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 10,
      seed: 42,
    })

    expect(result.tables.size).toBe(15)

    // Validate FK references for key tables
    const userPKs = new Set(
      result.tables.get('public.users')!.generatedPKs.map((pk) => pk[0]),
    )
    const productPKs = new Set(
      result.tables.get('public.products')!.generatedPKs.map((pk) => pk[0]),
    )
    const orderPKs = new Set(
      result.tables.get('public.orders')!.generatedPKs.map((pk) => pk[0]),
    )

    for (const row of result.tables.get('public.order_items')!.rows) {
      expect(orderPKs.has(row.order_id)).toBe(true)
      expect(productPKs.has(row.product_id)).toBe(true)
    }

    for (const row of result.tables.get('public.reviews')!.rows) {
      expect(userPKs.has(row.user_id)).toBe(true)
      expect(productPKs.has(row.product_id)).toBe(true)
    }
  })

  it('no unique constraint violations', async () => {
    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 20,
      seed: 42,
    })

    const usernames = result.tables
      .get('public.users')!
      .rows.map((r) => r.username)
    expect(new Set(usernames).size).toBe(usernames.length)

    const emails = result.tables
      .get('public.users')!
      .rows.map((r) => r.email)
    expect(new Set(emails).size).toBe(emails.length)

    const codes = result.tables
      .get('public.coupons')!
      .rows.map((r) => r.code)
    expect(new Set(codes).size).toBe(codes.length)
  })

  it('total rows = sum of per-table counts', async () => {
    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 5,
      seed: 42,
    })

    let totalRows = 0
    for (const [, tableResult] of result.tables) {
      totalRows += tableResult.rows.length
    }
    expect(totalRows).toBe(15 * 5) // 15 tables, 5 rows each
  })

  it('completes in under 5 seconds', async () => {
    const plan = buildInsertPlan(schema)
    const start = Date.now()
    await generate(schema, plan, null, {
      globalRowCount: 10,
      seed: 42,
    })
    const elapsed = Date.now() - start
    expect(elapsed).toBeLessThan(5000)
  })
})
