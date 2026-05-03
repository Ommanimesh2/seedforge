import { describe, it, expect } from 'vitest'
import { UniqueTracker, CompositeUniqueTracker } from '../unique-tracker.js'
import { createSeededFaker } from '../../mapping/seeded-faker.js'
import { GenerationError } from '../../errors/index.js'

describe('UniqueTracker', () => {
  it('accepts unique value on first try', () => {
    const tracker = new UniqueTracker()
    const faker = createSeededFaker(42)
    const generator = () => 'unique_value'

    const result = tracker.generateUnique('public.users', 'username', generator, faker, 0)
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
    tracker.initFromExisting('public.users', 'email', new Set(['existing@example.com']))
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

    expect(() => tracker.generateUnique('public.items', 'name', generator, faker, 0, 5)).toThrow(
      GenerationError,
    )

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

  // ─── maxLength-aware tracking (post-truncation collision avoidance) ───
  // Regression for the v2.7.x --fast UNIQUE failure: a generator that
  // emits values which already saturate the column's maxLength would
  // produce suffix attempts ("FOO_1", "FOO_2") that the tracker
  // considered distinct, but post-truncation collapsed back to "FOO_1"
  // / "FOO_2" / etc. — and on shorter caps, even back to "FOO". The
  // tracker now stores the post-truncation form so collisions match
  // what Postgres sees.
  describe('maxLength-aware tracking', () => {
    it('returns the truncated value when first candidate exceeds maxLength', () => {
      const tracker = new UniqueTracker()
      const faker = createSeededFaker(42)
      const generator = () => 'INE0123456789EXTRA'
      const v = tracker.generateUnique('public.schemes', 'isin', generator, faker, 0, 1000, 12)
      expect(v).toBe('INE012345678')
    })

    it('produces distinct post-truncation values on collision', () => {
      // Deterministic colliding generator: same value every call. The
      // tracker must produce 100 unique post-truncation values via its
      // suffix strategy, never returning the same 12-char string twice.
      const tracker = new UniqueTracker()
      const faker = createSeededFaker(42)
      const generator = () => 'INE0123456789X' // 14 chars, > maxLength 12
      const out: string[] = []
      for (let i = 0; i < 100; i++) {
        const v = tracker.generateUnique('public.schemes', 'isin', generator, faker, i, 1000, 12)
        expect(typeof v).toBe('string')
        expect((v as string).length).toBeLessThanOrEqual(12)
        out.push(v as string)
      }
      // Every generated value is unique post-truncation.
      expect(new Set(out).size).toBe(100)
    })

    it('throws SF3002 when truncated suffixes also exhaust at low maxLength', () => {
      // maxLength=2 + colliding generator → truncated suffix space is
      // small enough that we eventually exhaust within maxRetries.
      const tracker = new UniqueTracker()
      const faker = createSeededFaker(42)
      const generator = () => 'AB' // already at limit
      // Generate until exhaustion. With maxLength=2 we have at most 100
      // unique 2-char values via the counter strategy, so 200 retries
      // forces the throw.
      expect(() => {
        for (let i = 0; i < 1000; i++) {
          tracker.generateUnique('t', 'c', generator, faker, i, 200, 2)
        }
      }).toThrow(GenerationError)
    })

    it('passes through non-string values without truncation', () => {
      const tracker = new UniqueTracker()
      const faker = createSeededFaker(42)
      let n = 100
      const generator = () => n++
      const v = tracker.generateUnique('t', 'c', generator, faker, 0, 1000, 5)
      expect(v).toBe(100)
    })
  })
})

describe('CompositeUniqueTracker', () => {
  it('add() returns true for new tuple, false for duplicate', () => {
    const t = new CompositeUniqueTracker()
    expect(t.add('public.x', ['a', 'b'], [1, 'foo'])).toBe(true)
    expect(t.add('public.x', ['a', 'b'], [1, 'foo'])).toBe(false)
    expect(t.add('public.x', ['a', 'b'], [1, 'bar'])).toBe(true)
  })

  it('has() returns the same answer as add() would have for an absent key', () => {
    const t = new CompositeUniqueTracker()
    expect(t.has('public.x', ['a'], ['v'])).toBe(false)
    t.add('public.x', ['a'], ['v'])
    expect(t.has('public.x', ['a'], ['v'])).toBe(true)
  })

  it('keys are scoped per-table (and per column-set)', () => {
    const t = new CompositeUniqueTracker()
    t.add('public.x', ['a', 'b'], [1, 2])
    expect(t.has('public.y', ['a', 'b'], [1, 2])).toBe(false)
    expect(t.has('public.x', ['a', 'c'], [1, 2])).toBe(false)
  })

  it('initFromExisting seeds the tracker so subsequent adds return false', () => {
    const t = new CompositeUniqueTracker()
    t.initFromExisting(
      'public.x',
      ['a', 'b'],
      [
        [1, 'foo'],
        [2, 'bar'],
      ],
    )
    expect(t.add('public.x', ['a', 'b'], [1, 'foo'])).toBe(false)
    expect(t.add('public.x', ['a', 'b'], [3, 'baz'])).toBe(true)
  })

  it('serializes Date tuple values for stable equality', () => {
    const t = new CompositeUniqueTracker()
    const d1 = new Date('2024-01-15T00:00:00Z')
    const d2 = new Date('2024-01-15T00:00:00Z')
    expect(t.add('public.x', ['d'], [d1])).toBe(true)
    // Same instant, different reference → still treated as duplicate.
    expect(t.add('public.x', ['d'], [d2])).toBe(false)
  })

  it('treats undefined and null as the same key', () => {
    const t = new CompositeUniqueTracker()
    expect(t.add('public.x', ['c'], [undefined])).toBe(true)
    expect(t.add('public.x', ['c'], [null])).toBe(false)
  })
})
