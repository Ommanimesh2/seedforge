import { describe, it, expect } from 'vitest'
import { mergeCliIntoConfig } from '../merge.js'
import { createDefaultConfig } from '../defaults.js'
import type { SeedforgeConfig, CliOverrides } from '../types.js'

function makeConfig(overrides?: Partial<SeedforgeConfig>): SeedforgeConfig {
  return { ...createDefaultConfig(), ...overrides }
}

describe('mergeCliIntoConfig', () => {
  it('CLI db overrides config connection.url', () => {
    const config = makeConfig({
      connection: { url: 'postgres://config-url', schema: 'public' },
    })
    const cli: CliOverrides = { db: 'postgres://cli-url' }
    const result = mergeCliIntoConfig(config, cli)
    expect(result.connection.url).toBe('postgres://cli-url')
  })

  it('CLI schema overrides config connection.schema', () => {
    const config = makeConfig({
      connection: { schema: 'original' },
    })
    const cli: CliOverrides = { schema: 'overridden' }
    const result = mergeCliIntoConfig(config, cli)
    expect(result.connection.schema).toBe('overridden')
  })

  it('CLI count overrides config count', () => {
    const config = makeConfig({ count: 200 })
    const cli: CliOverrides = { count: 500 }
    const result = mergeCliIntoConfig(config, cli)
    expect(result.count).toBe(500)
  })

  it('CLI seed overrides config seed', () => {
    const config = makeConfig({ seed: 1 })
    const cli: CliOverrides = { seed: 99 }
    const result = mergeCliIntoConfig(config, cli)
    expect(result.seed).toBe(99)
  })

  it('CLI exclude appends to config exclude (no duplicates)', () => {
    const config = makeConfig({ exclude: ['pg_*', 'schema_migrations'] })
    const cli: CliOverrides = { exclude: ['users', 'pg_*'] }
    const result = mergeCliIntoConfig(config, cli)
    expect(result.exclude).toEqual(['pg_*', 'schema_migrations', 'users'])
  })

  it('unset CLI fields do not override config values', () => {
    const config = makeConfig({
      count: 200,
      seed: 42,
      connection: { url: 'postgres://original', schema: 'myschema' },
    })
    const cli: CliOverrides = {}
    const result = mergeCliIntoConfig(config, cli)
    expect(result.count).toBe(200)
    expect(result.seed).toBe(42)
    expect(result.connection.url).toBe('postgres://original')
    expect(result.connection.schema).toBe('myschema')
  })

  it('returned config is a new object (original not mutated)', () => {
    const config = makeConfig({ count: 200, exclude: ['a'] })
    const cli: CliOverrides = { count: 500, exclude: ['b'] }
    const result = mergeCliIntoConfig(config, cli)
    expect(result).not.toBe(config)
    expect(result.connection).not.toBe(config.connection)
    expect(result.exclude).not.toBe(config.exclude)
    expect(config.count).toBe(200)
    expect(config.exclude).toEqual(['a'])
  })

  it('config with no CLI overrides returns equivalent config', () => {
    const config = makeConfig({ count: 100, seed: 10 })
    const cli: CliOverrides = {}
    const result = mergeCliIntoConfig(config, cli)
    expect(result.count).toBe(100)
    expect(result.seed).toBe(10)
  })
})
