/**
 * E2e coverage for Wave 1.1 — CHECK-constraint enum picking hardening.
 *
 * The previous extractor returned null on real-world Postgres output for
 * `(col)::text = ANY ((ARRAY['A'::varchar, 'B'::varchar])::text[])` because
 * the regex didn't tolerate the cast wrapper around the array. These tests
 * exercise the live Postgres path against the actual `pg_get_constraintdef`
 * output, including the nullable-with-IS-NULL guard form, and assert that
 * generated rows respect the CHECK constraints (no SF4001 violations).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import { introspect } from '../../introspect/index.js'
import { buildInsertPlan } from '../../graph/index.js'
import { generate } from '../../generate/index.js'
import { executeOutput, OutputMode } from '../../output/index.js'

const ROW_COUNT = 100
const SEED = 42

async function setupDb(container: StartedPostgreSqlContainer, ddl: string) {
  const admin = new pg.Client({ connectionString: container.getConnectionUri() })
  await admin.connect()
  const dbName = `chk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  await admin.query(`CREATE DATABASE ${dbName}`)
  await admin.end()
  const uri = container.getConnectionUri().replace(/\/[^/]+$/, `/${dbName}`)
  const client = new pg.Client({ connectionString: uri })
  await client.connect()
  await client.query(ddl)
  return client
}

async function runPipeline(client: pg.Client, rowCount = ROW_COUNT) {
  const schema = await introspect(client, 'public')
  const plan = buildInsertPlan(schema)
  const result = await generate(schema, plan, client, {
    globalRowCount: rowCount,
    seed: SEED,
  })
  await executeOutput(result, schema, plan, {
    mode: OutputMode.DIRECT,
    client,
    batchSize: 500,
    showProgress: false,
    quiet: true,
  })
  return { schema }
}

describe('CHECK-constraint enum hardening (e2e)', () => {
  let container: StartedPostgreSqlContainer

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start()
  }, 120_000)

  afterAll(async () => {
    await container?.stop()
  })

  it('extracts enum values from ANY((ARRAY[...])::text[]) — Curie style', async () => {
    // This is the exact shape pg_get_constraintdef produces when the
    // table is declared with `VARCHAR CHECK (col IN (...))`. The cast
    // wrapper is the part that broke the previous regex.
    const ddl = `
      CREATE TABLE orders (
        id SERIAL PRIMARY KEY,
        order_type VARCHAR(20) NOT NULL,
        amount DECIMAL(20,2) NOT NULL DEFAULT 0
      );
      ALTER TABLE orders ADD CONSTRAINT chk_orders_type CHECK (
        order_type IN ('PURCHASE', 'REDEMPTION', 'IR', 'SIP_INSTALLMENT', 'SWITCH')
      );
    `
    const client = await setupDb(container, ddl)
    try {
      const { schema } = await runPipeline(client)

      // 1. The column has detected enumValues populated from the CHECK.
      const orderTypeCol = schema.tables.get('orders')!.columns.get('order_type')!
      expect(orderTypeCol.enumValues).toEqual([
        'PURCHASE',
        'REDEMPTION',
        'IR',
        'SIP_INSTALLMENT',
        'SWITCH',
      ])

      // 2. Every generated row has a value from the allowed set — no
      //    SF4001 violation, no faker lorem leaking through.
      const { rows } = await client.query<{ order_type: string }>('SELECT order_type FROM orders')
      expect(rows).toHaveLength(ROW_COUNT)
      const allowed = new Set(orderTypeCol.enumValues)
      for (const r of rows) {
        expect(allowed.has(r.order_type)).toBe(true)
      }
    } finally {
      await client.end()
    }
  }, 90_000)

  it('extracts enum values when CHECK includes IS NULL guard (nullable)', async () => {
    // Nullable column with an IS NULL OR IN (...) CHECK. Postgres emits
    //   ((col IS NULL) OR ((col)::text = ANY ((ARRAY[...])::text[])))
    const ddl = `
      CREATE TABLE orders (
        id SERIAL PRIMARY KEY,
        order_sub_type VARCHAR(30)
      );
      ALTER TABLE orders ADD CONSTRAINT chk_orders_sub_type CHECK (
        order_sub_type IS NULL OR order_sub_type IN (
          'FRESH', 'ADDITIONAL', 'FULL_REDEMPTION', 'PARTIAL', 'INSTANT', 'CP', 'RECURRING'
        )
      );
    `
    const client = await setupDb(container, ddl)
    try {
      const { schema } = await runPipeline(client)
      const col = schema.tables.get('orders')!.columns.get('order_sub_type')!
      expect(col.enumValues).toEqual([
        'FRESH',
        'ADDITIONAL',
        'FULL_REDEMPTION',
        'PARTIAL',
        'INSTANT',
        'CP',
        'RECURRING',
      ])

      const { rows } = await client.query<{ order_sub_type: string | null }>(
        'SELECT order_sub_type FROM orders',
      )
      expect(rows).toHaveLength(ROW_COUNT)
      const allowed = new Set(col.enumValues!)
      for (const r of rows) {
        if (r.order_sub_type !== null) {
          expect(allowed.has(r.order_sub_type)).toBe(true)
        }
      }
    } finally {
      await client.end()
    }
  }, 90_000)

  it('handles multiple IN-list CHECK constraints on the same table', async () => {
    // Mirrors the Curie orders table: order_type, order_sub_type,
    // current_status all under separate CHECK constraints.
    const ddl = `
      CREATE TABLE orders (
        id SERIAL PRIMARY KEY,
        order_type VARCHAR(20) NOT NULL,
        order_sub_type VARCHAR(30),
        current_status VARCHAR(40) NOT NULL
      );
      ALTER TABLE orders ADD CONSTRAINT chk_orders_type CHECK (
        order_type IN ('PURCHASE', 'REDEMPTION', 'IR')
      );
      ALTER TABLE orders ADD CONSTRAINT chk_orders_sub_type CHECK (
        order_sub_type IS NULL OR order_sub_type IN ('FRESH', 'ADDITIONAL')
      );
      ALTER TABLE orders ADD CONSTRAINT chk_orders_status CHECK (
        current_status IN ('CREATED', 'SUBMITTED', 'SETTLED', 'FAILED')
      );
    `
    const client = await setupDb(container, ddl)
    try {
      const { schema } = await runPipeline(client)
      const cols = schema.tables.get('orders')!.columns
      expect(cols.get('order_type')!.enumValues).toHaveLength(3)
      expect(cols.get('order_sub_type')!.enumValues).toHaveLength(2)
      expect(cols.get('current_status')!.enumValues).toHaveLength(4)

      // Every column independently respects its own constraint.
      const { rows } = await client.query<{
        order_type: string
        order_sub_type: string | null
        current_status: string
      }>('SELECT order_type, order_sub_type, current_status FROM orders')
      expect(rows).toHaveLength(ROW_COUNT)
      const types = new Set(['PURCHASE', 'REDEMPTION', 'IR'])
      const subs = new Set(['FRESH', 'ADDITIONAL'])
      const statuses = new Set(['CREATED', 'SUBMITTED', 'SETTLED', 'FAILED'])
      for (const r of rows) {
        expect(types.has(r.order_type)).toBe(true)
        expect(statuses.has(r.current_status)).toBe(true)
        if (r.order_sub_type !== null) {
          expect(subs.has(r.order_sub_type)).toBe(true)
        }
      }
    } finally {
      await client.end()
    }
  }, 90_000)

  it('produces deterministic output across runs with the same seed', async () => {
    const ddl = `
      CREATE TABLE t (
        id SERIAL PRIMARY KEY,
        kind VARCHAR(10) NOT NULL CHECK (kind IN ('A', 'B', 'C', 'D'))
      );
    `
    const a = await setupDb(container, ddl)
    const b = await setupDb(container, ddl)
    try {
      await runPipeline(a, 50)
      await runPipeline(b, 50)
      const aRows = await a.query<{ id: number; kind: string }>(
        'SELECT id, kind FROM t ORDER BY id',
      )
      const bRows = await b.query<{ id: number; kind: string }>(
        'SELECT id, kind FROM t ORDER BY id',
      )
      expect(aRows.rows).toEqual(bRows.rows)
    } finally {
      await a.end()
      await b.end()
    }
  }, 120_000)

  it('leaves range-style CHECKs alone (does not produce a fake enum)', async () => {
    // `price >= 0` is not enum-like; the column should not gain
    // enumValues. The generator falls back to the type's default.
    const ddl = `
      CREATE TABLE products (
        id SERIAL PRIMARY KEY,
        price DECIMAL(10,2) NOT NULL CHECK (price >= 0)
      );
    `
    const client = await setupDb(container, ddl)
    try {
      const { schema } = await runPipeline(client, 20)
      const col = schema.tables.get('products')!.columns.get('price')!
      expect(col.enumValues).toBeNull()

      // Confirm the CHECK still holds against generated data — proves the
      // generator's numeric default plays nicely with `>= 0`.
      const { rows } = await client.query<{ bad: number }>(
        'SELECT COUNT(*)::int AS bad FROM products WHERE price < 0',
      )
      expect(rows[0].bad).toBe(0)
    } finally {
      await client.end()
    }
  }, 90_000)
})
