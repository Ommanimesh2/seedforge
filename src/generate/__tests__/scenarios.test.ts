import { describe, it, expect } from 'vitest'
import { loadScenario, validateScenarios } from '../scenarios.js'
import type { SeedforgeConfigWithScenarios } from '../scenarios.js'
import { createDefaultConfig } from '../../config/defaults.js'
import { ConfigError } from '../../errors/index.js'

function makeConfigWithScenarios(
  scenarios: Record<string, { tables: Record<string, { count: number }> }>,
  tables?: Record<string, { count?: number }>,
): SeedforgeConfigWithScenarios {
  return {
    ...createDefaultConfig(),
    tables: tables ?? {},
    scenarios,
  }
}

describe('loadScenario', () => {
  it('merges scenario table counts into config', () => {
    const config = makeConfigWithScenarios({
      empty_store: {
        tables: {
          users: { count: 5 },
          products: { count: 0 },
          orders: { count: 0 },
        },
      },
    })

    const merged = loadScenario(config, 'empty_store')

    expect(merged.tables.users?.count).toBe(5)
    expect(merged.tables.products?.count).toBe(0)
    expect(merged.tables.orders?.count).toBe(0)
  })

  it('preserves existing table config while overriding count', () => {
    const config = makeConfigWithScenarios(
      {
        busy_store: {
          tables: {
            users: { count: 100 },
          },
        },
      },
      {
        users: {
          count: 50,
          columns: {
            email: { generator: 'faker.internet.email' },
          },
        },
      },
    ) as SeedforgeConfigWithScenarios

    const merged = loadScenario(config, 'busy_store')

    expect(merged.tables.users?.count).toBe(100)
    // Column overrides should be preserved
    expect(merged.tables.users?.columns?.email).toBeDefined()
  })

  it('preserves non-scenario config values', () => {
    const config = makeConfigWithScenarios({
      test_scenario: {
        tables: {
          users: { count: 10 },
        },
      },
    })
    config.seed = 42
    config.count = 200
    config.locale = 'de'

    const merged = loadScenario(config, 'test_scenario')

    expect(merged.seed).toBe(42)
    expect(merged.count).toBe(200)
    expect(merged.locale).toBe('de')
  })

  it('throws ConfigError for unknown scenario', () => {
    const config = makeConfigWithScenarios({
      existing: {
        tables: {
          users: { count: 5 },
        },
      },
    })

    expect(() => loadScenario(config, 'nonexistent')).toThrow(ConfigError)
    expect(() => loadScenario(config, 'nonexistent')).toThrow(/Unknown scenario/)
  })

  it('throws ConfigError when no scenarios defined', () => {
    const config = createDefaultConfig() as SeedforgeConfigWithScenarios

    expect(() => loadScenario(config, 'any')).toThrow(ConfigError)
  })

  it('adds table configs that do not exist in base config', () => {
    const config = makeConfigWithScenarios({
      scenario: {
        tables: {
          new_table: { count: 25 },
        },
      },
    })

    const merged = loadScenario(config, 'scenario')
    expect(merged.tables.new_table?.count).toBe(25)
  })

  it('supports count of 0', () => {
    const config = makeConfigWithScenarios({
      empty: {
        tables: {
          users: { count: 0 },
        },
      },
    })

    const merged = loadScenario(config, 'empty')
    expect(merged.tables.users?.count).toBe(0)
  })
})

describe('validateScenarios', () => {
  it('validates correct scenarios config', () => {
    const raw = {
      scenarios: {
        empty_store: {
          tables: {
            users: { count: 5 },
            products: { count: 0 },
          },
        },
        busy_store: {
          tables: {
            users: { count: 100 },
            products: { count: 500 },
          },
        },
      },
    }

    const result = validateScenarios(raw)
    expect(result).toBeDefined()
    expect(result!.empty_store.tables.users.count).toBe(5)
    expect(result!.empty_store.tables.products.count).toBe(0)
    expect(result!.busy_store.tables.users.count).toBe(100)
  })

  it('returns undefined when scenarios is not present', () => {
    const result = validateScenarios({})
    expect(result).toBeUndefined()
  })

  it('throws for non-object scenarios', () => {
    expect(() => validateScenarios({ scenarios: 'invalid' })).toThrow(ConfigError)
    expect(() => validateScenarios({ scenarios: [] })).toThrow(ConfigError)
  })

  it('throws when scenario has no tables key', () => {
    expect(() =>
      validateScenarios({ scenarios: { test: {} } }),
    ).toThrow(ConfigError)
  })

  it('throws for non-integer count', () => {
    expect(() =>
      validateScenarios({
        scenarios: {
          test: {
            tables: {
              users: { count: 1.5 },
            },
          },
        },
      }),
    ).toThrow(ConfigError)
  })

  it('throws for negative count', () => {
    expect(() =>
      validateScenarios({
        scenarios: {
          test: {
            tables: {
              users: { count: -1 },
            },
          },
        },
      }),
    ).toThrow(ConfigError)
  })

  it('allows count of 0', () => {
    const result = validateScenarios({
      scenarios: {
        test: {
          tables: {
            users: { count: 0 },
          },
        },
      },
    })
    expect(result!.test.tables.users.count).toBe(0)
  })
})
