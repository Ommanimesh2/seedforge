/**
 * E2e regression for the --fast UNIQUE constraint exhaustion bug.
 *
 * Background: at 1000+ rows on real-world fintech schemas (e.g. Curie's
 * `schemes.isin` VARCHAR(12) UNIQUE), the streaming COPY path tripped
 * `duplicate key value violates unique constraint`. Root cause: the
 * unique-tracker registered values *before* generate-table.ts truncated
 * them to maxLength, so two suffix attempts that the tracker considered
 * distinct ("FOOLONGSTR_1" / "FOOLONGSTR_2") collapsed to the same
 * 12-char stored value. Fix: the tracker now stores the post-truncation
 * value, so collision detection matches what Postgres sees.
 *
 * This e2e proves the round-trip: a tight VARCHAR(12) UNIQUE column on
 * a generator that produces saturated strings, seeded with 1500 rows
 * via --fast COPY streaming, lands without violations.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql'
import pg from 'pg'
import { introspect } from '../../introspect/index.js'
import { buildInsertPlan } from '../../graph/index.js'
import { generate } from '../../generate/index.js'
import { executeOutput, OutputMode, ProgressReporter } from '../../output/index.js'
import { executeFastPgPipeline } from '../../output/executors/pg-copy-streaming.js'

const SEED = 42

async function setupDb(container: StartedPostgreSqlContainer, ddl: string) {
  const admin = new pg.Client({ connectionString: container.getConnectionUri() })
  await admin.connect()
  const dbName = `unique_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
  await admin.query(`CREATE DATABASE ${dbName}`)
  await admin.end()
  const uri = container.getConnectionUri().replace(/\/[^/]+$/, `/${dbName}`)
  const client = new pg.Client({ connectionString: uri })
  await client.connect()
  await client.query(ddl)
  return client
}

describe('--fast UNIQUE truncation regression (e2e)', () => {
  let container: StartedPostgreSqlContainer

  beforeAll(async () => {
    container = await new PostgreSqlContainer('postgres:16-alpine').start()
  }, 120_000)

  afterAll(async () => {
    await container?.stop()
  })

  it('seeds 1500 rows with VARCHAR(12) UNIQUE without collision (batched path)', async () => {
    // Mirrors the failing Curie shape: short VARCHAR(N) with a UNIQUE
    // constraint, where N <= the natural length of the faker fallback.
    const ddl = `
      CREATE TABLE schemes (
        id SERIAL PRIMARY KEY,
        isin VARCHAR(12) NOT NULL UNIQUE,
        name VARCHAR(200) NOT NULL
      );
    `
    const client = await setupDb(container, ddl)
    try {
      const schema = await introspect(client, 'public')
      const plan = buildInsertPlan(schema)
      const result = await generate(schema, plan, client, {
        globalRowCount: 1500,
        seed: SEED,
      })
      await executeOutput(result, schema, plan, {
        mode: OutputMode.DIRECT,
        client,
        batchSize: 500,
        showProgress: false,
        quiet: true,
      })

      const { rows } = await client.query<{ count: number; distinct: number }>(
        `SELECT COUNT(*)::int AS count, COUNT(DISTINCT isin)::int AS distinct FROM schemes`,
      )
      expect(rows[0].count).toBe(1500)
      expect(rows[0].distinct).toBe(1500)
      // Every isin is within maxLength.
      const { rows: longs } = await client.query<{ bad: number }>(
        `SELECT COUNT(*)::int AS bad FROM schemes WHERE LENGTH(isin) > 12`,
      )
      expect(longs[0].bad).toBe(0)
    } finally {
      await client.end()
    }
  }, 180_000)

  it('seeds composite UNIQUE (FK, DATE) without collision via --fast', async () => {
    // Mirrors the failing Curie shape: scheme_navs(scheme_id, nav_date) UNIQUE.
    // Without composite tracking + UTC-correct DATE normalization, this
    // tripped at ~1000 rows on real fixtures.
    const ddl = `
      CREATE TABLE schemes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL
      );
      CREATE TABLE scheme_navs (
        id SERIAL PRIMARY KEY,
        scheme_id INTEGER NOT NULL REFERENCES schemes(id),
        nav_date DATE NOT NULL,
        nav_value DECIMAL(20,4) NOT NULL,
        UNIQUE (scheme_id, nav_date)
      );
    `
    const client = await setupDb(container, ddl)
    try {
      const schema = await introspect(client, 'public')
      const plan = buildInsertPlan(schema)
      const progress = new ProgressReporter({ showProgress: false, quiet: true })
      await executeFastPgPipeline(
        schema,
        plan,
        client,
        { globalRowCount: 2000, seed: SEED, quiet: true },
        progress,
      )

      const { rows } = await client.query<{ count: number; distinct: number }>(
        `SELECT COUNT(*)::int AS count,
                COUNT(DISTINCT (scheme_id, nav_date))::int AS distinct
         FROM scheme_navs`,
      )
      expect(rows[0].count).toBe(2000)
      expect(rows[0].distinct).toBe(2000)
    } finally {
      await client.end()
    }
  }, 180_000)

  it('seeds composite UNIQUE on two FK columns (resamples from pool)', async () => {
    // Real-world Curie shape: reported_balances(folio_id, scheme_id) UNIQUE
    // — both columns are FK UUIDs. Mutating either would corrupt the FK,
    // so the generator resamples from the FK reference pool instead.
    const ddl = `
      CREATE TABLE schemes (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL
      );
      CREATE TABLE folios (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL
      );
      CREATE TABLE reported_balances (
        id SERIAL PRIMARY KEY,
        folio_id INTEGER NOT NULL REFERENCES folios(id),
        scheme_id INTEGER NOT NULL REFERENCES schemes(id),
        total_units DECIMAL(20,4) NOT NULL,
        UNIQUE (folio_id, scheme_id)
      );
    `
    const client = await setupDb(container, ddl)
    try {
      const schema = await introspect(client, 'public')
      const plan = buildInsertPlan(schema)
      const progress = new ProgressReporter({ showProgress: false, quiet: true })
      await executeFastPgPipeline(
        schema,
        plan,
        client,
        { globalRowCount: 2000, seed: SEED, quiet: true },
        progress,
      )

      const { rows } = await client.query<{ count: number; distinct: number }>(
        `SELECT COUNT(*)::int AS count,
                COUNT(DISTINCT (folio_id, scheme_id))::int AS distinct
         FROM reported_balances`,
      )
      expect(rows[0].count).toBe(2000)
      expect(rows[0].distinct).toBe(2000)
    } finally {
      await client.end()
    }
  }, 180_000)

  it('seeds 1500 rows with VARCHAR(12) UNIQUE via --fast COPY streaming', async () => {
    const ddl = `
      CREATE TABLE schemes (
        id SERIAL PRIMARY KEY,
        isin VARCHAR(12) NOT NULL UNIQUE,
        amfi_code VARCHAR(20) NOT NULL UNIQUE,
        name VARCHAR(200) NOT NULL
      );
    `
    const client = await setupDb(container, ddl)
    try {
      const schema = await introspect(client, 'public')
      const plan = buildInsertPlan(schema)
      const progress = new ProgressReporter({ showProgress: false, quiet: true })
      await executeFastPgPipeline(
        schema,
        plan,
        client,
        { globalRowCount: 1500, seed: SEED, quiet: true },
        progress,
      )

      const { rows } = await client.query<{
        count: number
        distinct_isin: number
        distinct_amfi: number
      }>(
        `SELECT
           COUNT(*)::int AS count,
           COUNT(DISTINCT isin)::int AS distinct_isin,
           COUNT(DISTINCT amfi_code)::int AS distinct_amfi
         FROM schemes`,
      )
      expect(rows[0].count).toBe(1500)
      expect(rows[0].distinct_isin).toBe(1500)
      expect(rows[0].distinct_amfi).toBe(1500)
    } finally {
      await client.end()
    }
  }, 180_000)
})
