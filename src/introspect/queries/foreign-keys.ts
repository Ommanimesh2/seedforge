import type pg from 'pg'
import { type ForeignKeyDef, FKAction } from '../../types/index.js'
import { parseArray } from './parse-array.js'

const FK_ACTION_MAP: Record<string, FKAction> = {
  a: FKAction.NO_ACTION,
  r: FKAction.RESTRICT,
  c: FKAction.CASCADE,
  n: FKAction.SET_NULL,
  d: FKAction.SET_DEFAULT,
}

export async function queryForeignKeys(
  client: pg.Client,
  schema: string,
): Promise<Map<string, ForeignKeyDef[]>> {
  const result = await client.query<{
    table_name: string
    constraint_name: string
    columns: string[]
    referenced_table: string
    referenced_schema: string
    referenced_columns: string[]
    delete_action: string
    update_action: string
    is_deferrable: boolean
    is_deferred: boolean
  }>(
    `SELECT
      c.relname AS table_name,
      con.conname AS constraint_name,
      array_agg(a.attname ORDER BY k.ord) AS columns,
      ref_c.relname AS referenced_table,
      ref_n.nspname AS referenced_schema,
      array_agg(ref_a.attname ORDER BY fk.ord) AS referenced_columns,
      con.confdeltype AS delete_action,
      con.confupdtype AS update_action,
      con.condeferrable AS is_deferrable,
      con.condeferred AS is_deferred
    FROM pg_constraint con
    JOIN pg_class c ON con.conrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    JOIN pg_class ref_c ON con.confrelid = ref_c.oid
    JOIN pg_namespace ref_n ON ref_c.relnamespace = ref_n.oid
    JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS k(num, ord) ON true
    JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = k.num
    JOIN LATERAL unnest(con.confkey) WITH ORDINALITY AS fk(num, ord) ON k.ord = fk.ord
    JOIN pg_attribute ref_a ON ref_a.attrelid = ref_c.oid AND ref_a.attnum = fk.num
    WHERE con.contype = 'f'
      AND n.nspname = $1
    GROUP BY c.relname, con.conname, ref_c.relname, ref_n.nspname,
             con.confdeltype, con.confupdtype, con.condeferrable, con.condeferred
    ORDER BY c.relname, con.conname`,
    [schema],
  )

  const fks = new Map<string, ForeignKeyDef[]>()
  for (const row of result.rows) {
    const fk: ForeignKeyDef = {
      name: row.constraint_name,
      columns: parseArray(row.columns),
      referencedTable: row.referenced_table,
      referencedSchema: row.referenced_schema,
      referencedColumns: parseArray(row.referenced_columns),
      onDelete: FK_ACTION_MAP[row.delete_action] ?? FKAction.NO_ACTION,
      onUpdate: FK_ACTION_MAP[row.update_action] ?? FKAction.NO_ACTION,
      isDeferrable: row.is_deferrable,
      isDeferred: row.is_deferred,
      isVirtual: false,
    }

    if (!fks.has(row.table_name)) {
      fks.set(row.table_name, [])
    }
    fks.get(row.table_name)!.push(fk)
  }
  return fks
}
