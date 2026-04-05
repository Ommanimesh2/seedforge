import type { AIProvider, AITextRequest, AIProviderType } from './types.js'

/**
 * Per-token pricing (input + output) in USD per 1K tokens.
 * Approximate values for cost estimation display.
 */
const PRICING: Record<string, { input: number; output: number }> = {
  // OpenAI
  'gpt-4o-mini': { input: 0.00015, output: 0.0006 },
  'gpt-4o': { input: 0.0025, output: 0.01 },
  'gpt-4.1-mini': { input: 0.0004, output: 0.0016 },
  'gpt-4.1-nano': { input: 0.0001, output: 0.0004 },

  // Anthropic
  'claude-haiku-4-5-20251001': { input: 0.0008, output: 0.004 },
  'claude-sonnet-4-5-20250514': { input: 0.003, output: 0.015 },

  // Groq (very cheap)
  'llama-3.1-8b-instant': { input: 0.00005, output: 0.00008 },
}

/**
 * Estimate total token usage across all requests.
 */
export function estimateTotalTokens(
  provider: AIProvider,
  requests: AITextRequest[],
): number {
  return requests.reduce((sum, req) => sum + provider.estimateTokens(req), 0)
}

/**
 * Format a cost estimate string for display.
 */
export function formatCostEstimate(
  tokens: number,
  providerType: AIProviderType,
  model: string,
): string {
  const pricing = PRICING[model]
  if (!pricing) {
    if (providerType === 'ollama') {
      return `~${tokens.toLocaleString()} tokens (local, no cost)`
    }
    return `~${tokens.toLocaleString()} tokens (pricing unknown for ${model})`
  }

  // Rough split: ~30% input, ~70% output
  const inputTokens = Math.round(tokens * 0.3)
  const outputTokens = Math.round(tokens * 0.7)
  const cost = (inputTokens / 1000) * pricing.input + (outputTokens / 1000) * pricing.output

  if (cost < 0.01) {
    return `~${tokens.toLocaleString()} tokens (~$${cost.toFixed(4)})`
  }
  return `~${tokens.toLocaleString()} tokens (~$${cost.toFixed(2)})`
}

/**
 * Check if a provider requires a paid API (for confirmation prompts).
 */
export function isPaidProvider(providerType: AIProviderType): boolean {
  return providerType !== 'ollama'
}
