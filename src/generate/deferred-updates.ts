import type { Faker } from '@faker-js/faker'
import type { TableDef } from '../types/schema.js'
import type { DependencyEdge } from '../graph/types.js'
import type { Row, DeferredUpdate } from './types.js'
import type { ReferencePoolManager } from './reference-pool.js'

/**
 * Context needed to generate deferred updates for a table.
 */
export interface DeferredUpdateContext {
  tableName: string
  table: TableDef
  generatedRows: Row[]
  generatedPKs: unknown[][]
  /** Deferred FK edges (from InsertPlan.deferredEdges or self-ref edges) */
  deferredFKEdges: DependencyEdge[]
  referencePool: ReferencePoolManager
  faker: Faker
}

/**
 * Generates deferred UPDATE operations for self-referencing and cycle-broken FK columns.
 *
 * For self-ref tables: creates a tree structure where ~15% are root nodes (NULL FK)
 * and the rest reference earlier rows.
 *
 * For cycle-broken edges: assigns FK values from the reference pool of the target table.
 */
export function generateDeferredUpdates(
  context: DeferredUpdateContext,
): DeferredUpdate[] {
  const {
    tableName,
    table,
    generatedRows,
    generatedPKs,
    deferredFKEdges,
    referencePool,
    faker,
  } = context

  const updates: DeferredUpdate[] = []

  if (!table.primaryKey || table.primaryKey.columns.length === 0) {
    return updates
  }

  const pkColumns = table.primaryKey.columns

  for (const edge of deferredFKEdges) {
    const fkColumns = edge.fk.columns
    const isSelfRef = edge.isSelfRef

    // Calculate the root node threshold for self-ref tables
    const rootThreshold = isSelfRef
      ? Math.floor(generatedRows.length * 0.15)
      : 0

    for (let i = 0; i < generatedRows.length; i++) {
      const row = generatedRows[i]

      // Extract PK values for this row
      const pkValues = pkColumns.map((col) => row[col])

      // If PK values aren't in the row (auto-increment), use generatedPKs
      const hasPKInRow = pkValues.every((v) => v !== undefined)
      const effectivePKValues = hasPKInRow
        ? pkValues
        : i < generatedPKs.length
          ? generatedPKs[i]
          : pkValues

      if (isSelfRef) {
        // Self-ref: first ~15% remain NULL (root nodes)
        if (i < rootThreshold) {
          continue // Leave as NULL — no update needed
        }

        // Reference a random earlier row (ensures no forward references)
        if (generatedPKs.length === 0) {
          continue // No PKs available
        }

        // Pick from rows 0 to i-1 (or all generatedPKs if index exceeds)
        const maxParentIndex = Math.min(i, generatedPKs.length) - 1
        if (maxParentIndex < 0) {
          continue
        }

        const parentIndex = faker.number.int({
          min: 0,
          max: maxParentIndex,
        })
        const parentPK = generatedPKs[parentIndex]

        // Don't let a row reference itself
        const selfPK = effectivePKValues
        const isSameRow =
          selfPK.length === parentPK.length &&
          selfPK.every((v, idx) => v === parentPK[idx])
        if (isSameRow) {
          continue // Skip — leave as NULL
        }

        // Build FK values from the parent's PK
        const setValues = fkColumns.map((_, colIdx) => parentPK[colIdx])

        updates.push({
          tableName,
          pkColumns,
          pkValues: effectivePKValues,
          setColumns: fkColumns,
          setValues,
        })
      } else {
        // Cycle-broken edge: pick from reference pool of the target table
        const refTable = `${edge.fk.referencedSchema}.${edge.fk.referencedTable}`
        const refTuple = referencePool.pickReference(refTable, faker)

        if (refTuple === null) {
          continue // No references available, leave as NULL
        }

        const setValues = fkColumns.map((_, colIdx) => refTuple[colIdx])

        updates.push({
          tableName,
          pkColumns,
          pkValues: effectivePKValues,
          setColumns: fkColumns,
          setValues,
        })
      }
    }
  }

  return updates
}
