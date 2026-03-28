import type { Client } from 'pg'
import type { DatabaseSchema } from '../types/schema.js'
import { resolveTable } from '../types/resolve.js'
import type { InsertPlan } from '../graph/types.js'
import type {
  GenerationConfig,
  GenerationResult,
  ExistingData,
} from './types.js'
import { createGenerationConfig } from './config.js'
import { createSeededFaker } from '../mapping/seeded-faker.js'
import { mapTable } from '../mapping/mapper.js'
import { ReferencePoolManager } from './reference-pool.js'
import { UniqueTracker } from './unique-tracker.js'
import { queryExistingData } from './existing-data.js'
import { generateTableRows } from './generate-table.js'
import { generateDeferredUpdates } from './deferred-updates.js'
import type { DependencyEdge } from '../graph/types.js'
import { generationFailure } from '../errors/index.js'

/**
 * Empty ExistingData used when no database client is provided.
 */
function emptyExistingData(): ExistingData {
  return {
    rowCount: 0,
    existingPKs: [],
    existingUniqueValues: new Map(),
    sequenceValues: new Map(),
  }
}

/**
 * Main entry point for the data generation engine.
 *
 * Walks the InsertPlan in topological order, generates rows for each table,
 * handles FK references, self-referencing tables, and cycle-broken edges.
 *
 * @param schema - The database schema
 * @param plan - The insert plan from buildInsertPlan()
 * @param client - A pg.Client for querying existing data, or null for dry-run/testing
 * @param config - Optional partial generation config overrides
 * @returns GenerationResult with all generated rows and deferred updates
 */
export async function generate(
  schema: DatabaseSchema,
  plan: InsertPlan,
  client: Client | null,
  config?: Partial<GenerationConfig>,
): Promise<GenerationResult> {
  // 1. Initialize
  const genConfig = createGenerationConfig(config)
  const faker = createSeededFaker(genConfig.seed)
  const referencePool = new ReferencePoolManager()
  const uniqueTracker = new UniqueTracker()
  const warnings: string[] = [...plan.warnings]

  const result: GenerationResult = {
    tables: new Map(),
    deferredUpdates: [],
    warnings,
  }

  // 2. Build deferred FK column lookup
  // Map<tableName, Set<columnName>> of columns that must be NULL on first insert
  const deferredColumnMap = new Map<string, Set<string>>()

  // From plan.deferredEdges (cycle-broken edges)
  for (const edge of plan.deferredEdges) {
    const existing = deferredColumnMap.get(edge.from) ?? new Set<string>()
    for (const col of edge.fk.columns) {
      existing.add(col)
    }
    deferredColumnMap.set(edge.from, existing)
  }

  // From plan.selfRefTables: find self-referencing FK edges from the schema
  // and add their FK columns to the deferred map
  const selfRefEdges = new Map<string, DependencyEdge[]>()
  for (const tableName of plan.selfRefTables) {
    const table = resolveTable(schema, tableName)
    if (!table) continue

    const edges: DependencyEdge[] = []
    for (const fk of table.foreignKeys) {
      const refTable = `${fk.referencedSchema}.${fk.referencedTable}`
      if (refTable === tableName) {
        // This is a self-referencing FK
        const existing =
          deferredColumnMap.get(tableName) ?? new Set<string>()
        for (const col of fk.columns) {
          existing.add(col)
        }
        deferredColumnMap.set(tableName, existing)
        edges.push({
          from: tableName,
          to: tableName,
          fk,
          isNullable: fk.columns.every((col) => {
            const colDef = table.columns.get(col)
            return colDef !== undefined && colDef.isNullable
          }),
          isSelfRef: true,
        })
      }
    }
    if (edges.length > 0) {
      selfRefEdges.set(tableName, edges)
    }
  }

  // 3. Walk tables in topological order
  for (const tableName of plan.ordered) {
    const table = resolveTable(schema, tableName)
    if (!table) {
      warnings.push(`Table ${tableName} not found in schema, skipping`)
      continue
    }

    try {
      // a. Query existing data (if client is provided)
      let existingData: ExistingData
      if (client) {
        existingData = await queryExistingData(client, table)
        // Initialize reference pool from existing PKs
        if (table.primaryKey) {
          referencePool.initFromExisting(
            tableName,
            table.primaryKey.columns,
            existingData.existingPKs,
          )
        }
      } else {
        existingData = emptyExistingData()
      }

      // b. Map columns
      const mapping = mapTable(table)

      // c. Generate rows
      const tableResult = generateTableRows({
        table,
        mappingResult: mapping,
        config: genConfig,
        faker,
        referencePool,
        uniqueTracker,
        existingData,
        deferredFKColumns: deferredColumnMap.get(tableName) ?? new Set(),
      })

      // d. Update reference pool with newly generated PKs
      if (tableResult.generatedPKs.length > 0) {
        referencePool.addGenerated(tableName, tableResult.generatedPKs)
      }

      // e. Generate self-ref deferred updates immediately
      //    (self-ref tables reference themselves, so pool is already populated)
      const selfEdges = selfRefEdges.get(tableName)
      if (selfEdges && selfEdges.length > 0) {
        const updates = generateDeferredUpdates({
          tableName,
          table,
          generatedRows: tableResult.rows,
          generatedPKs: tableResult.generatedPKs,
          deferredFKEdges: selfEdges,
          referencePool,
          faker,
        })
        result.deferredUpdates.push(...updates)
      }

      // f. Store results
      result.tables.set(tableName, tableResult)
    } catch (err) {
      if (err instanceof Error && 'code' in err) {
        throw err // Re-throw SeedForgeErrors
      }
      const detail = err instanceof Error ? err.message : String(err)
      throw generationFailure(tableName, detail)
    }
  }

  // 4. Generate deferred updates for cycle-broken edges
  //    These must run AFTER all tables are generated, because the referenced table
  //    may have been generated after the table with the deferred FK column.
  for (const edge of plan.deferredEdges) {
    const tableName = edge.from
    const table = resolveTable(schema, tableName)
    if (!table) continue

    const tableResult = result.tables.get(tableName)
    if (!tableResult) continue

    try {
      const updates = generateDeferredUpdates({
        tableName,
        table,
        generatedRows: tableResult.rows,
        generatedPKs: tableResult.generatedPKs,
        deferredFKEdges: [edge],
        referencePool,
        faker,
      })
      result.deferredUpdates.push(...updates)
    } catch (err) {
      if (err instanceof Error && 'code' in err) {
        throw err
      }
      const detail = err instanceof Error ? err.message : String(err)
      throw generationFailure(tableName, detail)
    }
  }

  return result
}
