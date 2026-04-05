import { describe, it, expect } from 'vitest'
import { formatCostEstimate, isPaidProvider, estimateTotalTokens } from '../cost.js'
import type { AITextRequest } from '../types.js'
import { OpenAIProvider } from '../providers/openai.js'

describe('formatCostEstimate', () => {
  it('shows cost for known OpenAI model', () => {
    const result = formatCostEstimate(5000, 'openai', 'gpt-4o-mini')
    expect(result).toContain('5,000')
    expect(result).toContain('$')
  })

  it('shows "no cost" for ollama', () => {
    const result = formatCostEstimate(5000, 'ollama', 'llama3.2')
    expect(result).toContain('no cost')
  })

  it('shows "pricing unknown" for unknown model', () => {
    const result = formatCostEstimate(5000, 'openai', 'unknown-model')
    expect(result).toContain('pricing unknown')
  })
})

describe('isPaidProvider', () => {
  it('returns false for ollama', () => {
    expect(isPaidProvider('ollama')).toBe(false)
  })

  it('returns true for openai', () => {
    expect(isPaidProvider('openai')).toBe(true)
  })

  it('returns true for anthropic', () => {
    expect(isPaidProvider('anthropic')).toBe(true)
  })

  it('returns true for groq', () => {
    expect(isPaidProvider('groq')).toBe(true)
  })
})

describe('estimateTotalTokens', () => {
  it('sums token estimates across requests', () => {
    const provider = new OpenAIProvider({ apiKey: 'test' })
    const requests: AITextRequest[] = [
      { table: 't', column: 'c1', columnDomain: 'text', count: 10, maxTokens: 200 },
      { table: 't', column: 'c2', columnDomain: 'text', count: 5, maxTokens: 100 },
    ]

    const total = estimateTotalTokens(provider, requests)
    expect(total).toBe(
      provider.estimateTokens(requests[0]) + provider.estimateTokens(requests[1]),
    )
  })
})
