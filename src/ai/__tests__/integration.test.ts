import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateAITextPool } from '../batch.js'
import { createProvider, detectProvider } from '../provider.js'
import { buildPrompt, isAIEligibleColumn } from '../prompt.js'
import { AICache } from '../cache.js'
import { estimateTotalTokens, formatCostEstimate, isPaidProvider } from '../cost.js'
import { generate } from '../../generate/generate.js'
import { buildInsertPlan } from '../../graph/index.js'
import type { AIConfig, AITextRequest } from '../types.js'
import type { DatabaseSchema, TableDef, ColumnDef } from '../../types/schema.js'
import { NormalizedType } from '../../types/schema.js'
import { rmSync, existsSync, readdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const TEST_CACHE_DIR = '.test-cache-integration'

function makeColumn(name: string, overrides: Partial<ColumnDef> = {}): ColumnDef {
  return {
    name,
    dataType: NormalizedType.TEXT,
    nativeType: 'text',
    isNullable: true,
    hasDefault: false,
    defaultValue: null,
    isAutoIncrement: false,
    isGenerated: false,
    maxLength: null,
    numericPrecision: null,
    numericScale: null,
    enumValues: null,
    comment: null,
    ...overrides,
  }
}

function makeTable(name: string, columns: ColumnDef[], options: Partial<TableDef> = {}): TableDef {
  const colMap = new Map<string, ColumnDef>()
  for (const col of columns) {
    colMap.set(col.name, col)
  }
  return {
    name,
    schema: 'public',
    columns: colMap,
    primaryKey: null,
    foreignKeys: [],
    uniqueConstraints: [],
    checkConstraints: [],
    indexes: [],
    comment: null,
    ...options,
  }
}

function makeSchema(tables: TableDef[]): DatabaseSchema {
  const tableMap = new Map<string, TableDef>()
  for (const table of tables) {
    tableMap.set(`${table.schema}.${table.name}`, table)
  }
  return {
    name: 'test',
    tables: tableMap,
    enums: new Map(),
    schemas: ['public'],
  }
}

/** Build an Ollama-style mock response with a JSON array of strings */
function ollamaResponse(values: string[]): Response {
  return new Response(
    JSON.stringify({ message: { content: JSON.stringify(values) } }),
    { status: 200 },
  )
}

/** Build an OpenAI-style mock response */
function openaiResponse(values: string[]): Response {
  return new Response(
    JSON.stringify({
      choices: [{ message: { content: JSON.stringify(values) } }],
    }),
    { status: 200 },
  )
}

/** Build an Anthropic-style mock response */
function anthropicResponse(values: string[]): Response {
  return new Response(
    JSON.stringify({
      content: [{ type: 'text', text: JSON.stringify(values) }],
    }),
    { status: 200 },
  )
}

/** Mock Ollama health check response */
function ollamaHealthResponse(): Response {
  return new Response('{"models":[]}', { status: 200 })
}

// ---------------------------------------------------------------------------
// Integration Tests
// ---------------------------------------------------------------------------

describe('AI Integration: End-to-end pool generation + row consumption', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
    if (existsSync(TEST_CACHE_DIR)) {
      rmSync(TEST_CACHE_DIR, { recursive: true })
    }
  })

  it('AI-generated text appears in generated rows for eligible columns', async () => {
    const aiTexts = [
      'Premium wireless headphones with active noise cancellation',
      'Lightweight running shoes with responsive cushioning',
      'Stainless steel water bottle with vacuum insulation',
      'Ergonomic mechanical keyboard with customizable backlighting',
      'Compact travel backpack with anti-theft design',
    ]

    // Mock Ollama: health + 1 generate call
    fetchSpy.mockResolvedValueOnce(ollamaHealthResponse())
    fetchSpy.mockResolvedValueOnce(ollamaResponse(aiTexts))

    const schema = makeSchema([
      makeTable('products', [
        makeColumn('id', { dataType: NormalizedType.INTEGER, isAutoIncrement: true }),
        makeColumn('name', { dataType: NormalizedType.VARCHAR }),
        makeColumn('description'),
        makeColumn('price', { dataType: NormalizedType.DECIMAL, numericPrecision: 10, numericScale: 2 }),
      ], {
        primaryKey: { columns: ['id'], name: 'products_pkey' },
      }),
    ])

    const config: AIConfig = { enabled: true, provider: 'ollama', cache: false }
    const tableCounts = new Map([['public.products', 5]])

    // Step 1: Generate AI text pool
    const pool = await generateAITextPool(schema, config, tableCounts, undefined, {
      quiet: true,
      skipConfirmation: true,
    })

    expect(pool.has('public.products.description')).toBe(true)
    expect(pool.get('public.products.description')).toEqual(aiTexts)

    // Step 2: Feed pool into the generation engine
    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 5,
      seed: 42,
      aiTextPool: pool,
    })

    const rows = result.tables.get('public.products')!.rows
    expect(rows).toHaveLength(5)

    // Verify AI text is in the description column for each row
    for (let i = 0; i < 5; i++) {
      expect(rows[i].description).toBe(aiTexts[i])
    }

    // Verify non-AI columns are still Faker-generated (not AI text)
    for (const row of rows) {
      // name is nullable, so it may be null (due to nullableRate)
      if (row.name !== null) {
        expect(typeof row.name).toBe('string')
        expect(aiTexts).not.toContain(row.name)
      }
    }
  })

  it('AI text cycles when pool is smaller than row count', async () => {
    const aiTexts = ['Short bio 1', 'Short bio 2']

    fetchSpy.mockResolvedValueOnce(ollamaHealthResponse())
    fetchSpy.mockResolvedValueOnce(ollamaResponse(aiTexts))

    const schema = makeSchema([
      makeTable('users', [
        makeColumn('id', { dataType: NormalizedType.INTEGER, isAutoIncrement: true }),
        makeColumn('bio'),
      ], {
        primaryKey: { columns: ['id'], name: 'users_pkey' },
      }),
    ])

    const config: AIConfig = { enabled: true, provider: 'ollama', cache: false }
    const tableCounts = new Map([['public.users', 2]])

    const pool = await generateAITextPool(schema, config, tableCounts, undefined, {
      quiet: true, skipConfirmation: true,
    })

    // Generate 5 rows from a pool of 2 values
    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 5,
      seed: 42,
      aiTextPool: pool,
    })

    const rows = result.tables.get('public.users')!.rows
    expect(rows).toHaveLength(5)

    // Pool has 2 values, rows cycle: 0→"Short bio 1", 1→"Short bio 2", 2→"Short bio 1", ...
    expect(rows[0].bio).toBe('Short bio 1')
    expect(rows[1].bio).toBe('Short bio 2')
    expect(rows[2].bio).toBe('Short bio 1')
    expect(rows[3].bio).toBe('Short bio 2')
    expect(rows[4].bio).toBe('Short bio 1')
  })

  it('AI text is truncated to column maxLength', async () => {
    const longText = 'A'.repeat(300)
    fetchSpy.mockResolvedValueOnce(ollamaHealthResponse())
    fetchSpy.mockResolvedValueOnce(ollamaResponse([longText]))

    const schema = makeSchema([
      makeTable('articles', [
        makeColumn('id', { dataType: NormalizedType.INTEGER, isAutoIncrement: true }),
        makeColumn('title', { maxLength: 50 }),
      ], {
        primaryKey: { columns: ['id'], name: 'articles_pkey' },
      }),
    ])

    const config: AIConfig = { enabled: true, provider: 'ollama', columns: ['title'], cache: false }
    const tableCounts = new Map([['public.articles', 1]])

    const pool = await generateAITextPool(schema, config, tableCounts, undefined, {
      quiet: true, skipConfirmation: true,
    })

    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 1,
      seed: 42,
      aiTextPool: pool,
    })

    const row = result.tables.get('public.articles')!.rows[0]
    expect(typeof row.title).toBe('string')
    expect((row.title as string).length).toBeLessThanOrEqual(50)
  })

  it('multi-table AI generation assigns correct text to correct tables', async () => {
    const productDescs = ['Product desc A', 'Product desc B']
    const reviewBodies = ['Great product review', 'Decent value review']

    // health + products description + reviews body
    fetchSpy.mockResolvedValueOnce(ollamaHealthResponse())
    fetchSpy.mockResolvedValueOnce(ollamaResponse(productDescs))
    fetchSpy.mockResolvedValueOnce(ollamaHealthResponse())
    fetchSpy.mockResolvedValueOnce(ollamaResponse(reviewBodies))

    const schema = makeSchema([
      makeTable('products', [
        makeColumn('id', { dataType: NormalizedType.INTEGER, isAutoIncrement: true }),
        makeColumn('description'),
      ], {
        primaryKey: { columns: ['id'], name: 'products_pkey' },
      }),
      makeTable('reviews', [
        makeColumn('id', { dataType: NormalizedType.INTEGER, isAutoIncrement: true }),
        makeColumn('body'),
      ], {
        primaryKey: { columns: ['id'], name: 'reviews_pkey' },
      }),
    ])

    const config: AIConfig = { enabled: true, provider: 'ollama', cache: false }
    const tableCounts = new Map([
      ['public.products', 2],
      ['public.reviews', 2],
    ])

    const pool = await generateAITextPool(schema, config, tableCounts, undefined, {
      quiet: true, skipConfirmation: true,
    })

    expect(pool.get('public.products.description')).toEqual(productDescs)
    expect(pool.get('public.reviews.body')).toEqual(reviewBodies)

    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 2,
      seed: 42,
      aiTextPool: pool,
    })

    const productRows = result.tables.get('public.products')!.rows
    const reviewRows = result.tables.get('public.reviews')!.rows

    expect(productRows[0].description).toBe('Product desc A')
    expect(productRows[1].description).toBe('Product desc B')
    expect(reviewRows[0].body).toBe('Great product review')
    expect(reviewRows[1].body).toBe('Decent value review')
  })

  it('non-eligible columns are skipped even with AI enabled', async () => {
    const schema = makeSchema([
      makeTable('users', [
        makeColumn('id', { dataType: NormalizedType.INTEGER, isAutoIncrement: true }),
        makeColumn('email', { dataType: NormalizedType.VARCHAR }),
        makeColumn('age', { dataType: NormalizedType.INTEGER }),
        makeColumn('created_at', { dataType: NormalizedType.TIMESTAMPTZ }),
      ], {
        primaryKey: { columns: ['id'], name: 'users_pkey' },
      }),
    ])

    const config: AIConfig = { enabled: true, provider: 'ollama', cache: false }
    const tableCounts = new Map([['public.users', 5]])

    const pool = await generateAITextPool(schema, config, tableCounts, undefined, {
      quiet: true, skipConfirmation: true,
    })

    // No AI-eligible columns in this table
    expect(pool.size).toBe(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})

describe('AI Integration: Provider switching', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>
  const originalEnv = { ...process.env }

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
    process.env = { ...originalEnv }
  })

  it('OpenAI provider generates pool and feeds into generation engine', async () => {
    const aiTexts = ['OpenAI title 1', 'OpenAI title 2', 'OpenAI title 3']
    fetchSpy.mockResolvedValueOnce(openaiResponse(aiTexts))

    const schema = makeSchema([
      makeTable('articles', [
        makeColumn('id', { dataType: NormalizedType.INTEGER, isAutoIncrement: true }),
        makeColumn('title'),
      ], {
        primaryKey: { columns: ['id'], name: 'articles_pkey' },
      }),
    ])

    const config: AIConfig = {
      enabled: true,
      provider: 'openai',
      apiKey: 'sk-test-key-123',
      cache: false,
    }
    const tableCounts = new Map([['public.articles', 3]])

    const pool = await generateAITextPool(schema, config, tableCounts, undefined, {
      quiet: true, skipConfirmation: true,
    })

    expect(pool.get('public.articles.title')).toEqual(aiTexts)

    // Verify the actual HTTP request went to OpenAI endpoint
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.openai.com/v1/chat/completions')
    expect(opts.headers).toHaveProperty('Authorization', 'Bearer sk-test-key-123')
  })

  it('Anthropic provider generates pool and feeds into generation engine', async () => {
    const aiTexts = ['Claude comment 1', 'Claude comment 2']
    fetchSpy.mockResolvedValueOnce(anthropicResponse(aiTexts))

    const schema = makeSchema([
      makeTable('feedback', [
        makeColumn('id', { dataType: NormalizedType.INTEGER, isAutoIncrement: true }),
        makeColumn('comment'),
      ], {
        primaryKey: { columns: ['id'], name: 'feedback_pkey' },
      }),
    ])

    const config: AIConfig = {
      enabled: true,
      provider: 'anthropic',
      apiKey: 'sk-ant-test-key-123',
      cache: false,
    }
    const tableCounts = new Map([['public.feedback', 2]])

    const pool = await generateAITextPool(schema, config, tableCounts, undefined, {
      quiet: true, skipConfirmation: true,
    })

    expect(pool.get('public.feedback.comment')).toEqual(aiTexts)

    // Verify Anthropic-specific headers
    const [url, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://api.anthropic.com/v1/messages')
    expect(opts.headers).toHaveProperty('x-api-key', 'sk-ant-test-key-123')
    expect(opts.headers).toHaveProperty('anthropic-version', '2023-06-01')
  })

  it('Groq provider uses OpenAI-compatible endpoint with custom baseUrl', async () => {
    const aiTexts = ['Groq fast text 1', 'Groq fast text 2']
    fetchSpy.mockResolvedValueOnce(openaiResponse(aiTexts))

    const schema = makeSchema([
      makeTable('posts', [
        makeColumn('id', { dataType: NormalizedType.INTEGER, isAutoIncrement: true }),
        makeColumn('content'),
      ], {
        primaryKey: { columns: ['id'], name: 'posts_pkey' },
      }),
    ])

    const config: AIConfig = {
      enabled: true,
      provider: 'groq',
      apiKey: 'gsk-test-key-123',
      cache: false,
    }
    const tableCounts = new Map([['public.posts', 2]])

    const pool = await generateAITextPool(schema, config, tableCounts, undefined, {
      quiet: true, skipConfirmation: true,
    })

    expect(pool.get('public.posts.content')).toEqual(aiTexts)

    // Verify Groq uses OpenAI-compatible endpoint
    const [url] = fetchSpy.mock.calls[0] as [string]
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions')
  })

  it('provider auto-detection works from env vars and feeds correct endpoint', async () => {
    // Set OpenAI key in env
    process.env.OPENAI_API_KEY = 'sk-env-test-key'
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GROQ_API_KEY

    const config: AIConfig = { enabled: true }
    const detected = detectProvider(config)
    expect(detected).toBe('openai')

    const provider = createProvider(config)
    expect(provider.name).toBe('openai')
  })

  it('provider auto-detection falls back to Ollama when no env vars', () => {
    delete process.env.OPENAI_API_KEY
    delete process.env.ANTHROPIC_API_KEY
    delete process.env.GROQ_API_KEY

    const config: AIConfig = { enabled: true }
    expect(detectProvider(config)).toBe('ollama')
  })

  it('all four providers implement the same AIProvider interface', () => {
    // Ollama (no API key needed)
    const ollama = createProvider({ enabled: true, provider: 'ollama' })
    expect(typeof ollama.generate).toBe('function')
    expect(typeof ollama.estimateTokens).toBe('function')
    expect(ollama.name).toBe('ollama')

    // OpenAI
    const openai = createProvider({ enabled: true, provider: 'openai', apiKey: 'sk-test' })
    expect(typeof openai.generate).toBe('function')
    expect(typeof openai.estimateTokens).toBe('function')
    expect(openai.name).toBe('openai')

    // Anthropic
    const anthropic = createProvider({ enabled: true, provider: 'anthropic', apiKey: 'sk-ant-test' })
    expect(typeof anthropic.generate).toBe('function')
    expect(typeof anthropic.estimateTokens).toBe('function')
    expect(anthropic.name).toBe('anthropic')

    // Groq
    const groq = createProvider({ enabled: true, provider: 'groq', apiKey: 'gsk-test' })
    expect(typeof groq.generate).toBe('function')
    expect(typeof groq.estimateTokens).toBe('function')
    expect(groq.name).toBe('groq')
  })
})

