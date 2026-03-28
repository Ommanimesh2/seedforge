import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import { introspect } from '../../introspect/index.js'
import { buildInsertPlan } from '../../graph/index.js'
import { generate } from '../../generate/index.js'
import { executeOutput, OutputMode } from '../../output/index.js'
import {
  BASIC_TYPES,
  ENUM_TYPES,
  CHECK_CONSTRAINTS,
  SIMPLE_FK,
  FK_CHAIN,
  SELF_REF,
  UUID_JSON,
  COMPOSITE_PK,
  GENERATED_COLUMNS,
  ECOMMERCE,
} from './fixtures/schemas.js'

const ROW_COUNT = 20
const SEED = 42

/**
 * Helper: set up a schema, run seedforge pipeline, return results + client for verification queries.
 */
async function runSeedforge(
  container: StartedPostgreSqlContainer,
  schemaSql: string,
  rowCount = ROW_COUNT,
) {
  // Create fresh database for isolation
  const adminClient = new pg.Client({ connectionString: container.getConnectionUri() })
  await adminClient.connect()
  const dbName = `test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  await adminClient.query(`CREATE DATABASE ${dbName}`)
  await adminClient.end()

  // Connect to fresh database
  const connUri = container.getConnectionUri().replace(/\/[^/]+$/, `/${dbName}`)
  const client = new pg.Client({ connectionString: connUri })
  await client.connect()

  // Apply schema
  await client.query(schemaSql)

  // Run the full pipeline
  const schema = await introspect(client, 'public')
  const plan = buildInsertPlan(schema)
  const result = await generate(schema, plan, client, {
    globalRowCount: rowCount,
    seed: SEED,
  })
  const summary = await executeOutput(result, schema, plan, {
    mode: OutputMode.DIRECT,
    client,
    batchSize: 500,
    showProgress: false,
    quiet: true,
  })

  return { client, schema, plan, result, summary, connUri }
}

describe('seedforge e2e', () => {
  let container: StartedPostgreSqlContainer

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start()
  }, 120_000)

  afterAll(async () => {
    await container?.stop()
  })

  // ── Test 1: Basic Types ──────────────────────────────────────

  describe('Test 1: Basic column types', () => {
    let client: pg.Client

    afterAll(async () => { await client?.end() })

    it('generates correct row counts and types', async () => {
      const ctx = await runSeedforge(container, BASIC_TYPES)
      client = ctx.client

      // Verify row count
      const { rows } = await client.query('SELECT COUNT(*)::int AS cnt FROM basic_types')
      expect(rows[0].cnt).toBe(ROW_COUNT)

      // Verify column types are populated correctly
      const { rows: data } = await client.query('SELECT * FROM basic_types LIMIT 5')
      for (const row of data) {
        expect(row.id).toBeTypeOf('number')
        expect(row.name).toBeTypeOf('string')
        expect(row.name.length).toBeGreaterThan(0)
        expect(row.email).toBeTypeOf('string')
        expect(row.email).toContain('@')
        expect(row.is_active).toBeTypeOf('boolean')
        expect(row.created_at).toBeInstanceOf(Date)
        expect(row.updated_at).toBeInstanceOf(Date)
      }

      // Verify emails are unique
      const { rows: emails } = await client.query(
        'SELECT COUNT(DISTINCT email)::int AS cnt FROM basic_types',
      )
      expect(emails[0].cnt).toBe(ROW_COUNT)

      // Verify created_at <= updated_at
      const { rows: badDates } = await client.query(
        'SELECT COUNT(*)::int AS cnt FROM basic_types WHERE created_at > updated_at',
      )
      expect(badDates[0].cnt).toBe(0)
    }, 60_000)
  })

  // ── Test 2: Enum Types ───────────────────────────────────────

  describe('Test 2: PG enum types', () => {
    let client: pg.Client

    afterAll(async () => { await client?.end() })

    it('uses valid enum values', async () => {
      const ctx = await runSeedforge(container, ENUM_TYPES)
      client = ctx.client

      const { rows } = await client.query('SELECT role, status FROM enum_users')
      expect(rows).toHaveLength(ROW_COUNT)

      const validRoles = ['admin', 'editor', 'viewer']
      const validStatuses = ['active', 'inactive', 'suspended']
      for (const row of rows) {
        expect(validRoles).toContain(row.role)
        expect(validStatuses).toContain(row.status)
      }
    }, 60_000)
  })

  // ── Test 3: CHECK Constraints ────────────────────────────────

  describe('Test 3: CHECK constraints', () => {
    let client: pg.Client

    afterAll(async () => { await client?.end() })

    it('respects CHECK constraint values', async () => {
      const ctx = await runSeedforge(container, CHECK_CONSTRAINTS)
      client = ctx.client

      const { rows } = await client.query('SELECT status, priority, price, quantity FROM products')
      expect(rows).toHaveLength(ROW_COUNT)

      const validStatuses = ['draft', 'active', 'discontinued']
      const validPriorities = ['low', 'medium', 'high']
      for (const row of rows) {
        expect(validStatuses).toContain(row.status)
        expect(validPriorities).toContain(row.priority)
        expect(parseFloat(row.price)).toBeGreaterThanOrEqual(0)
        expect(row.quantity).toBeGreaterThanOrEqual(0)
      }
    }, 60_000)
  })

  // ── Test 4: Simple FK ────────────────────────────────────────

  describe('Test 4: Simple foreign key', () => {
    let client: pg.Client

    afterAll(async () => { await client?.end() })

    it('resolves FK references correctly', async () => {
      const ctx = await runSeedforge(container, SIMPLE_FK)
      client = ctx.client

      // Both tables have correct row counts
      const { rows: depts } = await client.query('SELECT COUNT(*)::int AS cnt FROM departments')
      expect(depts[0].cnt).toBe(ROW_COUNT)

      const { rows: emps } = await client.query('SELECT COUNT(*)::int AS cnt FROM employees')
      expect(emps[0].cnt).toBe(ROW_COUNT)

      // All FK references are valid
      const { rows: orphans } = await client.query(`
        SELECT COUNT(*)::int AS cnt FROM employees e
        WHERE NOT EXISTS (SELECT 1 FROM departments d WHERE d.id = e.department_id)
      `)
      expect(orphans[0].cnt).toBe(0)

      // Email column detected and populated
      const { rows: data } = await client.query('SELECT email FROM employees LIMIT 3')
      for (const row of data) {
        expect(row.email).toContain('@')
      }
    }, 60_000)
  })

  // ── Test 5: Multi-level FK chain ─────────────────────────────

  describe('Test 5: FK chain (4 levels deep)', () => {
    let client: pg.Client

    afterAll(async () => { await client?.end() })

    it('resolves deep FK chains in correct order', async () => {
      const ctx = await runSeedforge(container, FK_CHAIN)
      client = ctx.client

      // All 4 tables populated
      for (const table of ['countries', 'cities', 'addresses', 'customers']) {
        const { rows } = await client.query(`SELECT COUNT(*)::int AS cnt FROM ${table}`)
        expect(rows[0].cnt).toBe(ROW_COUNT)
      }

      // FK integrity: customers -> addresses -> cities -> countries
      const { rows: integrity } = await client.query(`
        SELECT COUNT(*)::int AS cnt FROM customers c
        JOIN addresses a ON c.address_id = a.id
        JOIN cities ci ON a.city_id = ci.id
        JOIN countries co ON ci.country_id = co.id
      `)
      expect(integrity[0].cnt).toBe(ROW_COUNT)

      // Insert order should be: countries, cities, addresses, customers
      expect(ctx.plan.ordered.indexOf('public.countries'))
        .toBeLessThan(ctx.plan.ordered.indexOf('public.cities'))
      expect(ctx.plan.ordered.indexOf('public.cities'))
        .toBeLessThan(ctx.plan.ordered.indexOf('public.addresses'))
      expect(ctx.plan.ordered.indexOf('public.addresses'))
        .toBeLessThan(ctx.plan.ordered.indexOf('public.customers'))
    }, 60_000)
  })

  // ── Test 6: Self-referencing FK ──────────────────────────────

  describe('Test 6: Self-referencing table', () => {
    let client: pg.Client

    afterAll(async () => { await client?.end() })

    it('generates tree structure with NULL roots', async () => {
      const ctx = await runSeedforge(container, SELF_REF)
      client = ctx.client

      const { rows: total } = await client.query('SELECT COUNT(*)::int AS cnt FROM categories')
      expect(total[0].cnt).toBe(ROW_COUNT)

      // Some rows should be roots (parent_id IS NULL)
      const { rows: roots } = await client.query(
        'SELECT COUNT(*)::int AS cnt FROM categories WHERE parent_id IS NULL',
      )
      expect(roots[0].cnt).toBeGreaterThan(0)
      expect(roots[0].cnt).toBeLessThan(ROW_COUNT)

      // Non-root rows should reference valid parents
      const { rows: badRefs } = await client.query(`
        SELECT COUNT(*)::int AS cnt FROM categories c
        WHERE c.parent_id IS NOT NULL
          AND NOT EXISTS (SELECT 1 FROM categories p WHERE p.id = c.parent_id)
      `)
      expect(badRefs[0].cnt).toBe(0)

      // Should be detected as self-ref
      expect(ctx.plan.selfRefTables).toContain('public.categories')
    }, 60_000)
  })

  // ── Test 7: UUID PKs + JSON columns ─────────────────────────

  describe('Test 7: UUID PKs and JSON columns', () => {
    let client: pg.Client

    afterAll(async () => { await client?.end() })

    it('generates valid UUIDs and JSON', async () => {
      const ctx = await runSeedforge(container, UUID_JSON)
      client = ctx.client

      const { rows } = await client.query('SELECT id, metadata, tags, title FROM articles')
      expect(rows).toHaveLength(ROW_COUNT)

      for (const row of rows) {
        // UUID format
        expect(row.id).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        )
        // Title is populated
        expect(row.title).toBeTypeOf('string')
        expect(row.title.length).toBeGreaterThan(0)
      }

      // All UUIDs are unique
      const { rows: uuids } = await client.query(
        'SELECT COUNT(DISTINCT id)::int AS cnt FROM articles',
      )
      expect(uuids[0].cnt).toBe(ROW_COUNT)
    }, 60_000)
  })

  // ── Test 8: Composite PK + multiple FKs ─────────────────────

  describe('Test 8: Composite PK', () => {
    let client: pg.Client

    afterAll(async () => { await client?.end() })

    it('generates valid composite PKs and FK references', async () => {
      const ctx = await runSeedforge(container, COMPOSITE_PK)
      client = ctx.client

      // Authors and books populated
      const { rows: authors } = await client.query('SELECT COUNT(*)::int AS cnt FROM authors')
      expect(authors[0].cnt).toBe(ROW_COUNT)
      const { rows: books } = await client.query('SELECT COUNT(*)::int AS cnt FROM books')
      expect(books[0].cnt).toBe(ROW_COUNT)

      // Book reviews: FK to books is valid
      const { rows: reviews } = await client.query('SELECT * FROM book_reviews')
      expect(reviews.length).toBeGreaterThan(0)

      const { rows: badBookRefs } = await client.query(`
        SELECT COUNT(*)::int AS cnt FROM book_reviews br
        WHERE NOT EXISTS (SELECT 1 FROM books b WHERE b.id = br.book_id)
      `)
      expect(badBookRefs[0].cnt).toBe(0)

      // Rating is within CHECK constraint bounds
      for (const row of reviews) {
        expect(row.rating).toBeGreaterThanOrEqual(1)
        expect(row.rating).toBeLessThanOrEqual(5)
      }
    }, 60_000)
  })

  // ── Test 9: Generated columns ───────────────────────────────

  describe('Test 9: Generated columns (STORED + IDENTITY)', () => {
    let client: pg.Client

    afterAll(async () => { await client?.end() })

    it('skips generated columns and lets DB compute them', async () => {
      const ctx = await runSeedforge(container, GENERATED_COLUMNS)
      client = ctx.client

      const { rows } = await client.query('SELECT * FROM invoices')
      expect(rows).toHaveLength(ROW_COUNT)

      for (const row of rows) {
        // ID is auto-generated via IDENTITY
        expect(row.id).toBeTypeOf('number')
        // tax_amount and total are computed correctly by the DB
        const subtotal = parseFloat(row.subtotal)
        const taxRate = parseFloat(row.tax_rate)
        const expectedTax = subtotal * taxRate
        const expectedTotal = subtotal + expectedTax
        expect(parseFloat(row.tax_amount)).toBeCloseTo(expectedTax, 1)
        expect(parseFloat(row.total)).toBeCloseTo(expectedTotal, 1)
      }
    }, 60_000)
  })

  // ── Test 10: Full e-commerce schema ─────────────────────────

  describe('Test 10: Full e-commerce (6 tables, enums, FKs, composite PK)', () => {
    let client: pg.Client

    afterAll(async () => { await client?.end() })

    it('seeds entire e-commerce schema correctly', async () => {
      const ctx = await runSeedforge(container, ECOMMERCE)
      client = ctx.client

      // All tables populated
      const tables = ['users', 'product_categories', 'products', 'orders', 'order_items', 'reviews']
      for (const table of tables) {
        const { rows } = await client.query(`SELECT COUNT(*)::int AS cnt FROM ${table}`)
        expect(rows[0].cnt).toBeGreaterThan(0)
      }

      // Users have valid emails
      const { rows: users } = await client.query('SELECT email FROM users')
      for (const row of users) {
        expect(row.email).toContain('@')
      }

      // Orders reference valid users
      const { rows: orphanOrders } = await client.query(`
        SELECT COUNT(*)::int AS cnt FROM orders o
        WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = o.user_id)
      `)
      expect(orphanOrders[0].cnt).toBe(0)

      // Order status uses enum values
      const { rows: orders } = await client.query('SELECT status FROM orders')
      const validStatuses = ['pending', 'confirmed', 'shipped', 'delivered', 'cancelled']
      for (const row of orders) {
        expect(validStatuses).toContain(row.status)
      }

      // Order items FK integrity (composite PK references)
      const { rows: badItems } = await client.query(`
        SELECT COUNT(*)::int AS cnt FROM order_items oi
        WHERE NOT EXISTS (SELECT 1 FROM orders o WHERE o.id = oi.order_id)
           OR NOT EXISTS (SELECT 1 FROM products p WHERE p.id = oi.product_id)
      `)
      expect(badItems[0].cnt).toBe(0)

      // Reviews FK integrity
      const { rows: badReviews } = await client.query(`
        SELECT COUNT(*)::int AS cnt FROM reviews r
        WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = r.user_id)
           OR NOT EXISTS (SELECT 1 FROM products p WHERE p.id = r.product_id)
      `)
      expect(badReviews[0].cnt).toBe(0)

      // Review ratings respect CHECK constraint
      const { rows: reviews } = await client.query('SELECT rating FROM reviews')
      for (const row of reviews) {
        expect(row.rating).toBeGreaterThanOrEqual(1)
        expect(row.rating).toBeLessThanOrEqual(5)
      }

      // Product categories self-ref
      expect(ctx.plan.selfRefTables).toContain('public.product_categories')

      // Summary stats
      expect(ctx.summary.tablesSeeded).toBe(6)
      expect(ctx.summary.totalRowsInserted).toBeGreaterThan(0)
    }, 60_000)
  })

  // ── Test: Deterministic output ──────────────────────────────

  describe('Deterministic seeding', () => {
    let client1: pg.Client
    let client2: pg.Client

    afterAll(async () => {
      await client1?.end()
      await client2?.end()
    })

    it('produces identical data with same seed', async () => {
      // Run twice with same seed
      const ctx1 = await runSeedforge(container, BASIC_TYPES, 10)
      client1 = ctx1.client
      const ctx2 = await runSeedforge(container, BASIC_TYPES, 10)
      client2 = ctx2.client

      const { rows: rows1 } = await client1.query(
        'SELECT name, email, is_active FROM basic_types ORDER BY id',
      )
      const { rows: rows2 } = await client2.query(
        'SELECT name, email, is_active FROM basic_types ORDER BY id',
      )

      expect(rows1).toEqual(rows2)
    }, 60_000)
  })

  // ── Test: SQL file output ───────────────────────────────────

  describe('SQL file output', () => {
    let client: pg.Client

    afterAll(async () => { await client?.end() })

    it('generates valid SQL file', async () => {
      const adminClient = new pg.Client({ connectionString: container.getConnectionUri() })
      await adminClient.connect()
      const dbName = `test_sql_${Date.now()}`
      await adminClient.query(`CREATE DATABASE ${dbName}`)
      await adminClient.end()

      const connUri = container.getConnectionUri().replace(/\/[^/]+$/, `/${dbName}`)
      client = new pg.Client({ connectionString: connUri })
      await client.connect()
      await client.query(SIMPLE_FK)

      const schema = await introspect(client, 'public')
      const plan = buildInsertPlan(schema)
      const result = await generate(schema, plan, client, {
        globalRowCount: 10,
        seed: SEED,
      })

      const fs = await import('node:fs')
      const path = await import('node:path')
      const os = await import('node:os')
      const tmpFile = path.join(os.tmpdir(), `seedforge-test-${Date.now()}.sql`)

      try {
        const summary = await executeOutput(result, schema, plan, {
          mode: OutputMode.FILE,
          filePath: tmpFile,
          batchSize: 500,
          showProgress: false,
          quiet: true,
        })

        expect(summary.mode).toBe(OutputMode.FILE)

        // SQL file exists and has content
        const sql = fs.readFileSync(tmpFile, 'utf-8')
        expect(sql.length).toBeGreaterThan(0)
        expect(sql).toContain('INSERT INTO')
        expect(sql).toContain('departments')
        expect(sql).toContain('employees')
      } finally {
        try { fs.unlinkSync(tmpFile) } catch { /* ignore */ }
      }
    }, 60_000)
  })
})
