import { describe, it, expect } from 'vitest'
import { createProgram } from './cli.js'

describe('CLI', () => {
  it('parses --db flag', () => {
    const program = createProgram()
    program.exitOverride()
    program.parse(['node', 'seedforge', '--db', 'postgres://localhost/test'])
    const opts = program.opts()
    expect(opts.db).toBe('postgres://localhost/test')
  })

  it('defaults count to 50', () => {
    const program = createProgram()
    program.exitOverride()
    program.parse(['node', 'seedforge', '--db', 'postgres://localhost/test'])
    const opts = program.opts()
    expect(opts.count).toBe(50)
  })

  it('parses --count as number', () => {
    const program = createProgram()
    program.exitOverride()
    program.parse(['node', 'seedforge', '--db', 'postgres://localhost/test', '--count', '200'])
    const opts = program.opts()
    expect(opts.count).toBe(200)
  })

  it('parses --seed as number', () => {
    const program = createProgram()
    program.exitOverride()
    program.parse(['node', 'seedforge', '--db', 'postgres://localhost/test', '--seed', '42'])
    const opts = program.opts()
    expect(opts.seed).toBe(42)
  })

  it('defaults dry-run to false', () => {
    const program = createProgram()
    program.exitOverride()
    program.parse(['node', 'seedforge', '--db', 'postgres://localhost/test'])
    const opts = program.opts()
    expect(opts.dryRun).toBe(false)
  })

  it('parses --dry-run flag', () => {
    const program = createProgram()
    program.exitOverride()
    program.parse(['node', 'seedforge', '--db', 'postgres://localhost/test', '--dry-run'])
    const opts = program.opts()
    expect(opts.dryRun).toBe(true)
  })

  it('parses --output flag', () => {
    const program = createProgram()
    program.exitOverride()
    program.parse(['node', 'seedforge', '--db', 'postgres://localhost/test', '--output', 'seed.sql'])
    const opts = program.opts()
    expect(opts.output).toBe('seed.sql')
  })

  it('defaults schema to public', () => {
    const program = createProgram()
    program.exitOverride()
    program.parse(['node', 'seedforge', '--db', 'postgres://localhost/test'])
    const opts = program.opts()
    expect(opts.schema).toBe('public')
  })

  it('parses --exclude with multiple tables', () => {
    const program = createProgram()
    program.exitOverride()
    program.parse([
      'node', 'seedforge', '--db', 'postgres://localhost/test',
      '--exclude', 'migrations', 'spatial_ref_sys',
    ])
    const opts = program.opts()
    expect(opts.exclude).toEqual(['migrations', 'spatial_ref_sys'])
  })

  it('parses --json flag', () => {
    const program = createProgram()
    program.exitOverride()
    program.parse(['node', 'seedforge', '--db', 'postgres://localhost/test', '--json'])
    const opts = program.opts()
    expect(opts.json).toBe(true)
  })

  it('parses --yes flag', () => {
    const program = createProgram()
    program.exitOverride()
    program.parse(['node', 'seedforge', '--db', 'postgres://localhost/test', '--yes'])
    const opts = program.opts()
    expect(opts.yes).toBe(true)
  })

  it('errors when --db is missing', () => {
    const program = createProgram()
    program.exitOverride()
    expect(() => {
      program.parse(['node', 'seedforge'])
    }).toThrow()
  })

  it('shows version', () => {
    const program = createProgram()
    program.exitOverride()
    expect(() => {
      program.parse(['node', 'seedforge', '--version'])
    }).toThrow() // commander throws on --version with exitOverride
  })
})
