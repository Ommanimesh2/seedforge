import { describe, it, expect } from 'vitest'
import { faker } from '@faker-js/faker'
import { resolveGenerator, resolveColumnOverrides } from '../generator-resolver.js'
import { ConfigError } from '../../errors/index.js'
import { createSeededFaker } from '../../mapping/seeded-faker.js'
import type { TableConfig } from '../types.js'

describe('resolveGenerator', () => {
  it('valid path "faker.person.firstName" produces a callable GeneratorFn', () => {
    const gen = resolveGenerator('faker.person.firstName')
    const result = gen(faker, 0)
    expect(typeof result).toBe('string')
    expect((result as string).length).toBeGreaterThan(0)
  })

  it('valid nested path "faker.internet.email" works', () => {
    const gen = resolveGenerator('faker.internet.email')
    const result = gen(faker, 0)
    expect(typeof result).toBe('string')
    expect(result as string).toContain('@')
  })

  it('invalid path "faker.nonexistent.method" -> SF5016', () => {
    try {
      resolveGenerator('faker.nonexistent.method')
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError)
      expect((err as ConfigError).code).toBe('SF5016')
    }
  })

  it('non-function path "faker.person" -> SF5016', () => {
    try {
      resolveGenerator('faker.person')
      expect.fail('Should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(ConfigError)
      expect((err as ConfigError).code).toBe('SF5016')
    }
  })

  it('generator uses the seeded faker instance (deterministic output)', () => {
    const gen = resolveGenerator('faker.person.firstName')

    // createSeededFaker returns the global faker re-seeded, so we must
    // re-seed before each call to get deterministic output
    const seeded1 = createSeededFaker(12345)
    const result1 = gen(seeded1, 0)

    // Re-seed with the same value and regenerate
    const seeded2 = createSeededFaker(12345)
    const result2 = gen(seeded2, 0)
    expect(result1).toBe(result2)

    // Different seed should produce a valid string
    const seeded3 = createSeededFaker(99999)
    const result3 = gen(seeded3, 0)
    expect(typeof result3).toBe('string')
  })
})

describe('resolveColumnOverrides', () => {
  it('column with generator override produces a ColumnMapping', () => {
    const config: TableConfig = {
      columns: {
        email: { generator: 'faker.internet.email' },
      },
    }
    const mappings = resolveColumnOverrides(config)
    expect(mappings.has('email')).toBe(true)
    const mapping = mappings.get('email')!
    expect(mapping.domain).toBe('config_override')
    expect(mapping.fakerMethod).toBe('faker.internet.email')
    expect(typeof mapping.generator).toBe('function')
  })

  it('column with values produces a GeneratorFn that returns from the array', () => {
    const config: TableConfig = {
      columns: {
        role: { values: ['admin', 'editor', 'viewer'] },
      },
    }
    const mappings = resolveColumnOverrides(config)
    expect(mappings.has('role')).toBe(true)

    const gen = mappings.get('role')!.generator!
    // Generate many values and ensure they are all from the list
    const results = new Set<unknown>()
    for (let i = 0; i < 100; i++) {
      results.add(gen(faker, i))
    }
    for (const val of results) {
      expect(['admin', 'editor', 'viewer']).toContain(val)
    }
  })

  it('column with values + weights produces weighted distribution', () => {
    const config: TableConfig = {
      columns: {
        role: {
          values: ['rare', 'common'],
          weights: [0.1, 0.9],
        },
      },
    }
    const mappings = resolveColumnOverrides(config)
    const gen = mappings.get('role')!.generator!

    // Generate 1000 values and check rough distribution
    let rareCount = 0
    let commonCount = 0
    for (let i = 0; i < 1000; i++) {
      const val = gen(faker, i)
      if (val === 'rare') rareCount++
      if (val === 'common') commonCount++
    }
    // With weights 0.1 / 0.9, we expect ~10% rare and ~90% common
    // Allow generous tolerance: rare should be < 25% and common > 60%
    expect(rareCount).toBeLessThan(250)
    expect(commonCount).toBeGreaterThan(600)
  })

  it('returns empty map when no columns are defined', () => {
    const config: TableConfig = {}
    const mappings = resolveColumnOverrides(config)
    expect(mappings.size).toBe(0)
  })
})
