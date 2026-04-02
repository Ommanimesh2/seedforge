import type { Client } from 'pg'
import type { SequenceResetInfo } from './types.js'
import { buildSequenceResetSQL } from './sql-builder.js'
import { InsertionError } from '../errors/index.js'

/**
 * Find all sequences associated with serial/identity columns in the specified tables.
 *
 * Queries pg_catalog for both serial sequences (pg_depend) and identity columns.
 * Results are deduplicated by (table, column) pair.
 *
 * @param client - pg.Client connected to the database
 * @param schema - Schema name to search
 * @param tableNames - Table names to search for sequences
 * @returns Array of SequenceResetInfo objects
 */
export async function findSequences(
  client: Client,
  schema: string,
  tableNames: string[],
): Promise<SequenceResetInfo[]> {
  if (tableNames.length === 0) {
    return []
  }

  try {
    // Query for serial sequences (via pg_depend)
    const serialQuery = `
      SELECT
        t.relname AS table_name,
        a.attname AS column_name,
        s.relname AS sequence_name,
        n.nspname AS schema_name
      FROM pg_depend d
      JOIN pg_class s ON d.objid = s.oid AND s.relkind = 'S'
      JOIN pg_class t ON d.refobjid = t.oid AND t.relkind IN ('r', 'p')
      JOIN pg_namespace n ON t.relnamespace = n.oid
      JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = d.refobjsubid
      WHERE n.nspname = $1
        AND t.relname = ANY($2)
        AND d.deptype IN ('a', 'i')
      ORDER BY t.relname, a.attname;
    `

    // Query for identity columns
    const identityQuery = `
      SELECT
        c.relname AS table_name,
        a.attname AS column_name,
        pg_get_serial_sequence(quote_ident(n.nspname) || '.' || quote_ident(c.relname), a.attname) AS sequence_name,
        n.nspname AS schema_name
      FROM pg_attribute a
      JOIN pg_class c ON a.attrelid = c.oid
      JOIN pg_namespace n ON c.relnamespace = n.oid
      WHERE a.attidentity IN ('a', 'd')
        AND n.nspname = $1
        AND c.relname = ANY($2)
        AND NOT a.attisdropped
      ORDER BY c.relname, a.attname;
    `

    const serialResult = await client.query(serialQuery, [schema, tableNames])
    const identityResult = await client.query(identityQuery, [schema, tableNames])

    // Merge and deduplicate by (table, column) pair
    const seen = new Set<string>()
    const sequences: SequenceResetInfo[] = []

    const processRow = (row: {
      table_name: string
      column_name: string
      sequence_name: string | null
      schema_name: string
    }) => {
      if (!row.sequence_name) return
      const key = `${row.schema_name}.${row.table_name}.${row.column_name}`
      if (seen.has(key)) return
      seen.add(key)
      sequences.push({
        tableName: row.table_name,
        schemaName: row.schema_name,
        columnName: row.column_name,
        sequenceName: row.sequence_name,
      })
    }

    for (const row of serialResult.rows) {
      processRow(row)
    }
    for (const row of identityResult.rows) {
      processRow(row)
    }

    return sequences
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    throw new InsertionError(
      'SF4005',
      `Failed to introspect sequences for reset: ${detail}`,
      [
        'Check that the database connection is valid',
        'Ensure the schema exists and is accessible',
      ],
      { schema, tableNames },
    )
  }
}

/**
 * Reset sequences to match the maximum value in their associated column.
 *
 * @param client - pg.Client connected to the database
 * @param sequences - Sequences to reset
 * @returns Count of sequences successfully reset
 */
export async function resetSequences(
  client: Client,
  sequences: SequenceResetInfo[],
): Promise<number> {
  let count = 0
  for (const seq of sequences) {
    try {
      const sql = buildSequenceResetSQL(
        seq.schemaName,
        seq.tableName,
        seq.columnName,
        seq.sequenceName,
      )
      await client.query(sql)
      count++
    } catch {
      // Non-fatal: log warning and continue
      // The sequence may not exist or the table may be empty
    }
  }
  return count
}
