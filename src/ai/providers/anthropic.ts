import type { AIProvider, AITextRequest } from '../types.js'
import { buildPrompt } from '../prompt.js'
import { parseJsonArray, fetchWithRetry } from './openai.js'

const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'

/**
 * Anthropic Claude provider.
 */
export class AnthropicProvider implements AIProvider {
  readonly name = 'anthropic'
  private apiKey: string
  private model: string
  private temperature: number
  private baseUrl: string

  constructor(options: { apiKey: string; model?: string; baseUrl?: string; temperature?: number }) {
    this.apiKey = options.apiKey
    this.model = options.model ?? 'claude-haiku-4-5-20251001'
    this.baseUrl = (options.baseUrl ?? ANTHROPIC_API_URL).replace(/\/$/, '')
    this.temperature = options.temperature ?? 0.7
  }

  async generate(request: AITextRequest): Promise<string[]> {
    const prompt = buildPrompt(request)

    const response = await fetchWithRetry(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
      },
      body: JSON.stringify({
        model: this.model,
        max_tokens: request.maxTokens * request.count,
        temperature: this.temperature,
        system:
          'You are a test data generator. You produce realistic, varied text for database seed data.',
        messages: [{ role: 'user', content: prompt }],
      }),
    })

    const data = (await response.json()) as {
      content: Array<{ type: string; text: string }>
    }

    const textBlock = data.content?.find((b) => b.type === 'text')
    const content = textBlock?.text ?? ''
    return parseJsonArray(content, request.count)
  }

  estimateTokens(request: AITextRequest): number {
    return 100 + request.maxTokens * request.count
  }
}
