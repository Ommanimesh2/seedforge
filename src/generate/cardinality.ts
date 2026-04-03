import type { Faker } from '@faker-js/faker'
import type { TableDef } from '../types/schema.js'
import type { ReferencePoolManager } from './reference-pool.js'
import { createDistribution, type DistributionType } from './distributions.js'
import type { RelationshipConfig } from '../config/types.js'

/**
 * Supported distribution types for FK cardinality.
 */
export type CardinalityDistribution = 'uniform' | 'zipf' | 'normal'

/**
 * A parsed cardinality specification.
 */
export interface CardinalitySpec {
  min: number
  max: number
  distribution: CardinalityDistribution
}

/**
 * Per-table cardinality config: FK column name -> spec
 */
export type TableCardinalityConfig = Map<string, CardinalitySpec>

/**
 * Parse a range string like "1..10" or "0..3" into { min, max }.
 */
export function parseCardinalityRange(input: string): { min: number; max: number } {
  const match = /^(\d+)\.\.(\d+)$/.exec(input)
  if (!match) {
    throw new Error(`Invalid cardinality range "${input}". Use format "min..max" (e.g., "1..10")`)
  }
  const min = parseInt(match[1], 10)
  const max = parseInt(match[2], 10)
  if (min > max) {
    throw new Error(`Cardinality min (${min}) must be <= max (${max})`)
  }
  return { min, max }
}

/**
 * Convert a RelationshipConfig (from YAML or API) to a CardinalitySpec.
 */
export function convertRelationshipConfig(raw: RelationshipConfig): CardinalitySpec {
  const distribution = (raw.distribution ?? 'uniform') as CardinalityDistribution

  if (typeof raw.cardinality === 'string') {
    const { min, max } = parseCardinalityRange(raw.cardinality)
    return { min, max, distribution }
  }

  if (Array.isArray(raw.cardinality)) {
    // Discrete values: use min/max of the array
    const min = Math.min(...raw.cardinality)
    const max = Math.max(...raw.cardinality)
    return { min, max, distribution }
  }

  // Should not reach here if validation is correct
  return { min: 0, max: 1, distribution }
}

/**
 * Distribute totalChildren across parentCount parents according to the cardinality spec.
 * Returns an array of length parentCount where each element is the number of children
 * assigned to that parent.
 *
 * The sum of the returned array always equals totalChildren (exact normalization).
 */
export function distributeChildren(
  parentCount: number,
  totalChildren: number,
  spec: CardinalitySpec,
  faker: Faker,
): number[] {
  if (parentCount === 0 || totalChildren === 0) {
    return new Array(parentCount).fill(0)
  }

  const { min, max, distribution } = spec
  const counts = new Array<number>(parentCount)

  // Sample a count for each parent from the distribution
  const distFn = createDistribution(distribution as DistributionType)
  for (let i = 0; i < parentCount; i++) {
    const t = distFn(faker, i, parentCount)
    // Scale 0..1 to [min, max] and round
    counts[i] = Math.round(min + t * (max - min))
  }

  // Normalize sum to match totalChildren exactly
  let currentSum = counts.reduce((a, b) => a + b, 0)

  if (currentSum === 0 && totalChildren > 0) {
    // Edge case: all counts are 0 but we need children
    // Spread them uniformly
    const perParent = Math.floor(totalChildren / parentCount)
    const remainder = totalChildren % parentCount
    for (let i = 0; i < parentCount; i++) {
      counts[i] = perParent + (i < remainder ? 1 : 0)
    }
    return counts
  }

  // Scale proportionally first
  if (currentSum !== totalChildren && currentSum > 0) {
    const scale = totalChildren / currentSum
    for (let i = 0; i < parentCount; i++) {
      counts[i] = Math.round(counts[i] * scale)
    }
    currentSum = counts.reduce((a, b) => a + b, 0)
  }

  // Fine-tune: add or remove one at a time to hit exact total
  // Process parents in random order to avoid bias
  const indices = Array.from({ length: parentCount }, (_, i) => i)

  while (currentSum < totalChildren) {
    // Find a parent with room to grow (below max, or any if all at max)
    let added = false
    for (const idx of indices) {
      if (counts[idx] < max) {
        counts[idx]++
        currentSum++
        added = true
        break
      }
    }
    if (!added) {
      // All at max — exceed max for the first available parent
      counts[indices[0]]++
      currentSum++
    }
  }

  while (currentSum > totalChildren) {
    // Find a parent that can shrink (above min, or any if all at min)
    let removed = false
    for (const idx of indices) {
      if (counts[idx] > min) {
        counts[idx]--
        currentSum--
        removed = true
        break
      }
    }
    if (!removed) {
      // All at min — go below min for a parent (better than wrong total)
      for (const idx of indices) {
        if (counts[idx] > 0) {
          counts[idx]--
          currentSum--
          removed = true
          break
        }
      }
      if (!removed) break // All zero, can't reduce further
    }
  }

  return counts
}

