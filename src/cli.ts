#!/usr/bin/env node

import { createRequire } from 'node:module'
import { Command } from 'commander'
import { SeedForgeError, ConfigError, PluginError, redactConnectionString } from './errors/index.js'
import { connect, disconnect, introspect } from './introspect/index.js'
import { detectDatabaseType, DatabaseType, createAdapter } from './introspect/adapter.js'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { parseDrizzleFile } from './parsers/drizzle/index.js'
import { parsePrismaFile } from './parsers/prisma/index.js'
import { parseJpaDirectory } from './parsers/jpa/index.js'
import { parseTypeORMDirectory } from './parsers/typeorm/index.js'
import { loadAndMergeConfig } from './config/loader.js'
import { PluginRegistry, loadSinglePlugin } from './plugins/index.js'
import type { CliOverrides } from './config/types.js'
import { buildInsertPlan } from './graph/index.js'
import { generate } from './generate/index.js'
import { executeOutput, resolveOutputMode, OutputMode } from './output/index.js'

const require = createRequire(import.meta.url)
const pkg = require('../package.json') as { version: string }

export interface CliOptions {
  db?: string
  drizzle?: string
  prisma?: string
  jpa?: string
  typeorm?: string
  plugin?: string[]
  config?: string
  count: number
  seed?: number
  dryRun: boolean
  output?: string
  schema: string
  exclude: string[]
  verbose: boolean
  quiet: boolean
  debug: boolean
  json: boolean
  yes: boolean
  fast: boolean
}

