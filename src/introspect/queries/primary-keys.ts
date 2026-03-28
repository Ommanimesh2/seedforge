import type pg from 'pg'
import type { PrimaryKeyDef } from '../../types/index.js'
import { parseArray } from './parse-array.js'

export async function queryPrimaryKeys(
  client: pg.Client,
  schema: string,
): Promise<Map<string, PrimaryKeyDef>> {
  const result = await client.query<{
    table_name: string
    constraint_name: string
    columns: string[]
  }>(
    `SELECT
      c.relname AS table_name,
      con.conname AS constraint_name,
      array_agg(a.attname ORDER BY array_position(con.conkey, a.attnum)) AS columns
    FROM pg_constraint con
    JOIN pg_class c ON con.conrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = ANY(con.conkey)
    WHERE con.contype = 'p'
      AND n.nspname = $1
    GROUP BY c.relname, con.conname
    ORDER BY c.relname`,
    [schema],
  )

  const pks = new Map<string, PrimaryKeyDef>()
  for (const row of result.rows) {
    pks.set(row.table_name, {
      columns: parseArray(row.columns),
      name: row.constraint_name,
    })
  }
  return pks
}
