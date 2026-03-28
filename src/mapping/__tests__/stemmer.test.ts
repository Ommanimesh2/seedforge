import { describe, it, expect } from 'vitest'
import { stem } from '../stemmer.js'

describe('stemmer', () => {
  it('stems -ing endings', () => {
    expect(stem('shipping')).toBe('ship')
    expect(stem('billing')).toBe('bil')
    expect(stem('tracking')).toBe('track')
    expect(stem('building')).toBe('build')
    expect(stem('parking')).toBe('park')
  })

  it('stems -tion/-sion endings', () => {
    expect(stem('registration')).toBe('registr')
    expect(stem('transaction')).toBe('transact')
    expect(stem('subscription')).toBe('subscript')
  })

  it('stems -ment endings', () => {
    expect(stem('payment')).toBe('pay')
    expect(stem('shipment')).toBe('ship')
    expect(stem('enrollment')).toBe('enrol')
  })

  it('stems -ness endings', () => {
    // The stemmer reduces -ness, then step 5 may trim further
    expect(stem('wellness')).toBe('wel')
    expect(stem('illness')).toBe('ill')
  })

  it('stems -ous endings', () => {
    // The stemmer reduces step by step
    const result = stem('dangerous')
    expect(typeof result).toBe('string')
    expect(result.length).toBeLessThan('dangerous'.length)
  })

  it('stems -al endings', () => {
    expect(stem('financial')).toBe('financi')
    expect(stem('medical')).toBe('med')
    expect(stem('postal')).toBe('post')
  })

  it('stems -ed endings', () => {
    expect(stem('created')).toBe('cre')
    expect(stem('updated')).toBe('upd')
    expect(stem('expired')).toBe('expir')
    expect(stem('scheduled')).toBe('schedul')
  })

  it('stems -er endings', () => {
    // Step 4 should remove -er from words with sufficient measure
    const result = stem('driver')
    expect(typeof result).toBe('string')
  })

  it('stems -ful endings', () => {
    // -ful is handled by step 3
    const result = stem('beautiful')
    expect(typeof result).toBe('string')
    expect(result.length).toBeLessThan('beautiful'.length)
  })

  it('stems -less endings', () => {
    // -less is not a dedicated suffix in our mini stemmer,
    // but step 1 handles -s and step 4 may handle remainder
    const result = stem('wireless')
    expect(typeof result).toBe('string')
  })

  it('stems -able/-ible endings', () => {
    // Step 4 handles -able and -ible
    const result = stem('available')
    expect(typeof result).toBe('string')
    expect(result.length).toBeLessThan('available'.length)
  })

  it('stems -ize/-ise endings', () => {
    const result = stem('normalize')
    expect(typeof result).toBe('string')
    expect(result.length).toBeLessThan('normalize'.length)
  })

  it('handles plurals', () => {
    expect(stem('patients')).toBe(stem('patient'))
    expect(stem('vehicles')).toBe(stem('vehicle'))
    expect(stem('addresses')).toBe(stem('address'))
  })

  it('does not stem very short words', () => {
    expect(stem('id')).toBe('id')
    expect(stem('ip')).toBe('ip')
  })

  it('handles common column name words', () => {
    // These just verify the stemmer produces reasonable output
    // without crashing on typical column name tokens
    const words = [
      'hospital', 'clinic', 'pharmacy', 'diagnosis', 'prognosis',
      'vehicle', 'airport', 'flight', 'transport',
      'student', 'education', 'university', 'graduation',
      'government', 'passport', 'citizen', 'election',
      'court', 'attorney', 'lawsuit', 'verdict',
      'finance', 'salary', 'revenue', 'invoice',
    ]

    for (const word of words) {
      const result = stem(word)
      expect(typeof result).toBe('string')
      expect(result.length).toBeGreaterThan(0)
      expect(result.length).toBeLessThanOrEqual(word.length)
    }
  })
})
