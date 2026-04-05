import type { AIProvider, AITextRequest } from '../types.js'
import { buildPrompt } from '../prompt.js'
import { parseJsonArray } from './openai.js'

const DEFAULT_OLLAMA_URL = 'http://localhost:11434'

/**
 * Ollama provider for local LLM inference.
 * No API key required — connects to a local Ollama instance.
 */
export class OllamaProvider implements AIProvider {
  readonly name = 'ollama'
  private baseUrl: string
  private model: string
  private temperature: number

  constructor(options: {
    model?: string
    baseUrl?: string
    temperature?: number
  } = {}) {
    this.model = options.model ?? 'llama3.2'
    this.baseUrl = (options.baseUrl ?? DEFAULT_OLLAMA_URL).replace(/\/$/, '')
    this.temperature = options.temperature ?? 0.7
  }

  async generate(request: AITextRequest): Promise<string[]> {
    await this.ensureRunning()

    const prompt = buildPrompt(request)
    const systemPrompt = 'You are a test data generator. You produce realistic, varied text for database seed data. Always respond with valid JSON.'

    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: prompt },
        ],
        stream: false,
        options: {
          temperature: this.temperature,
        },
      }),
    })

    if (!response.ok) {
      const body = await response.text()
      throw new Error(
        `Ollama API error (${response.status}): ${body.slice(0, 200)}`,
      )
    }

    const data = await response.json() as {
      message?: { content: string }
    }

    const content = data.message?.content ?? ''
    return parseJsonArray(content, request.count)
  }

  estimateTokens(request: AITextRequest): number {
    // Ollama is free/local, but estimate for consistency
    return 100 + request.maxTokens * request.count
  }

  /**
   * Check if Ollama is running. Throws a helpful error if not.
   */
  private async ensureRunning(): Promise<void> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(3000),
      })
      if (!response.ok) {
        throw new Error(`Ollama returned status ${response.status}`)
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      const error = new Error(
        `Cannot connect to Ollama at ${this.baseUrl}: ${detail}\n` +
        'Install Ollama from https://ollama.ai and run: ollama serve',
      )
      if (err instanceof Error) {
        error.cause = err
      }
      throw error
    }
  }
}
