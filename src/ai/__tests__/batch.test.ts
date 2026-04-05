import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { generateAITextPool } from '../batch.js'
import type { AIConfig } from '../types.js'
import type { DatabaseSchema } from '../../types/schema.js'
import { NormalizedType } from '../../types/schema.js'

function makeSchema(tables: Record<string, string[]>): DatabaseSchema {
  const schema: DatabaseSchema = {
    name: 'test',
    tables: new Map(),
    enums: new Map(),
    schemas: ['public'],
  }

  for (const [tableName, columns] of Object.entries(tables)) {
    const colMap = new Map()
    for (const col of columns) {
      colMap.set(col, {
        name: col,
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
        arrayType: null,
      })
    }
    schema.tables.set(`public.${tableName}`, {
      name: tableName,
      schema: 'public',
      columns: colMap,
      primaryKey: null,
      foreignKeys: [],
      uniqueConstraints: [],
      checkConstraints: [],
      indexes: [],
      comment: null,
    })
  }

  return schema
}

describe('generateAITextPool', () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    fetchSpy = vi.spyOn(globalThis, 'fetch')
  })

  afterEach(() => {
    fetchSpy.mockRestore()
  })

  it('generates text pool for eligible columns', async () => {
    // Mock Ollama: health check + generate call
    fetchSpy.mockResolvedValueOnce(new Response('{"models":[]}', { status: 200 }))
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ message: { content: '["AI desc 1", "AI desc 2", "AI desc 3"]' } }),
      { status: 200 },
    ))

    const schema = makeSchema({ products: ['id', 'name', 'description', 'price'] })
    const config: AIConfig = {
      enabled: true,
      provider: 'ollama',
      cache: false,
    }
    const tableCounts = new Map([['public.products', 3]])

    const pool = await generateAITextPool(schema, config, tableCounts, undefined, {
      quiet: true,
      skipConfirmation: true,
    })

    expect(pool.has('public.products.description')).toBe(true)
    expect(pool.get('public.products.description')).toHaveLength(3)
    // id, name, price should not be in the pool
    expect(pool.has('public.products.id')).toBe(false)
    expect(pool.has('public.products.price')).toBe(false)
  })

  it('only generates for explicitly specified columns', async () => {
    fetchSpy.mockResolvedValueOnce(new Response('{"models":[]}', { status: 200 }))
    fetchSpy.mockResolvedValueOnce(new Response(
      JSON.stringify({ message: { content: '["custom 1", "custom 2"]' } }),
      { status: 200 },
    ))

    const schema = makeSchema({ products: ['description', 'title', 'notes'] })
    const config: AIConfig = {
      enabled: true,
      provider: 'ollama',
      columns: ['title'], // Only title
      cache: false,
    }
    const tableCounts = new Map([['public.products', 2]])

    const pool = await generateAITextPool(schema, config, tableCounts, undefined, {
      quiet: true,
      skipConfirmation: true,
    })

    expect(pool.has('public.products.title')).toBe(true)
    // description and notes should NOT be in pool since only title is specified
    expect(pool.has('public.products.description')).toBe(false)
    expect(pool.has('public.products.notes')).toBe(false)
  })

  it('returns empty pool when no eligible columns found', async () => {
    const schema = makeSchema({ products: ['id', 'name', 'price'] })
    const config: AIConfig = {
      enabled: true,
      provider: 'ollama',
      cache: false,
    }
    const tableCounts = new Map([['public.products', 5]])

    const pool = await generateAITextPool(schema, config, tableCounts, undefined, {
      quiet: true,
      skipConfirmation: true,
    })

    expect(pool.size).toBe(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })

  it('handles provider failure gracefully', async () => {
    fetchSpy.mockRejectedValue(new Error('Connection refused'))

    const schema = makeSchema({ posts: ['description'] })
    const config: AIConfig = {
      enabled: true,
      provider: 'ollama',
      cache: false,
    }
    const tableCounts = new Map([['public.posts', 3]])

    const pool = await generateAITextPool(schema, config, tableCounts, undefined, {
      quiet: true,
      skipConfirmation: true,
    })

    // Should return empty pool, not throw
    expect(pool.has('public.posts.description')).toBe(false)
  })

  it('skips tables with 0 count', async () => {
    const schema = makeSchema({ products: ['description'] })
    const config: AIConfig = {
      enabled: true,
      provider: 'ollama',
      cache: false,
    }
    const tableCounts = new Map([['public.products', 0]])

    const pool = await generateAITextPool(schema, config, tableCounts, undefined, {
      quiet: true,
      skipConfirmation: true,
    })

    expect(pool.size).toBe(0)
    expect(fetchSpy).not.toHaveBeenCalled()
  })
})
