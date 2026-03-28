import { describe, it, expect } from 'vitest'
import { faker } from '@faker-js/faker'
import { getDomainGenerator } from '../domain-generators.js'
import { NormalizedType } from '../../types/schema.js'

describe('getDomainGenerator', () => {
  beforeEach(() => {
    faker.seed(42)
  })

  describe('finance domain', () => {
    it('TEXT → transaction description', () => {
      const result = getDomainGenerator('finance', NormalizedType.TEXT)
      expect(result).not.toBeNull()
      expect(result!.fakerMethod).toContain('transactionDescription')
      const value = result!.generator(faker, 0)
      expect(typeof value).toBe('string')
    })

    it('DECIMAL → finance amount', () => {
      const result = getDomainGenerator('finance', NormalizedType.DECIMAL)
      expect(result).not.toBeNull()
      expect(result!.fakerMethod).toContain('finance.amount')
      const value = result!.generator(faker, 0) as string
      expect(value).toBeDefined()
    })

    it('VARCHAR → currency code', () => {
      const result = getDomainGenerator('finance', NormalizedType.VARCHAR)
      expect(result).not.toBeNull()
      expect(result!.fakerMethod).toContain('currencyCode')
    })

    it('INTEGER → integer amount', () => {
      const result = getDomainGenerator('finance', NormalizedType.INTEGER)
      expect(result).not.toBeNull()
      const value = result!.generator(faker, 0) as number
      expect(typeof value).toBe('number')
    })
  })

  describe('medical domain', () => {
    it('TEXT → lorem sentence (graceful fallback)', () => {
      const result = getDomainGenerator('medical', NormalizedType.TEXT)
      expect(result).not.toBeNull()
      expect(result!.fakerMethod).toContain('lorem.sentence')
      const value = result!.generator(faker, 0)
      expect(typeof value).toBe('string')
    })

    it('VARCHAR → lorem words', () => {
      const result = getDomainGenerator('medical', NormalizedType.VARCHAR)
      expect(result).not.toBeNull()
      const value = result!.generator(faker, 0)
      expect(typeof value).toBe('string')
    })
  })

  describe('transport domain', () => {
    it('TEXT → vehicle name', () => {
      const result = getDomainGenerator('transport', NormalizedType.TEXT)
      expect(result).not.toBeNull()
      expect(result!.fakerMethod).toContain('vehicle')
      const value = result!.generator(faker, 0)
      expect(typeof value).toBe('string')
    })

    it('VARCHAR → vehicle name', () => {
      const result = getDomainGenerator('transport', NormalizedType.VARCHAR)
      expect(result).not.toBeNull()
      const value = result!.generator(faker, 0)
      expect(typeof value).toBe('string')
    })
  })

  describe('location domain', () => {
    it('TEXT → street address', () => {
      const result = getDomainGenerator('location', NormalizedType.TEXT)
      expect(result).not.toBeNull()
      expect(result!.fakerMethod).toContain('streetAddress')
    })

    it('DECIMAL → latitude', () => {
      const result = getDomainGenerator('location', NormalizedType.DECIMAL)
      expect(result).not.toBeNull()
      expect(result!.fakerMethod).toContain('latitude')
    })
  })

  describe('person domain', () => {
    it('TEXT → full name', () => {
      const result = getDomainGenerator('person', NormalizedType.TEXT)
      expect(result).not.toBeNull()
      expect(result!.fakerMethod).toContain('fullName')
    })

    it('INTEGER → age-like number', () => {
      const result = getDomainGenerator('person', NormalizedType.INTEGER)
      expect(result).not.toBeNull()
      const value = result!.generator(faker, 0) as number
      expect(value).toBeGreaterThanOrEqual(18)
      expect(value).toBeLessThanOrEqual(85)
    })
  })

  describe('education domain', () => {
    it('TEXT → lorem sentence', () => {
      const result = getDomainGenerator('education', NormalizedType.TEXT)
      expect(result).not.toBeNull()
      const value = result!.generator(faker, 0)
      expect(typeof value).toBe('string')
    })

    it('DECIMAL → GPA-like float', () => {
      const result = getDomainGenerator('education', NormalizedType.DECIMAL)
      expect(result).not.toBeNull()
      const value = result!.generator(faker, 0) as number
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(4)
    })
  })

  describe('edge cases', () => {
    it('unknown domain returns null', () => {
      const result = getDomainGenerator('nonexistent', NormalizedType.TEXT)
      expect(result).toBeNull()
    })

    it('known domain with unmapped type returns null', () => {
      // Boolean domain only has BOOLEAN type mapped
      const result = getDomainGenerator('boolean', NormalizedType.TEXT)
      expect(result).toBeNull()
    })

    it('all domains return valid results for their primary types', () => {
      const domainTypes: [string, NormalizedType][] = [
        ['person', NormalizedType.TEXT],
        ['contact', NormalizedType.TEXT],
        ['internet', NormalizedType.TEXT],
        ['location', NormalizedType.TEXT],
        ['finance', NormalizedType.DECIMAL],
        ['commerce', NormalizedType.TEXT],
        ['text', NormalizedType.TEXT],
        ['identifiers', NormalizedType.VARCHAR],
        ['temporal', NormalizedType.TIMESTAMP],
        ['medical', NormalizedType.TEXT],
        ['transport', NormalizedType.TEXT],
        ['education', NormalizedType.TEXT],
        ['government', NormalizedType.VARCHAR],
        ['legal', NormalizedType.TEXT],
        ['boolean', NormalizedType.BOOLEAN],
      ]

      for (const [domain, type] of domainTypes) {
        const result = getDomainGenerator(domain, type)
        expect(result, `${domain} + ${type} should have a generator`).not.toBeNull()
        const value = result!.generator(faker, 0)
        expect(value, `${domain} + ${type} should produce a value`).toBeDefined()
      }
    })
  })
})