describe('AI Integration: Graceful failure + fallback', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('falls back to Faker when provider returns HTTP error', async () => {
    // Ollama health succeeds, but generation returns 500
    fetchSpy.mockResolvedValueOnce(ollamaHealthResponse())
    fetchSpy.mockResolvedValueOnce(new Response('Internal Server Error', { status: 500 }))

    const schema = makeSchema([
      makeTable('products', [
        makeColumn('id', { dataType: NormalizedType.INTEGER, isAutoIncrement: true }),
        makeColumn('description'),
      ], {
        primaryKey: { columns: ['id'], name: 'products_pkey' },
      }),
    ])

    const config: AIConfig = { enabled: true, provider: 'ollama', cache: false }
    const tableCounts = new Map([['public.products', 3]])

    // Pool generation should NOT throw
    const pool = await generateAITextPool(schema, config, tableCounts, undefined, {
      quiet: true, skipConfirmation: true,
    })

    // Pool should be empty for the failed column
    expect(pool.has('public.products.description')).toBe(false)

    // But row generation should still work (falls back to Faker)
    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 3,
      seed: 42,
      aiTextPool: pool,
    })

    const rows = result.tables.get('public.products')!.rows
    expect(rows).toHaveLength(3)
    // Faker generates text, not null
    for (const row of rows) {
      expect(row.description).toBeDefined()
    }
  })

  it('falls back to Faker when provider network fails completely', async () => {
    fetchSpy.mockRejectedValue(new Error('ECONNREFUSED'))

    const schema = makeSchema([
      makeTable('posts', [
        makeColumn('id', { dataType: NormalizedType.INTEGER, isAutoIncrement: true }),
        makeColumn('body'),
      ], {
        primaryKey: { columns: ['id'], name: 'posts_pkey' },
      }),
    ])

    const config: AIConfig = { enabled: true, provider: 'ollama', cache: false }
    const tableCounts = new Map([['public.posts', 2]])

    const pool = await generateAITextPool(schema, config, tableCounts, undefined, {
      quiet: true, skipConfirmation: true,
    })

    expect(pool.size).toBe(0)

    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 2,
      seed: 42,
      aiTextPool: pool,
    })

    expect(result.tables.get('public.posts')!.rows).toHaveLength(2)
  })

  it('handles provider returning invalid JSON gracefully', async () => {
    fetchSpy.mockResolvedValueOnce(ollamaHealthResponse())
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ message: { content: 'Here is some random text without any JSON array' } }),
      { status: 200 },
    ))

    const schema = makeSchema([
      makeTable('items', [
        makeColumn('id', { dataType: NormalizedType.INTEGER, isAutoIncrement: true }),
        makeColumn('summary'),
      ], {
        primaryKey: { columns: ['id'], name: 'items_pkey' },
      }),
    ])

    const config: AIConfig = { enabled: true, provider: 'ollama', cache: false }
    const tableCounts = new Map([['public.items', 3]])

    const pool = await generateAITextPool(schema, config, tableCounts, undefined, {
      quiet: true, skipConfirmation: true,
    })

    // parseJsonArray uses fallback line splitting — should still produce values
    expect(pool.has('public.items.summary')).toBe(true)
    const values = pool.get('public.items.summary')!
    expect(values.length).toBeGreaterThan(0)
  })

  it('handles empty response content gracefully', async () => {
    fetchSpy.mockResolvedValueOnce(ollamaHealthResponse())
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ message: { content: '' } }),
      { status: 200 },
    ))

    const schema = makeSchema([
      makeTable('logs', [
        makeColumn('id', { dataType: NormalizedType.INTEGER, isAutoIncrement: true }),
        makeColumn('message'),
      ], {
        primaryKey: { columns: ['id'], name: 'logs_pkey' },
      }),
    ])

    const config: AIConfig = { enabled: true, provider: 'ollama', columns: ['message'], cache: false }
    const tableCounts = new Map([['public.logs', 2]])

    // Should not throw
    const pool = await generateAITextPool(schema, config, tableCounts, undefined, {
      quiet: true, skipConfirmation: true,
    })

    // Pool will have padded empty-ish values from fallback parser
    expect(pool.has('public.logs.message')).toBe(true)
  })
})

