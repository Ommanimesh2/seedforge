import type { AIProvider, AITextRequest } from '../types.js'
import { buildPrompt } from '../prompt.js'

const FETCH_TIMEOUT_MS = 30_000
const MAX_RETRIES = 3
const RETRYABLE_STATUS_CODES = new Set([429, 500, 502, 503, 504])

/**
 * Fetch with timeout and retry for transient failures (429, 5xx).
 * Uses exponential backoff with jitter.
 */
export async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = MAX_RETRIES,
  timeoutMs = FETCH_TIMEOUT_MS,
): Promise<Response> {
  let lastError: Error | undefined

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: init.signal ?? AbortSignal.timeout(timeoutMs),
      })

      if (response.ok || !RETRYABLE_STATUS_CODES.has(response.status)) {
        if (!response.ok) {
          const body = await response.text()
          throw new Error(`API error (${response.status}): ${body.slice(0, 200)}`)
        }
        return response
      }

      // Retryable status code — backoff and retry
      if (attempt < retries) {
        const baseDelay = Math.min(1000 * 2 ** attempt, 8000)
        const jitter = Math.random() * baseDelay * 0.5
        await new Promise((r) => setTimeout(r, baseDelay + jitter))
        continue
      }

      const body = await response.text()
      throw new Error(
        `API error (${response.status}) after ${retries + 1} attempts: ${body.slice(0, 200)}`,
      )
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err), { cause: err })
      if (lastError.name === 'TimeoutError' || lastError.name === 'AbortError') {
        if (attempt < retries) {
          continue
        }
        throw new Error(`Request timed out after ${timeoutMs}ms (${retries + 1} attempts)`, {
          cause: err,
        })
      }
      if (attempt >= retries) {
        throw lastError
      }
    }
  }

  throw lastError ?? new Error('Request failed')
}

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

    const response = await fetchWithRetry(`${this.baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          {
            role: 'system',
            content:
              'You are a test data generator. You produce realistic, varied text for database seed data.',
          },
          { role: 'user', content: prompt },
        ],
        temperature: this.temperature,
        max_tokens: request.maxTokens * request.count,
      }),
    })

    const data = (await response.json()) as {
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
    .map((line) =>
      line
        .replace(/^\d+[.)]\s*/, '')
        .replace(/^["'\-*]\s*/, '')
        .trim(),
    )
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
