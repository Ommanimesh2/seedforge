import { describe, it, expect } from 'vitest'
import { PluginRegistry } from '../registry.js'
import { PluginError } from '../../errors/index.js'
import type {
  SchemaParserPlugin,
  GeneratorPlugin,
  SeedforgePlugin,
} from '../types.js'
import { NormalizedType } from '../../types/schema.js'
import type { ColumnDef } from '../../types/schema.js'

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function makeParser(overrides?: Partial<SchemaParserPlugin>): SchemaParserPlugin {
  return {
    name: 'test-parser',
    version: '1.0.0',
    detect: async () => false,
    parse: async () => ({
      name: 'test',
      tables: new Map(),
      enums: new Map(),
      schemas: ['public'],
    }),
    filePatterns: ['**/*.test'],
    ...overrides,
  }
}

function makeGenerator(overrides?: Partial<GeneratorPlugin>): GeneratorPlugin {
  return {
    name: 'test-gen',
    version: '1.0.0',
    columnPatterns: [{ names: ['ssn'] }],
    generate: () => '123-45-6789',
    priority: 10,
    ...overrides,
  }
}

function makeColumn(name: string): ColumnDef {
  return {
    name,
    dataType: NormalizedType.TEXT,
    nativeType: 'text',
    isNullable: false,
    hasDefault: false,
    defaultValue: null,
    isAutoIncrement: false,
    isGenerated: false,
    maxLength: null,
    numericPrecision: null,
    numericScale: null,
    enumValues: null,
    comment: null,
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('PluginRegistry', () => {
  describe('register', () => {
    it('registers a parser plugin', () => {
      const registry = new PluginRegistry()
      const parser = makeParser()
      registry.register({ type: 'parser', plugin: parser })
      expect(registry.parserCount).toBe(1)
    })

    it('registers a generator plugin', () => {
      const registry = new PluginRegistry()
      const gen = makeGenerator()
      registry.register({ type: 'generator', plugin: gen })
      expect(registry.generatorCount).toBe(1)
    })

    it('rejects an invalid plugin', () => {
      const registry = new PluginRegistry()
      expect(() =>
        registry.register({ type: 'parser', plugin: {} as SchemaParserPlugin }),
      ).toThrow(PluginError)
    })
  })

  describe('registerAll', () => {
    it('registers multiple plugins at once', () => {
      const registry = new PluginRegistry()
      const plugins: SeedforgePlugin[] = [
        { type: 'parser', plugin: makeParser({ name: 'p1' }) },
        { type: 'parser', plugin: makeParser({ name: 'p2' }) },
        { type: 'generator', plugin: makeGenerator({ name: 'g1' }) },
      ]
      registry.registerAll(plugins)
      expect(registry.parserCount).toBe(2)
      expect(registry.generatorCount).toBe(1)
    })
  })

  describe('getParser', () => {
    it('returns a registered parser by name', () => {
      const registry = new PluginRegistry()
      const parser = makeParser({ name: 'my-parser' })
      registry.register({ type: 'parser', plugin: parser })
      expect(registry.getParser('my-parser')).toBe(parser)
    })

    it('returns undefined for unknown name', () => {
      const registry = new PluginRegistry()
      expect(registry.getParser('nonexistent')).toBeUndefined()
    })
  })

  describe('getAllParsers', () => {
    it('returns all registered parsers', () => {
      const registry = new PluginRegistry()
      registry.register({ type: 'parser', plugin: makeParser({ name: 'a' }) })
      registry.register({ type: 'parser', plugin: makeParser({ name: 'b' }) })
      const all = registry.getAllParsers()
      expect(all).toHaveLength(2)
      expect(all.map((p) => p.name).sort()).toEqual(['a', 'b'])
    })
  })

  describe('detectParser', () => {
    it('returns the first parser whose detect() returns true', async () => {
      const registry = new PluginRegistry()
      registry.register({
        type: 'parser',
        plugin: makeParser({
          name: 'no-match',
          detect: async () => false,
        }),
      })
      registry.register({
        type: 'parser',
        plugin: makeParser({
          name: 'match',
          detect: async () => true,
        }),
      })

      const result = await registry.detectParser('/some/path')
      expect(result?.name).toBe('match')
    })

    it('returns undefined when no parser matches', async () => {
      const registry = new PluginRegistry()
      registry.register({
        type: 'parser',
        plugin: makeParser({ detect: async () => false }),
      })

      const result = await registry.detectParser('/some/path')
      expect(result).toBeUndefined()
    })

    it('returns undefined when no parsers are registered', async () => {
      const registry = new PluginRegistry()
      const result = await registry.detectParser('/some/path')
      expect(result).toBeUndefined()
    })
  })

  describe('getGenerators', () => {
    it('returns generators sorted by priority (highest first)', () => {
      const registry = new PluginRegistry()
      registry.register({
        type: 'generator',
        plugin: makeGenerator({ name: 'low', priority: 1 }),
      })
      registry.register({
        type: 'generator',
        plugin: makeGenerator({ name: 'high', priority: 100 }),
      })
      registry.register({
        type: 'generator',
        plugin: makeGenerator({ name: 'mid', priority: 50 }),
      })

      const gens = registry.getGenerators()
      expect(gens.map((g) => g.name)).toEqual(['high', 'mid', 'low'])
    })

    it('returns a defensive copy', () => {
      const registry = new PluginRegistry()
      registry.register({
        type: 'generator',
        plugin: makeGenerator(),
      })

      const a = registry.getGenerators()
      const b = registry.getGenerators()
      expect(a).not.toBe(b)
      expect(a).toEqual(b)
    })
  })

  describe('applyGeneratorPlugins', () => {
    it('returns matching generator for exact name match', () => {
      const registry = new PluginRegistry()
      const gen = makeGenerator({
        columnPatterns: [{ names: ['ssn', 'social_security'] }],
      })
      registry.register({ type: 'generator', plugin: gen })

      const result = registry.applyGeneratorPlugins(makeColumn('ssn'))
      expect(result).toBe(gen)
    })

    it('matches column names case-insensitively', () => {
      const registry = new PluginRegistry()
      const gen = makeGenerator({
        columnPatterns: [{ names: ['SSN'] }],
      })
      registry.register({ type: 'generator', plugin: gen })

      const result = registry.applyGeneratorPlugins(makeColumn('ssn'))
      expect(result).toBe(gen)
    })

    it('returns matching generator for suffix match', () => {
      const registry = new PluginRegistry()
      const gen = makeGenerator({
        columnPatterns: [{ suffixes: ['_hash'] }],
      })
      registry.register({ type: 'generator', plugin: gen })

      const result = registry.applyGeneratorPlugins(makeColumn('password_hash'))
      expect(result).toBe(gen)
    })

    it('returns matching generator for prefix match', () => {
      const registry = new PluginRegistry()
      const gen = makeGenerator({
        columnPatterns: [{ prefixes: ['is_'] }],
      })
      registry.register({ type: 'generator', plugin: gen })

      const result = registry.applyGeneratorPlugins(makeColumn('is_active'))
      expect(result).toBe(gen)
    })

    it('returns undefined when no generator matches', () => {
      const registry = new PluginRegistry()
      registry.register({
        type: 'generator',
        plugin: makeGenerator({
          columnPatterns: [{ names: ['ssn'] }],
        }),
      })

      const result = registry.applyGeneratorPlugins(makeColumn('email'))
      expect(result).toBeUndefined()
    })

    it('returns highest-priority matching generator when multiple match', () => {
      const registry = new PluginRegistry()
      const lowPriority = makeGenerator({
        name: 'low',
        priority: 1,
        columnPatterns: [{ names: ['email'] }],
      })
      const highPriority = makeGenerator({
        name: 'high',
        priority: 100,
        columnPatterns: [{ names: ['email'] }],
      })

      registry.register({ type: 'generator', plugin: lowPriority })
      registry.register({ type: 'generator', plugin: highPriority })

      const result = registry.applyGeneratorPlugins(makeColumn('email'))
      expect(result?.name).toBe('high')
    })

    it('matches across multiple patterns in columnPatterns array', () => {
      const registry = new PluginRegistry()
      const gen = makeGenerator({
        columnPatterns: [
          { names: ['ssn'] },
          { suffixes: ['_number'] },
        ],
      })
      registry.register({ type: 'generator', plugin: gen })

      // Should match via suffix
      const result = registry.applyGeneratorPlugins(makeColumn('phone_number'))
      expect(result).toBe(gen)
    })
  })

  describe('counts', () => {
    it('reports correct counts', () => {
      const registry = new PluginRegistry()
      expect(registry.parserCount).toBe(0)
      expect(registry.generatorCount).toBe(0)

      registry.register({ type: 'parser', plugin: makeParser() })
      registry.register({ type: 'generator', plugin: makeGenerator() })

      expect(registry.parserCount).toBe(1)
      expect(registry.generatorCount).toBe(1)
    })
  })
})