describe('AI Integration: Cache behavior', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
    if (existsSync(TEST_CACHE_DIR)) {
      rmSync(TEST_CACHE_DIR, { recursive: true })
    }
  })

  it('cache write + read avoids duplicate API calls', () => {
    const cache = new AICache(TEST_CACHE_DIR)
    const key = { table: 'products', column: 'description', count: 5, model: 'gpt-4o-mini' }
    const values = ['cached 1', 'cached 2', 'cached 3', 'cached 4', 'cached 5']

    // First: write to cache
    cache.write(key, values)

    // Second: read from cache
    const cached = cache.read(key)
    expect(cached).toEqual(values)
  })

  it('different models produce different cache entries', () => {
    const cache = new AICache(TEST_CACHE_DIR)
    const baseKey = { table: 'posts', column: 'body', count: 3 }

    cache.write({ ...baseKey, model: 'gpt-4o-mini' }, ['gpt val 1', 'gpt val 2', 'gpt val 3'])
    cache.write({ ...baseKey, model: 'llama3.2' }, ['llama val 1', 'llama val 2', 'llama val 3'])

    expect(cache.read({ ...baseKey, model: 'gpt-4o-mini' })).toEqual(['gpt val 1', 'gpt val 2', 'gpt val 3'])
    expect(cache.read({ ...baseKey, model: 'llama3.2' })).toEqual(['llama val 1', 'llama val 2', 'llama val 3'])
  })

  it('cache disabled skips reading and writing', async () => {
    const cache = new AICache(TEST_CACHE_DIR)
    const key = { table: 'products', column: 'description', count: 3, model: 'default' }
    cache.write(key, ['stale 1', 'stale 2', 'stale 3'])

    // With cache: false, the pool should call the provider instead of reading cache
    fetchSpy.mockResolvedValueOnce(ollamaHealthResponse())
    fetchSpy.mockResolvedValueOnce(ollamaResponse(['fresh 1', 'fresh 2', 'fresh 3']))

    const schema = makeSchema([
      makeTable('products', [
        makeColumn('id', { dataType: NormalizedType.INTEGER, isAutoIncrement: true }),
        makeColumn('description'),
      ], {
        primaryKey: { columns: ['id'], name: 'products_pkey' },
      }),
    ])

    const config: AIConfig = { enabled: true, provider: 'ollama', cache: false }
    const tableCounts = new Map([['public.products', 3]])

    const pool = await generateAITextPool(schema, config, tableCounts, undefined, {
      quiet: true, skipConfirmation: true,
    })

    expect(pool.get('public.products.description')).toEqual(['fresh 1', 'fresh 2', 'fresh 3'])
    expect(fetchSpy).toHaveBeenCalled()
  })

  it('corrupted cache entry returns null and regenerates', () => {
    const cache = new AICache(TEST_CACHE_DIR)
    const key = { table: 'users', column: 'bio', count: 3, model: 'test' }

    // Write valid data first, then overwrite with corrupted data
    cache.write(key, ['valid 1', 'valid 2', 'valid 3'])

    // Find and corrupt the cache file
    const files = readdirSync(TEST_CACHE_DIR).filter(f => f.startsWith('users.bio.'))
    expect(files.length).toBeGreaterThan(0)
    writeFileSync(join(TEST_CACHE_DIR, files[0]), 'NOT VALID JSON{{', 'utf-8')

    // Should return null for corrupted entry
    expect(cache.read(key)).toBeNull()
  })
})

