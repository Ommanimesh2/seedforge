import type { DatabaseSchema } from '../types/schema.js'
import type { InsertPlan } from '../graph/types.js'
import type { SeederOptions, TableSeedOptions, Row } from './types.js'
import type { PipelineConnection } from '../core/types.js'
import { connectAndIntrospect } from '../core/pipeline.js'
import { buildInsertPlan } from '../graph/index.js'
import { generate } from '../generate/index.js'
import type { CardinalitySpec, TableCardinalityConfig } from '../generate/cardinality.js'
import { TableChain } from './builder.js'

/**
 * Create a stateful Seeder instance with a persistent database connection.
 *
 * The seeder connects and introspects the schema on creation, then reuses
 * the connection for all subsequent seed() calls.
 *
 * @example
 * const seeder = await createSeeder('postgres://localhost/testdb', {
 *   seed: 42,
 *   transaction: true,
 * })
 *
 * const users = await seeder.seed('users', 10)
 * const posts = await seeder.seed('posts', 50)
 *
 * await seeder.teardown() // rollback all changes
 */
export async function createSeeder(
  connectionUrl: string,
  options: SeederOptions = {},
): Promise<Seeder> {
  const {
    seed,
    transaction = false,
    schema: schemaName = 'public',
    quiet = true,
    skipProductionCheck = true,
    batchSize = 500,
  } = options

  const result = await connectAndIntrospect(connectionUrl, {
    schema: schemaName,
    skipProductionCheck,
  })

  const plan = buildInsertPlan(result.schema)

  const seeder = new Seeder(
    result.connection,
    result.schema,
    plan,
    result.disconnect,
    { seed, transaction, quiet, batchSize },
  )

  if (transaction) {
    await seeder._beginTransaction()
  }

  return seeder
}

/**
 * A stateful seeder that holds a database connection and supports
 * per-table seeding with row return, transaction isolation, and
 * a fluent builder API.
 */
export class Seeder {
  private _connection: PipelineConnection
  private _schema: DatabaseSchema
  private _plan: InsertPlan
  private _disconnectFn: () => Promise<void>
  private _options: {
    seed?: number
    transaction: boolean
    quiet: boolean
    batchSize: number
  }
  private _inTransaction = false
  private _closed = false
  private _seedCallCount = 0

  constructor(
    connection: PipelineConnection,
    schema: DatabaseSchema,
    plan: InsertPlan,
    disconnectFn: () => Promise<void>,
    options: { seed?: number; transaction: boolean; quiet: boolean; batchSize: number },
  ) {
    this._connection = connection
    this._schema = schema
    this._plan = plan
    this._disconnectFn = disconnectFn
    this._options = options
  }

