import type { Faker } from '@faker-js/faker'
import type { TableDef } from '../types/schema.js'
import type { MappingResult } from '../mapping/types.js'
import type { GenerationConfig, Row, TableGenerationResult, ExistingData } from './types.js'
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
  /** Pre-computed FK assignment sequences for cardinality-configured columns */
  fkAssignments?: Map<string, unknown[][]>
  /** Pre-generated AI text pool. Key: "table.column", Value: text values */
  aiTextPool?: Map<string, string[]>
}

/**
 * Streaming metadata returned when a generateTableStream generator completes.
 */
export interface TableStreamMeta {
  /** Qualified table name */
  tableName: string
  /** PK values extracted from generated rows (array of tuples) */
  generatedPKs: unknown[][]
  /** Total rows yielded */
  rowCount: number
}

interface PreparedTable {
  qualifiedName: string
  rowCount: number
  timestampPairMap: Map<
    string,
    { pair: ReturnType<typeof detectTimestampPairs>[0]; role: 'created' | 'updated' }
  >
  fkColumnToFK: Map<
    string,
    { fkName: string; fkColumns: string[]; refTable: string; refColumns: string[] }
  >
  uniqueColumns: Set<string>
}

function prepareTable(context: TableGenerationContext): PreparedTable {
  const { table, config, uniqueTracker, existingData } = context
  const qualifiedName = `${table.schema}.${table.name}`
  const rowCount = getRowCount(config, qualifiedName)

  const timestampPairs = detectTimestampPairs(table)
  const timestampPairMap = new Map<
    string,
    { pair: ReturnType<typeof detectTimestampPairs>[0]; role: 'created' | 'updated' }
  >()
  for (const pair of timestampPairs) {
    timestampPairMap.set(pair.createdColumn, { pair, role: 'created' })
    timestampPairMap.set(pair.updatedColumn, { pair, role: 'updated' })
  }

  const fkColumnToFK = new Map<
    string,
    { fkName: string; fkColumns: string[]; refTable: string; refColumns: string[] }
  >()
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

  // Initialize unique tracker from existing unique values
  for (const [colName, values] of existingData.existingUniqueValues) {
    uniqueTracker.initFromExisting(qualifiedName, colName, values)
  }

  return { qualifiedName, rowCount, timestampPairMap, fkColumnToFK, uniqueColumns }
}

/**
 * Build a single row for the table at index `i`.
 *
 * Pure per-row logic: consumes the prepared context, produces one Row.
 * Shared between generateTableRows (array collection) and generateTableStream
 * (async generator yield). Any behavior change here affects both entry points.
 */