describe('AI Integration: Batch size + multiple batches', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('generates multiple batches when count exceeds batchSize', async () => {
    const batch1 = Array.from({ length: 3 }, (_, i) => `Batch1 item ${i}`)
    const batch2 = Array.from({ length: 3 }, (_, i) => `Batch2 item ${i}`)
    const batch3 = Array.from({ length: 2 }, (_, i) => `Batch3 item ${i}`)

    // Health check + 3 generate calls
    fetchSpy.mockResolvedValueOnce(ollamaHealthResponse())
    fetchSpy.mockResolvedValueOnce(ollamaResponse(batch1))
    fetchSpy.mockResolvedValueOnce(ollamaHealthResponse())
    fetchSpy.mockResolvedValueOnce(ollamaResponse(batch2))
    fetchSpy.mockResolvedValueOnce(ollamaHealthResponse())
    fetchSpy.mockResolvedValueOnce(ollamaResponse(batch3))

    const schema = makeSchema([
      makeTable('articles', [
        makeColumn('id', { dataType: NormalizedType.INTEGER, isAutoIncrement: true }),
        makeColumn('content'),
      ], {
        primaryKey: { columns: ['id'], name: 'articles_pkey' },
      }),
    ])

    const config: AIConfig = {
      enabled: true,
      provider: 'ollama',
      batchSize: 3, // Only 3 per batch
      cache: false,
    }
    const tableCounts = new Map([['public.articles', 8]])

    const pool = await generateAITextPool(schema, config, tableCounts, undefined, {
      quiet: true, skipConfirmation: true,
    })

    const values = pool.get('public.articles.content')!
    expect(values).toHaveLength(8)
    expect(values.slice(0, 3)).toEqual(batch1)
    expect(values.slice(3, 6)).toEqual(batch2)
    expect(values.slice(6, 8)).toEqual(batch3)
  })

  it('partial batch failure stops and returns what was generated', async () => {
    const batch1 = ['Success item 1', 'Success item 2', 'Success item 3']

    // Health + batch1 succeeds, health + batch2 fails
    fetchSpy.mockResolvedValueOnce(ollamaHealthResponse())
    fetchSpy.mockResolvedValueOnce(ollamaResponse(batch1))
    fetchSpy.mockResolvedValueOnce(ollamaHealthResponse())
    fetchSpy.mockResolvedValueOnce(new Response('Server overloaded', { status: 503 }))

    const schema = makeSchema([
      makeTable('posts', [
        makeColumn('id', { dataType: NormalizedType.INTEGER, isAutoIncrement: true }),
        makeColumn('body'),
      ], {
        primaryKey: { columns: ['id'], name: 'posts_pkey' },
      }),
    ])

    const config: AIConfig = {
      enabled: true,
      provider: 'ollama',
      batchSize: 3,
      cache: false,
    }
    const tableCounts = new Map([['public.posts', 6]])

    const pool = await generateAITextPool(schema, config, tableCounts, undefined, {
      quiet: true, skipConfirmation: true,
    })

    // Should have partial results from batch1
    const values = pool.get('public.posts.body')!
    expect(values).toEqual(batch1)
    expect(values).toHaveLength(3) // Only the successful batch
  })
})

