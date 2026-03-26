import type { Faker } from '@faker-js/faker'
import type { GeneratorFn } from '../mapping/types.js'
import { uniqueValueExhaustion } from '../errors/index.js'

/**
 * Tracks generated values per column to enforce uniqueness.
 * Handles collision avoidance with counter/suffix strategy.
 */
export class UniqueTracker {
  /** Key: "tableName.columnName", Value: Set of stringified generated values */
  private seen: Map<string, Set<string>> = new Map()

  private getKey(tableName: string, columnName: string): string {
    return `${tableName}.${columnName}`
  }

  private getSet(tableName: string, columnName: string): Set<string> {
    const key = this.getKey(tableName, columnName)
    let set = this.seen.get(key)
    if (!set) {
      set = new Set()
      this.seen.set(key, set)
    }
    return set
  }

  /**
   * Initialize with existing values from the database.
   */
  initFromExisting(
    tableName: string,
    columnName: string,
    existingValues: Set<string>,
  ): void {
    const set = this.getSet(tableName, columnName)
    for (const value of existingValues) {
      set.add(value)
    }
  }

  /**
   * Check if a value has already been used.
   */
  has(tableName: string, columnName: string, value: unknown): boolean {
    const set = this.getSet(tableName, columnName)
    return set.has(String(value))
  }

  /**
   * Register a value as used. Returns false if it was already present.
   */
  add(tableName: string, columnName: string, value: unknown): boolean {
    const set = this.getSet(tableName, columnName)
    const str = String(value)
    if (set.has(str)) {
      return false
    }
    set.add(str)
    return true
  }

  /**
   * Generate a unique value using the generator, with counter/suffix fallback.
   * Tries the generator first. If collision, applies suffix strategy based on value type.
   * Throws GenerationError SF3002 after maxRetries.
   */
  generateUnique(
    tableName: string,
    columnName: string,
    generator: GeneratorFn,
    faker: Faker,
    rowIndex: number,
    maxRetries: number = 1000,
  ): unknown {
    const set = this.getSet(tableName, columnName)

    // First attempt: use the generator directly
    const candidate = generator(faker, rowIndex)
    const candidateStr = String(candidate)

    if (!set.has(candidateStr)) {
      set.add(candidateStr)
      return candidate
    }

    // Collision detected — apply suffix strategy
    const isEmail =
      typeof candidate === 'string' && candidate.includes('@')
    const isNumber = typeof candidate === 'number'

    for (let i = 1; i <= maxRetries; i++) {
      let suffixed: unknown

      if (isEmail) {
        // Insert suffix before @
        const atIndex = (candidate as string).indexOf('@')
        const localPart = (candidate as string).slice(0, atIndex)
        const domain = (candidate as string).slice(atIndex)
        suffixed = `${localPart}_${i}${domain}`
      } else if (isNumber) {
        suffixed = (candidate as number) + i
      } else if (typeof candidate === 'string') {
        // Check if it looks like a UUID (regenerate instead of suffixing)
        const uuidRegex =
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        if (uuidRegex.test(candidate)) {
          // Regenerate UUID
          suffixed = generator(faker, rowIndex + i)
        } else {
          suffixed = `${candidate}_${i}`
        }
      } else {
        // For other types, just try regenerating
        suffixed = generator(faker, rowIndex + i)
      }

      const suffixedStr = String(suffixed)
      if (!set.has(suffixedStr)) {
        set.add(suffixedStr)
        return suffixed
      }
    }

    throw uniqueValueExhaustion(tableName, columnName, maxRetries)
  }
}
