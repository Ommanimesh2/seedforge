import type { Faker } from '@faker-js/faker'
import type { TableDef } from '../types/schema.js'
import type { MappingResult } from '../mapping/types.js'
import type { GenerationConfig, Row, TableGenerationResult, ExistingData } from './types.js'
import type { ReferencePoolManager } from './reference-pool.js'
import type { UniqueTracker } from './unique-tracker.js'
import { CompositeUniqueTracker } from './unique-tracker.js'
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
  /** Composite UNIQUE constraints on this table (>1 column). Used to
   *  enforce per-row tuple uniqueness post-build. */
  compositeUniques: { columns: string[] }[]
  /** Per-table composite tracker. Lives on the prepared context so it
   *  persists across rows. */
  compositeTracker: CompositeUniqueTracker
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
  const compositeUniques: { columns: string[] }[] = []
  for (const uc of table.uniqueConstraints) {
    if (uc.columns.length === 1) {
      uniqueColumns.add(uc.columns[0])
    } else if (uc.columns.length > 1) {
      compositeUniques.push({ columns: [...uc.columns] })
    }
  }
  if (table.primaryKey) {
    if (table.primaryKey.columns.length === 1) {
      uniqueColumns.add(table.primaryKey.columns[0])
    } else if (table.primaryKey.columns.length > 1) {
      // Composite PK is implicitly UNIQUE.
      compositeUniques.push({ columns: [...table.primaryKey.columns] })
    }
  }

  // Initialize unique tracker from existing unique values
  for (const [colName, values] of existingData.existingUniqueValues) {
    uniqueTracker.initFromExisting(qualifiedName, colName, values)
  }

  return {
    qualifiedName,
    rowCount,
    timestampPairMap,
    fkColumnToFK,
    uniqueColumns,
    compositeUniques,
    compositeTracker: new CompositeUniqueTracker(),
  }
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
      // Pass maxLength so the tracker registers the post-truncation
      // value — otherwise two suffix attempts can collide after the
      // truncation that happens here, defeating uniqueness.
      const value = uniqueTracker.generateUnique(
        qualifiedName,
        columnName,
        generator,
        faker,
        i,
        1000,
        column.maxLength,
      )

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

/**
 * Post-build pass: for each composite UNIQUE constraint on this table,
 * check whether the row's tuple has already been seen. If it has,
 * mutate one of the constraint's columns (non-FK preferred) and retry.
 * On exhaustion, leave the row as-is — the database will reject it
 * with a clear error, which is preferable to silent data corruption.
 *
 * This is the streaming/batched-shared bridge to the
 * `CompositeUniqueTracker`. Single-column UNIQUE columns are handled
 * earlier inside the row build (see uniqueTracker.generateUnique).
 */
function enforceCompositeUniqueness(
  row: Row,
  prepared: PreparedTable,
  context: TableGenerationContext,
): void {
  const tracker = prepared.compositeTracker
  const fkSet = new Set(prepared.fkColumnToFK.keys())
  const tableName = prepared.qualifiedName

  // Build a tuple-normalizer: for DATE columns we must compare on
  // YYYY-MM-DD (Postgres's stored representation), not on the raw
  // Date's full-precision toISOString — otherwise two different times
  // on the same day are tracker-distinct but Postgres-identical.
  const normalizeForColumn = (col: string, v: unknown): unknown => {
    const colDef = context.table.columns.get(col)
    if (!colDef) return v
    if (colDef.dataType === 'DATE' && v instanceof Date) {
      // Match how PG COPY serializes (toISOString → UTC ISO) and how
      // Postgres parses it into a DATE column (the YYYY-MM-DD prefix
      // of the UTC instant). Using local time here would cause tracker
      // / DB disagreement around midnight UTC, missing real collisions.
      return v.toISOString().slice(0, 10)
    }
    return v
  }
  const tupleOf = (cols: readonly string[]): unknown[] =>
    cols.map((c) => normalizeForColumn(c, row[c]))

  for (const uc of prepared.compositeUniques) {
    let tuple = tupleOf(uc.columns)
    if (tracker.add(tableName, uc.columns, tuple)) continue

    // Special case: every column in the constraint is an FK. Mutating
    // would break referential integrity, so we resample from the FK
    // pool instead.
    const allFk = uc.columns.every((c) => fkSet.has(c))
    if (allFk) {
      // Mutating an FK UUID would break referential integrity, so when
      // every column in the constraint is an FK we resample one of
      // them from the reference pool until the tuple is unique.
      resampleFkTuple(row, uc.columns, prepared, context, tableName)
      continue
    }

    // Pick a column to mutate: prefer non-FK columns, prefer the last
    // one (typically a temporal / discriminator column with high
    // cardinality).
    const mutableIdx = pickMutableColumnIndex(uc.columns, fkSet)
    if (mutableIdx === -1) {
      // All columns are FKs — can't safely mutate. Let DB throw.
      tracker.add(tableName, uc.columns, tuple)
      continue
    }
    const colName = uc.columns[mutableIdx]
    const colDef = context.table.columns.get(colName)
    let bumped = false
    let mutationRefused = false
    for (let attempt = 1; attempt <= 1000; attempt++) {
      const mutated = mutateForUniqueness(row[colName], attempt, colDef?.maxLength ?? null)
      if (mutated === null) {
        // Mutator refused (e.g. UUID column). Let the DB error surface
        // — that's a clearer signal to the user than silent corruption.
        mutationRefused = true
        break
      }
      tuple = uc.columns.map((c, idx) =>
        idx === mutableIdx ? normalizeForColumn(c, mutated) : normalizeForColumn(c, row[c]),
      )
      if (tracker.add(tableName, uc.columns, tuple)) {
        row[colName] = mutated
        bumped = true
        break
      }
    }
    if (!bumped && !mutationRefused) {
      // Exhausted retries — register the colliding tuple and let the
      // DB error surface. Better than retrying forever.
      tracker.add(tableName, uc.columns, tuple)
    }
  }
}

