import { describe, it, expect } from 'vitest'
import {
  validateParserPlugin,
  validateGeneratorPlugin,
  validatePlugin,
} from '../validate.js'
import { PluginError } from '../../errors/index.js'

// ---------------------------------------------------------------------------
// Valid fixtures
// ---------------------------------------------------------------------------

function makeValidParser() {
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
  }
}

function makeValidGenerator() {
  return {
    name: 'test-generator',
    version: '2.0.0',
    columnPatterns: [{ names: ['ssn'], suffixes: ['_ssn'] }],
    generate: () => '123-45-6789',
    priority: 10,
  }
}

// ---------------------------------------------------------------------------
// validateParserPlugin
// ---------------------------------------------------------------------------

describe('validateParserPlugin', () => {
  it('accepts a valid parser plugin', () => {
    expect(() => validateParserPlugin(makeValidParser())).not.toThrow()
  })

  it('rejects null', () => {
    expect(() => validateParserPlugin(null)).toThrow(PluginError)
  })

  it('rejects a non-object', () => {
    expect(() => validateParserPlugin('not-an-object')).toThrow(PluginError)
  })

  it('rejects missing name', () => {
    const p = makeValidParser()
    ;(p as Record<string, unknown>).name = ''
    expect(() => validateParserPlugin(p)).toThrow(PluginError)
    expect(() => validateParserPlugin(p)).toThrow(/name/)
  })

  it('rejects missing version', () => {
    const p = makeValidParser()
    ;(p as Record<string, unknown>).version = ''
    expect(() => validateParserPlugin(p)).toThrow(PluginError)
    expect(() => validateParserPlugin(p)).toThrow(/version/)
  })

  it('rejects missing detect function', () => {
    const p = makeValidParser()
    ;(p as Record<string, unknown>).detect = 'not a function'
    expect(() => validateParserPlugin(p)).toThrow(PluginError)
    expect(() => validateParserPlugin(p)).toThrow(/detect/)
  })

  it('rejects missing parse function', () => {
    const p = makeValidParser()
    ;(p as Record<string, unknown>).parse = undefined
    expect(() => validateParserPlugin(p)).toThrow(PluginError)
    expect(() => validateParserPlugin(p)).toThrow(/parse/)
  })

  it('rejects missing filePatterns', () => {
    const p = makeValidParser()
    ;(p as Record<string, unknown>).filePatterns = 'not-an-array'
    expect(() => validateParserPlugin(p)).toThrow(PluginError)
    expect(() => validateParserPlugin(p)).toThrow(/filePatterns/)
  })
})

// ---------------------------------------------------------------------------
// validateGeneratorPlugin
// ---------------------------------------------------------------------------

describe('validateGeneratorPlugin', () => {
  it('accepts a valid generator plugin', () => {
    expect(() => validateGeneratorPlugin(makeValidGenerator())).not.toThrow()
  })

  it('rejects null', () => {
    expect(() => validateGeneratorPlugin(null)).toThrow(PluginError)
  })

  it('rejects a non-object', () => {
    expect(() => validateGeneratorPlugin(42)).toThrow(PluginError)
  })

  it('rejects missing name', () => {
    const g = makeValidGenerator()
    ;(g as Record<string, unknown>).name = ''
    expect(() => validateGeneratorPlugin(g)).toThrow(PluginError)
  })

  it('rejects missing version', () => {
    const g = makeValidGenerator()
    ;(g as Record<string, unknown>).version = undefined
    expect(() => validateGeneratorPlugin(g)).toThrow(PluginError)
  })

  it('rejects missing columnPatterns array', () => {
    const g = makeValidGenerator()
    ;(g as Record<string, unknown>).columnPatterns = 'nope'
    expect(() => validateGeneratorPlugin(g)).toThrow(PluginError)
    expect(() => validateGeneratorPlugin(g)).toThrow(/columnPatterns/)
  })

  it('rejects missing generate function', () => {
    const g = makeValidGenerator()
    ;(g as Record<string, unknown>).generate = null
    expect(() => validateGeneratorPlugin(g)).toThrow(PluginError)
    expect(() => validateGeneratorPlugin(g)).toThrow(/generate/)
  })

  it('rejects non-numeric priority', () => {
    const g = makeValidGenerator()
    ;(g as Record<string, unknown>).priority = 'high'
    expect(() => validateGeneratorPlugin(g)).toThrow(PluginError)
    expect(() => validateGeneratorPlugin(g)).toThrow(/priority/)
  })

  it('rejects NaN priority', () => {
    const g = makeValidGenerator()
    ;(g as Record<string, unknown>).priority = NaN
    expect(() => validateGeneratorPlugin(g)).toThrow(PluginError)
  })

  it('rejects Infinity priority', () => {
    const g = makeValidGenerator()
    ;(g as Record<string, unknown>).priority = Infinity
    expect(() => validateGeneratorPlugin(g)).toThrow(PluginError)
  })
})

// ---------------------------------------------------------------------------
// validatePlugin (wrapper)
// ---------------------------------------------------------------------------

describe('validatePlugin', () => {
  it('accepts a valid parser wrapper', () => {
    const wrapper = { type: 'parser', plugin: makeValidParser() }
    expect(() => validatePlugin(wrapper)).not.toThrow()
  })

  it('accepts a valid generator wrapper', () => {
    const wrapper = { type: 'generator', plugin: makeValidGenerator() }
    expect(() => validatePlugin(wrapper)).not.toThrow()
  })

  it('rejects null', () => {
    expect(() => validatePlugin(null)).toThrow(PluginError)
  })

  it('rejects invalid type', () => {
    const wrapper = { type: 'transformer', plugin: makeValidParser() }
    expect(() => validatePlugin(wrapper)).toThrow(PluginError)
    expect(() => validatePlugin(wrapper)).toThrow(/type/)
  })

  it('rejects parser wrapper with invalid plugin', () => {
    const wrapper = { type: 'parser', plugin: {} }
    expect(() => validatePlugin(wrapper)).toThrow(PluginError)
  })

  it('rejects generator wrapper with invalid plugin', () => {
    const wrapper = { type: 'generator', plugin: { name: 'x' } }
    expect(() => validatePlugin(wrapper)).toThrow(PluginError)
  })
})
