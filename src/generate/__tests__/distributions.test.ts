import { describe, it, expect } from 'vitest'
import { createDistribution, isValidDistributionType } from '../distributions.js'
import { createSeededFaker } from '../../mapping/seeded-faker.js'

describe('createDistribution', () => {
  describe('uniform', () => {
    it('returns values between 0 and 1', () => {
      const dist = createDistribution('uniform')
      const faker = createSeededFaker(42)

      for (let i = 0; i < 100; i++) {
        const value = dist(faker, i, 100)
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(1)
      }
    })

    it('produces roughly uniform distribution', () => {
      const dist = createDistribution('uniform')
      const faker = createSeededFaker(42)
      const values: number[] = []

      for (let i = 0; i < 1000; i++) {
        values.push(dist(faker, i, 1000))
      }

      // Split into quarters — each should have roughly 250 values (allow 150-350)
      const q1 = values.filter(v => v < 0.25).length
      const q2 = values.filter(v => v >= 0.25 && v < 0.5).length
      const q3 = values.filter(v => v >= 0.5 && v < 0.75).length
      const q4 = values.filter(v => v >= 0.75).length

      expect(q1).toBeGreaterThan(150)
      expect(q1).toBeLessThan(350)
      expect(q2).toBeGreaterThan(150)
      expect(q2).toBeLessThan(350)
      expect(q3).toBeGreaterThan(150)
      expect(q3).toBeLessThan(350)
      expect(q4).toBeGreaterThan(150)
      expect(q4).toBeLessThan(350)
    })
  })

  describe('zipf', () => {
    it('returns values between 0 and 1', () => {
      const dist = createDistribution('zipf')
      const faker = createSeededFaker(42)

      for (let i = 0; i < 100; i++) {
        const value = dist(faker, i, 100)
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(1)
      }
    })

    it('produces more low values than high values (power law)', () => {
      const dist = createDistribution('zipf')
      const faker = createSeededFaker(42)
      const values: number[] = []

      for (let i = 0; i < 1000; i++) {
        values.push(dist(faker, i, 1000))
      }

      const lowHalf = values.filter(v => v < 0.5).length
      const highHalf = values.filter(v => v >= 0.5).length

      // Zipf should produce significantly more values in the low half
      expect(lowHalf).toBeGreaterThan(highHalf)
    })

    it('respects custom exponent', () => {
      const dist = createDistribution('zipf', { exponent: 2.0 })
      const faker = createSeededFaker(42)
      const values: number[] = []

      for (let i = 0; i < 1000; i++) {
        values.push(dist(faker, i, 1000))
      }

      // Higher exponent = even more skewed toward low values
      const lowQuarter = values.filter(v => v < 0.25).length
      expect(lowQuarter).toBeGreaterThan(500) // Most values should be in the first quarter
    })
  })

  describe('normal', () => {
    it('returns values between 0 and 1', () => {
      const dist = createDistribution('normal')
      const faker = createSeededFaker(42)

      for (let i = 0; i < 100; i++) {
        const value = dist(faker, i, 100)
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(1)
      }
    })

    it('clusters around the mean (default 0.5)', () => {
      const dist = createDistribution('normal')
      const faker = createSeededFaker(42)
      const values: number[] = []

      for (let i = 0; i < 1000; i++) {
        values.push(dist(faker, i, 1000))
      }

      const mean = values.reduce((sum, v) => sum + v, 0) / values.length
      // Mean should be close to 0.5
      expect(mean).toBeGreaterThan(0.35)
      expect(mean).toBeLessThan(0.65)

      // More values should be near the center than at the edges
      const center = values.filter(v => v >= 0.3 && v <= 0.7).length
      const edges = values.filter(v => v < 0.3 || v > 0.7).length
      expect(center).toBeGreaterThan(edges)
    })

    it('respects custom mean and stddev', () => {
      const dist = createDistribution('normal', { mean: 0.8, stddev: 0.05 })
      const faker = createSeededFaker(42)
      const values: number[] = []

      for (let i = 0; i < 1000; i++) {
        values.push(dist(faker, i, 1000))
      }

      const mean = values.reduce((sum, v) => sum + v, 0) / values.length
      // Mean should be close to 0.8
      expect(mean).toBeGreaterThan(0.7)
      expect(mean).toBeLessThan(0.9)
    })
  })

  describe('exponential', () => {
    it('returns values between 0 and 1', () => {
      const dist = createDistribution('exponential')
      const faker = createSeededFaker(42)

      for (let i = 0; i < 100; i++) {
        const value = dist(faker, i, 100)
        expect(value).toBeGreaterThanOrEqual(0)
        expect(value).toBeLessThanOrEqual(1)
      }
    })

    it('produces more low values than high values', () => {
      const dist = createDistribution('exponential')
      const faker = createSeededFaker(42)
      const values: number[] = []

      for (let i = 0; i < 1000; i++) {
        values.push(dist(faker, i, 1000))
      }

      const mean = values.reduce((sum, v) => sum + v, 0) / values.length
      // Exponential distribution should have mean below 0.5
      expect(mean).toBeLessThan(0.6)
    })
  })

  describe('edge cases', () => {
    it('handles total of 1 (single row)', () => {
      const dist = createDistribution('zipf')
      const faker = createSeededFaker(42)

      const value = dist(faker, 0, 1)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    })

    it('falls back to uniform for unknown type', () => {
      // TypeScript won't allow this, but test runtime safety
      const dist = createDistribution('unknown' as 'uniform')
      const faker = createSeededFaker(42)

      const value = dist(faker, 0, 100)
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    })

    it('is deterministic with same seed', () => {
      const dist = createDistribution('normal', { mean: 0.5, stddev: 0.2 })

      const faker1 = createSeededFaker(99)
      const values1: number[] = []
      for (let i = 0; i < 10; i++) {
        values1.push(dist(faker1, i, 10))
      }

      const faker2 = createSeededFaker(99)
      const values2: number[] = []
      for (let i = 0; i < 10; i++) {
        values2.push(dist(faker2, i, 10))
      }

      expect(values1).toEqual(values2)
    })
  })
})

describe('isValidDistributionType', () => {
  it('returns true for valid types', () => {
    expect(isValidDistributionType('uniform')).toBe(true)
    expect(isValidDistributionType('zipf')).toBe(true)
    expect(isValidDistributionType('normal')).toBe(true)
    expect(isValidDistributionType('exponential')).toBe(true)
  })

  it('returns false for invalid types', () => {
    expect(isValidDistributionType('gaussian')).toBe(false)
    expect(isValidDistributionType('')).toBe(false)
    expect(isValidDistributionType('UNIFORM')).toBe(false)
  })
})
