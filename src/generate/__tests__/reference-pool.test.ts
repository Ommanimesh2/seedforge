import { describe, it, expect } from 'vitest'
import { ReferencePoolManager } from '../reference-pool.js'
import { createSeededFaker } from '../../mapping/seeded-faker.js'

describe('ReferencePoolManager', () => {
  it('initializes from existing data and contains those values', () => {
    const pool = new ReferencePoolManager()
    pool.initFromExisting('public.users', ['id'], [[1], [2], [3]])

    expect(pool.hasReferences('public.users')).toBe(true)
    expect(pool.poolSize('public.users')).toBe(3)
  })

  it('adds generated values to pool', () => {
    const pool = new ReferencePoolManager()
    pool.addGenerated('public.users', [[10], [20]])

    expect(pool.hasReferences('public.users')).toBe(true)
    expect(pool.poolSize('public.users')).toBe(2)
  })

  it('merges existing and generated values', () => {
    const pool = new ReferencePoolManager()
    pool.initFromExisting('public.users', ['id'], [[1], [2]])
    pool.addGenerated('public.users', [[3], [4]])

    expect(pool.poolSize('public.users')).toBe(4)
  })

  it('picks a valid reference from pool', () => {
    const pool = new ReferencePoolManager()
    pool.initFromExisting('public.users', ['id'], [[1], [2], [3]])

    const faker = createSeededFaker(42)
    const ref = pool.pickReference('public.users', faker)

    expect(ref).not.toBeNull()
    expect([[1], [2], [3]]).toContainEqual(ref)
  })

  it('returns null when picking from empty pool', () => {
    const pool = new ReferencePoolManager()
    const faker = createSeededFaker(42)

    const ref = pool.pickReference('public.nonexistent', faker)
    expect(ref).toBeNull()
  })

  it('returns null when picking from non-existent pool', () => {
    const pool = new ReferencePoolManager()
    const faker = createSeededFaker(42)

    expect(pool.pickReference('public.missing', faker)).toBeNull()
    expect(pool.hasReferences('public.missing')).toBe(false)
  })

  it('handles composite PK tuples correctly', () => {
    const pool = new ReferencePoolManager()
    pool.initFromExisting(
      'public.order_items',
      ['order_id', 'product_id'],
      [[1, 10], [2, 20], [3, 30]],
    )

    const faker = createSeededFaker(42)
    const ref = pool.pickReference('public.order_items', faker)

    expect(ref).not.toBeNull()
    expect(ref!.length).toBe(2) // Always a pair
    // The tuple should match one of the originals
    expect([[1, 10], [2, 20], [3, 30]]).toContainEqual(ref)
  })

  it('produces deterministic picks with same seed', () => {
    const pool = new ReferencePoolManager()
    pool.initFromExisting('public.users', ['id'], [[1], [2], [3], [4], [5]])

    // First run: seed and collect picks
    const faker1 = createSeededFaker(123)
    const picks1 = Array.from({ length: 10 }, () =>
      pool.pickReference('public.users', faker1),
    )

    // Second run: re-seed the same faker and collect picks again
    const faker2 = createSeededFaker(123)
    const picks2 = Array.from({ length: 10 }, () =>
      pool.pickReference('public.users', faker2),
    )

    expect(picks1).toEqual(picks2)
  })

  it('maintains independent pools for multiple tables', () => {
    const pool = new ReferencePoolManager()
    pool.initFromExisting('public.users', ['id'], [[1], [2]])
    pool.initFromExisting('public.posts', ['id'], [[100], [200], [300]])

    expect(pool.poolSize('public.users')).toBe(2)
    expect(pool.poolSize('public.posts')).toBe(3)
  })

  it('reports correct pool size', () => {
    const pool = new ReferencePoolManager()

    expect(pool.poolSize('public.users')).toBe(0)

    pool.initFromExisting('public.users', ['id'], [[1]])
    expect(pool.poolSize('public.users')).toBe(1)

    pool.addGenerated('public.users', [[2], [3]])
    expect(pool.poolSize('public.users')).toBe(3)
  })

  it('getPool returns the pool object or null', () => {
    const pool = new ReferencePoolManager()
    pool.initFromExisting('public.users', ['id'], [[1]])

    const p = pool.getPool('public.users')
    expect(p).not.toBeNull()
    expect(p!.tableName).toBe('public.users')
    expect(p!.columns).toEqual(['id'])
    expect(p!.values).toEqual([[1]])

    expect(pool.getPool('public.nonexistent')).toBeNull()
  })
})
