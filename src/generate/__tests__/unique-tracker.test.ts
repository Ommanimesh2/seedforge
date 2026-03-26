import { describe, it, expect } from 'vitest'
import { UniqueTracker } from '../unique-tracker.js'
import { createSeededFaker } from '../../mapping/seeded-faker.js'
import { GenerationError } from '../../errors/index.js'

describe('UniqueTracker', () => {
  it('accepts unique value on first try', () => {
    const tracker = new UniqueTracker()
    const faker = createSeededFaker(42)
    const generator = () => 'unique_value'

    const result = tracker.generateUnique(
      'public.users',
      'username',
      generator,
      faker,
      0,
    )
    expect(result).toBe('unique_value')
  })

  it('appends suffix on string collision', () => {
    const tracker = new UniqueTracker()
    const faker = createSeededFaker(42)
    const generator = () => 'john_doe'

    // First call succeeds
    const first = tracker.generateUnique('public.users', 'username', generator, faker, 0)
    expect(first).toBe('john_doe')

    // Second call hits collision, gets suffix
    const second = tracker.generateUnique('public.users', 'username', generator, faker, 1)
    expect(second).toBe('john_doe_1')

    // Third call
    const third = tracker.generateUnique('public.users', 'username', generator, faker, 2)
    expect(third).toBe('john_doe_2')
  })

  it('inserts suffix before @ for email collisions', () => {
    const tracker = new UniqueTracker()
    const faker = createSeededFaker(42)
    const generator = () => 'user@example.com'

    const first = tracker.generateUnique('public.users', 'email', generator, faker, 0)
    expect(first).toBe('user@example.com')

    const second = tracker.generateUnique('public.users', 'email', generator, faker, 1)
    expect(second).toBe('user_1@example.com')

    const third = tracker.generateUnique('public.users', 'email', generator, faker, 2)
    expect(third).toBe('user_2@example.com')
  })

  it('increments number values on collision', () => {
    const tracker = new UniqueTracker()
    const faker = createSeededFaker(42)
    const generator = () => 100

    const first = tracker.generateUnique('public.items', 'code', generator, faker, 0)
    expect(first).toBe(100)

    const second = tracker.generateUnique('public.items', 'code', generator, faker, 1)
    expect(second).toBe(101)
  })

  it('regenerates UUID values on collision (no suffix)', () => {
    const tracker = new UniqueTracker()
    const faker = createSeededFaker(42)

    // Force a UUID collision by using a fixed UUID generator first, then a real one
    const fixedUuid = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
    let callCount = 0
    const generator = (f: typeof faker) => {
      callCount++
      if (callCount <= 2) return fixedUuid
      return f.string.uuid()
    }

    const first = tracker.generateUnique('public.users', 'id', generator, faker, 0)
    expect(first).toBe(fixedUuid)

    // Second call should regenerate, not suffix
    const second = tracker.generateUnique('public.users', 'id', generator, faker, 1)
    expect(second).not.toBe(fixedUuid)
    // It should still be a valid-looking UUID (not have _1 suffix)
    expect(String(second)).not.toContain('_')
  })

  it('excludes existing values when initialized', () => {
    const tracker = new UniqueTracker()
    tracker.initFromExisting(
      'public.users',
      'email',
      new Set(['existing@example.com']),
    )
    const faker = createSeededFaker(42)
    const generator = () => 'existing@example.com'

    // Should not return the existing value, should suffix it
    const result = tracker.generateUnique('public.users', 'email', generator, faker, 0)
    expect(result).toBe('existing_1@example.com')
  })

  it('throws GenerationError SF3002 after maxRetries', () => {
    const tracker = new UniqueTracker()
    const faker = createSeededFaker(42)

    // Pre-populate with values that will cause exhaustion
    for (let i = 0; i <= 5; i++) {
      const val = i === 0 ? 'val' : `val_${i}`
      tracker.add('public.items', 'name', val)
    }
    const generator = () => 'val'

    expect(() =>
      tracker.generateUnique('public.items', 'name', generator, faker, 0, 5),
    ).toThrow(GenerationError)

    try {
      tracker.generateUnique('public.items', 'name', generator, faker, 0, 5)
    } catch (err) {
      expect((err as GenerationError).code).toBe('SF3002')
    }
  })

  it('allows same value in different tables (cross-table independence)', () => {
    const tracker = new UniqueTracker()
    const faker = createSeededFaker(42)
    const generator = () => 'shared_value'

    const first = tracker.generateUnique('public.users', 'name', generator, faker, 0)
    const second = tracker.generateUnique('public.posts', 'name', generator, faker, 0)

    expect(first).toBe('shared_value')
    expect(second).toBe('shared_value')
  })

  it('is case-sensitive: "John" and "john" are different values', () => {
    const tracker = new UniqueTracker()
    const faker = createSeededFaker(42)

    let callIdx = 0
    const generator = () => {
      callIdx++
      return callIdx === 1 ? 'John' : 'john'
    }

    const first = tracker.generateUnique('public.users', 'name', generator, faker, 0)
    expect(first).toBe('John')

    const second = tracker.generateUnique('public.users', 'name', generator, faker, 1)
    expect(second).toBe('john')
  })

  it('has() checks correctly', () => {
    const tracker = new UniqueTracker()
    tracker.add('public.users', 'email', 'test@example.com')

    expect(tracker.has('public.users', 'email', 'test@example.com')).toBe(true)
    expect(tracker.has('public.users', 'email', 'other@example.com')).toBe(false)
    expect(tracker.has('public.posts', 'email', 'test@example.com')).toBe(false)
  })

  it('add() returns false if value already present', () => {
    const tracker = new UniqueTracker()

    expect(tracker.add('public.users', 'name', 'alice')).toBe(true)
    expect(tracker.add('public.users', 'name', 'alice')).toBe(false)
    expect(tracker.add('public.users', 'name', 'bob')).toBe(true)
  })
})