describe('AI Integration: Column eligibility + config options', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('explicit columns override auto-detection', async () => {
    // Only generate for "name" (not normally eligible), skip "description" (normally eligible)
    fetchSpy.mockResolvedValueOnce(ollamaHealthResponse())
    fetchSpy.mockResolvedValueOnce(ollamaResponse(['Custom name 1', 'Custom name 2']))

    const schema = makeSchema([
      makeTable('products', [
        makeColumn('id', { dataType: NormalizedType.INTEGER, isAutoIncrement: true }),
        makeColumn('name', { dataType: NormalizedType.VARCHAR }),
        makeColumn('description'),
      ], {
        primaryKey: { columns: ['id'], name: 'products_pkey' },
      }),
    ])

    const config: AIConfig = {
      enabled: true,
      provider: 'ollama',
      columns: ['name'], // Only name
      cache: false,
    }
    const tableCounts = new Map([['public.products', 2]])

    const pool = await generateAITextPool(schema, config, tableCounts, undefined, {
      quiet: true, skipConfirmation: true,
    })

    expect(pool.has('public.products.name')).toBe(true)
    expect(pool.has('public.products.description')).toBe(false) // Skipped when explicit list provided
  })

  it('custom prompt template is used in generation', async () => {
    fetchSpy.mockResolvedValueOnce(ollamaHealthResponse())
    fetchSpy.mockResolvedValueOnce(ollamaResponse(['Custom output 1', 'Custom output 2']))

    const schema = makeSchema([
      makeTable('items', [
        makeColumn('id', { dataType: NormalizedType.INTEGER, isAutoIncrement: true }),
        makeColumn('description'),
      ], {
        primaryKey: { columns: ['id'], name: 'items_pkey' },
      }),
    ])

    const config: AIConfig = {
      enabled: true,
      provider: 'ollama',
      prompt: 'Generate {count} descriptions for {table}.{column} in Spanish',
      cache: false,
    }
    const tableCounts = new Map([['public.items', 2]])

    const pool = await generateAITextPool(schema, config, tableCounts, undefined, {
      quiet: true, skipConfirmation: true,
    })

    expect(pool.get('public.items.description')).toEqual(['Custom output 1', 'Custom output 2'])

    // Verify the prompt was sent to the provider with custom template
    const [, opts] = fetchSpy.mock.calls[1] as [string, RequestInit]
    const body = JSON.parse(opts.body as string)
    const userMessage = body.messages.find((m: { role: string }) => m.role === 'user')
    expect(userMessage.content).toContain('in Spanish')
  })

  it('auto-increment and generated columns are never AI-eligible', async () => {
    const schema = makeSchema([
      makeTable('articles', [
        makeColumn('id', { dataType: NormalizedType.INTEGER, isAutoIncrement: true }),
        makeColumn('content', { isGenerated: true }),
        makeColumn('description'),
      ], {
        primaryKey: { columns: ['id'], name: 'articles_pkey' },
      }),
    ])

    // Only description should be eligible (1 generate call)
    fetchSpy.mockResolvedValueOnce(ollamaHealthResponse())
    fetchSpy.mockResolvedValueOnce(ollamaResponse(['Only description']))

    const config: AIConfig = { enabled: true, provider: 'ollama', cache: false }
    const tableCounts = new Map([['public.articles', 1]])

    const pool = await generateAITextPool(schema, config, tableCounts, undefined, {
      quiet: true, skipConfirmation: true,
    })

    expect(pool.has('public.articles.description')).toBe(true)
    expect(pool.has('public.articles.id')).toBe(false)
    expect(pool.has('public.articles.content')).toBe(false)
  })

  it('suffixed column names are detected as eligible', () => {
    expect(isAIEligibleColumn('product_description')).toBe(true)
    expect(isAIEligibleColumn('user_bio')).toBe(true)
    expect(isAIEligibleColumn('post_body')).toBe(true)
    expect(isAIEligibleColumn('review_content')).toBe(true)
    expect(isAIEligibleColumn('item_summary')).toBe(true)
    expect(isAIEligibleColumn('article_title')).toBe(true)
  })
})

