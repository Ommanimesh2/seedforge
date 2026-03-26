import type { Client } from 'pg'
import type { TableDef } from '../types/schema.js'
import type { ExistingData } from './types.js'
import { existingDataQueryFailure } from '../errors/index.js'

/**
 * Queries the live database for existing data in a table.
 * Used for collision avoidance, FK reference pools, and sequence state.
 *
 * If any individual query fails, logs a warning and returns partial results.
 */
export async function queryExistingData(
  client: Client,
  table: TableDef,
): Promise<ExistingData> {
  const result: ExistingData = {
    rowCount: 0,
    existingPKs: [],
    existingUniqueValues: new Map(),
    sequenceValues: new Map(),
  }

  const schemaName = table.schema
  const tableName = table.name

  // Query 1: Row count
  try {
    const countResult = await client.query(
      `SELECT COUNT(*)::int AS count FROM "${schemaName}"."${tableName}"`,
    )
    result.rowCount = countResult.rows[0]?.count ?? 0
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    const warning = existingDataQueryFailure(
      `${schemaName}.${tableName}`,
      `Row count query failed: ${detail}`,
    )
    // Log but don't throw
    void warning
  }

  // Query 2: Existing PK values
  if (table.primaryKey && table.primaryKey.columns.length > 0) {
    try {
      const pkCols = table.primaryKey.columns
        .map((col) => `"${col}"`)
        .join(', ')
      const pkResult = await client.query(
        `SELECT ${pkCols} FROM "${schemaName}"."${tableName}" LIMIT 10000`,
      )
      result.existingPKs = pkResult.rows.map((row) =>
        table.primaryKey!.columns.map((col) => row[col]),
      )
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      void existingDataQueryFailure(
        `${schemaName}.${tableName}`,
        `PK query failed: ${detail}`,
      )
    }
  }

  // Query 3: Existing unique values (single-column unique constraints only)
  for (const uc of table.uniqueConstraints) {
    if (uc.columns.length !== 1) continue
    const colName = uc.columns[0]

    try {
      const uniqueResult = await client.query(
        `SELECT DISTINCT "${colName}"::text FROM "${schemaName}"."${tableName}" LIMIT 10000`,
      )
      const values = new Set<string>()
      for (const row of uniqueResult.rows) {
        if (row[colName] != null) {
          values.add(String(row[colName]))
        }
      }
      result.existingUniqueValues.set(colName, values)
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      void existingDataQueryFailure(
        `${schemaName}.${tableName}`,
        `Unique values query failed for ${colName}: ${detail}`,
      )
    }
  }

  // Query 4: Sequence state for auto-increment columns
  for (const [, column] of table.columns) {
    if (!column.isAutoIncrement) continue

    try {
      const seqResult = await client.query(
        `SELECT pg_get_serial_sequence('"${schemaName}"."${tableName}"', '${column.name}') AS seq_name`,
      )
      const seqName = seqResult.rows[0]?.seq_name
      if (seqName) {
        const lastValResult = await client.query(
          `SELECT last_value FROM ${seqName}`,
        )
        const lastValue = lastValResult.rows[0]?.last_value
        if (lastValue != null) {
          result.sequenceValues.set(seqName, Number(lastValue))
        }
      }
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err)
      void existingDataQueryFailure(
        `${schemaName}.${tableName}`,
        `Sequence query failed for ${column.name}: ${detail}`,
      )
    }
  }

  return result
}
