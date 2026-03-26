import type pg from 'pg'
import type { UniqueConstraintDef, IndexDef } from '../../types/index.js'

export async function queryUniqueConstraints(
  client: pg.Client,
  schema: string,
): Promise<Map<string, UniqueConstraintDef[]>> {
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
    WHERE con.contype = 'u'
      AND n.nspname = $1
    GROUP BY c.relname, con.conname
    ORDER BY c.relname`,
    [schema],
  )

  const constraints = new Map<string, UniqueConstraintDef[]>()
  for (const row of result.rows) {
    if (!constraints.has(row.table_name)) {
      constraints.set(row.table_name, [])
    }
    constraints.get(row.table_name)!.push({
      columns: row.columns,
      name: row.constraint_name,
    })
  }
  return constraints
}

export async function queryIndexes(
  client: pg.Client,
  schema: string,
): Promise<Map<string, IndexDef[]>> {
  const result = await client.query<{
    table_name: string
    index_name: string
    columns: string[]
    is_unique: boolean
  }>(
    `SELECT
      t.relname AS table_name,
      i.relname AS index_name,
      array_agg(a.attname ORDER BY array_position(ix.indkey::int[], a.attnum)) AS columns,
      ix.indisunique AS is_unique
    FROM pg_index ix
    JOIN pg_class t ON ix.indrelid = t.oid
    JOIN pg_class i ON ix.indexrelid = i.oid
    JOIN pg_namespace n ON t.relnamespace = n.oid
    JOIN pg_attribute a ON a.attrelid = t.oid AND a.attnum = ANY(ix.indkey)
    WHERE n.nspname = $1
      AND NOT ix.indisprimary
      AND NOT EXISTS (
        SELECT 1 FROM pg_constraint con
        WHERE con.conindid = ix.indexrelid AND con.contype = 'u'
      )
    GROUP BY t.relname, i.relname, ix.indisunique
    ORDER BY t.relname`,
    [schema],
  )

  const indexes = new Map<string, IndexDef[]>()
  for (const row of result.rows) {
    if (!indexes.has(row.table_name)) {
      indexes.set(row.table_name, [])
    }
    indexes.get(row.table_name)!.push({
      columns: row.columns,
      name: row.index_name,
      isUnique: row.is_unique,
    })
  }
  return indexes
}