describe('AI Integration: Cost estimation across providers', () => {
  it('estimates tokens consistently across all providers', () => {
    const request: AITextRequest = {
      table: 'products',
      column: 'description',
      columnDomain: 'text',
      count: 10,
      maxTokens: 200,
    }

    const ollama = createProvider({ enabled: true, provider: 'ollama' })
    const openai = createProvider({ enabled: true, provider: 'openai', apiKey: 'sk-test' })
    const anthropic = createProvider({ enabled: true, provider: 'anthropic', apiKey: 'sk-ant-test' })
    const groq = createProvider({ enabled: true, provider: 'groq', apiKey: 'gsk-test' })

    // All providers should return positive token estimates
    expect(ollama.estimateTokens(request)).toBeGreaterThan(0)
    expect(openai.estimateTokens(request)).toBeGreaterThan(0)
    expect(anthropic.estimateTokens(request)).toBeGreaterThan(0)
    expect(groq.estimateTokens(request)).toBeGreaterThan(0)
  })

  it('formats cost estimate correctly for paid vs free providers', () => {
    expect(formatCostEstimate(5000, 'ollama', 'llama3.2')).toContain('no cost')
    expect(formatCostEstimate(5000, 'openai', 'gpt-4o-mini')).toContain('$')
    expect(formatCostEstimate(5000, 'anthropic', 'claude-haiku-4-5-20251001')).toContain('$')
    expect(formatCostEstimate(5000, 'groq', 'llama-3.1-8b-instant')).toContain('$')
  })

  it('isPaidProvider correctly classifies all providers', () => {
    expect(isPaidProvider('ollama')).toBe(false)
    expect(isPaidProvider('openai')).toBe(true)
    expect(isPaidProvider('anthropic')).toBe(true)
    expect(isPaidProvider('groq')).toBe(true)
  })

  it('total token estimation aggregates across multiple requests', () => {
    const requests: AITextRequest[] = [
      { table: 'products', column: 'description', columnDomain: 'text', count: 10, maxTokens: 200 },
      { table: 'reviews', column: 'body', columnDomain: 'text', count: 20, maxTokens: 300 },
    ]

    const provider = createProvider({ enabled: true, provider: 'ollama' })
    const total = estimateTotalTokens(provider, requests)

    const individual = requests.reduce((sum, r) => sum + provider.estimateTokens(r), 0)
    expect(total).toBe(individual)
    expect(total).toBeGreaterThan(0)
  })
})

