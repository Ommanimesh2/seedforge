import { describe, it, expect, afterEach } from 'vitest'
import { createProvider, detectProvider } from '../provider.js'
import type { AIConfig } from '../types.js'

describe('detectProvider', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('detects openai from OPENAI_API_KEY', () => {
    process.env.OPENAI_API_KEY = 'sk-test-123'
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GROQ_API_KEY
    expect(detectProvider({ enabled: true })).toBe('openai')
  })

  it('detects anthropic from ANTHROPIC_API_KEY', () => {
    delete process.env.OPENAI_API_KEY
    process.env.ANTHROPIC_API_KEY = 'sk-ant-test-123'
    delete process.env.GROQ_API_KEY
    expect(detectProvider({ enabled: true })).toBe('anthropic')
  })

  it('detects groq from GROQ_API_KEY', () => {
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    process.env.GROQ_API_KEY = 'gsk-test-123'
    expect(detectProvider({ enabled: true })).toBe('groq')
  })

  it('defaults to ollama when no env vars are set', () => {
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GROQ_API_KEY
    expect(detectProvider({ enabled: true })).toBe('ollama')
  })

  it('detects anthropic from api key prefix sk-ant-', () => {
    const config: AIConfig = { enabled: true, apiKey: 'sk-ant-test-key' }
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    expect(detectProvider(config)).toBe('anthropic')
  })

  it('detects openai from generic api key', () => {
    const config: AIConfig = { enabled: true, apiKey: 'sk-test-key' }
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    expect(detectProvider(config)).toBe('openai')
  })
})

describe('createProvider', () => {
  const originalEnv = { ...process.env }

  afterEach(() => {
    process.env = { ...originalEnv }
  })

  it('creates ollama provider when specified', () => {
    const provider = createProvider({ enabled: true, provider: 'ollama' })
    expect(provider.name).toBe('ollama')
  })

  it('creates openai provider when specified', () => {
    const provider = createProvider({
      enabled: true,
      provider: 'openai',
      apiKey: 'sk-test-123',
    })
    expect(provider.name).toBe('openai')
  })

  it('creates anthropic provider when specified', () => {
    const provider = createProvider({
      enabled: true,
      provider: 'anthropic',
      apiKey: 'sk-ant-test-123',
    })
    expect(provider.name).toBe('anthropic')
  })

  it('creates groq provider (OpenAI-compatible) when specified', () => {
    const provider = createProvider({
      enabled: true,
      provider: 'groq',
      apiKey: 'gsk-test-123',
    })
    expect(provider.name).toBe('groq')
  })

  it('throws when openai has no API key', () => {
    delete process.env.OPENAI_API_KEY
    expect(() => createProvider({
      enabled: true,
      provider: 'openai',
    })).toThrow('OPENAI_API_KEY')
  })

  it('throws when anthropic has no API key', () => {
    delete process.env.ANTHROPIC_API_KEY
    expect(() => createProvider({
      enabled: true,
      provider: 'anthropic',
    })).toThrow('ANTHROPIC_API_KEY')
  })
})
