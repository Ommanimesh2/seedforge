import { describe, it, expect } from 'vitest'
import { validateConfig } from '../validate.js'

describe('AI config validation', () => {
  it('accepts valid AI config', () => {
    const config = validateConfig({
      ai: {
        enabled: true,
        provider: 'ollama',
        model: 'llama3.2',
        temperature: 0.7,
        maxTokensPerField: 200,
        batchSize: 20,
        cache: true,
      },
    })

    expect(config.ai).toBeDefined()
    expect(config.ai!.enabled).toBe(true)
    expect(config.ai!.provider).toBe('ollama')
    expect(config.ai!.model).toBe('llama3.2')
  })

  it('accepts AI config with columns', () => {
    const config = validateConfig({
      ai: {
        enabled: true,
        columns: ['products.description', 'users.bio'],
      },
    })

    expect(config.ai!.columns).toEqual(['products.description', 'users.bio'])
  })

  it('accepts AI config with custom prompt', () => {
    const config = validateConfig({
      ai: {
        prompt: 'Generate {count} items for {table}.{column}',
      },
    })

    expect(config.ai!.prompt).toContain('{count}')
  })

  it('rejects invalid provider', () => {
    expect(() => validateConfig({
      ai: { provider: 'invalid' },
    })).toThrow('Invalid AI provider')
  })

  it('rejects invalid temperature (too high)', () => {
    expect(() => validateConfig({
      ai: { temperature: 3 },
    })).toThrow('temperature')
  })

  it('rejects invalid temperature (negative)', () => {
    expect(() => validateConfig({
      ai: { temperature: -1 },
    })).toThrow('temperature')
  })

  it('rejects non-boolean enabled', () => {
    expect(() => validateConfig({
      ai: { enabled: 'yes' },
    })).toThrow('boolean')
  })

  it('rejects non-array columns', () => {
    expect(() => validateConfig({
      ai: { columns: 'description' },
    })).toThrow('array of strings')
  })

  it('rejects non-integer batchSize', () => {
    expect(() => validateConfig({
      ai: { batchSize: 1.5 },
    })).toThrow('positive integer')
  })

  it('rejects unknown AI config keys', () => {
    expect(() => validateConfig({
      ai: { unknownKey: true },
    })).toThrow('Unknown config key')
  })

  it('accepts empty AI config', () => {
    const config = validateConfig({ ai: {} })
    expect(config.ai).toBeDefined()
  })

  it('accepts all valid providers', () => {
    for (const provider of ['openai', 'anthropic', 'ollama', 'groq']) {
      const config = validateConfig({ ai: { provider } })
      expect(config.ai!.provider).toBe(provider)
    }
  })
})