/**
 * Build a shuffled FK assignment sequence from a children-per-parent distribution.
 *
 * Returns an array of length sum(childrenPerParent) where each element is a PK tuple
 * from parentPKs. The array is deterministically shuffled using the faker instance.
 */
export function buildFKAssignmentSequence(
  childrenPerParent: number[],
  parentPKs: unknown[][],
  faker: Faker,
): unknown[][] {
  const assignments: unknown[][] = []

  for (let parentIdx = 0; parentIdx < childrenPerParent.length; parentIdx++) {
    const count = childrenPerParent[parentIdx]
    const pk = parentPKs[parentIdx]
    for (let j = 0; j < count; j++) {
      assignments.push(pk)
    }
  }

  // Fisher-Yates shuffle (deterministic via faker)
  for (let i = assignments.length - 1; i > 0; i--) {
    const j = faker.number.int({ min: 0, max: i })
    const temp = assignments[i]
    assignments[i] = assignments[j]
    assignments[j] = temp
  }

  return assignments
}

/**
 * Resolve cardinality for all configured FK columns of a table.
 *
 * Returns a Map from FK column name to pre-computed assignment sequence.
 * Columns without cardinality config are not included (use uniform fallback).
 */
export function resolveCardinalityForTable(
  table: TableDef,
  referencePool: ReferencePoolManager,
  cardinalityConfig: TableCardinalityConfig,
  totalChildCount: number,
  faker: Faker,
  deferredFKColumns?: Set<string>,
): Map<string, unknown[][]> {
  const result = new Map<string, unknown[][]>()

  for (const [fkColumnName, spec] of cardinalityConfig) {
    // Skip deferred columns (self-ref, cycle-broken)
    if (deferredFKColumns?.has(fkColumnName)) continue

    // Find the FK definition for this column
    const fkDef = table.foreignKeys.find((fk) => fk.columns.includes(fkColumnName))
    if (!fkDef) continue

    // Skip composite FKs — cardinality only supports single-column FKs
    if (fkDef.columns.length > 1) continue

    const refTable = `${fkDef.referencedSchema}.${fkDef.referencedTable}`
    const pool = referencePool.getPool(refTable)
    if (!pool || pool.values.length === 0) continue

    const childrenPerParent = distributeChildren(
      pool.values.length,
      totalChildCount,
      spec,
      faker,
    )

    const sequence = buildFKAssignmentSequence(
      childrenPerParent,
      pool.values,
      faker,
    )

    result.set(fkColumnName, sequence)
  }

  return result
}

/**
 * Build tableCardinalityConfigs from SeedforgeConfig tables.
 * Converts RelationshipConfig entries to CardinalitySpec instances.
 */
export function buildCardinalityFromConfig(
  tables: Record<string, { relationships?: Record<string, RelationshipConfig> }>,
  schemaName: string,
): Map<string, TableCardinalityConfig> {
  const result = new Map<string, TableCardinalityConfig>()

  for (const [tableName, tableConfig] of Object.entries(tables)) {
    if (!tableConfig.relationships) continue

    const columnSpecs = new Map<string, CardinalitySpec>()
    for (const [colName, relConfig] of Object.entries(tableConfig.relationships)) {
      columnSpecs.set(colName, convertRelationshipConfig(relConfig))
    }

    if (columnSpecs.size > 0) {
      // Support both qualified and unqualified table names
      const qualifiedName = tableName.includes('.') ? tableName : `${schemaName}.${tableName}`
      result.set(qualifiedName, columnSpecs)
    }
  }

  return result
}
