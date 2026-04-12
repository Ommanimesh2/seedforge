import { describe, it, expect } from 'vitest'
import { createProgram } from './cli.js'

/**
 * Parse CLI args for option testing only.
 * Replaces the async action handler with a no-op to prevent
 * actual DB connections (which cause unhandled rejections on Node 22+).
 */
function parseOpts(args: string[]) {
  const program = createProgram()
  program.exitOverride()
  program.action(() => {})
  program.parse(['node', 'seedforge', ...args])
  return program.opts()
}

describe('CLI', () => {
  it('parses --db flag', () => {
    const opts = parseOpts(['--db', 'postgres://localhost/test'])
    expect(opts.db).toBe('postgres://localhost/test')
  })

  it('defaults count to 50', () => {
    const opts = parseOpts(['--db', 'postgres://localhost/test'])
    expect(opts.count).toBe(50)
  })

  it('parses --count as number', () => {
    const opts = parseOpts(['--db', 'postgres://localhost/test', '--count', '200'])
    expect(opts.count).toBe(200)
  })

  it('parses --seed as number', () => {
    const opts = parseOpts(['--db', 'postgres://localhost/test', '--seed', '42'])
    expect(opts.seed).toBe(42)
  })

  it('defaults dry-run to false', () => {
    const opts = parseOpts(['--db', 'postgres://localhost/test'])
    expect(opts.dryRun).toBe(false)
  })

  it('parses --dry-run flag', () => {
    const opts = parseOpts(['--db', 'postgres://localhost/test', '--dry-run'])
    expect(opts.dryRun).toBe(true)
  })

  it('parses --output flag', () => {
    const opts = parseOpts(['--db', 'postgres://localhost/test', '--output', 'seed.sql'])
    expect(opts.output).toBe('seed.sql')
  })

  it('defaults schema to public', () => {
    const opts = parseOpts(['--db', 'postgres://localhost/test'])
    expect(opts.schema).toBe('public')
  })

  it('parses --exclude with multiple tables', () => {
    const opts = parseOpts([
      '--db',
      'postgres://localhost/test',
      '--exclude',
      'migrations',
      'spatial_ref_sys',
    ])
    expect(opts.exclude).toEqual(['migrations', 'spatial_ref_sys'])
  })

  it('parses --json flag', () => {
    const opts = parseOpts(['--db', 'postgres://localhost/test', '--json'])
    expect(opts.json).toBe(true)
  })

  it('parses --yes flag', () => {
    const opts = parseOpts(['--db', 'postgres://localhost/test', '--yes'])
    expect(opts.yes).toBe(true)
  })

  it('--db is optional (can come from config file)', () => {
    // Verify that --db is registered as a non-mandatory option
    const program = createProgram()
    const dbOption = program.options.find((opt) => opt.long === '--db')
    expect(dbOption).toBeDefined()
    // mandatory=false means it was registered with .option() not .requiredOption()
    expect(dbOption!.mandatory).toBe(false)
  })

  it('has --config flag registered', () => {
    // Verify that --config is registered as an option
    const program = createProgram()
    const configOption = program.options.find((opt) => opt.long === '--config')
    expect(configOption).toBeDefined()
  })

  it('shows version', () => {
    const program = createProgram()
    program.exitOverride()
    expect(() => {
      program.parse(['node', 'seedforge', '--version'])
    }).toThrow() // commander throws on --version with exitOverride
  })
})
