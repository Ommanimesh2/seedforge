import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { loadConfig, loadAndMergeConfig } from '../loader.js'
import { ExistingDataMode } from '../types.js'
import { ConfigError } from '../../errors/index.js'
import type { CliOverrides } from '../types.js'

let tmpDir: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'seedforge-integ-'))
})

afterEach(() => {
  vi.unstubAllEnvs()
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

describe('loadConfig integration', () => {
  it('no config file returns default config', () => {
    const config = loadConfig({ cwd: tmpDir })
    expect(config.count).toBe(50)
    expect(config.locale).toBe('en')
    expect(config.existingData).toBe(ExistingDataMode.AUGMENT)
  })

  it('config file with count: 200 is picked up', () => {
    fs.writeFileSync(path.join(tmpDir, '.seedforge.yml'), 'count: 200')
    const config = loadConfig({ cwd: tmpDir })
    expect(config.count).toBe(200)
  })

  it('invalid YAML throws SF5001', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.seedforge.yml'),
      ':\n  bad: yaml\n    wrong: indent',
    )
    try {
      loadConfig({ cwd: tmpDir })
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError)
      expect((err as ConfigError).code).toBe('SF5001')
    }
  })

  it('unknown keys throw SF5003 with suggestions', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.seedforge.yml'),
      'conection:\n  url: test',
    )
    try {
      loadConfig({ cwd: tmpDir })
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError)
      expect((err as ConfigError).code).toBe('SF5003')
    }
  })

  it('env var in connection.url resolves correctly', () => {
    vi.stubEnv('TEST_DATABASE_URL', 'postgres://testhost/testdb')
    fs.writeFileSync(
      path.join(tmpDir, '.seedforge.yml'),
      'connection:\n  url: "${TEST_DATABASE_URL}"',
    )
    const config = loadConfig({ cwd: tmpDir })
    expect(config.connection.url).toBe('postgres://testhost/testdb')
  })

  it('undefined env var throws SF5010', () => {
    delete process.env.TOTALLY_MISSING_VAR
    fs.writeFileSync(
      path.join(tmpDir, '.seedforge.yml'),
      'connection:\n  url: "${TOTALLY_MISSING_VAR}"',
    )
    try {
      loadConfig({ cwd: tmpDir })
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError)
      expect((err as ConfigError).code).toBe('SF5010')
    }
  })

  it('full realistic config file loads successfully', () => {
    const yaml = `
connection:
  url: "postgres://localhost/mydb"
  schema: "public"
seed: 42
count: 100
locale: "en"
existingData:
  mode: "augment"
tables:
  users:
    count: 500
    columns:
      email:
        generator: "faker.internet.email"
        unique: true
      role:
        values: ["admin", "editor", "viewer"]
        weights: [0.05, 0.25, 0.70]
      bio:
        nullable: 0.3
exclude:
  - schema_migrations
  - "_prisma_migrations"
  - "pg_*"
virtualForeignKeys:
  - source: { table: "comments", column: "commentable_id" }
    target: { table: "posts", column: "id" }
`
    fs.writeFileSync(path.join(tmpDir, '.seedforge.yml'), yaml)
    const config = loadConfig({ cwd: tmpDir })
    expect(config.connection.url).toBe('postgres://localhost/mydb')
    expect(config.seed).toBe(42)
    expect(config.count).toBe(100)
    expect(config.tables.users.count).toBe(500)
    expect(config.tables.users.columns?.email.generator).toBe(
      'faker.internet.email',
    )
    expect(config.virtualForeignKeys).toHaveLength(1)
    expect(config.exclude).toContain('pg_*')
  })

  it('column overrides with values + weights are parsed', () => {
    const yaml = `
tables:
  orders:
    columns:
      status:
        values: ["pending", "shipped", "delivered"]
        weights: [0.3, 0.5, 0.2]
`
    fs.writeFileSync(path.join(tmpDir, '.seedforge.yml'), yaml)
    const config = loadConfig({ cwd: tmpDir })
    expect(config.tables.orders.columns?.status.values).toEqual([
      'pending',
      'shipped',
      'delivered',
    ])
    expect(config.tables.orders.columns?.status.weights).toEqual([
      0.3, 0.5, 0.2,
    ])
  })
})

describe('loadAndMergeConfig integration', () => {
  it('config file count: 200 + no CLI override -> count is 200', () => {
    fs.writeFileSync(path.join(tmpDir, '.seedforge.yml'), 'count: 200')
    const cli: CliOverrides = {}
    const config = loadAndMergeConfig(cli, { cwd: tmpDir })
    expect(config.count).toBe(200)
  })

  it('config file count: 200 + CLI count 500 -> count is 500', () => {
    fs.writeFileSync(path.join(tmpDir, '.seedforge.yml'), 'count: 200')
    const cli: CliOverrides = { count: 500 }
    const config = loadAndMergeConfig(cli, { cwd: tmpDir })
    expect(config.count).toBe(500)
  })

  it('config exclude + CLI exclude are merged', () => {
    fs.writeFileSync(
      path.join(tmpDir, '.seedforge.yml'),
      'exclude:\n  - "pg_*"',
    )
    const cli: CliOverrides = { exclude: ['users'] }
    const config = loadAndMergeConfig(cli, { cwd: tmpDir })
    expect(config.exclude).toEqual(['pg_*', 'users'])
  })

  it('explicit configPath overrides discovery', () => {
    const customPath = path.join(tmpDir, 'custom-config.yml')
    fs.writeFileSync(customPath, 'count: 999')
    const config = loadConfig({ configPath: customPath })
    expect(config.count).toBe(999)
  })
})
