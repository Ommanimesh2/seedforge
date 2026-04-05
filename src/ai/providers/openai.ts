import type { AIProvider, AITextRequest } from '../types.js'
import { buildPrompt } from '../prompt.js'

/**
 * OpenAI-compatible provider.
 * Works with OpenAI, Groq, Together, and any API that implements
 * the /v1/chat/completions endpoint.
 */
export class OpenAIProvider implements AIProvider {
  readonly name: string
  private baseUrl: string
  private apiKey: string
  private model: string
  private temperature: number

  constructor(options: {
    apiKey: string
    model?: string
    baseUrl?: string
    temperature?: number
    name?: string
  }) {
    this.apiKey = options.apiKey
    this.model = options.model ?? 'gpt-4o-mini'
    this.baseUrl = (options.baseUrl ?? 'https://api.openai.com').replace(/\/$/, '')
    this.temperature = options.temperature ?? 0.7
    this.name = options.name ?? 'openai'
  }

  async generate(request: AITextRequest): Promise<string[]> {
    const prompt = buildPrompt(request)

    const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: 'You are a test data generator. You produce realistic, varied text for database seed data.' },
          { role: 'user', content: prompt },
        ],
        temperature: this.temperature,
        max_tokens: request.maxTokens * request.count,
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(
        `${this.name} API error (${response.status}): ${body.slice(0, 200)}`,
      )
    }

    const data = await response.json() as {
      choices: Array<{ message: { content: string } }>
    }

    const content = data.choices?.[0]?.message?.content ?? ''
    return parseJsonArray(content, request.count)
  }

  estimateTokens(request: AITextRequest): number {
    // Rough estimate: prompt ~100 tokens + output ~(maxTokens * count)
    return 100 + request.maxTokens * request.count
  }
}

/**
 * Parse a JSON array of strings from LLM output.
 * Handles common issues: markdown fences, extra text around the array.
 */
export function parseJsonArray(content: string, expectedCount: number): string[] {
  // Strip markdown code fences if present
  let cleaned = content.trim()
  cleaned = cleaned.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/, '')
  cleaned = cleaned.trim()

  // Find the JSON array in the response
  const arrayStart = cleaned.indexOf('[')
  const arrayEnd = cleaned.lastIndexOf(']')
  if (arrayStart === -1 || arrayEnd === -1) {
    // No JSON array found — split by newlines as fallback
    return fallbackSplit(content, expectedCount)
  }

  try {
    const parsed = JSON.parse(cleaned.slice(arrayStart, arrayEnd + 1))
    if (Array.isArray(parsed)) {
      const strings = parsed.map((item) => String(item))
      // Pad or trim to expected count
      return padToCount(strings, expectedCount)
    }
  } catch {
    // JSON parse failed — use fallback
  }

  return fallbackSplit(content, expectedCount)
}

function fallbackSplit(content: string, expectedCount: number): string[] {
  const lines = content
    .split('\n')
    .map((line) => line.replace(/^\d+[.)]\s*/, '').replace(/^["'\-*]\s*/, '').trim())
    .filter((line) => line.length > 0)

  return padToCount(lines, expectedCount)
}

function padToCount(values: string[], count: number): string[] {
  if (values.length >= count) {
    return values.slice(0, count)
  }
  // Pad by cycling through existing values
  const result = [...values]
  while (result.length < count) {
    result.push(values[result.length % values.length])
  }
  return result
}
