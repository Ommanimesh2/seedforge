import { describe, it, expect } from 'vitest'
import { createSeededFaker } from '../seeded-faker.js'

describe('createSeededFaker', () => {
  it('produces deterministic output with the same seed', () => {
    const faker1 = createSeededFaker(42)
    const name1 = faker1.person.firstName()
    const email1 = faker1.internet.email()

    const faker2 = createSeededFaker(42)
    const name2 = faker2.person.firstName()
    const email2 = faker2.internet.email()

    expect(name1).toBe(name2)
    expect(email1).toBe(email2)
  })

  it('produces different output with different seeds', () => {
    const faker1 = createSeededFaker(42)
    const name1 = faker1.person.firstName()

    const faker2 = createSeededFaker(99)
    const name2 = faker2.person.firstName()

    expect(name1).not.toBe(name2)
  })

  it('does not throw when called with undefined seed', () => {
    expect(() => createSeededFaker(undefined)).not.toThrow()
    const f = createSeededFaker(undefined)
    expect(typeof f.person.firstName()).toBe('string')
  })

  it('returns a working faker instance', () => {
    const f = createSeededFaker(42)
    expect(typeof f.person.firstName()).toBe('string')
    expect(typeof f.internet.email()).toBe('string')
    expect(typeof f.number.int()).toBe('number')
  })

  it('deterministic end-to-end: same seed produces identical sequence', () => {
    const results1: string[] = []
    const f1 = createSeededFaker(12345)
    for (let i = 0; i < 10; i++) {
      results1.push(f1.person.fullName())
    }

    const results2: string[] = []
    const f2 = createSeededFaker(12345)
    for (let i = 0; i < 10; i++) {
      results2.push(f2.person.fullName())
    }

    expect(results1).toEqual(results2)
  })
})