  /**
   * Seed a single table and return the generated rows.
   *
   * Tables should be seeded in dependency order (parent tables first).
   * FK references are automatically resolved from previously seeded data
   * in the database.
   *
   * @param tableName - The table to seed
   * @param count - Number of rows to generate
   * @param options - Per-table overrides
   * @returns The generated rows
   */
  async seed(
    tableName: string,
    count: number,
    options?: TableSeedOptions,
  ): Promise<Row[]> {
    this._assertOpen()

    // Derive a unique seed per call for deterministic but varied output
    const callSeed = this._options.seed !== undefined
      ? this._options.seed + this._seedCallCount
      : undefined
    this._seedCallCount++

    // Build a plan that includes prerequisite tables (for FK reference pool population)
    // All prerequisite tables get 0 rows — just their existing PKs are queried
    const targetIdx = this._plan.ordered.indexOf(tableName)
    if (targetIdx === -1) {
      throw new Error(
        `Table "${tableName}" not found in schema. ` +
        `Available tables: ${this._plan.ordered.join(', ')}`,
      )
    }
    const precedingTables = targetIdx > 0
      ? this._plan.ordered.slice(0, targetIdx)
      : []

    const isSelfRef = this._plan.selfRefTables.includes(tableName)
    const singlePlan: InsertPlan = {
      ordered: [...precedingTables, tableName],
      deferredEdges: isSelfRef
        ? this._plan.deferredEdges.filter(
            (e) => e.from === tableName && e.to === tableName,
          )
        : [],
      selfRefTables: isSelfRef ? [tableName] : [],
      warnings: [],
    }

    // Set per-table row counts: target table gets `count`, all others get 0
    const tableRowCounts = new Map<string, number>()
    tableRowCounts.set(tableName, count)
    for (const t of precedingTables) {
      tableRowCounts.set(t, 0)
    }

    // For generation, only PG clients support existing-data queries
    const genClient = this._connection.type === 'pg'
      ? this._connection.client
      : null

    // Build cardinality config from relationship overrides
    let tableCardinalityConfigs: Map<string, TableCardinalityConfig> | undefined
    if (options?.relationship) {
      const columnSpecs = new Map<string, CardinalitySpec>()
      for (const [colName, relOverride] of Object.entries(options.relationship)) {
        if (relOverride.cardinality) {
          columnSpecs.set(colName, {
            min: relOverride.cardinality.min,
            max: relOverride.cardinality.max,
            distribution: relOverride.cardinality.distribution ?? 'uniform',
          })
        }
      }
      if (columnSpecs.size > 0) {
        tableCardinalityConfigs = new Map([[tableName, columnSpecs]])
      }
    }

    const generationResult = await generate(this._schema, singlePlan, genClient, {
      globalRowCount: 0,
      tableRowCounts,
      seed: callSeed,
      tableCardinalityConfigs,
    })

    const tableResult = generationResult.tables.get(tableName)
    if (!tableResult || tableResult.rows.length === 0) {
      return []
    }

    let rows = tableResult.rows

    // Apply column overrides
    if (options?.columns) {
      rows = applyColumnOverrides(rows, options.columns)
    }

    // Insert rows into the database
    await this._insertRows(tableName, rows, generationResult)

    return rows
  }

  /**
   * Start a fluent builder chain for multi-table seeding.
   *
   * @example
   * const result = await seeder
   *   .table('users', 5)
   *   .table('posts', 20)
   *   .execute()
   */
  table(tableName: string, count: number, options?: TableSeedOptions): TableChain {
    this._assertOpen()
    return new TableChain(this).table(tableName, count, options)
  }

  /**
   * Rollback the transaction and disconnect.
   * Only works when the seeder was created with `transaction: true`.
   */
  async teardown(): Promise<void> {
    if (this._closed) return

    if (this._inTransaction) {
      await this._rollbackTransaction()
    }

    await this._disconnectFn()
    this._closed = true
  }

  /**
   * Commit any open transaction and disconnect.
   */
  async disconnect(): Promise<void> {
    if (this._closed) return

    if (this._inTransaction) {
      await this._commitTransaction()
    }

    await this._disconnectFn()
    this._closed = true
  }

  /** @internal */
  get schema(): DatabaseSchema {
    return this._schema
  }

  /** @internal */
  get plan(): InsertPlan {
    return this._plan
  }

  /** @internal */
  get connection(): PipelineConnection {
    return this._connection
  }

  /** @internal */
  get options(): { seed?: number; quiet: boolean; batchSize: number } {
    return this._options
  }

  /** @internal */
  get seedCallCount(): number {
    return this._seedCallCount
  }

  /** @internal */
  async _beginTransaction(): Promise<void> {
    switch (this._connection.type) {
      case 'pg':
        await this._connection.client.query('BEGIN')
        break
      case 'mysql':
        await this._connection.connection.query('START TRANSACTION')
        break
      case 'sqlite':
        this._connection.db.exec('BEGIN')
        break
      default:
        return
    }
    this._inTransaction = true
  }

  private async _commitTransaction(): Promise<void> {
    switch (this._connection.type) {
      case 'pg':
        await this._connection.client.query('COMMIT')
        break
      case 'mysql':
        await this._connection.connection.query('COMMIT')
        break
      case 'sqlite':
        this._connection.db.exec('COMMIT')
        break
    }
    this._inTransaction = false
  }

