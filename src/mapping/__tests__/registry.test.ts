import { describe, it, expect } from 'vitest'
import { faker } from '@faker-js/faker'
import { buildRegistry } from '../registry.js'

describe('buildRegistry', () => {
  const registry = buildRegistry()

  it('has exact name lookup for person domain', () => {
    const entry = registry.exactNames.get('first_name')
    expect(entry).toBeDefined()
    expect(entry!.domain).toBe('person')
    expect(entry!.fakerMethod).toContain('firstName')
  })

  it('has exact name lookup for contact domain', () => {
    const entry = registry.exactNames.get('email')
    expect(entry).toBeDefined()
    expect(entry!.domain).toBe('contact')
  })

  it('has exact name lookup for internet domain', () => {
    const entry = registry.exactNames.get('ip_address')
    expect(entry).toBeDefined()
    expect(entry!.domain).toBe('internet')
  })

  it('has exact name lookup for location domain', () => {
    const entry = registry.exactNames.get('city')
    expect(entry).toBeDefined()
    expect(entry!.domain).toBe('location')
  })

  it('has exact name lookup for finance domain', () => {
    const entry = registry.exactNames.get('price')
    expect(entry).toBeDefined()
    expect(entry!.domain).toBe('finance')
  })

  it('has exact name lookup for commerce domain', () => {
    const entry = registry.exactNames.get('product_name')
    expect(entry).toBeDefined()
    expect(entry!.domain).toBe('commerce')
  })

  it('has exact name lookup for identifiers domain', () => {
    const entry = registry.exactNames.get('uuid')
    expect(entry).toBeDefined()
    expect(entry!.domain).toBe('identifiers')
  })

  it('has exact name lookup for temporal domain', () => {
    const entry = registry.exactNames.get('created_at')
    expect(entry).toBeDefined()
    expect(entry!.domain).toBe('temporal')
  })

  it('has exact name lookup for text domain', () => {
    const entry = registry.exactNames.get('description')
    expect(entry).toBeDefined()
    expect(entry!.domain).toBe('text')
  })

  it('has exact name lookup for boolean domain', () => {
    const entry = registry.exactNames.get('active')
    expect(entry).toBeDefined()
    expect(entry!.domain).toBe('boolean')
  })

  it('contains at least 80 total unique exact names', () => {
    expect(registry.exactNames.size).toBeGreaterThanOrEqual(80)
  })

  it('has suffix entries sorted by length descending (longest first)', () => {
    for (let i = 1; i < registry.suffixes.length; i++) {
      expect(registry.suffixes[i]!.suffix.length).toBeLessThanOrEqual(
        registry.suffixes[i - 1]!.suffix.length,
      )
    }
  })

  it('suffix matching returns correct entry for _email', () => {
    const emailSuffix = registry.suffixes.find((s) => s.suffix === '_email')
    expect(emailSuffix).toBeDefined()
    expect(emailSuffix!.entry.domain).toBe('contact')
  })

  it('prefix matching returns correct entry for is_', () => {
    const isPrefix = registry.prefixes.find((p) => p.prefix === 'is_')
    expect(isPrefix).toBeDefined()
    expect(isPrefix!.entry.domain).toBe('boolean')
  })

  it('collision resolution: title resolves to person domain (higher priority)', () => {
    const entry = registry.exactNames.get('title')
    expect(entry).toBeDefined()
    // Person has higher priority than text
    expect(entry!.domain).toBe('person')
  })

  it('all entries have valid generator functions that do not throw', () => {
    faker.seed(42)
    for (const [, entry] of registry.exactNames) {
      expect(() => entry.generator(faker, 0)).not.toThrow()
    }
  })

  it('all entries have non-empty fakerMethod and domain strings', () => {
    for (const [, entry] of registry.exactNames) {
      expect(entry.fakerMethod.length).toBeGreaterThan(0)
      expect(entry.domain.length).toBeGreaterThan(0)
    }
  })
})
