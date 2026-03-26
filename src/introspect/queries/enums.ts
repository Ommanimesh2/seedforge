import type pg from 'pg'
import type { EnumDef } from '../../types/index.js'

export async function queryEnums(
  client: pg.Client,
  schema: string,
): Promise<Map<string, EnumDef>> {
  const result = await client.query<{
    enum_name: string
    enum_schema: string
    enum_values: string[]
  }>(
    `SELECT
      t.typname AS enum_name,
      n.nspname AS enum_schema,
      array_agg(e.enumlabel ORDER BY e.enumsortorder) AS enum_values
    FROM pg_type t
    JOIN pg_enum e ON t.oid = e.enumtypid
    JOIN pg_namespace n ON t.typnamespace = n.oid
    WHERE n.nspname = $1
    GROUP BY t.typname, n.nspname
    ORDER BY t.typname`,
    [schema],
  )

  const enums = new Map<string, EnumDef>()
  for (const row of result.rows) {
    enums.set(row.enum_name, {
      name: row.enum_name,
      schema: row.enum_schema,
      values: row.enum_values,
    })
  }
  return enums
}
