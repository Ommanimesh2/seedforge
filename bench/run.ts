/**
 * Seedforge scale benchmark runner.
 *
 * Spins up PostgreSQL and MySQL testcontainers, runs each fixture at several
 * row counts, and measures:
 *
 *   - wall time (ms)
 *   - RSS growth (MB) — rough signal for memory pressure
 *   - throughput (rows/sec)
 *
 * Three modes are compared per fixture:
 *
 *   - `pg-insert`  : default batched INSERT path (materialize → execute)
 *   - `pg-copy`    : --fast PG COPY streaming (executeFastPgPipeline)
 *   - `mysql-load` : --fast MySQL LOAD DATA LOCAL INFILE streaming
 *
 * Not wired into CI. Run manually with:
 *
 *   npm run bench           # all fixtures, all row counts
 *   npm run bench -- wide   # a single fixture by name
 *
 * Each run prints a markdown-ish results table to stdout so it can be pasted
 * into release notes or captured for regression tracking.
 */

import { PostgreSqlContainer } from '@testcontainers/postgresql'
import { MySqlContainer } from '@testcontainers/mysql'
import pg from 'pg'
import mysql from 'mysql2/promise'
import { introspect } from '../src/introspect/index.js'
import { introspectMysql } from '../src/introspect/mysql/introspect.js'
import { buildInsertPlan } from '../src/graph/index.js'
import { generate } from '../src/generate/index.js'
import { executeOutput, OutputMode } from '../src/output/index.js'
import { executeFastPgPipeline } from '../src/output/executors/pg-copy-streaming.js'
import { executeFastMysqlPipeline } from '../src/output/executors/mysql-load-data.js'
import { ProgressReporter } from '../src/output/progress.js'
import { FIXTURES, type BenchSchemaFixture } from './fixtures.js'

interface BenchResult {
  fixture: string
  mode: string
  rowCount: number
  tables: number
  totalRows: number
  elapsedMs: number
  rssGrowthMb: number
  rowsPerSec: number
}

const ROW_COUNTS = [10_000, 100_000] as const
const SEED = 42

function silentProgress() {
  return new ProgressReporter({ quiet: true, showProgress: false })
}

function mb(bytes: number): number {
  return Math.round((bytes / 1024 / 1024) * 10) / 10
}

async function resetPgDb(container: Awaited<ReturnType<typeof startPg>>, fixture: BenchSchemaFixture) {
  // Drop and rebuild schema in the `public` schema so every run starts cold.
  const client = new pg.Client({ connectionString: container.getConnectionUri() })
  await client.connect()
  await client.query('DROP SCHEMA public CASCADE; CREATE SCHEMA public;')
  await client.query(fixture.pgSql)
  return client
}

async function resetMysqlDb(
  container: Awaited<ReturnType<typeof startMysql>>,
  fixture: BenchSchemaFixture,
) {
  const db = container.getDatabase()
  const conn = await mysql.createConnection({
    host: container.getHost(),
    port: container.getPort(),
    user: container.getUsername(),
    password: container.getUserPassword(),
    database: db,
    multipleStatements: true,
  })
  // MySQL doesn't have PG's DROP SCHEMA CASCADE — drop each table explicitly.
  await conn.query('SET FOREIGN_KEY_CHECKS=0')
  for (const t of fixture.tables) {
    await conn.query(`DROP TABLE IF EXISTS \`${t}\``)
  }
  await conn.query('SET FOREIGN_KEY_CHECKS=1')
  await conn.query(fixture.mysqlSql)
  return { conn, db }
}

async function runPgInsert(
  container: Awaited<ReturnType<typeof startPg>>,
  fixture: BenchSchemaFixture,
  rowCount: number,
): Promise<BenchResult> {
  const client = await resetPgDb(container, fixture)
  try {
    const schema = await introspect(client, 'public')
    const plan = buildInsertPlan(schema)
    const rssBefore = process.memoryUsage().rss
    const start = Date.now()
    const gen = await generate(schema, plan, client, { globalRowCount: rowCount, seed: SEED })
    const summary = await executeOutput(
      gen,
      schema,
      plan,
      {
        mode: OutputMode.DIRECT,
        client,
        batchSize: 500,
        showProgress: false,
        quiet: true,
      },
      '0.0.0-bench',
    )
    const elapsed = Date.now() - start
    const rssAfter = process.memoryUsage().rss
    return {
      fixture: fixture.name,
      mode: 'pg-insert',
      rowCount,
      tables: summary.rowsPerTable.size,
      totalRows: summary.totalRowsInserted,
      elapsedMs: elapsed,
      rssGrowthMb: mb(rssAfter - rssBefore),
      rowsPerSec: Math.round(summary.totalRowsInserted / (elapsed / 1000)),
    }
  } finally {
    await client.end()
  }
}

