import type { SeedOptions, SeedConfigOptions, SeedResult, Row } from './types.js'
import type { DatabaseSchema } from '../types/schema.js'
import { connectAndIntrospect, runPipeline } from '../core/pipeline.js'
import type { PipelineConnection } from '../core/types.js'

/**
 * Seed a database with realistic test data.
 *
 * This is the simplest entry point to seedforge's programmatic API.
 *
 * @example
 * // Seed a PostgreSQL database with defaults (50 rows/table)
 * await seed('postgres://localhost/testdb')
 *
 * @example
 * // With options
 * await seed('postgres://localhost/testdb', {
 *   count: 10,
 *   seed: 42,
 *   exclude: ['audit_log'],
 * })
 *
 * @example
 * // From a Prisma schema file (no live DB needed)
 * await seed({ prisma: './prisma/schema.prisma', output: './seed.sql' })
 *
 * @example
 * // Dry-run: returns generated SQL without executing
 * const result = await seed('postgres://localhost/testdb', { dryRun: true })
 */
export async function seed(
  connectionOrOptions: string | SeedConfigOptions,
  options?: SeedOptions,
): Promise<SeedResult> {
  const startTime = Date.now()

  // Normalize arguments
  const connectionUrl = typeof connectionOrOptions === 'string'
    ? connectionOrOptions
    : connectionOrOptions.db
  const opts: SeedOptions = typeof connectionOrOptions === 'string'
    ? (options ?? {})
    : connectionOrOptions

  const {
    count = 50,
    seed: prngSeed,
    exclude,
    schema: schemaName = 'public',
    dryRun = false,
    output,
    fast = false,
    batchSize = 500,
    quiet = true,
    skipProductionCheck = true,
    prisma,
    drizzle,
    jpa,
    typeorm,
    ai,
  } = opts

  let dbSchema: DatabaseSchema
  let connection: PipelineConnection = { type: 'none' }
  let disconnectFn: (() => Promise<void>) | null = null

  // Helper: connect to DB for direct insertion alongside parser-based schema
  const connectIfUrl = async () => {
    if (connectionUrl) {
      const result = await connectAndIntrospect(connectionUrl, {
        schema: schemaName,
        skipProductionCheck,
      })
      connection = result.connection
      disconnectFn = result.disconnect
    }
  }

  try {
    // Acquire schema from parser or database introspection
    if (prisma) {
      const { parsePrismaFile } = await import('../parsers/prisma/index.js')
      dbSchema = parsePrismaFile(prisma)
      await connectIfUrl()
    } else if (drizzle) {
      const { parseDrizzleFile } = await import('../parsers/drizzle/index.js')
      dbSchema = parseDrizzleFile(drizzle, schemaName)
      await connectIfUrl()
    } else if (jpa) {
      const { parseJpaDirectory } = await import('../parsers/jpa/index.js')
      dbSchema = parseJpaDirectory(jpa, { schemaName })
      await connectIfUrl()
    } else if (typeorm) {
      const { parseTypeORMDirectory } = await import('../parsers/typeorm/index.js')
      dbSchema = parseTypeORMDirectory(typeorm)
      await connectIfUrl()
    } else if (connectionUrl) {
      const result = await connectAndIntrospect(connectionUrl, {
        schema: schemaName,
        skipProductionCheck,
      })
      dbSchema = result.schema
      connection = result.connection
      disconnectFn = result.disconnect
    } else {
      throw new Error(
        'No database connection or schema file provided. ' +
        'Pass a connection URL or use prisma/drizzle/jpa/typeorm option.',
      )
    }

    // Apply excludes — try both raw name and schema-qualified name
    if (exclude && exclude.length > 0) {
      for (const tableName of exclude) {
        // Direct match (e.g. 'basic_types' or 'public.basic_types')
        if (dbSchema.tables.has(tableName)) {
          dbSchema.tables.delete(tableName)
        } else {
          // Try matching by qualified name pattern
          for (const [key, table] of dbSchema.tables) {
            const qualifiedName = `${table.schema}.${table.name}`
            if (qualifiedName === tableName || table.name === tableName || key === tableName) {
              dbSchema.tables.delete(key)
              break
            }
          }
        }
      }
    }

    // Run the pipeline
    const result = await runPipeline({
      schema: dbSchema,
      connection,
      count,
      seed: prngSeed,
      dryRun,
      output,
      fast,
      batchSize,
      quiet,
      ai,
    })

    // Build result
    const tables = new Map<string, Row[]>()
    let rowCount = 0
    for (const [tableName, tableResult] of result.generationResult.tables) {
      tables.set(tableName, tableResult.rows)
      rowCount += tableResult.rows.length
    }

    return {
      tables,
      rowCount,
      duration: Date.now() - startTime,
      summary: result.summary,
    }
  } finally {
    if (disconnectFn) {
      await disconnectFn()
    }
  }
}