/**
 * Resample one of an all-FK composite UC's columns from the reference
 * pool until the resulting tuple is unique. Mutates `row` in place.
 * Returns true on success, false on exhaustion.
 */
function resampleFkTuple(
  row: Row,
  columns: readonly string[],
  prepared: PreparedTable,
  context: TableGenerationContext,
  tableName: string,
): boolean {
  const tracker = prepared.compositeTracker
  // Pick the last column to resample (heuristic: most variable).
  const colName = columns[columns.length - 1]
  const fk = prepared.fkColumnToFK.get(colName)
  if (!fk) return false
  // The prepared FK descriptor already stores the qualified target as
  // `refTable` (`schema.table`).
  const pool = context.referencePool.getPool(fk.refTable)
  if (!pool || pool.values.length === 0) return false
  const maxAttempts = Math.min(1000, pool.values.length)
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const idx = context.faker.number.int({ min: 0, max: pool.values.length - 1 })
    const candidate = pool.values[idx]
    // FK pool tuples are single-column unless composite. We assume the
    // FK is single-column here (typical case); composite FK + composite
    // UC is rare and not handled by this helper.
    const newVal = candidate[0]
    row[colName] = newVal
    const tuple = columns.map((c) => row[c])
    if (tracker.add(tableName, columns, tuple)) return true
  }
  return false
}

function pickMutableColumnIndex(columns: readonly string[], fkSet: Set<string>): number {
  // Walk right to left preferring non-FK columns. FK columns hold
  // pool-resolved UUIDs; mutating them would break referential
  // integrity, so we only fall back to them when there is no
  // alternative (and even then `mutateForUniqueness` will refuse to
  // mutate UUID-shaped values).
  for (let i = columns.length - 1; i >= 0; i--) {
    if (!fkSet.has(columns[i])) return i
  }
  for (let i = columns.length - 1; i >= 0; i--) {
    return i
  }
  return -1
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Returns the mutated value, or `null` if mutation is unsafe (e.g.
 * mutating a UUID would corrupt FK references). Caller treats `null`
 * as "give up and let the DB error surface the real issue".
 */
function mutateForUniqueness(value: unknown, attempt: number, maxLength: number | null): unknown {
  if (value instanceof Date) {
    // Bump by `attempt` days. Spreading across days is more useful
    // than seconds because it stays representable in DATE columns
    // (which truncate sub-day precision).
    return new Date(value.getTime() + attempt * 86_400_000)
  }
  if (typeof value === 'number') {
    return value + attempt
  }
  if (typeof value === 'string') {
    // Don't mutate UUIDs — appending a suffix produces an invalid UUID
    // that Postgres rejects, and even if it didn't, the value would no
    // longer match any FK parent. Better to bail and let the user
    // increase parent cardinality.
    if (UUID_REGEX.test(value)) return null
    const suffix = `_${attempt}`
    if (maxLength && value.length + suffix.length > maxLength) {
      const keep = Math.max(1, maxLength - suffix.length)
      return value.slice(0, keep) + suffix
    }
    return value + suffix
  }
  // bigint, boolean, null, etc.: best effort.
  if (typeof value === 'bigint') return value + BigInt(attempt)
  return value
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
    enforceCompositeUniqueness(row, prepared, context)
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
    enforceCompositeUniqueness(row, prepared, context)
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