async function runPgCopy(
  container: Awaited<ReturnType<typeof startPg>>,
  fixture: BenchSchemaFixture,
  rowCount: number,
): Promise<BenchResult> {
  const client = await resetPgDb(container, fixture)
  try {
    const schema = await introspect(client, 'public')
    const plan = buildInsertPlan(schema)
    const rssBefore = process.memoryUsage().rss
    const start = Date.now()
    const summary = await executeFastPgPipeline(
      schema,
      plan,
      client,
      { globalRowCount: rowCount, seed: SEED },
      silentProgress(),
    )
    const elapsed = Date.now() - start
    const rssAfter = process.memoryUsage().rss
    return {
      fixture: fixture.name,
      mode: 'pg-copy',
      rowCount,
      tables: summary.rowsPerTable.size,
      totalRows: summary.totalRowsInserted,
      elapsedMs: elapsed,
      rssGrowthMb: mb(rssAfter - rssBefore),
      rowsPerSec: Math.round(summary.totalRowsInserted / (elapsed / 1000)),
    }
  } finally {
    await client.end()
  }
}

async function runMysqlLoad(
  container: Awaited<ReturnType<typeof startMysql>>,
  fixture: BenchSchemaFixture,
  rowCount: number,
): Promise<BenchResult> {
  const { conn, db } = await resetMysqlDb(container, fixture)
  try {
    const schema = await introspectMysql(conn, db)
    const plan = buildInsertPlan(schema)
    const rssBefore = process.memoryUsage().rss
    const start = Date.now()
    const summary = await executeFastMysqlPipeline(
      schema,
      plan,
      conn,
      { globalRowCount: rowCount, seed: SEED },
      silentProgress(),
    )
    const elapsed = Date.now() - start
    const rssAfter = process.memoryUsage().rss
    return {
      fixture: fixture.name,
      mode: 'mysql-load',
      rowCount,
      tables: summary.rowsPerTable.size,
      totalRows: summary.totalRowsInserted,
      elapsedMs: elapsed,
      rssGrowthMb: mb(rssAfter - rssBefore),
      rowsPerSec: Math.round(summary.totalRowsInserted / (elapsed / 1000)),
    }
  } finally {
    await conn.end()
  }
}

async function startPg() {
  return new PostgreSqlContainer('postgres:16-alpine').start()
}

async function startMysql() {
  return new MySqlContainer('mysql:8.0')
    .withCommand(['mysqld', '--local-infile=1'])
    .start()
}

function printResults(results: BenchResult[]) {
  const header = ['fixture', 'mode', 'rows', 'tables', 'elapsed(ms)', 'rows/s', 'rss growth(MB)']
  const rows = results.map((r) => [
    r.fixture,
    r.mode,
    String(r.rowCount),
    String(r.tables),
    String(r.elapsedMs),
    String(r.rowsPerSec),
    String(r.rssGrowthMb),
  ])
  const widths = header.map((h, i) =>
    Math.max(h.length, ...rows.map((row) => row[i].length)),
  )
  const fmt = (cells: string[]) =>
    cells.map((c, i) => c.padEnd(widths[i])).join('  ')
  console.log('')
  console.log(fmt(header))
  console.log(widths.map((w) => '-'.repeat(w)).join('  '))
  for (const row of rows) console.log(fmt(row))
  console.log('')
}

async function main() {
  const filterName = process.argv[2]
  const fixtures = filterName
    ? FIXTURES.filter((f) => f.name === filterName)
    : FIXTURES
  if (fixtures.length === 0) {
    console.error(
      `No fixture matches "${filterName}". Available: ${FIXTURES.map((f) => f.name).join(', ')}`,
    )
    process.exit(1)
  }

  console.log('Starting postgres container…')
  const pgContainer = await startPg()
  console.log('Starting mysql container (local_infile=1)…')
  const mysqlContainer = await startMysql()

  const results: BenchResult[] = []
  try {
    for (const fixture of fixtures) {
      console.log(`\n=== ${fixture.name} — ${fixture.description} ===`)
      for (const rowCount of ROW_COUNTS) {
        console.log(`  running pg-insert  @ ${rowCount}`)
        results.push(await runPgInsert(pgContainer, fixture, rowCount))
        console.log(`  running pg-copy    @ ${rowCount}`)
        results.push(await runPgCopy(pgContainer, fixture, rowCount))
        console.log(`  running mysql-load @ ${rowCount}`)
        results.push(await runMysqlLoad(mysqlContainer, fixture, rowCount))
      }
    }
  } finally {
    await pgContainer.stop()
    await mysqlContainer.stop()
  }

  printResults(results)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