function buildSingleRow(context: TableGenerationContext, prepared: PreparedTable, i: number): Row {
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
  const { qualifiedName, timestampPairMap, fkColumnToFK, uniqueColumns } = prepared

  const row: Row = {}
  const handledFKs = new Set<string>()
  const timestampValues = new Map<string, Date>()

  for (const [columnName, column] of table.columns) {
    // a. Skip GENERATED ALWAYS AS columns
    if (column.isGenerated) {
      continue
    }

    // a2. Handle auto-increment PK columns
    if (column.isAutoIncrement) {
      const isPK = table.primaryKey?.columns.includes(columnName) ?? false
      if (isPK) {
        const existingMax =
          existingData.existingPKs.length > 0
            ? Math.max(...existingData.existingPKs.map((pk) => Number(pk[0]) || 0))
            : 0
        row[columnName] = existingMax + i + 1
      }
      continue
    }

    // b. Handle deferred FK columns (NULL on first insert)
    if (deferredFKColumns.has(columnName)) {
      row[columnName] = null
      continue
    }

    // c. Handle FK columns
    const fkInfo = fkColumnToFK.get(columnName)
    if (fkInfo && !deferredFKColumns.has(columnName)) {
      if (handledFKs.has(fkInfo.fkName)) {
        continue
      }
      handledFKs.add(fkInfo.fkName)

      const preAssigned = context.fkAssignments?.get(fkInfo.fkColumns[0])
      const refTuple =
        preAssigned && i < preAssigned.length
          ? preAssigned[i]
          : referencePool.pickReference(fkInfo.refTable, faker)

      if (refTuple === null) {
        if (column.isNullable) {
          for (const fkCol of fkInfo.fkColumns) {
            row[fkCol] = null
          }
          continue
        } else {
          throw fkReferencePoolEmpty(qualifiedName, columnName, fkInfo.refTable)
        }
      }

      for (let j = 0; j < fkInfo.fkColumns.length; j++) {
        row[fkInfo.fkColumns[j]] = refTuple[j]
      }
      continue
    }

    // d. Handle nullable columns
    const isPK = table.primaryKey?.columns.includes(columnName) ?? false
    if (column.isNullable && !isPK && !fkInfo) {
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

    // Lookup generator from mapping
    const mapping = mappingResult.mappings.get(columnName)
    const generator = mapping?.generator

    if (!generator) {
      row[columnName] = null
      continue
    }

    // e2. AI text pool
    if (context.aiTextPool) {
      const poolKey = `${qualifiedName}.${columnName}`
      const aiValues = context.aiTextPool.get(poolKey)
      if (aiValues && aiValues.length > 0) {
        let aiValue: string = aiValues[i % aiValues.length]
        if (column.maxLength && aiValue.length > column.maxLength) {
          aiValue = aiValue.substring(0, column.maxLength).trimEnd()
        }
        row[columnName] = aiValue
        continue
      }
    }

    // f. Unique columns
    if (uniqueColumns.has(columnName)) {
      let value = uniqueTracker.generateUnique(qualifiedName, columnName, generator, faker, i)

      if (column.maxLength && typeof value === 'string' && value.length > column.maxLength) {
        value = value.substring(0, column.maxLength).trimEnd()
      }

      row[columnName] = value
      continue
    }

    // g. Default generation
    let value = generator(faker, i)

    if (column.maxLength && typeof value === 'string' && value.length > column.maxLength) {
      value = value.substring(0, column.maxLength).trimEnd()
    }

    row[columnName] = value
  }

  return row
}

function extractPk(table: TableDef, row: Row): unknown[] | null {
  if (!table.primaryKey) return null
  const pkTuple = table.primaryKey.columns.map((col) => row[col])
  return pkTuple.every((v) => v !== undefined) ? pkTuple : null
}

/**
 * Generates rows for a single table according to its schema, mappings, and constraints.
 *
 * Collects all rows into an array in memory. Suitable for normal generation;
 * for memory-efficient streaming (e.g. --fast mode), use generateTableStream.
 */
export function generateTableRows(context: TableGenerationContext): TableGenerationResult {
  const prepared = prepareTable(context)
  const rows: Row[] = []
  const generatedPKs: unknown[][] = []

  for (let i = 0; i < prepared.rowCount; i++) {
    const row = buildSingleRow(context, prepared, i)
    rows.push(row)
    const pk = extractPk(context.table, row)
    if (pk) generatedPKs.push(pk)
  }

  return {
    tableName: prepared.qualifiedName,
    rows,
    generatedPKs,
  }
}

/**
 * Generates rows for a single table as an AsyncGenerator.
 *
 * Yields one row at a time instead of collecting into an array, so that
 * memory stays flat regardless of row count. Used by --fast streaming paths
 * (PG COPY, MySQL LOAD DATA) where rows are piped straight into the DB.
 *
 * PK tuples are still captured (necessary for downstream FK resolution) and
 * returned via the generator's final return value.
 */
export async function* generateTableStream(
  context: TableGenerationContext,
): AsyncGenerator<Row, TableStreamMeta, undefined> {
  const prepared = prepareTable(context)
  const generatedPKs: unknown[][] = []
  let yieldedCount = 0

  for (let i = 0; i < prepared.rowCount; i++) {
    const row = buildSingleRow(context, prepared, i)
    const pk = extractPk(context.table, row)
    if (pk) generatedPKs.push(pk)
    yieldedCount++
    yield row
  }

  return {
    tableName: prepared.qualifiedName,
    generatedPKs,
    rowCount: yieldedCount,
  }
}
