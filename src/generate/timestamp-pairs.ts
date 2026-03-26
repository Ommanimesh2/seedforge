import type { Faker } from '@faker-js/faker'
import type { TableDef } from '../types/schema.js'
import { NormalizedType } from '../types/schema.js'

/**
 * A detected pair of timestamp columns (created/updated).
 */
export interface TimestampPair {
  createdColumn: string
  updatedColumn: string
}

/**
 * Known patterns for created/updated timestamp pairs.
 * Each entry maps a "created" column name to its corresponding "updated" column name.
 */
const TIMESTAMP_PAIR_PATTERNS: [string, string][] = [
  ['created_at', 'updated_at'],
  ['created', 'updated'],
  ['created_at', 'modified_at'],
  ['created', 'modified'],
  ['create_date', 'update_date'],
  ['inserted_at', 'updated_at'],
]

/**
 * Detect timestamp column pairs (created/updated) in a table.
 * Both columns must be present and have a timestamp-like type.
 */
export function detectTimestampPairs(table: TableDef): TimestampPair[] {
  const timestampTypes = new Set([
    NormalizedType.TIMESTAMP,
    NormalizedType.TIMESTAMPTZ,
  ])

  const pairs: TimestampPair[] = []

  for (const [createdName, updatedName] of TIMESTAMP_PAIR_PATTERNS) {
    const createdCol = table.columns.get(createdName)
    const updatedCol = table.columns.get(updatedName)

    if (
      createdCol &&
      updatedCol &&
      timestampTypes.has(createdCol.dataType) &&
      timestampTypes.has(updatedCol.dataType)
    ) {
      pairs.push({
        createdColumn: createdName,
        updatedColumn: updatedName,
      })
    }
  }

  return pairs
}

/**
 * Generate a consistent timestamp pair where created < updated.
 */
export function generateTimestampPair(
  faker: Faker,
): { created: Date; updated: Date } {
  const created = faker.date.past({ years: 2 })
  const updated = faker.date.between({ from: created, to: new Date() })
  return { created, updated }
}
