import type { Faker } from '@faker-js/faker'
import type { TableDef } from '../types/schema.js'
import type { MappingResult } from '../mapping/types.js'
import type {
  GenerationConfig,
  Row,
  ExistingData,
} from './types.js'
import type { ReferencePoolManager } from './reference-pool.js'
import type { UniqueTracker } from './unique-tracker.js'
import { detectTimestampPairs, generateTimestampPair } from './timestamp-pairs.js'
import { getRowCount } from './config.js'
import { fkReferencePoolEmpty } from '../errors/index.js'

/**
 * Context needed to generate rows for a single table in streaming mode.
 * Identical to TableGenerationContext from generate-table.ts.
 */
export interface StreamTableGenerationContext {
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
 * Result metadata from streaming generation.
 * Rows are yielded via the async generator, not stored here.
 */
export interface StreamTableGenerationMeta {
  /** Qualified table name */
  tableName: string
  /** PK values extracted from generated rows */
  generatedPKs: unknown[][]
  /** Total rows yielded */
  rowCount: number
}

/**
 * Generates rows for a single table as an AsyncGenerator.
 *
 * For large datasets, this avoids holding all rows in memory at once.
 * Each row is yielded one at a time. PK values are still collected
 * (necessary for FK resolution), but non-PK column data is not retained.
 *
 * @param context - Generation context with table, mapping, config, etc.
 * @yields Individual Row objects one at a time
 * @returns StreamTableGenerationMeta with PKs and count after iteration completes
 */
export async function* generateTableStream(
  context: StreamTableGenerationContext,
): AsyncGenerator<Row, StreamTableGenerationMeta, undefined> {
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
  const generatedPKs: unknown[][] = []

  // Detect timestamp pairs once
  const timestampPairs = detectTimestampPairs(table)

  // Build FK column lookup
  const fkColumnToFK = new Map<string, { fkName: string; fkColumns: string[]; refTable: string; refColumns: string[] }>()
  for (const fk of table.foreignKeys) {
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

  // Build unique columns set
  const uniqueColumns = new Set<string>()
  for (const uc of table.uniqueConstraints) {
    if (uc.columns.length === 1) {
      uniqueColumns.add(uc.columns[0])
    }
  }
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

  let yieldedCount = 0

  for (let i = 0; i < rowCount; i++) {
    const row: Row = {}
    const handledFKs = new Set<string>()
    const timestampValues = new Map<string, Date>()

    for (const [columnName, column] of table.columns) {
      // Skip generated columns
      if (column.isGenerated) {
        continue
      }

      // Handle auto-increment PK columns
      if (column.isAutoIncrement) {
        const isPK = table.primaryKey?.columns.includes(columnName) ?? false
        if (isPK) {
          const existingMax = existingData.existingPKs.length > 0
            ? Math.max(...existingData.existingPKs.map(pk => Number(pk[0]) || 0))
            : 0
          row[columnName] = existingMax + i + 1
        }
        continue
      }

      // Handle deferred FK columns
      if (deferredFKColumns.has(columnName)) {
        row[columnName] = null
        continue
      }

      // Handle FK columns
      const fkInfo = fkColumnToFK.get(columnName)
      if (fkInfo && !deferredFKColumns.has(columnName)) {
        if (handledFKs.has(fkInfo.fkName)) {
          continue
        }
        handledFKs.add(fkInfo.fkName)

        const refTuple = referencePool.pickReference(fkInfo.refTable, faker)

        if (refTuple === null) {
          if (column.isNullable) {
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

        for (let j = 0; j < fkInfo.fkColumns.length; j++) {
          row[fkInfo.fkColumns[j]] = refTuple[j]
        }
        continue
      }

      // Handle nullable columns
      const isPK = table.primaryKey?.columns.includes(columnName) ?? false
      if (column.isNullable && !isPK && !fkInfo) {
        const roll = faker.number.float({ min: 0, max: 1 })
        if (roll < config.nullableRate) {
          row[columnName] = null
          continue
        }
      }

      // Handle timestamp pairs
      const tsPairInfo = timestampPairMap.get(columnName)
      if (tsPairInfo) {
        const pairKey = `${tsPairInfo.pair.createdColumn}|${tsPairInfo.pair.updatedColumn}`
        if (!timestampValues.has(pairKey)) {
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

      // Get generator from mapping
      const mapping = mappingResult.mappings.get(columnName)
      const generator = mapping?.generator

      if (!generator) {
        row[columnName] = null
        continue
      }

      // Handle unique columns
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

      // Default generation
      row[columnName] = generator(faker, i)
    }

    // Extract PK values (always collected for FK resolution)
    if (table.primaryKey) {
      const pkTuple = table.primaryKey.columns.map((col) => row[col])
      if (pkTuple.every((v) => v !== undefined)) {
        generatedPKs.push(pkTuple)
      }
    }

    yieldedCount++
    yield row
  }

  return {
    tableName: qualifiedName,
    generatedPKs,
    rowCount: yieldedCount,
  }
}
