import { buildInsertPlan } from '../graph/index.js'
import { generate } from '../generate/index.js'
import { executeOutput, OutputMode, ProgressReporter } from '../output/index.js'
import type { PipelineOptions, PipelineResult, PipelineConnection } from './types.js'

/**
 * Run the full seedforge pipeline: plan -> generate -> execute.
 *
 * This is the core orchestration function used by both the CLI and the
 * programmatic API. It takes a pre-acquired schema and connection, then
 * builds the insert plan, generates data, and executes the output.
 */
export async function runPipeline(options: PipelineOptions): Promise<PipelineResult> {
  const {
    schema,
    connection,
    count,
    seed,
    dryRun = false,
    output,
    fast = false,
    batchSize = 500,
    quiet = false,
    version = '0.0.0',
  } = options

  const plan = buildInsertPlan(schema)

  // Determine output mode
  const mode = dryRun
    ? OutputMode.DRY_RUN
    : output
      ? OutputMode.FILE
      : OutputMode.DIRECT

  // For generation, only PG clients support existing-data queries
  const genClient = connection.type === 'pg' && mode !== OutputMode.DRY_RUN
    ? connection.client
    : null

  const generationResult = await generate(schema, plan, genClient, {
    globalRowCount: count,
    seed,
    tableCardinalityConfigs: options.tableCardinalityConfigs,
  })

  // Dispatch to the appropriate executor
  let summary

  if (mode === OutputMode.DIRECT && connection.type === 'mysql') {
    const { executeMysqlDirect } = await import('../output/executors/mysql-direct.js')
    const progress = new ProgressReporter({ quiet, showProgress: !quiet })
    summary = await executeMysqlDirect(
      generationResult,
      schema,
      plan.ordered,
      connection.connection,
      batchSize,
      progress,
    )
    progress.printSummary(summary)
  } else if (mode === OutputMode.DIRECT && connection.type === 'sqlite') {
    const { executeSqliteDirect } = await import('../output/executors/sqlite-direct.js')
    const progress = new ProgressReporter({ quiet, showProgress: !quiet })
    summary = executeSqliteDirect(
      generationResult,
      schema,
      plan.ordered,
      connection.db,
      batchSize,
      progress,
    )
    progress.printSummary(summary)
  } else {
    // PG direct, file, or dry-run modes go through executeOutput
    const outputOptions = {
      mode,
      client: mode === OutputMode.DIRECT && connection.type === 'pg'
        ? connection.client
        : undefined,
      filePath: output,
      batchSize,
      showProgress: !quiet,
      quiet,
      fast,
    }

    summary = await executeOutput(
      generationResult,
      schema,
      plan,
      outputOptions,
      version,
    )
  }

  return { generationResult, summary, plan, schema }
}

/**
 * Connect to a database, introspect the schema, and return the connection
 * and schema. Used by the programmatic API to handle connection setup.
 */
export async function connectAndIntrospect(
  connectionUrl: string,
  options: {
    schema?: string
    skipProductionCheck?: boolean
  } = {},
): Promise<{
  connection: PipelineConnection
  schema: import('../types/schema.js').DatabaseSchema
  disconnect: () => Promise<void>
}> {
  const { detectDatabaseType, DatabaseType } = await import('../introspect/adapter.js')
  const dbType = detectDatabaseType(connectionUrl)
  const effectiveSchema = options.schema ?? 'public'

  switch (dbType) {
    case DatabaseType.POSTGRES: {
      const { connect, disconnect } = await import('../introspect/index.js')
      const { introspect } = await import('../introspect/index.js')
      const client = await connect({
        connectionString: connectionUrl,
        schema: effectiveSchema,
        skipProductionCheck: options.skipProductionCheck ?? true,
      })
      try {
        const schema = await introspect(client, effectiveSchema)
        return {
          connection: { type: 'pg', client },
          schema,
          disconnect: () => disconnect(client),
        }
      } catch (err) {
        await disconnect(client)
        throw err
      }
    }

    case DatabaseType.MYSQL: {
      const { createAdapter } = await import('../introspect/adapter.js')
      const adapter = await createAdapter(DatabaseType.MYSQL)
      const connection = await adapter.connect({
        connectionString: connectionUrl,
        schema: effectiveSchema,
        skipProductionCheck: options.skipProductionCheck ?? true,
      })
      try {
        const mysqlConn = connection as import('mysql2/promise').Connection
        const dbName = extractDatabaseName(connectionUrl) ?? effectiveSchema
        const schema = await adapter.introspect(connection, dbName)
        return {
          connection: { type: 'mysql', connection: mysqlConn },
          schema,
          disconnect: () => adapter.disconnect(connection),
        }
      } catch (err) {
        await adapter.disconnect(connection)
        throw err
      }
    }

    case DatabaseType.SQLITE: {
      const { connectSqlite, disconnectSqlite, extractSqlitePath } = await import('../introspect/sqlite/connection.js')
      const { introspectSqlite } = await import('../introspect/sqlite/introspect.js')
      const filePath = extractSqlitePath(connectionUrl)
      const db = connectSqlite(filePath)
      try {
        const schema = introspectSqlite(db, filePath)
        return {
          connection: { type: 'sqlite', db },
          schema,
          disconnect: async () => disconnectSqlite(db),
        }
      } catch (err) {
        disconnectSqlite(db)
        throw err
      }
    }
  }
}

function extractDatabaseName(connectionUrl: string): string | null {
  try {
    const parsed = new URL(connectionUrl)
    return parsed.pathname.replace(/^\//, '') || null
  } catch {
    return null
  }
}