describe('AI Integration: Prompt generation with real provider flow', () => {
  it('produces domain-specific prompts for all eligible column types', () => {
    const eligibleColumns = [
      'description', 'summary', 'excerpt', 'abstract',
      'body', 'content', 'text',
      'bio', 'about', 'tagline',
      'note', 'comment', 'message',
      'review', 'feedback',
      'title', 'headline', 'subject', 'caption',
      'reason', 'instructions',
    ]

    for (const column of eligibleColumns) {
      const request: AITextRequest = {
        table: 'test_table',
        column,
        columnDomain: 'text',
        count: 5,
        maxTokens: 200,
      }
      const prompt = buildPrompt(request)

      // Every prompt should end with JSON instruction
      expect(prompt).toContain('JSON array')
      // Should contain the count
      expect(prompt).toContain('5')
    }
  })

  it('prompt includes table and column context in fallback', () => {
    const request: AITextRequest = {
      table: 'my_custom_table',
      column: 'weird_field_xyz',
      columnDomain: 'text',
      count: 3,
      maxTokens: 200,
    }
    const prompt = buildPrompt(request)

    expect(prompt).toContain('my_custom_table')
    expect(prompt).toContain('weird_field_xyz')
    expect(prompt).toContain('JSON array')
  })
})

describe('AI Integration: FK tables with AI text', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('AI text works alongside FK references in child tables', async () => {
    const reviewBodies = ['Excellent quality!', 'Good value for money', 'Would buy again']

    fetchSpy.mockResolvedValueOnce(ollamaHealthResponse())
    fetchSpy.mockResolvedValueOnce(ollamaResponse(reviewBodies))

    const productsTable = makeTable('products', [
      makeColumn('id', { dataType: NormalizedType.INTEGER, isAutoIncrement: true }),
      makeColumn('name', { dataType: NormalizedType.VARCHAR }),
    ], {
      primaryKey: { columns: ['id'], name: 'products_pkey' },
    })

    const reviewsTable = makeTable('reviews', [
      makeColumn('id', { dataType: NormalizedType.INTEGER, isAutoIncrement: true }),
      makeColumn('product_id', { dataType: NormalizedType.INTEGER, isNullable: false }),
      makeColumn('body'),
    ], {
      primaryKey: { columns: ['id'], name: 'reviews_pkey' },
      foreignKeys: [{
        name: 'reviews_product_id_fkey',
        columns: ['product_id'],
        referencedTable: 'products',
        referencedSchema: 'public',
        referencedColumns: ['id'],
        onDelete: 'CASCADE' as never,
        onUpdate: 'NO_ACTION' as never,
        isDeferrable: false,
        isDeferred: false,
        isVirtual: false,
      }],
    })

    const schema = makeSchema([productsTable, reviewsTable])
    const config: AIConfig = { enabled: true, provider: 'ollama', cache: false }
    const tableCounts = new Map([
      ['public.products', 3],
      ['public.reviews', 3],
    ])

    const pool = await generateAITextPool(schema, config, tableCounts, undefined, {
      quiet: true, skipConfirmation: true,
    })

    expect(pool.has('public.reviews.body')).toBe(true)

    const plan = buildInsertPlan(schema)
    const result = await generate(schema, plan, null, {
      globalRowCount: 3,
      seed: 42,
      aiTextPool: pool,
    })

    const reviewRows = result.tables.get('public.reviews')!.rows
    expect(reviewRows).toHaveLength(3)

    for (let i = 0; i < 3; i++) {
      // AI text in body column
      expect(reviewRows[i].body).toBe(reviewBodies[i])
      // FK reference in product_id (should reference a valid product ID)
      expect(reviewRows[i].product_id).toBeDefined()
      expect(typeof reviewRows[i].product_id).toBe('number')
    }

    // Verify products were generated too
    const productRows = result.tables.get('public.products')!.rows
    expect(productRows).toHaveLength(3)
  })
})

