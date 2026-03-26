#!/usr/bin/env node

import { createRequire } from 'node:module'
import { Command } from 'commander'
import { SeedForgeError } from './errors/index.js'

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
      // Stub: will be filled in Phase 2+
      if (options.verbose || options.debug) {
        console.log('Parsed options:', {
          ...options,
          db: options.db.replace(/:[^@]+@/, ':***@'),
        })
      }
      console.log(`seedforge v${pkg.version}`)
      console.log(`Target: ${options.schema} schema, ${options.count} rows/table`)
      if (options.dryRun) {
        console.log('Mode: dry-run (no changes will be made)')
      }
      if (options.output) {
        console.log(`Output: ${options.output}`)
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
