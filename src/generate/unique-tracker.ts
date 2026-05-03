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
  initFromExisting(tableName: string, columnName: string, existingValues: Set<string>): void {
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
   * Tries the generator first. If collision, applies suffix strategy based
   * on value type. Throws GenerationError SF3002 after maxRetries.
   *
   * `maxLength` is honored *during* uniqueness tracking. Without it, a
   * VARCHAR(12) column could see two suffix attempts ("FOO_1", "FOO_2")
   * that the tracker considers distinct, but which both truncate to the
   * same stored value ("FOO_1" / "FOO_2" → both fit, but generators that
   * already produce 12-char output collide post-truncation as "FOO0000000000_1"
   * → "FOO0000000000"). The tracker now stores the actual stored value
   * (post-truncation) so collision detection mirrors what Postgres sees.
   */
  generateUnique(
    tableName: string,
    columnName: string,
    generator: GeneratorFn,
    faker: Faker,
    rowIndex: number,
    maxRetries: number = 1000,
    maxLength: number | null = null,
  ): unknown {
    const set = this.getSet(tableName, columnName)

    // First attempt: use the generator directly
    const candidate = generator(faker, rowIndex)
    const truncated = applyMaxLength(candidate, maxLength)
    const candidateStr = String(truncated)

    if (!set.has(candidateStr)) {
      set.add(candidateStr)
      return truncated
    }

    // Collision detected — apply suffix strategy. We compute suffix
    // attempts off the *original* candidate so the suffix is meaningful,
    // but always check uniqueness against the post-truncation form.
    const isEmail = typeof candidate === 'string' && candidate.includes('@')
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
        const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
        if (uuidRegex.test(candidate)) {
          // Regenerate UUID
          suffixed = generator(faker, rowIndex + i)
        } else if (maxLength !== null && candidate.length >= maxLength) {
          // String already saturates maxLength, so a `_<n>` suffix would
          // be truncated away. Replace the trailing characters with the
          // counter so the resulting value remains distinct after
          // truncation.
          const counter = String(i)
          const keepLen = Math.max(1, maxLength - counter.length)
          suffixed = (candidate as string).slice(0, keepLen) + counter
        } else {
          suffixed = `${candidate}_${i}`
        }
      } else {
        // For other types, just try regenerating
        suffixed = generator(faker, rowIndex + i)
      }

      const suffixedTruncated = applyMaxLength(suffixed, maxLength)
      const suffixedStr = String(suffixedTruncated)
      if (!set.has(suffixedStr)) {
        set.add(suffixedStr)
        return suffixedTruncated
      }
    }

    throw uniqueValueExhaustion(tableName, columnName, maxRetries)
  }
}

/**
 * Mirror the truncation logic in generate-table.ts so the tracker
 * registers what will actually land in the database.
 */
function applyMaxLength(value: unknown, maxLength: number | null): unknown {
  if (maxLength === null) return value
  if (typeof value !== 'string') return value
  if (value.length <= maxLength) return value
  return value.slice(0, maxLength).trimEnd()
}

/**
 * Tracks generated tuples per composite unique constraint to detect
 * collisions like `(scheme_id, nav_date)` UNIQUE — single-column
 * tracking on either column doesn't catch it. Used as a post-row
 * check; on collision the caller mutates one of the row's columns
 * and re-tries.
 */
export class CompositeUniqueTracker {
  /** Key: "tableName/<col1,col2,...>", Value: Set of tuple JSON */
  private seen: Map<string, Set<string>> = new Map()

  private getKey(tableName: string, columns: readonly string[]): string {
    return `${tableName}/${columns.join(',')}`
  }

  has(tableName: string, columns: readonly string[], tuple: readonly unknown[]): boolean {
    const k = this.getKey(tableName, columns)
    const set = this.seen.get(k)
    if (!set) return false
    return set.has(serializeTuple(tuple))
  }

  /** Returns false if the tuple was already present (caller must mutate). */
  add(tableName: string, columns: readonly string[], tuple: readonly unknown[]): boolean {
    const k = this.getKey(tableName, columns)
    let set = this.seen.get(k)
    if (!set) {
      set = new Set()
      this.seen.set(k, set)
    }
    const ser = serializeTuple(tuple)
    if (set.has(ser)) return false
    set.add(ser)
    return true
  }

  /**
   * Initialize from existing tuples in the database — same role as
   * `UniqueTracker.initFromExisting` for composite constraints.
   */
  initFromExisting(
    tableName: string,
    columns: readonly string[],
    tuples: readonly (readonly unknown[])[],
  ): void {
    const k = this.getKey(tableName, columns)
    let set = this.seen.get(k)
    if (!set) {
      set = new Set()
      this.seen.set(k, set)
    }
    for (const t of tuples) set.add(serializeTuple(t))
  }
}

function serializeTuple(tuple: readonly unknown[]): string {
  // JSON-encode with explicit treatment of `undefined` (not allowed in
  // JSON), so the tuple key is stable across Postgres NULLs and
  // JS undefined.
  return JSON.stringify(
    tuple.map((v) => (v === undefined ? null : v instanceof Date ? v.toISOString() : v)),
  )
}
