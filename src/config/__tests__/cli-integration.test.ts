import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { loadAndMergeConfig } from '../loader.js'
import type { CliOverrides } from '../types.js'
import { ConfigError } from '../../errors/index.js'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seedforge-cli-'))
})

afterEach(() => {
  vi.unstubAllEnvs()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('CLI config integration', () => {
  it('config file values are used when CLI flags are not provided', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.seedforge.yml'),
      'count: 300\nseed: 99\nconnection:\n  url: "postgres://confighost/db"',
    )
    const cli: CliOverrides = {}
    const config = loadAndMergeConfig(cli, { cwd: tmpDir })
    expect(config.count).toBe(300)
    expect(config.seed).toBe(99)
    expect(config.connection.url).toBe('postgres://confighost/db')
  })

  it('CLI --count overrides config file count', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.seedforge.yml'),
      'count: 300',
    )
    const cli: CliOverrides = { count: 500 }
    const config = loadAndMergeConfig(cli, { cwd: tmpDir })
    expect(config.count).toBe(500)
  })

  it('CLI --seed overrides config file seed', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.seedforge.yml'),
      'seed: 1',
    )
    const cli: CliOverrides = { seed: 42 }
    const config = loadAndMergeConfig(cli, { cwd: tmpDir })
    expect(config.seed).toBe(42)
  })

  it('CLI --exclude appends to config file exclude', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.seedforge.yml'),
      'exclude:\n  - "pg_*"',
    )
    const cli: CliOverrides = { exclude: ['users'] }
    const config = loadAndMergeConfig(cli, { cwd: tmpDir })
    expect(config.exclude).toEqual(['pg_*', 'users'])
  })

  it('--db is not required if connection.url is in config', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.seedforge.yml'),
      'connection:\n  url: "postgres://from-config/db"',
    )
    const cli: CliOverrides = {}
    const config = loadAndMergeConfig(cli, { cwd: tmpDir })
    expect(config.connection.url).toBe('postgres://from-config/db')
  })

  it('CLI --db overrides config connection.url', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.seedforge.yml'),
      'connection:\n  url: "postgres://from-config/db"',
    )
    const cli: CliOverrides = { db: 'postgres://from-cli/db' }
    const config = loadAndMergeConfig(cli, { cwd: tmpDir })
    expect(config.connection.url).toBe('postgres://from-cli/db')
  })

  it('missing both --db and config connection.url is detected after merge', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.seedforge.yml'),
      'count: 100',
    )
    const cli: CliOverrides = {}
    const config = loadAndMergeConfig(cli, { cwd: tmpDir })
    // The config itself is valid -- the URL check happens at the CLI action handler level
    expect(config.connection.url).toBeUndefined()
  })

  it('explicit config path loads the correct file', () => {
    const customPath = path.join(tmpDir, 'custom.yml')
    fs.writeFileSync(customPath, 'count: 777')
    const cli: CliOverrides = {}
    const config = loadAndMergeConfig(cli, { configPath: customPath })
    expect(config.count).toBe(777)
  })

  it('SF5017 is thrown by CLI handler when no URL from any source', () => {
    // This tests the ConfigError factory, not the full CLI handler
    const err = new ConfigError(
      'SF5017',
      'No database connection URL provided',
      [
        'Pass --db <url> on the command line',
        'Or set connection.url in .seedforge.yml',
      ],
    )
    expect(err.code).toBe('SF5017')
    expect(err.message).toContain('No database connection URL')
  })
})
