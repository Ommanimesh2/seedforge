import type { DatabaseSchema } from '../types/schema.js'
import { resolveTable } from '../types/resolve.js'
import { buildInsertPlan } from '../graph/plan.js'
import type { DependencyEdge } from '../graph/types.js'
import type { GenerationConfig, GenerationResult, ExistingData } from './types.js'
import { createGenerationConfig, getRowCount } from './config.js'
import { createSeededFaker } from '../mapping/seeded-faker.js'
import { mapTable } from '../mapping/mapper.js'
import { ReferencePoolManager } from './reference-pool.js'
import { UniqueTracker } from './unique-tracker.js'
import { generateTableRows } from './generate-table.js'
import { generateDeferredUpdates } from './deferred-updates.js'
import { resolveCardinalityForTable } from './cardinality.js'
import { generationFailure } from '../errors/index.js'

/**
 * Empty ExistingData used when no database client is available.
 * Keeps the generation engine honest without needing a live DB query.
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
 * Pure, browser-safe entry point for the generation engine.
 *
 * Given a fully-populated DatabaseSchema (e.g. produced by a parser or
 * constructed by hand in an in-browser playground), walk the schema in
 * dependency order and produce a GenerationResult of synthetic rows.
 *
 * Unlike {@link generate}, this function does NOT talk to any database
 * client. It therefore has no transitive dependency on `pg`, `mysql2`,
 * `better-sqlite3`, or any Node built-in, which means it is safe to bundle
 * for the browser via the `@otg-dev/seedforge/browser` subpath export.
 *
 * @example
 * ```ts
 * import { generateFromSchema } from '@otg-dev/seedforge/browser'
 *
 * const result = generateFromSchema(mySchema, { count: 100, seed: 42 })
 * for (const [tableName, tableResult] of result.tables) {
 *   console.log(tableName, tableResult.rows.length)
 * }
 * ```
 *
 * @param schema - The database schema to generate rows for
 * @param config - Optional generation config overrides, plus two
 *                 convenience shortcuts: `count` (globalRowCount) and
 *                 `seed` (RNG seed)
 * @returns A GenerationResult with rows per table and any deferred updates
 */
export function generateFromSchema(
  schema: DatabaseSchema,
  config?: Partial<GenerationConfig> & { count?: number; seed?: number },
): GenerationResult {
  // Normalize the convenience shortcuts into a proper GenerationConfig.
  const overrides: Partial<GenerationConfig> = { ...config }
  if (config?.count !== undefined && overrides.globalRowCount === undefined) {
    overrides.globalRowCount = config.count
  }
  // `seed` is already part of GenerationConfig, so it passes through as-is.

  const genConfig = createGenerationConfig(overrides)
  const faker = createSeededFaker(genConfig.seed)
  const referencePool = new ReferencePoolManager()
  const uniqueTracker = new UniqueTracker()

  // Build the insert plan from the schema (topological order + cycle breaks).
  const plan = buildInsertPlan(schema)
  const warnings: string[] = [...plan.warnings]

  const result: GenerationResult = {
    tables: new Map(),
    deferredUpdates: [],
    warnings,
  }

  // Build deferred FK column lookup (cycle-broken edges).
  const deferredColumnMap = new Map<string, Set<string>>()
  for (const edge of plan.deferredEdges) {
    const existing = deferredColumnMap.get(edge.from) ?? new Set<string>()
    for (const col of edge.fk.columns) {
      existing.add(col)
    }
    deferredColumnMap.set(edge.from, existing)
  }

  // Collect self-referencing FK edges.
  const selfRefEdges = new Map<string, DependencyEdge[]>()
  for (const tableName of plan.selfRefTables) {
    const table = resolveTable(schema, tableName)
    if (!table) continue

    const edges: DependencyEdge[] = []
    for (const fk of table.foreignKeys) {
      const refTable = `${fk.referencedSchema}.${fk.referencedTable}`
      if (refTable === tableName) {
        const existing = deferredColumnMap.get(tableName) ?? new Set<string>()
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

  // Walk tables in topological order. No DB client means we use an empty
  // ExistingData for every table.
  for (const tableName of plan.ordered) {
    const table = resolveTable(schema, tableName)
    if (!table) {
      warnings.push(`Table ${tableName} not found in schema, skipping`)
      continue
    }

    try {
      const existingData = emptyExistingData()

      const mapping = mapTable(table)

      const deferredFKColumns = deferredColumnMap.get(tableName) ?? new Set()
      let fkAssignments: Map<string, unknown[][]> | undefined
      const cardinalityConfig = genConfig.tableCardinalityConfigs?.get(tableName)
      if (cardinalityConfig && cardinalityConfig.size > 0) {
        const rowCount = getRowCount(genConfig, tableName)
        if (rowCount > 0) {
          fkAssignments = resolveCardinalityForTable(
            table,
            referencePool,
            cardinalityConfig,
            rowCount,
            faker,
            deferredFKColumns,
          )
        }
      }

      const tableResult = generateTableRows({
        table,
        mappingResult: mapping,
        config: genConfig,
        faker,
        referencePool,
        uniqueTracker,
        existingData,
        deferredFKColumns,
        fkAssignments,
        aiTextPool: genConfig.aiTextPool,
      })

      if (tableResult.generatedPKs.length > 0) {
        referencePool.addGenerated(tableName, tableResult.generatedPKs)
      }

      // Self-ref deferred updates can be generated immediately — the
      // reference pool is already populated from the insert we just did.
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

      result.tables.set(tableName, tableResult)
    } catch (err) {
      if (err instanceof Error && 'code' in err) {
        throw err
      }
      const detail = err instanceof Error ? err.message : String(err)
      throw generationFailure(tableName, detail)
    }
  }

  // Cycle-broken deferred updates run after every table is generated so
  // the target reference pool is guaranteed to be populated.
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
