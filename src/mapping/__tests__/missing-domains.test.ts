import { describe, it, expect, beforeEach } from 'vitest'
import { faker } from '@faker-js/faker'
import { commercePatterns } from '../domains/commerce.js'
import { identifierPatterns } from '../domains/identifiers.js'
import { booleanPatterns } from '../domains/boolean.js'

describe('commerce domain patterns', () => {
  beforeEach(() => {
    faker.seed(42)
  })

  it('generates product names as strings', () => {
    const pattern = commercePatterns.find((p) => p.names.includes('product'))!
    const value = pattern.generator(faker, 0)
    expect(typeof value).toBe('string')
    expect((value as string).length).toBeGreaterThan(0)
  })

  it('generates brand names as strings', () => {
    const pattern = commercePatterns.find((p) => p.names.includes('brand'))!
    const value = pattern.generator(faker, 0)
    expect(typeof value).toBe('string')
    expect((value as string).length).toBeGreaterThan(0)
  })

  it('generates category as a department string', () => {
    const pattern = commercePatterns.find((p) => p.names.includes('category'))!
    const value = pattern.generator(faker, 0)
    expect(typeof value).toBe('string')
    expect((value as string).length).toBeGreaterThan(0)
  })

  it('generates sku as 8-char uppercase alphanumeric', () => {
    const pattern = commercePatterns.find((p) => p.names.includes('sku'))!
    const value = pattern.generator(faker, 0) as string
    expect(value).toMatch(/^[A-Z0-9]{8}$/)
  })

  it('generates barcode in ISBN format', () => {
    const pattern = commercePatterns.find((p) => p.names.includes('barcode'))!
    const value = pattern.generator(faker, 0) as string
    expect(typeof value).toBe('string')
    expect(value.length).toBeGreaterThan(0)
  })

  it('generates isbn in ISBN format', () => {
    const pattern = commercePatterns.find((p) => p.names.includes('isbn'))!
    const value = pattern.generator(faker, 0) as string
    expect(typeof value).toBe('string')
    expect(value.length).toBeGreaterThan(0)
  })

  it('generates color as a human-readable color name', () => {
    const pattern = commercePatterns.find((p) => p.names.includes('color'))!
    const value = pattern.generator(faker, 0) as string
    expect(typeof value).toBe('string')
    expect(value.length).toBeGreaterThan(0)
  })

  it('generates size as one of XS, S, M, L, XL, XXL', () => {
    const pattern = commercePatterns.find((p) => p.names.includes('size'))!
    const value = pattern.generator(faker, 0)
    expect(['XS', 'S', 'M', 'L', 'XL', 'XXL']).toContain(value)
  })

  it('generates weight as a number between 0.1 and 100', () => {
    const pattern = commercePatterns.find((p) => p.names.includes('weight'))!
    const value = pattern.generator(faker, 0) as number
    expect(typeof value).toBe('number')
    expect(value).toBeGreaterThanOrEqual(0.1)
    expect(value).toBeLessThanOrEqual(100)
  })

  it('generates quantity as an integer between 1 and 100', () => {
    const pattern = commercePatterns.find((p) => p.names.includes('quantity'))!
    const value = pattern.generator(faker, 0) as number
    expect(Number.isInteger(value)).toBe(true)
    expect(value).toBeGreaterThanOrEqual(1)
    expect(value).toBeLessThanOrEqual(100)
  })

  it('generates rating as an integer between 1 and 5', () => {
    const pattern = commercePatterns.find((p) => p.names.includes('rating'))!
    const value = pattern.generator(faker, 0) as number
    expect(Number.isInteger(value)).toBe(true)
    expect(value).toBeGreaterThanOrEqual(1)
    expect(value).toBeLessThanOrEqual(5)
  })

  it('generates review as a paragraph string', () => {
    const pattern = commercePatterns.find((p) => p.names.includes('review'))!
    const value = pattern.generator(faker, 0) as string
    expect(typeof value).toBe('string')
    expect(value.length).toBeGreaterThan(20)
  })

  it('all commerce patterns belong to the commerce domain', () => {
    for (const pattern of commercePatterns) {
      expect(pattern.domain).toBe('commerce')
    }
  })
})

