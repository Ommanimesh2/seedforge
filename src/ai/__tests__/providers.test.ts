import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { OpenAIProvider, parseJsonArray } from '../providers/openai.js'
import { AnthropicProvider } from '../providers/anthropic.js'
import { OllamaProvider } from '../providers/ollama.js'
import type { AITextRequest } from '../types.js'

const mockRequest: AITextRequest = {
  table: 'products',
  column: 'description',
  columnDomain: 'text',
  count: 3,
  maxTokens: 200,
}

describe('parseJsonArray', () => {
  it('parses a clean JSON array', () => {
    const result = parseJsonArray('["one", "two", "three"]', 3)
    expect(result).toEqual(['one', 'two', 'three'])
  })

  it('strips markdown code fences', () => {
    const result = parseJsonArray('```json\n["one", "two", "three"]\n```', 3)
    expect(result).toEqual(['one', 'two', 'three'])
  })

  it('finds array in surrounding text', () => {
    const result = parseJsonArray('Here are the results:\n["a", "b", "c"]\nDone!', 3)
    expect(result).toEqual(['a', 'b', 'c'])
  })

  it('pads to expected count if fewer values returned', () => {
    const result = parseJsonArray('["only one"]', 3)
    expect(result).toHaveLength(3)
    expect(result[0]).toBe('only one')
  })

  it('trims to expected count if more values returned', () => {
    const result = parseJsonArray('["a", "b", "c", "d", "e"]', 3)
    expect(result).toHaveLength(3)
  })

  it('falls back to line splitting when no JSON array', () => {
    const result = parseJsonArray('1. First item\n2. Second item\n3. Third item', 3)
    expect(result).toHaveLength(3)
    expect(result[0]).toBe('First item')
    expect(result[1]).toBe('Second item')
  })

  it('handles numbered list with dots', () => {
    const result = parseJsonArray('1. Hello\n2. World', 2)
    expect(result).toEqual(['Hello', 'World'])
  })

  it('handles bulleted list', () => {
    const result = parseJsonArray('- Hello\n- World', 2)
    expect(result).toEqual(['Hello', 'World'])
  })

  it('handles empty content gracefully', () => {
    const result = parseJsonArray('', 3)
    expect(result).toHaveLength(3) // padded from empty
  })
})

describe('OpenAIProvider', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('sends correct request to OpenAI API', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '["desc 1", "desc 2", "desc 3"]' } }],
        }),
        { status: 200 },
      ),
    )

    const provider = new OpenAIProvider({ apiKey: 'sk-test' })
    const result = await provider.generate(mockRequest)

    expect(result).toEqual(['desc 1', 'desc 2', 'desc 3'])
    expect(fetchSpy).toHaveBeenCalledOnce()

    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(options.method).toBe('POST')
    expect(options.headers).toHaveProperty('Authorization', 'Bearer sk-test')
  })

  it('uses custom base URL', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '["a", "b", "c"]' } }],
        }),
        { status: 200 },
      ),
    )

    const provider = new OpenAIProvider({
      apiKey: 'test',
      baseUrl: 'https://custom.api.com',
    })
    await provider.generate(mockRequest)

    const [url] = fetchSpy.mock.calls[0] as [string]
    expect(url).toBe('https://custom.api.com/v1/chat/completions')
  })

  it('throws on non-retryable API error', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))

    const provider = new OpenAIProvider({ apiKey: 'sk-test' })
    await expect(provider.generate(mockRequest)).rejects.toThrow('401')
  })

  it('estimates tokens', () => {
    const provider = new OpenAIProvider({ apiKey: 'sk-test' })
    const tokens = provider.estimateTokens(mockRequest)
    expect(tokens).toBeGreaterThan(0)
  })
})

describe('AnthropicProvider', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('sends correct request to Anthropic API', async () => {
    fetchSpy.mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          content: [{ type: 'text', text: '["bio 1", "bio 2", "bio 3"]' }],
        }),
        { status: 200 },
      ),
    )

    const provider = new AnthropicProvider({ apiKey: 'sk-ant-test' })
    const result = await provider.generate(mockRequest)

    expect(result).toEqual(['bio 1', 'bio 2', 'bio 3'])

    const [url, options] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(options.headers).toHaveProperty('x-api-key', 'sk-ant-test')
    expect(options.headers).toHaveProperty('anthropic-version', '2023-06-01')
  })

  it('throws on API error', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }))

    const provider = new AnthropicProvider({ apiKey: 'invalid' })
    await expect(provider.generate(mockRequest)).rejects.toThrow('401')
  })
})

describe('OllamaProvider', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('sends correct request to Ollama', async () => {
    // First call: ensureRunning (GET /api/tags)
    fetchSpy.mockResolvedValueOnce(new Response('{"models":[]}', { status: 200 }))
    // Second call: generate
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: { content: '["text 1", "text 2", "text 3"]' } }), {
        status: 200,
      }),
    )

    const provider = new OllamaProvider({ model: 'llama3.2' })
    const result = await provider.generate(mockRequest)

    expect(result).toEqual(['text 1', 'text 2', 'text 3'])
    expect(fetchSpy).toHaveBeenCalledTimes(2)

    // Check the generate call
    const [url] = fetchSpy.mock.calls[1] as [string]
    expect(url).toBe('http://localhost:11434/api/chat')
  })

  it('throws helpful error when Ollama is not running', async () => {
    fetchSpy.mockRejectedValueOnce(new Error('Connection refused'))

    const provider = new OllamaProvider()
    await expect(provider.generate(mockRequest)).rejects.toThrow('Cannot connect to Ollama')
  })

  it('uses custom base URL', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{"models":[]}', { status: 200 }))
    fetchSpy.mockResolvedValueOnce(
      new Response(JSON.stringify({ message: { content: '["a", "b", "c"]' } }), { status: 200 }),
    )

    const provider = new OllamaProvider({ baseUrl: 'http://gpu-server:11434' })
    await provider.generate(mockRequest)

    const [healthUrl] = fetchSpy.mock.calls[0] as [string]
    expect(healthUrl).toBe('http://gpu-server:11434/api/tags')
  })
})