  private async _rollbackTransaction(): Promise<void> {
    try {
      switch (this._connection.type) {
        case 'pg':
          await this._connection.client.query('ROLLBACK')
          break
        case 'mysql':
          await this._connection.connection.query('ROLLBACK')
          break
        case 'sqlite':
          this._connection.db.exec('ROLLBACK')
          break
      }
    } catch {
      // Swallow rollback errors
    }
    this._inTransaction = false
  }

  /** @internal */
  async _insertRows(
    tableName: string,
    rows: Row[],
    generationResult: import('../generate/types.js').GenerationResult,
  ): Promise<void> {
    const { resolveTable } = await import('../types/resolve.js')
    const tableDef = resolveTable(this._schema, tableName)
    if (!tableDef || rows.length === 0) return

    switch (this._connection.type) {
      case 'pg':
        await this._insertPg(tableDef, rows, generationResult)
        break
      case 'mysql':
        await this._insertMysql(tableDef, rows)
        break
      case 'sqlite':
        this._insertSqlite(tableDef, rows)
        break
      case 'none':
        // No DB to insert into (dry-run scenario)
        break
    }
  }

  private async _insertPg(
    tableDef: { name: string; schema: string; columns: Map<string, { name: string; isGenerated: boolean }> },
    rows: Row[],
    generationResult: import('../generate/types.js').GenerationResult,
  ): Promise<void> {
    if (this._connection.type !== 'pg') return
    const client = this._connection.client

    const columns = getInsertableColumns(tableDef, rows[0])
    const { buildBatchedInserts } = await import('../output/batcher.js')
    const batches = buildBatchedInserts(tableDef.name, tableDef.schema, columns, rows, this._options.batchSize)

    // If not in a seeder-managed transaction, wrap inserts in their own
    if (!this._inTransaction) {
      await client.query('BEGIN')
    }

    try {
      for (const batch of batches) {
        await client.query(batch.sql)
      }

      // Apply deferred updates for self-referencing tables
      if (generationResult.deferredUpdates.length > 0) {
        const { buildUpdateSQL } = await import('../output/sql-builder.js')
        for (const update of generationResult.deferredUpdates) {
          if (update.tableName !== `${tableDef.schema}.${tableDef.name}` &&
              update.tableName !== tableDef.name) continue
          for (let i = 0; i < update.setColumns.length; i++) {
            const sql = buildUpdateSQL(
              tableDef.name, tableDef.schema,
              update.pkColumns, update.pkValues,
              update.setColumns[i], update.setValues[i],
            )
            await client.query(sql)
          }
        }
      }

      if (!this._inTransaction) {
        await client.query('COMMIT')
      }
    } catch (err) {
      if (!this._inTransaction) {
        try { await client.query('ROLLBACK') } catch { /* ignore */ }
      }
      throw err
    }
  }