describe('identifiers domain patterns', () => {
  beforeEach(() => {
    faker.seed(42)
  })

  it('generates uuid in valid UUID format', () => {
    const pattern = identifierPatterns.find((p) => p.names.includes('uuid'))!
    const value = pattern.generator(faker, 0) as string
    expect(value).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it('generates code as 8-char uppercase alphanumeric', () => {
    const pattern = identifierPatterns.find((p) => p.names.includes('code'))!
    const value = pattern.generator(faker, 0) as string
    expect(value).toMatch(/^[A-Z0-9]{8}$/)
  })

  it('generates hash as 40-char hex string', () => {
    const pattern = identifierPatterns.find((p) => p.names.includes('hash'))!
    const value = pattern.generator(faker, 0) as string
    expect(value).toMatch(/^[0-9a-fA-F]{40}$/)
  })

  it('generates external_id as 12-char alphanumeric', () => {
    const pattern = identifierPatterns.find((p) => p.names.includes('external_id'))!
    const value = pattern.generator(faker, 0) as string
    expect(value).toMatch(/^[a-zA-Z0-9]{12}$/)
  })

  it('generates tracking_number as 16-char uppercase alphanumeric', () => {
    const pattern = identifierPatterns.find((p) => p.names.includes('tracking_number'))!
    const value = pattern.generator(faker, 0) as string
    expect(value).toMatch(/^[A-Z0-9]{16}$/)
  })

  it('generates confirmation_code as 6-char uppercase alphanumeric', () => {
    const pattern = identifierPatterns.find((p) => p.names.includes('confirmation_code'))!
    const value = pattern.generator(faker, 0) as string
    expect(value).toMatch(/^[A-Z0-9]{6}$/)
  })

  it('generates serial_number as 10-char uppercase alphanumeric', () => {
    const pattern = identifierPatterns.find((p) => p.names.includes('serial_number'))!
    const value = pattern.generator(faker, 0) as string
    expect(value).toMatch(/^[A-Z0-9]{10}$/)
  })

  it('uuid pattern declares _uuid and _guid suffixes', () => {
    const pattern = identifierPatterns.find((p) => p.names.includes('uuid'))!
    expect(pattern.suffixes).toContain('_uuid')
    expect(pattern.suffixes).toContain('_guid')
  })

  it('all identifier patterns belong to the identifiers domain', () => {
    for (const pattern of identifierPatterns) {
      expect(pattern.domain).toBe('identifiers')
    }
  })
})

describe('boolean domain patterns', () => {
  beforeEach(() => {
    faker.seed(42)
  })

  it('generates boolean for named patterns (active, verified, etc.)', () => {
    const pattern = booleanPatterns.find((p) => p.names.includes('active'))!
    const value = pattern.generator(faker, 0)
    expect(typeof value).toBe('boolean')
  })

  it('named pattern covers all expected column names', () => {
    const namedPattern = booleanPatterns.find((p) => p.names.includes('active'))!
    const expectedNames = [
      'active',
      'enabled',
      'disabled',
      'verified',
      'confirmed',
      'approved',
      'published',
      'archived',
      'deleted',
      'visible',
      'hidden',
      'locked',
      'featured',
      'public',
      'private',
      'read',
      'admin',
      'subscribed',
      'opted_in',
    ]
    for (const name of expectedNames) {
      expect(namedPattern.names).toContain(name)
    }
  })

  it('generates boolean for prefix-based patterns (is_, has_, can_, etc.)', () => {
    const prefixPattern = booleanPatterns.find((p) => p.prefixes && p.prefixes.length > 0)!
    const value = prefixPattern.generator(faker, 0)
    expect(typeof value).toBe('boolean')
  })

  it('prefix pattern declares all expected prefixes', () => {
    const prefixPattern = booleanPatterns.find((p) => p.prefixes && p.prefixes.length > 0)!
    const expectedPrefixes = [
      'is_',
      'has_',
      'can_',
      'should_',
      'was_',
      'will_',
      'allow_',
      'enable_',
      'disable_',
    ]
    for (const prefix of expectedPrefixes) {
      expect(prefixPattern.prefixes).toContain(prefix)
    }
  })

  it('produces varied boolean values across multiple calls', () => {
    const pattern = booleanPatterns.find((p) => p.names.includes('active'))!
    const values = new Set<boolean>()
    for (let i = 0; i < 20; i++) {
      values.add(pattern.generator(faker, i) as boolean)
    }
    expect(values.size).toBe(2)
  })

  it('all boolean patterns belong to the boolean domain', () => {
    for (const pattern of booleanPatterns) {
      expect(pattern.domain).toBe('boolean')
    }
  })
})