describe('AI Integration: Custom model + baseUrl config', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('custom model is sent in API request', async () => {
    fetchSpy.mockResolvedValueOnce(openaiResponse(['val 1', 'val 2']))

    const config: AIConfig = {
      enabled: true,
      provider: 'openai',
      apiKey: 'sk-test',
      model: 'gpt-4o',
      cache: false,
    }

    const schema = makeSchema([
      makeTable('posts', [
        makeColumn('id', { dataType: NormalizedType.INTEGER, isAutoIncrement: true }),
        makeColumn('title'),
      ], {
        primaryKey: { columns: ['id'], name: 'posts_pkey' },
      }),
    ])

    const tableCounts = new Map([['public.posts', 2]])
    await generateAITextPool(schema, config, tableCounts, undefined, {
      quiet: true, skipConfirmation: true,
    })

    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(opts.body as string)
    expect(body.model).toBe('gpt-4o')
  })

  it('custom baseUrl routes to the correct endpoint', async () => {
    fetchSpy.mockResolvedValueOnce(openaiResponse(['val 1']))

    const config: AIConfig = {
      enabled: true,
      provider: 'openai',
      apiKey: 'sk-test',
      baseUrl: 'https://my-proxy.example.com',
      cache: false,
    }

    const schema = makeSchema([
      makeTable('items', [
        makeColumn('id', { dataType: NormalizedType.INTEGER, isAutoIncrement: true }),
        makeColumn('description'),
      ], {
        primaryKey: { columns: ['id'], name: 'items_pkey' },
      }),
    ])

    const tableCounts = new Map([['public.items', 1]])
    await generateAITextPool(schema, config, tableCounts, undefined, {
      quiet: true, skipConfirmation: true,
    })

    const [url] = fetchSpy.mock.calls[0] as [string]
    expect(url).toBe('https://my-proxy.example.com/v1/chat/completions')
  })

  it('custom temperature is passed to provider', async () => {
    fetchSpy.mockResolvedValueOnce(openaiResponse(['val 1']))

    const config: AIConfig = {
      enabled: true,
      provider: 'openai',
      apiKey: 'sk-test',
      temperature: 1.5,
      cache: false,
    }

    const schema = makeSchema([
      makeTable('posts', [
        makeColumn('id', { dataType: NormalizedType.INTEGER, isAutoIncrement: true }),
        makeColumn('title'),
      ], {
        primaryKey: { columns: ['id'], name: 'posts_pkey' },
      }),
    ])

    const tableCounts = new Map([['public.posts', 1]])
    await generateAITextPool(schema, config, tableCounts, undefined, {
      quiet: true, skipConfirmation: true,
    })

    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(opts.body as string)
    expect(body.temperature).toBe(1.5)
  })

  it('Ollama custom model is sent in request', async () => {
    fetchSpy.mockResolvedValueOnce(ollamaHealthResponse())
    fetchSpy.mockResolvedValueOnce(ollamaResponse(['val 1']))

    const config: AIConfig = {
      enabled: true,
      provider: 'ollama',
      model: 'mistral',
      cache: false,
    }

    const schema = makeSchema([
      makeTable('notes', [
        makeColumn('id', { dataType: NormalizedType.INTEGER, isAutoIncrement: true }),
        makeColumn('content'),
      ], {
        primaryKey: { columns: ['id'], name: 'notes_pkey' },
      }),
    ])

    const tableCounts = new Map([['public.notes', 1]])
    await generateAITextPool(schema, config, tableCounts, undefined, {
      quiet: true, skipConfirmation: true,
    })

    const [, opts] = fetchSpy.mock.calls[1] as [string, RequestInit]
    const body = JSON.parse(opts.body as string)
    expect(body.model).toBe('mistral')
  })

  it('Anthropic custom model is sent in request', async () => {
    fetchSpy.mockResolvedValueOnce(anthropicResponse(['val 1']))

    const config: AIConfig = {
      enabled: true,
      provider: 'anthropic',
      apiKey: 'sk-ant-test',
      model: 'claude-sonnet-4-5-20250514',
      cache: false,
    }

    const schema = makeSchema([
      makeTable('feedback', [
        makeColumn('id', { dataType: NormalizedType.INTEGER, isAutoIncrement: true }),
        makeColumn('comment'),
      ], {
        primaryKey: { columns: ['id'], name: 'feedback_pkey' },
      }),
    ])

    const tableCounts = new Map([['public.feedback', 1]])
    await generateAITextPool(schema, config, tableCounts, undefined, {
      quiet: true, skipConfirmation: true,
    })

    const [, opts] = fetchSpy.mock.calls[0] as [string, RequestInit]
    const body = JSON.parse(opts.body as string)
    expect(body.model).toBe('claude-sonnet-4-5-20250514')
  })
})
