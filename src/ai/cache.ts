import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const CACHE_DIR = '.seedforge-cache/ai'
const DEFAULT_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

interface CacheKey {
  table: string
  column: string
  count: number
  model: string
  seed?: number
  prompt?: string
}

/**
 * File-based cache for AI-generated text values.
 * Keyed by (table, column, count, model, seed, prompt).
 * Default TTL: 7 days.
 */
export class AICache {
  private dir: string
  private ttlMs: number

  constructor(cacheDir?: string, ttlMs?: number) {
    this.dir = cacheDir ?? CACHE_DIR
    this.ttlMs = ttlMs ?? DEFAULT_TTL_MS
  }

  /**
   * Read cached values. Returns null if not found or expired.
   */
  read(key: CacheKey): string[] | null {
    const filePath = this.keyToPath(key)
    if (!existsSync(filePath)) return null

    try {
      const stat = statSync(filePath)
      if (Date.now() - stat.mtimeMs > this.ttlMs) {
        return null // Expired
      }

      const data = readFileSync(filePath, 'utf-8')
      const parsed = JSON.parse(data)
      if (Array.isArray(parsed) && parsed.every((v) => typeof v === 'string')) {
        return parsed
      }
    } catch {
      // Corrupted cache entry
    }

    return null
  }

  /**
   * Write values to cache.
   */
  write(key: CacheKey, values: string[]): void {
    try {
      mkdirSync(this.dir, { recursive: true })
      const filePath = this.keyToPath(key)
      writeFileSync(filePath, JSON.stringify(values), 'utf-8')
    } catch {
      // Cache write failure is non-fatal
    }
  }

  private keyToPath(key: CacheKey): string {
    const hash = createHash('sha256')
      .update(JSON.stringify({
        t: key.table,
        c: key.column,
        n: key.count,
        m: key.model,
        s: key.seed,
        p: key.prompt,
      }))
      .digest('hex')
      .slice(0, 16)

    return join(this.dir, `${key.table}.${key.column}.${hash}.json`)
  }
}
