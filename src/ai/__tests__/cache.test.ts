import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { AICache } from '../cache.js'
import { rmSync, existsSync } from 'node:fs'

const TEST_CACHE_DIR = '.test-cache-ai'

describe('AICache', () => {
  let cache: AICache

  beforeEach(() => {
    cache = new AICache(TEST_CACHE_DIR)
  })

  afterEach(() => {
    if (existsSync(TEST_CACHE_DIR)) {
      rmSync(TEST_CACHE_DIR, { recursive: true })
    }
  })

  const key = {
    table: 'products',
    column: 'description',
    count: 10,
    model: 'gpt-4o-mini',
  }

  it('returns null for cache miss', () => {
    expect(cache.read(key)).toBeNull()
  })

  it('writes and reads back values', () => {
    const values = ['desc 1', 'desc 2', 'desc 3']
    cache.write(key, values)

    const result = cache.read(key)
    expect(result).toEqual(values)
  })

  it('returns different results for different keys', () => {
    const values1 = ['a', 'b']
    const values2 = ['x', 'y']

    cache.write(key, values1)
    cache.write({ ...key, column: 'title' }, values2)

    expect(cache.read(key)).toEqual(values1)
    expect(cache.read({ ...key, column: 'title' })).toEqual(values2)
  })

  it('returns null for expired entries', async () => {
    const shortTTLCache = new AICache(TEST_CACHE_DIR, 1) // 1ms TTL
    shortTTLCache.write(key, ['expired'])

    // Wait for TTL to pass
    await new Promise((r) => setTimeout(r, 10))

    expect(shortTTLCache.read(key)).toBeNull()
  })

  it('includes seed in cache key', () => {
    const values1 = ['seeded']
    const values2 = ['different']

    cache.write({ ...key, seed: 42 }, values1)
    cache.write({ ...key, seed: 99 }, values2)

    expect(cache.read({ ...key, seed: 42 })).toEqual(values1)
    expect(cache.read({ ...key, seed: 99 })).toEqual(values2)
  })
})