  private async _insertMysql(
    tableDef: { name: string; columns: Map<string, { name: string; isGenerated: boolean }> },
    rows: Row[],
  ): Promise<void> {
    if (this._connection.type !== 'mysql') return
    const conn = this._connection.connection

    const columns = getInsertableColumns(tableDef, rows[0])
    const escapedCols = columns.map((c) => '`' + c.replace(/`/g, '``') + '`').join(', ')
    const escapedTable = '`' + tableDef.name.replace(/`/g, '``') + '`'

    if (!this._inTransaction) {
      await conn.query('START TRANSACTION')
    }

    try {
      for (let i = 0; i < rows.length; i += this._options.batchSize) {
        const batchRows = rows.slice(i, i + this._options.batchSize)
        const valueTuples = batchRows.map((row) => {
          const values = columns.map((col) => formatMysqlValue(row[col] ?? null))
          return `(${values.join(', ')})`
        })
        const sql = `INSERT INTO ${escapedTable} (${escapedCols}) VALUES\n${valueTuples.join(',\n')};`
        await conn.query(sql)
      }

      if (!this._inTransaction) {
        await conn.query('COMMIT')
      }
    } catch (err) {
      if (!this._inTransaction) {
        try { await conn.query('ROLLBACK') } catch { /* ignore */ }
      }
      throw err
    }
  }

  private _insertSqlite(
    tableDef: { name: string; columns: Map<string, { name: string; isGenerated: boolean }> },
    rows: Row[],
  ): void {
    if (this._connection.type !== 'sqlite') return
    const db = this._connection.db

    const columns = getInsertableColumns(tableDef, rows[0])
    const placeholders = columns.map(() => '?').join(', ')
    const escapedCols = columns.map((c) => `"${c}"`).join(', ')
    const sql = `INSERT INTO "${tableDef.name}" (${escapedCols}) VALUES (${placeholders})`
    const stmt = db.prepare(sql)

    const insertAll = db.transaction((rowsToInsert: Row[]) => {
      for (const row of rowsToInsert) {
        const values = columns.map((col) => prepareSqliteValue(row[col]))
        stmt.run(...values)
      }
    })

    insertAll(rows)
  }

  private _assertOpen(): void {
    if (this._closed) {
      throw new Error('Seeder has been closed. Create a new seeder instance.')
    }
  }
}

function getInsertableColumns(
  tableDef: { columns: Map<string, { name: string; isGenerated: boolean }> },
  sampleRow: Row,
): string[] {
  return Object.keys(sampleRow).filter((col) => {
    const colDef = tableDef.columns.get(col)
    return colDef && !colDef.isGenerated
  })
}

function applyColumnOverrides(
  rows: Row[],
  overrides: Record<string, { values?: unknown[]; weights?: number[] }>,
): Row[] {
  return rows.map((row, index) => {
    const newRow = { ...row }
    for (const [colName, override] of Object.entries(overrides)) {
      if (override.values && override.values.length > 0) {
        if (override.weights && override.weights.length === override.values.length) {
          // Weighted random selection (deterministic via index)
          newRow[colName] = weightedPick(override.values, override.weights, index)
        } else {
          // Cycle through values
          newRow[colName] = override.values[index % override.values.length]
        }
      }
    }
    return newRow
  })
}

// Knuth's multiplicative hash constant (golden ratio * 2^32)
const KNUTH_HASH_MULTIPLIER = 2654435761

function weightedPick(values: unknown[], weights: number[], index: number): unknown {
  const totalWeight = weights.reduce((sum, w) => sum + w, 0)
  // Use index to create a deterministic "random" position via multiplicative hashing
  const position = ((index * KNUTH_HASH_MULTIPLIER) % 1000) / 1000 * totalWeight
  let cumulative = 0
  for (let i = 0; i < weights.length; i++) {
    cumulative += weights[i]
    if (position < cumulative) {
      return values[i]
    }
  }
  return values[values.length - 1]
}

function formatMysqlValue(value: unknown): string {
  if (value === null || value === undefined) return 'NULL'
  if (typeof value === 'boolean') return value ? '1' : '0'
  if (typeof value === 'number') return isFinite(value) ? String(value) : 'NULL'
  if (typeof value === 'bigint') return String(value)
  if (value instanceof Date) {
    return `'${value.toISOString().replace('T', ' ').replace('Z', '')}'`
  }
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    return escapeMysqlString(JSON.stringify(value))
  }
  return escapeMysqlString(String(value))
}

function escapeMysqlString(str: string): string {
  const escaped = str
    .replace(/\\/g, '\\\\')
    .replace(/'/g, "\\'")
    .replace(/\0/g, '\\0')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    // eslint-disable-next-line no-control-regex
    .replace(/\x1a/g, '\\Z')
  return `'${escaped}'`
}

function prepareSqliteValue(value: unknown): unknown {
  if (value === null || value === undefined) return null
  if (value instanceof Date) return value.toISOString()
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) {
    return Buffer.isBuffer(value) ? value : Buffer.from(value)
  }
  if (typeof value === 'boolean') return value ? 1 : 0
  if (Array.isArray(value) || (typeof value === 'object' && value !== null)) {
    return JSON.stringify(value)
  }
  return value
}
