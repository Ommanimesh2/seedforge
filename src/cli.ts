#!/usr/bin/env node

import { createRequire } from 'node:module'
import { Command } from 'commander'
import { SeedForgeError, redactConnectionString } from './errors/index.js'
import { connect, disconnect, introspect } from './introspect/index.js'

const require = createRequire(import.meta.url)
const pkg = require('../package.json') as { version: string }

export interface CliOptions {
  db: string
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
    .requiredOption('--db <url>', 'PostgreSQL connection string')
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
    .action(async (options: CliOptions) => {
      if (!options.quiet) {
        console.log(`seedforge v${pkg.version}`)
      }

      if (options.debug) {
        console.log('Options:', {
          ...options,
          db: redactConnectionString(options.db),
        })
      }

      // Connect and introspect
      const client = await connect({
        connectionString: options.db,
        schema: options.schema,
        skipProductionCheck: options.yes,
      })

      try {
        const schema = await introspect(client, options.schema)

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

        if (options.dryRun) {
          console.log('Dry-run mode: no data generated')
        }

        // TODO: Phases 3-6 will add generation and insertion here
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
