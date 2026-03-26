#!/usr/bin/env node

import { createRequire } from 'node:module'
import { Command } from 'commander'
import { SeedForgeError, ConfigError, redactConnectionString } from './errors/index.js'
import { connect, disconnect, introspect } from './introspect/index.js'
import { loadAndMergeConfig } from './config/loader.js'
import type { CliOverrides } from './config/types.js'
import { buildInsertPlan } from './graph/index.js'
import { generate } from './generate/index.js'
import { executeOutput, resolveOutputMode, OutputMode } from './output/index.js'

const require = createRequire(import.meta.url)
const pkg = require('../package.json') as { version: string }

export interface CliOptions {
  db?: string
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
}

export function createProgram(): Command {
  const program = new Command()

  program
    .name('seedforge')
    .description('Generate realistic seed data from your database schema')
    .version(pkg.version)
    .option('--db <url>', 'PostgreSQL connection string')
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
    .addHelpText('after', `
Examples:
  $ seedforge --db postgres://localhost/mydb
  $ seedforge --db postgres://localhost/mydb --count 100 --seed 42
  $ seedforge --db postgres://localhost/mydb --output seed.sql --dry-run
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

      // Determine connection URL
      const connectionUrl = mergedConfig.connection.url ?? options.db
      if (!connectionUrl) {
        throw new ConfigError(
          'SF5017',
          'No database connection URL provided',
          [
            'Pass --db <url> on the command line',
            'Or set connection.url in .seedforge.yml',
            'Or set DATABASE_URL environment variable and use ${DATABASE_URL} in config',
          ],
        )
      }

      const effectiveSchema = mergedConfig.connection.schema ?? options.schema ?? 'public'
      const effectiveCount = mergedConfig.count
      const effectiveSeed = mergedConfig.seed

      if (!options.quiet) {
        console.log(`seedforge v${pkg.version}`)
      }

      if (options.debug) {
        console.log('Options:', {
          ...options,
          db: redactConnectionString(connectionUrl),
        })
      }

      // Connect and introspect
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
          // Serialize Maps for JSON output
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

        // Phase 3: Build insert plan (dependency graph + topological order)
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

        // Phase 5: Generate data
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

        // Phase 6: Output
        const outputOptions = {
          mode,
          client: mode === OutputMode.DIRECT ? client : undefined,
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

        // JSON output mode
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

const isDirectRun = process.argv[1] && /cli\.[jt]s/.test(process.argv[1])
if (isDirectRun) {
  main()
}