export function createProgram(): Command {
  const program = new Command()

  program
    .name('seedforge')
    .description('Generate realistic seed data from your database schema')
    .version(pkg.version)
    .option('--db <url>', 'database connection string (postgres://, mysql://, sqlite:, or .db/.sqlite path)')
    .option('--drizzle <path>', 'path to Drizzle ORM schema file or directory')
    .option('--prisma <path>', 'path to Prisma schema file (.prisma)')
    .option('--jpa <path>', 'path to JPA entity classes directory')
    .option('--typeorm <path>', 'path to TypeORM entity classes directory')
    .option('--plugin <paths...>', 'paths to plugin modules to load')
    .option('--config <path>', 'path to .seedforge.yml config file')
    .option('--count <number>', 'rows per table', (v) => parseInt(v, 10), 50)
    .option('--seed <number>', 'PRNG seed for deterministic output', (v) => parseInt(v, 10))
    .option('--dry-run', 'preview without executing', false)
    .option('--output <file>', 'SQL file export path')
    .option('--schema <name>', 'database schema to introspect', 'public')
    .option('--exclude <tables...>', 'tables to skip')
    .option('--verbose', 'verbose logging', false)
    .option('--quiet', 'suppress non-essential output', false)
    .option('--debug', 'debug logging', false)
    .option('--json', 'machine-readable JSON output', false)
    .option('--yes', 'skip confirmation prompts', false)
    .option('--fast', 'use COPY-based insertion for PostgreSQL (faster for large datasets)', false)
    .addHelpText('after', `
Examples:
  $ seedforge --db postgres://localhost/mydb
  $ seedforge --db mysql://root:pass@localhost/mydb
  $ seedforge --db sqlite:./dev.db
  $ seedforge --db ./data.sqlite --output seed.sql
  $ seedforge --db postgres://localhost/mydb --count 100 --seed 42
  $ seedforge --db postgres://localhost/mydb --output seed.sql --dry-run
  $ seedforge --drizzle ./src/db/schema.ts --output seed.sql --dry-run
  $ seedforge --prisma ./prisma/schema.prisma --output seed.sql
  $ seedforge --jpa ./src/main/java/com/example/entities/ --output seed.sql --dry-run
  $ seedforge --typeorm ./src/entities/ --output seed.sql --dry-run
  $ seedforge --config .seedforge.yml
`)
    .action(async (options: CliOptions) => {
      // Build CLI overrides: only include values explicitly passed by the user
      const cliOverrides: CliOverrides = {}
      const optionSources = program as unknown as { getOptionValueSource(name: string): string | undefined }
      if (typeof optionSources.getOptionValueSource === 'function') {
        if (optionSources.getOptionValueSource('db') === 'cli') {
          cliOverrides.db = options.db
        }
        if (optionSources.getOptionValueSource('count') === 'cli') {
          cliOverrides.count = options.count
        }
        if (optionSources.getOptionValueSource('seed') === 'cli') {
          cliOverrides.seed = options.seed
        }
        if (optionSources.getOptionValueSource('schema') === 'cli') {
          cliOverrides.schema = options.schema
        }
        if (optionSources.getOptionValueSource('exclude') === 'cli') {
          cliOverrides.exclude = options.exclude
        }
        if (optionSources.getOptionValueSource('output') === 'cli') {
          cliOverrides.output = options.output
        }
        if (optionSources.getOptionValueSource('dryRun') === 'cli') {
          cliOverrides.dryRun = options.dryRun
        }
      } else {
        // Fallback: treat all options as CLI-provided
        if (options.db) cliOverrides.db = options.db
        if (options.seed !== undefined) cliOverrides.seed = options.seed
        if (options.exclude) cliOverrides.exclude = options.exclude
        cliOverrides.count = options.count
        cliOverrides.schema = options.schema
      }

      // Load and merge config
      const mergedConfig = loadAndMergeConfig(cliOverrides, {
        configPath: options.config,
      })

      const effectiveSchema = mergedConfig.connection.schema ?? options.schema ?? 'public'
      const effectiveCount = mergedConfig.count
      const effectiveSeed = mergedConfig.seed

      // Determine connection URL
      const connectionUrl = mergedConfig.connection.url ?? options.db

      // ─── Plugin loading ──────────────────────────────────────────
      const pluginRegistry = new PluginRegistry()
      if (options.plugin && options.plugin.length > 0) {
        for (const pluginPath of options.plugin) {
          try {
            const loaded = await loadSinglePlugin(pluginPath, process.cwd())
            pluginRegistry.register(loaded)
            if (options.verbose && !options.quiet) {
              console.log(`Loaded plugin: ${loaded.plugin.name} v${loaded.plugin.version} (${loaded.type})`)
            }
          } catch (err) {
            if (err instanceof PluginError) {
              throw err
            }
            const detail = err instanceof Error ? err.message : String(err)
            throw new PluginError(
              'SF6001',
              `Failed to load plugin: ${pluginPath}`,
              ['Check the plugin path is correct and the module is valid'],
              { pluginPath, detail },
            )
          }
        }
      }

      // ─── Try parser plugin auto-detection ────────────────────────
      if (!connectionUrl && !options.drizzle && !options.prisma && !options.jpa && !options.typeorm) {
        const detectedParser = await pluginRegistry.detectParser(process.cwd())
        if (detectedParser) {
          if (!options.quiet) {
            console.log(`seedforge v${pkg.version} (plugin: ${detectedParser.name})`)
            console.log(`Parsing schema with plugin: ${detectedParser.name}`)
          }

          const schema = await detectedParser.parse(process.cwd())

          if (!options.quiet) {
            const tableCount = schema.tables.size
            const enumCount = schema.enums.size
            const fkCount = Array.from(schema.tables.values())
              .reduce((sum, t) => sum + t.foreignKeys.length, 0)
            console.log(
              `Parsed ${tableCount} tables, ${enumCount} enums, ${fkCount} foreign keys`,
            )
          }

          const plan = buildInsertPlan(schema)
          const mode = resolveOutputMode(options)
          const generationResult = await generate(schema, plan, null, {
            globalRowCount: effectiveCount,
            seed: effectiveSeed,
          })

          if (!options.quiet) {
            const totalRows = Array.from(generationResult.tables.values())
              .reduce((sum, t) => sum + t.rows.length, 0)
            console.log(`Generated ${totalRows} rows across ${generationResult.tables.size} tables`)
          }

          const outputOptions = {
            mode,
            filePath: options.output,
            batchSize: 500,
            showProgress: !options.quiet,
            quiet: options.quiet,
          }

          const summary = await executeOutput(
            generationResult,
            schema,
            plan,
            outputOptions,
            pkg.version,
          )

          if (options.json) {
            const jsonSummary = {
              ...summary,
              rowsPerTable: Object.fromEntries(summary.rowsPerTable),
            }
            console.log(JSON.stringify(jsonSummary, null, 2))
          }

          return
        }
      }

      // ─── Prisma schema-file path ─────────────────────────────────
      // Auto-detect: if no --prisma, no --db, no --drizzle, no --jpa, no --typeorm,
      // check for prisma/schema.prisma in CWD
      let prismaPath = options.prisma
      if (!prismaPath && !connectionUrl && !options.drizzle && !options.jpa && !options.typeorm) {
        const autoPath = join(process.cwd(), 'prisma', 'schema.prisma')
        if (existsSync(autoPath)) {
          prismaPath = autoPath
        }
      }

      if (prismaPath) {
        if (!options.quiet) {
          console.log(`seedforge v${pkg.version} (Prisma schema)`)
          console.log(`Parsing Prisma schema: ${prismaPath}`)
        }

        const schema = parsePrismaFile(prismaPath)

        if (!options.quiet) {
          const tableCount = schema.tables.size
          const enumCount = schema.enums.size
          const fkCount = Array.from(schema.tables.values())
            .reduce((sum, t) => sum + t.foreignKeys.length, 0)
          console.log(
            `Parsed ${tableCount} tables, ${enumCount} enums, ${fkCount} foreign keys`,
          )
        }

        if (options.verbose) {
          for (const [name, table] of schema.tables) {
            console.log(
              `  ${name}: ${table.columns.size} columns, ${table.foreignKeys.length} FKs`,
            )
          }
        }

        if (options.debug) {
          const serializable = {
            ...schema,
            tables: Object.fromEntries(
              Array.from(schema.tables.entries()).map(([k, v]) => [
                k,
                { ...v, columns: Object.fromEntries(v.columns) },
              ]),
            ),
            enums: Object.fromEntries(schema.enums),
          }
          console.log(JSON.stringify(serializable, null, 2))
        }

        const plan = buildInsertPlan(schema)

        if (options.verbose && !options.quiet) {
          console.log(`Insert order: ${plan.ordered.join(' -> ')}`)
          if (plan.deferredEdges.length > 0) {
            console.log(`Deferred edges: ${plan.deferredEdges.length}`)
          }
          if (plan.selfRefTables.length > 0) {
            console.log(`Self-referencing tables: ${plan.selfRefTables.join(', ')}`)
          }
        }

        // If --db is also provided, connect for direct insertion
        let client: Awaited<ReturnType<typeof connect>> | null = null
        if (connectionUrl) {
          client = await connect({
            connectionString: connectionUrl,
            schema: effectiveSchema,
            skipProductionCheck: options.yes,
          })
        }

        try {
          const mode = resolveOutputMode(options)
          const generationResult = await generate(schema, plan, client, {
            globalRowCount: effectiveCount,
            seed: effectiveSeed,
          })

          if (!options.quiet) {
            const totalRows = Array.from(generationResult.tables.values())
              .reduce((sum, t) => sum + t.rows.length, 0)
            console.log(`Generated ${totalRows} rows across ${generationResult.tables.size} tables`)
          }

          const outputOptions = {
            mode,
            client: mode === OutputMode.DIRECT && client ? client : undefined,
            filePath: options.output,
            batchSize: 500,
            showProgress: !options.quiet,
            quiet: options.quiet,
          }

          const summary = await executeOutput(
            generationResult,
            schema,
            plan,
            outputOptions,
            pkg.version,
          )

          if (options.json) {
            const jsonSummary = {
              ...summary,
              rowsPerTable: Object.fromEntries(summary.rowsPerTable),
            }
            console.log(JSON.stringify(jsonSummary, null, 2))
          }
        } finally {
          if (client) {
            await disconnect(client)
          }
        }

        return
      }

      // ─── Drizzle schema-file path ────────────────────────────────
      if (options.drizzle) {
        if (!options.quiet) {
          console.log(`seedforge v${pkg.version} (Drizzle schema)`)
          console.log(`Parsing Drizzle schema: ${options.drizzle}`)
        }

        if (options.debug) {
          console.log('Options:', { ...options })
        }

        const schema = parseDrizzleFile(options.drizzle, effectiveSchema)

        if (!options.quiet) {
          const tableCount = schema.tables.size
          const enumCount = schema.enums.size
          const fkCount = Array.from(schema.tables.values())
            .reduce((sum, t) => sum + t.foreignKeys.length, 0)
          console.log(
            `Parsed ${tableCount} tables, ${enumCount} enums, ${fkCount} foreign keys from Drizzle schema`,
          )
        }

        if (options.verbose) {
          for (const [name, table] of schema.tables) {
            console.log(
              `  ${name}: ${table.columns.size} columns, ${table.foreignKeys.length} FKs`,
            )
          }
        }

        if (options.debug) {
          const serializable = {
            ...schema,
            tables: Object.fromEntries(
              Array.from(schema.tables.entries()).map(([k, v]) => [
                k,
                { ...v, columns: Object.fromEntries(v.columns) },
              ]),
            ),
            enums: Object.fromEntries(schema.enums),
          }
          console.log(JSON.stringify(serializable, null, 2))
        }

        const plan = buildInsertPlan(schema)

        if (options.verbose && !options.quiet) {
          console.log(`Insert order: ${plan.ordered.join(' -> ')}`)
          if (plan.deferredEdges.length > 0) {
            console.log(`Deferred edges: ${plan.deferredEdges.length}`)
          }
          if (plan.selfRefTables.length > 0) {
            console.log(`Self-referencing tables: ${plan.selfRefTables.join(', ')}`)
          }
        }

        // If --db is also provided, connect for direct insertion
        let drizzleClient: Awaited<ReturnType<typeof connect>> | null = null
        if (connectionUrl) {
          drizzleClient = await connect({
            connectionString: connectionUrl,
            schema: effectiveSchema,
            skipProductionCheck: options.yes,
          })
        }

        try {
          const mode = resolveOutputMode(options)
          const generationClient = mode === OutputMode.DRY_RUN ? null : drizzleClient
          const generationResult = await generate(schema, plan, generationClient, {
            globalRowCount: effectiveCount,
            seed: effectiveSeed,
          })

          if (!options.quiet) {
            const totalRows = Array.from(generationResult.tables.values())
              .reduce((sum, t) => sum + t.rows.length, 0)
            console.log(`Generated ${totalRows} rows across ${generationResult.tables.size} tables`)
          }

          const outputOptions = {
            mode,
            client: mode === OutputMode.DIRECT && drizzleClient ? drizzleClient : undefined,
            filePath: options.output,
            batchSize: 500,
            showProgress: !options.quiet,
            quiet: options.quiet,
          }

          const summary = await executeOutput(
            generationResult,
            schema,
            plan,
            outputOptions,
            pkg.version,
          )

          if (options.json) {
            const jsonSummary = {
              ...summary,
              rowsPerTable: Object.fromEntries(summary.rowsPerTable),
            }
            console.log(JSON.stringify(jsonSummary, null, 2))
          }
        } finally {
          if (drizzleClient) {
            await disconnect(drizzleClient)
          }
        }

        return
      }

      // ─── JPA entity path ─────────────────────────────────────────
      if (options.jpa) {
        if (!options.quiet) {
          console.log(`seedforge v${pkg.version} (JPA entities)`)
          console.log(`Parsing JPA entities: ${options.jpa}`)
        }

        if (options.debug) {
          console.log('Options:', { ...options })
        }

        const schema = parseJpaDirectory(options.jpa, { schemaName: effectiveSchema })

        if (!options.quiet) {
          const tableCount = schema.tables.size
          const enumCount = schema.enums.size
          const fkCount = Array.from(schema.tables.values())
            .reduce((sum, t) => sum + t.foreignKeys.length, 0)
          console.log(
            `Parsed ${tableCount} tables, ${enumCount} enums, ${fkCount} foreign keys from JPA entities`,
          )
        }

        if (options.verbose) {
          for (const [name, table] of schema.tables) {
            console.log(
              `  ${name}: ${table.columns.size} columns, ${table.foreignKeys.length} FKs`,
            )
          }
        }

        if (options.debug) {
          const serializable = {
            ...schema,
            tables: Object.fromEntries(
              Array.from(schema.tables.entries()).map(([k, v]) => [
                k,
                { ...v, columns: Object.fromEntries(v.columns) },
              ]),
            ),
            enums: Object.fromEntries(schema.enums),
          }
          console.log(JSON.stringify(serializable, null, 2))
        }

        const plan = buildInsertPlan(schema)

        if (options.verbose && !options.quiet) {
          console.log(`Insert order: ${plan.ordered.join(' -> ')}`)
          if (plan.deferredEdges.length > 0) {
            console.log(`Deferred edges: ${plan.deferredEdges.length}`)
          }
          if (plan.selfRefTables.length > 0) {
            console.log(`Self-referencing tables: ${plan.selfRefTables.join(', ')}`)
          }
        }

        // If --db is also provided, connect for direct insertion
        let jpaClient: Awaited<ReturnType<typeof connect>> | null = null
        if (connectionUrl) {
          jpaClient = await connect({
            connectionString: connectionUrl,
            schema: effectiveSchema,
            skipProductionCheck: options.yes,
          })
        }

        try {
          const mode = resolveOutputMode(options)
          const generationClient = mode === OutputMode.DRY_RUN ? null : jpaClient
          const generationResult = await generate(schema, plan, generationClient, {
            globalRowCount: effectiveCount,
            seed: effectiveSeed,
          })

          if (!options.quiet) {
            const totalRows = Array.from(generationResult.tables.values())
              .reduce((sum, t) => sum + t.rows.length, 0)
            console.log(`Generated ${totalRows} rows across ${generationResult.tables.size} tables`)
          }

          const outputOptions = {
            mode,
            client: mode === OutputMode.DIRECT && jpaClient ? jpaClient : undefined,
            filePath: options.output,
            batchSize: 500,
            showProgress: !options.quiet,
            quiet: options.quiet,
          }

          const summary = await executeOutput(
            generationResult,
            schema,
            plan,
            outputOptions,
            pkg.version,
          )

          if (options.json) {
            const jsonSummary = {
              ...summary,
              rowsPerTable: Object.fromEntries(summary.rowsPerTable),
            }
            console.log(JSON.stringify(jsonSummary, null, 2))
          }
        } finally {
          if (jpaClient) {
            await disconnect(jpaClient)
          }
        }

        return
      }

      // ─── TypeORM entity path ──────────────────────────────────────
      if (options.typeorm) {
        if (!options.quiet) {
          console.log(`seedforge v${pkg.version} (TypeORM entities)`)
          console.log(`Parsing TypeORM entities: ${options.typeorm}`)
        }

        if (options.debug) {
          console.log('Options:', { ...options })
        }

        const schema = parseTypeORMDirectory(options.typeorm)

        if (!options.quiet) {
          const tableCount = schema.tables.size
          const enumCount = schema.enums.size
          const fkCount = Array.from(schema.tables.values())
            .reduce((sum, t) => sum + t.foreignKeys.length, 0)
          console.log(
            `Parsed ${tableCount} tables, ${enumCount} enums, ${fkCount} foreign keys from TypeORM entities`,
          )
        }

        if (options.verbose) {
          for (const [name, table] of schema.tables) {
            console.log(
              `  ${name}: ${table.columns.size} columns, ${table.foreignKeys.length} FKs`,
            )
          }
        }

        if (options.debug) {
          const serializable = {
            ...schema,
            tables: Object.fromEntries(
              Array.from(schema.tables.entries()).map(([k, v]) => [
                k,
                { ...v, columns: Object.fromEntries(v.columns) },
              ]),
            ),
            enums: Object.fromEntries(schema.enums),
          }
          console.log(JSON.stringify(serializable, null, 2))
        }

        const plan = buildInsertPlan(schema)

        if (options.verbose && !options.quiet) {
          console.log(`Insert order: ${plan.ordered.join(' -> ')}`)
          if (plan.deferredEdges.length > 0) {
            console.log(`Deferred edges: ${plan.deferredEdges.length}`)
          }
          if (plan.selfRefTables.length > 0) {
            console.log(`Self-referencing tables: ${plan.selfRefTables.join(', ')}`)
          }
        }

        // If --db is also provided, connect for direct insertion
        let typeormClient: Awaited<ReturnType<typeof connect>> | null = null
        if (connectionUrl) {
          typeormClient = await connect({
            connectionString: connectionUrl,
            schema: effectiveSchema,
            skipProductionCheck: options.yes,
          })
        }

        try {
          const mode = resolveOutputMode(options)
          const generationClient = mode === OutputMode.DRY_RUN ? null : typeormClient
          const generationResult = await generate(schema, plan, generationClient, {
            globalRowCount: effectiveCount,
            seed: effectiveSeed,
          })

          if (!options.quiet) {
            const totalRows = Array.from(generationResult.tables.values())
              .reduce((sum, t) => sum + t.rows.length, 0)
            console.log(`Generated ${totalRows} rows across ${generationResult.tables.size} tables`)
          }

          const outputOptions = {
            mode,
            client: mode === OutputMode.DIRECT && typeormClient ? typeormClient : undefined,
            filePath: options.output,
            batchSize: 500,
            showProgress: !options.quiet,
            quiet: options.quiet,
          }

          const summary = await executeOutput(
            generationResult,
            schema,
            plan,
            outputOptions,
            pkg.version,
          )

          if (options.json) {
            const jsonSummary = {
              ...summary,
              rowsPerTable: Object.fromEntries(summary.rowsPerTable),
            }
            console.log(JSON.stringify(jsonSummary, null, 2))
          }
        } finally {
          if (typeormClient) {
            await disconnect(typeormClient)
          }
        }

        return
      }

      // ─── DB introspection path ───────────────────────────────────
      if (!connectionUrl) {
        throw new ConfigError(
          'SF5017',
          'No database connection URL provided',
          [
            'Pass --db <url> on the command line',
            'Or use --drizzle <path> to parse a Drizzle schema file',
            'Or use --prisma <path> to parse a Prisma schema file',
            'Or use --jpa <path> to parse JPA entity classes',
            'Or use --typeorm <path> to parse TypeORM entity classes',
            'Or set connection.url in .seedforge.yml',
            'Or set DATABASE_URL environment variable and use ${DATABASE_URL} in config',
          ],
        )
      }

      // Detect database type from connection URL scheme
      const dbType = detectDatabaseType(connectionUrl)

      // Validate --fast flag: only supported with PostgreSQL
      if (options.fast && dbType !== DatabaseType.POSTGRES) {
        throw new ConfigError(
          'SF5019',
          'The --fast flag is only supported with PostgreSQL databases',
          [
            'Remove the --fast flag to use standard batched INSERTs',
            'The --fast flag uses PostgreSQL COPY protocol which is not available for other databases',
          ],
        )
      }

      if (!options.quiet) {
        const dbLabelMap: Record<string, string> = {
          [DatabaseType.POSTGRES]: 'PostgreSQL',
          [DatabaseType.MYSQL]: 'MySQL',
          [DatabaseType.SQLITE]: 'SQLite',
        }
        const dbLabel = dbLabelMap[dbType] ?? dbType
        console.log(`seedforge v${pkg.version} (${dbLabel})`)
      }

      if (options.debug) {
        console.log('Options:', {
          ...options,
          db: redactConnectionString(connectionUrl),
        })
      }

      if (dbType === DatabaseType.SQLITE) {
        // ─── SQLite path ────────────────────────────────────────────────
        const { connectSqlite, disconnectSqlite, extractSqlitePath } = await import('./introspect/sqlite/connection.js')
        const { introspectSqlite } = await import('./introspect/sqlite/introspect.js')
        const { executeSqliteDirect } = await import('./output/executors/sqlite-direct.js')

        const filePath = extractSqlitePath(connectionUrl)
        const sqliteDb = connectSqlite(filePath)

        try {
          const schema = introspectSqlite(sqliteDb, filePath)

          if (!options.quiet) {
            const tableCount = schema.tables.size
            const enumCount = schema.enums.size
            const fkCount = Array.from(schema.tables.values())
              .reduce((sum, t) => sum + t.foreignKeys.length, 0)
            console.log(
              `Introspected ${tableCount} tables, ${enumCount} enums, ${fkCount} foreign keys`,
            )
          }

          if (options.verbose) {
            for (const [name, table] of schema.tables) {
              console.log(
                `  ${name}: ${table.columns.size} columns, ${table.foreignKeys.length} FKs`,
              )
            }
          }

          if (options.debug) {
            const serializable = {
              ...schema,
              tables: Object.fromEntries(
                Array.from(schema.tables.entries()).map(([k, v]) => [
                  k,
                  { ...v, columns: Object.fromEntries(v.columns) },
                ]),
              ),
              enums: Object.fromEntries(schema.enums),
            }
            console.log(JSON.stringify(serializable, null, 2))
          }

          const plan = buildInsertPlan(schema)

          if (options.verbose && !options.quiet) {
            console.log(`Insert order: ${plan.ordered.join(' -> ')}`)
            if (plan.deferredEdges.length > 0) {
              console.log(`Deferred edges: ${plan.deferredEdges.length}`)
            }
            if (plan.selfRefTables.length > 0) {
              console.log(`Self-referencing tables: ${plan.selfRefTables.join(', ')}`)
            }
          }

          const mode = resolveOutputMode(options)
          const generationResult = await generate(schema, plan, null, {
            globalRowCount: effectiveCount,
            seed: effectiveSeed,
          })

          if (!options.quiet) {
            const totalRows = Array.from(generationResult.tables.values())
              .reduce((sum, t) => sum + t.rows.length, 0)
            console.log(`Generated ${totalRows} rows across ${generationResult.tables.size} tables`)
          }

          if (mode === OutputMode.DIRECT) {
            const { ProgressReporter } = await import('./output/progress.js')
            const progress = new ProgressReporter({
              quiet: options.quiet,
              showProgress: !options.quiet,
            })
            const summary = executeSqliteDirect(
              generationResult,
              schema,
              plan.ordered,
              sqliteDb,
              500,
              progress,
            )
            progress.printSummary(summary)

            if (options.json) {
              const jsonSummary = {
                ...summary,
                rowsPerTable: Object.fromEntries(summary.rowsPerTable),
              }
              console.log(JSON.stringify(jsonSummary, null, 2))
            }
          } else {
            const outputOptions = {
              mode,
              filePath: options.output,
              batchSize: 500,
              showProgress: !options.quiet,
              quiet: options.quiet,
            }

            const summary = await executeOutput(
              generationResult,
              schema,
              plan,
              outputOptions,
              pkg.version,
            )

            if (options.json) {
              const jsonSummary = {
                ...summary,
                rowsPerTable: Object.fromEntries(summary.rowsPerTable),
              }
              console.log(JSON.stringify(jsonSummary, null, 2))
            }
          }
        } finally {
          disconnectSqlite(sqliteDb)
        }
      } else if (dbType === DatabaseType.MYSQL) {
        // ─── MySQL path ───────────────────────────────────────────────
        const adapter = await createAdapter(DatabaseType.MYSQL)
        const connection = await adapter.connect({
          connectionString: connectionUrl,
          schema: effectiveSchema,
          skipProductionCheck: options.yes,
        })

        try {
          // For MySQL, the "schema" is the database name
          const mysqlDb = extractMysqlDatabase(connectionUrl, effectiveSchema)
          const schema = await adapter.introspect(connection, mysqlDb)

          if (!options.quiet) {
            const tableCount = schema.tables.size
            const enumCount = schema.enums.size
            const fkCount = Array.from(schema.tables.values())
              .reduce((sum, t) => sum + t.foreignKeys.length, 0)
            console.log(
              `Introspected ${tableCount} tables, ${enumCount} enums, ${fkCount} foreign keys`,
            )
          }

          if (options.verbose) {
            for (const [name, table] of schema.tables) {
              console.log(
                `  ${name}: ${table.columns.size} columns, ${table.foreignKeys.length} FKs`,
              )
            }
          }

          if (options.debug) {
            const serializable = {
              ...schema,
              tables: Object.fromEntries(
                Array.from(schema.tables.entries()).map(([k, v]) => [
                  k,
                  { ...v, columns: Object.fromEntries(v.columns) },
                ]),
              ),
              enums: Object.fromEntries(schema.enums),
            }
            console.log(JSON.stringify(serializable, null, 2))
          }

          const plan = buildInsertPlan(schema)

          if (options.verbose && !options.quiet) {
            console.log(`Insert order: ${plan.ordered.join(' -> ')}`)
            if (plan.deferredEdges.length > 0) {
              console.log(`Deferred edges: ${plan.deferredEdges.length}`)
            }
            if (plan.selfRefTables.length > 0) {
              console.log(`Self-referencing tables: ${plan.selfRefTables.join(', ')}`)
            }
          }

          // Generate data (no live-DB client for generation queries in MySQL path for now)
          const mode = resolveOutputMode(options)
          const generationResult = await generate(schema, plan, null, {
            globalRowCount: effectiveCount,
            seed: effectiveSeed,
          })

          if (!options.quiet) {
            const totalRows = Array.from(generationResult.tables.values())
              .reduce((sum, t) => sum + t.rows.length, 0)
            console.log(`Generated ${totalRows} rows across ${generationResult.tables.size} tables`)
          }

          // Output
          if (mode === OutputMode.DIRECT) {
            // Use the MySQL executor directly
            const { executeMysqlDirect } = await import('./output/executors/mysql-direct.js')
            const { ProgressReporter } = await import('./output/progress.js')
            const progress = new ProgressReporter({
              quiet: options.quiet,
              showProgress: !options.quiet,
            })
            const mysqlConn = connection as import('mysql2/promise').Connection
            const summary = await executeMysqlDirect(
              generationResult,
              schema,
              plan.ordered,
              mysqlConn,
              500,
              progress,
            )
            progress.printSummary(summary)

            if (options.json) {
              const jsonSummary = {
                ...summary,
                rowsPerTable: Object.fromEntries(summary.rowsPerTable),
              }
              console.log(JSON.stringify(jsonSummary, null, 2))
            }
          } else {
            // FILE or DRY_RUN modes use the existing output layer (SQL is PG-flavored but functional)
            const outputOptions = {
              mode,
              filePath: options.output,
              batchSize: 500,
              showProgress: !options.quiet,
              quiet: options.quiet,
            }

            const summary = await executeOutput(
              generationResult,
              schema,
              plan,
              outputOptions,
              pkg.version,
            )

            if (options.json) {
              const jsonSummary = {
                ...summary,
                rowsPerTable: Object.fromEntries(summary.rowsPerTable),
              }
              console.log(JSON.stringify(jsonSummary, null, 2))
            }
          }
        } finally {
          await adapter.disconnect(connection)
        }
      } else {
        // ─── PostgreSQL path (existing) ──────────────────────────────
        const client = await connect({
          connectionString: connectionUrl,
          schema: effectiveSchema,
          skipProductionCheck: options.yes,
        })

        try {
          const schema = await introspect(client, effectiveSchema)

          if (!options.quiet) {
            const tableCount = schema.tables.size
            const enumCount = schema.enums.size
            const fkCount = Array.from(schema.tables.values())
              .reduce((sum, t) => sum + t.foreignKeys.length, 0)
            console.log(
              `Introspected ${tableCount} tables, ${enumCount} enums, ${fkCount} foreign keys`,
            )
          }

          if (options.verbose) {
            for (const [name, table] of schema.tables) {
              console.log(
                `  ${name}: ${table.columns.size} columns, ${table.foreignKeys.length} FKs`,
              )
            }
          }

          if (options.debug) {
            const serializable = {
              ...schema,
              tables: Object.fromEntries(
                Array.from(schema.tables.entries()).map(([k, v]) => [
                  k,
                  { ...v, columns: Object.fromEntries(v.columns) },
                ]),
              ),
              enums: Object.fromEntries(schema.enums),
            }
            console.log(JSON.stringify(serializable, null, 2))
          }

          const plan = buildInsertPlan(schema)

          if (options.verbose && !options.quiet) {
            console.log(`Insert order: ${plan.ordered.join(' -> ')}`)
            if (plan.deferredEdges.length > 0) {
              console.log(`Deferred edges: ${plan.deferredEdges.length}`)
            }
            if (plan.selfRefTables.length > 0) {
              console.log(`Self-referencing tables: ${plan.selfRefTables.join(', ')}`)
            }
          }

          const mode = resolveOutputMode(options)
          const generationClient = mode === OutputMode.DRY_RUN ? null : client
          const generationResult = await generate(schema, plan, generationClient, {
            globalRowCount: effectiveCount,
            seed: effectiveSeed,
          })

          if (!options.quiet) {
            const totalRows = Array.from(generationResult.tables.values())
              .reduce((sum, t) => sum + t.rows.length, 0)
            console.log(`Generated ${totalRows} rows across ${generationResult.tables.size} tables`)
          }

          const outputOptions = {
            mode,
            client: mode === OutputMode.DIRECT ? client : undefined,
            filePath: options.output,
            batchSize: 500,
            showProgress: !options.quiet,
            quiet: options.quiet,
            fast: options.fast,
          }

          const summary = await executeOutput(
            generationResult,
            schema,
            plan,
            outputOptions,
            pkg.version,
          )

          if (options.json) {
            const jsonSummary = {
              ...summary,
              rowsPerTable: Object.fromEntries(summary.rowsPerTable),
            }
            console.log(JSON.stringify(jsonSummary, null, 2))
          }
        } finally {
          await disconnect(client)
        }
      }
    })

  return program
}

async function main(): Promise<void> {
  const program = createProgram()

  try {
    await program.parseAsync(process.argv)
  } catch (err) {
    if (err instanceof SeedForgeError) {
      console.error(err.render())
      process.exit(1)
    }
    if (err instanceof Error) {
      console.error(`Error: ${err.message}`)
      process.exit(1)
    }
    process.exit(2)
  }
}

/**
 * Extract the database name from a MySQL connection URL.
 * Falls back to the effectiveSchema if extraction fails.
 */
function extractMysqlDatabase(connectionUrl: string, fallback: string): string {
  try {
    const parsed = new URL(connectionUrl)
    const dbName = parsed.pathname.replace(/^\//, '')
    return dbName || fallback
  } catch {
    return fallback
  }
}

const isDirectRun =
  process.argv[1] &&
  (/cli\.[jt]s/.test(process.argv[1]) || /seedforge$/.test(process.argv[1]))
if (isDirectRun) {
  main()
}
