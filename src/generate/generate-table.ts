import type { Faker } from '@faker-js/faker'
import type { TableDef } from '../types/schema.js'
import type { MappingResult } from '../mapping/types.js'
import type {
  GenerationConfig,
  Row,
  TableGenerationResult,
  ExistingData,
} from './types.js'
import type { ReferencePoolManager } from './reference-pool.js'
import type { UniqueTracker } from './unique-tracker.js'
import { detectTimestampPairs, generateTimestampPair } from './timestamp-pairs.js'
import { getRowCount } from './config.js'
import { fkReferencePoolEmpty } from '../errors/index.js'

/**
 * Context needed to generate rows for a single table.
 */
export interface TableGenerationContext {
  table: TableDef
  mappingResult: MappingResult
  config: GenerationConfig
  faker: Faker
  referencePool: ReferencePoolManager
  uniqueTracker: UniqueTracker
  existingData: ExistingData
  /** FK columns that should be NULL (self-ref or cycle-broken) */
  deferredFKColumns: Set<string>
}

/**
 * Generates rows for a single table according to its schema, mappings, and constraints.
 */
export function generateTableRows(
  context: TableGenerationContext,
): TableGenerationResult {
  const {
    table,
    mappingResult,
    config,
    faker,
    referencePool,
    uniqueTracker,
    existingData,
    deferredFKColumns,
  } = context

  const qualifiedName = `${table.schema}.${table.name}`
  const rowCount = getRowCount(config, qualifiedName)
  const rows: Row[] = []
  const generatedPKs: unknown[][] = []

  // Detect timestamp pairs once (cached)
  const timestampPairs = detectTimestampPairs(table)

  // Build FK column lookup: map each FK column to its FK definition
  // Group FK columns by FK name so composite FKs are handled as a unit
  const fkColumnToFK = new Map<string, { fkName: string; fkColumns: string[]; refTable: string; refColumns: string[] }>()
  for (const fk of table.foreignKeys) {
    if (fk.columns.some((col) => col === fk.referencedColumns[0] && fk.referencedTable === table.name)) {
      // skip self-ref FKs handled via deferred
    }
    const refTable = `${fk.referencedSchema}.${fk.referencedTable}`
    for (const col of fk.columns) {
      fkColumnToFK.set(col, {
        fkName: fk.name,
        fkColumns: fk.columns,
        refTable,
        refColumns: fk.referencedColumns,
      })
    }
  }

  // Build set of unique columns (single-column unique constraints + PK columns)
  const uniqueColumns = new Set<string>()
  for (const uc of table.uniqueConstraints) {
    if (uc.columns.length === 1) {
      uniqueColumns.add(uc.columns[0])
    }
  }
  // PK columns are implicitly unique
  if (table.primaryKey) {
    for (const col of table.primaryKey.columns) {
      uniqueColumns.add(col)
    }
  }

  // Build timestamp pair lookup
  const timestampPairMap = new Map<string, { pair: ReturnType<typeof detectTimestampPairs>[0]; role: 'created' | 'updated' }>()
  for (const pair of timestampPairs) {
    timestampPairMap.set(pair.createdColumn, { pair, role: 'created' })
    timestampPairMap.set(pair.updatedColumn, { pair, role: 'updated' })
  }

  // Initialize unique tracker from existing unique values
  for (const [colName, values] of existingData.existingUniqueValues) {
    uniqueTracker.initFromExisting(qualifiedName, colName, values)
  }

  for (let i = 0; i < rowCount; i++) {
    const row: Row = {}
    const handledFKs = new Set<string>() // Track handled FK groups by FK name
    const timestampValues = new Map<string, Date>() // Store generated timestamp pair values

    for (const [columnName, column] of table.columns) {
      // a. Skip generated columns (GENERATED ALWAYS AS)
      if (column.isGenerated) {
        continue
      }

      // a2. Handle auto-increment PK columns: generate explicit sequential IDs
      //     so they're available for FK reference pools
      if (column.isAutoIncrement) {
        const isPK = table.primaryKey?.columns.includes(columnName) ?? false
        if (isPK) {
          // Start from existing max + 1, or 1 if no existing data
          const existingMax = existingData.existingPKs.length > 0
            ? Math.max(...existingData.existingPKs.map(pk => Number(pk[0]) || 0))
            : 0
          row[columnName] = existingMax + i + 1
        }
        continue
      }

      // b. Handle deferred FK columns (set to NULL)
      if (deferredFKColumns.has(columnName)) {
        row[columnName] = null
        continue
      }

      // c. Handle FK columns (non-deferred)
      const fkInfo = fkColumnToFK.get(columnName)
      if (fkInfo && !deferredFKColumns.has(columnName)) {
        // Check if this FK group was already handled (composite FK)
        if (handledFKs.has(fkInfo.fkName)) {
          continue // Already assigned by composite FK handling
        }
        handledFKs.add(fkInfo.fkName)

        const refTuple = referencePool.pickReference(fkInfo.refTable, faker)

        if (refTuple === null) {
          // Pool is empty
          if (column.isNullable) {
            // Set all FK columns in this group to NULL
            for (const fkCol of fkInfo.fkColumns) {
              row[fkCol] = null
            }
            continue
          } else {
            throw fkReferencePoolEmpty(
              qualifiedName,
              columnName,
              fkInfo.refTable,
            )
          }
        }

        // Assign FK values from tuple
        for (let j = 0; j < fkInfo.fkColumns.length; j++) {
          row[fkInfo.fkColumns[j]] = refTuple[j]
        }
        continue
      }

      // d. Handle nullable columns (non-FK, non-PK)
      const isPK = table.primaryKey?.columns.includes(columnName) ?? false
      if (
        column.isNullable &&
        !isPK &&
        !fkInfo
      ) {
        const roll = faker.number.float({ min: 0, max: 1 })
        if (roll < config.nullableRate) {
          row[columnName] = null
          continue
        }
      }

      // e. Handle timestamp pairs
      const tsPairInfo = timestampPairMap.get(columnName)
      if (tsPairInfo) {
        const pairKey = `${tsPairInfo.pair.createdColumn}|${tsPairInfo.pair.updatedColumn}`
        if (!timestampValues.has(pairKey)) {
          // Generate the pair together
          const { created, updated } = generateTimestampPair(faker)
          timestampValues.set(pairKey, created)
          timestampValues.set(`${pairKey}:updated`, updated)
        }
        if (tsPairInfo.role === 'created') {
          row[columnName] = timestampValues.get(pairKey)!
        } else {
          row[columnName] = timestampValues.get(`${pairKey}:updated`)!
        }
        continue
      }

      // Get the generator from the mapping
      const mapping = mappingResult.mappings.get(columnName)
      const generator = mapping?.generator

      if (!generator) {
        // No generator available (auto-increment or generated column mapping returned null)
        row[columnName] = null
        continue
      }

      // f. Handle unique columns
      if (uniqueColumns.has(columnName)) {
        const value = uniqueTracker.generateUnique(
          qualifiedName,
          columnName,
          generator,
          faker,
          i,
        )
        row[columnName] = value
        continue
      }

      // g. Default generation
      row[columnName] = generator(faker, i)
    }

    rows.push(row)

    // Extract PK values
    if (table.primaryKey) {
      const pkTuple = table.primaryKey.columns.map((col) => row[col])
      // Only include if PK columns are present in the row (not auto-increment)
      if (pkTuple.every((v) => v !== undefined)) {
        generatedPKs.push(pkTuple)
      }
    }
  }

  return {
    tableName: qualifiedName,
    rows,
    generatedPKs,
  }
}
