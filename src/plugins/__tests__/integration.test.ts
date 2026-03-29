/**
 * Integration tests — verify that registry + loader + validation work
 * together end-to-end, including generator override behaviour.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { writeFileSync, mkdirSync, rmSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { faker } from '@faker-js/faker'

import { PluginRegistry } from '../registry.js'
import { loadSinglePlugin } from '../loader.js'
import type { GeneratorPlugin, SchemaParserPlugin } from '../types.js'
import { NormalizedType } from '../../types/schema.js'
import type { ColumnDef } from '../../types/schema.js'

// ---------------------------------------------------------------------------
// Temp dir
// ---------------------------------------------------------------------------

let tempDir: string

beforeEach(() => {
  tempDir = join(tmpdir(), `seedforge-int-${Date.now()}-${Math.random().toString(36).slice(2)}`)
  mkdirSync(tempDir, { recursive: true })
})

afterEach(() => {
  if (existsSync(tempDir)) {
    rmSync(tempDir, { recursive: true, force: true })
  }
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
// Generator plugin override
// ---------------------------------------------------------------------------

describe('generator plugin override', () => {
  it('overrides built-in mapping when a plugin generator matches', () => {
    const registry = new PluginRegistry()

    const ssnGenerator: GeneratorPlugin = {
      name: 'ssn-generator',
      version: '1.0.0',
      columnPatterns: [
        { names: ['ssn', 'social_security_number'] },
        { suffixes: ['_ssn'] },
      ],
      generate: () => '999-00-1234',
      priority: 10,
    }

    registry.register({ type: 'generator', plugin: ssnGenerator })

    // Should match by exact name
    const col = makeColumn('ssn')
    const override = registry.applyGeneratorPlugins(col)
    expect(override).toBe(ssnGenerator)
    expect(override!.generate(col, faker, 0)).toBe('999-00-1234')
  })

  it('does not override when no generator matches', () => {
    const registry = new PluginRegistry()

    const ssnGenerator: GeneratorPlugin = {
      name: 'ssn-generator',
      version: '1.0.0',
      columnPatterns: [{ names: ['ssn'] }],
      generate: () => '999-00-1234',
      priority: 10,
    }

    registry.register({ type: 'generator', plugin: ssnGenerator })

    const col = makeColumn('email')
    const override = registry.applyGeneratorPlugins(col)
    expect(override).toBeUndefined()
  })

  it('priority ordering determines which generator wins', () => {
    const registry = new PluginRegistry()

    const low: GeneratorPlugin = {
      name: 'low-priority',
      version: '1.0.0',
      columnPatterns: [{ names: ['phone'] }],
      generate: () => '000-0000',
      priority: 1,
    }

    const high: GeneratorPlugin = {
      name: 'high-priority',
      version: '1.0.0',
      columnPatterns: [{ names: ['phone'] }],
      generate: () => '999-9999',
      priority: 100,
    }

    registry.register({ type: 'generator', plugin: low })
    registry.register({ type: 'generator', plugin: high })

    const col = makeColumn('phone')
    const override = registry.applyGeneratorPlugins(col)
    expect(override?.name).toBe('high-priority')
    expect(override!.generate(col, faker, 0)).toBe('999-9999')
  })
})

// ---------------------------------------------------------------------------
// Parser plugin detection
// ---------------------------------------------------------------------------

describe('parser plugin detection', () => {
  it('detects a parser that matches the project root', async () => {
    const registry = new PluginRegistry()

    const sequelizeParser: SchemaParserPlugin = {
      name: 'sequelize-parser',
      version: '1.0.0',
      detect: async (root: string) => {
        // Check for a models/ directory
        return existsSync(join(root, 'models'))
      },
      parse: async () => ({
        name: 'sequelize',
        tables: new Map(),
        enums: new Map(),
        schemas: ['public'],
      }),
      filePatterns: ['models/**/*.js'],
    }

    registry.register({ type: 'parser', plugin: sequelizeParser })

    // No models/ directory -> no detection
    const noMatch = await registry.detectParser(tempDir)
    expect(noMatch).toBeUndefined()

    // Create models/ directory -> should detect
    mkdirSync(join(tempDir, 'models'))
    const match = await registry.detectParser(tempDir)
    expect(match?.name).toBe('sequelize-parser')
  })
})

// ---------------------------------------------------------------------------
// Full load -> register -> use cycle
// ---------------------------------------------------------------------------

describe('load -> register -> use cycle', () => {
  it('loads a plugin file, registers it, and uses it', async () => {
    const pluginFile = join(tempDir, 'full-cycle.mjs')
    writeFileSync(
      pluginFile,
      `
export default {
  type: 'generator',
  plugin: {
    name: 'cycle-gen',
    version: '1.0.0',
    columnPatterns: [{ prefixes: ['lat_', 'lng_'] }],
    generate: (col) => col.name.startsWith('lat') ? 40.7128 : -74.0060,
    priority: 20,
  },
}
`,
    )

    const loaded = await loadSinglePlugin(pluginFile, tempDir)
    const registry = new PluginRegistry()
    registry.register(loaded)

    expect(registry.generatorCount).toBe(1)

    const latCol = makeColumn('lat_home')
    const match = registry.applyGeneratorPlugins(latCol)
    expect(match).toBeDefined()
    expect(match!.generate(latCol, faker, 0)).toBe(40.7128)

    const unmatched = makeColumn('email')
    expect(registry.applyGeneratorPlugins(unmatched)).toBeUndefined()
  })
})
