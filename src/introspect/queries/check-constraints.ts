import type pg from 'pg'
import type { CheckConstraintDef } from '../../types/index.js'

export async function queryCheckConstraints(
  client: pg.Client,
  schema: string,
): Promise<Map<string, CheckConstraintDef[]>> {
  const result = await client.query<{
    table_name: string
    constraint_name: string
    expression: string
  }>(
    `SELECT
      c.relname AS table_name,
      con.conname AS constraint_name,
      pg_get_constraintdef(con.oid) AS expression
    FROM pg_constraint con
    JOIN pg_class c ON con.conrelid = c.oid
    JOIN pg_namespace n ON c.relnamespace = n.oid
    WHERE con.contype = 'c'
      AND n.nspname = $1
    ORDER BY c.relname, con.conname`,
    [schema],
  )

  const constraints = new Map<string, CheckConstraintDef[]>()
  for (const row of result.rows) {
    if (!constraints.has(row.table_name)) {
      constraints.set(row.table_name, [])
    }
    constraints.get(row.table_name)!.push({
      expression: row.expression,
      name: row.constraint_name,
      inferredValues: extractEnumLikeValues(row.expression),
    })
  }
  return constraints
}

export function extractEnumLikeValues(expression: string): string[] | null {
  if (!expression) return null

  // Pattern 1: ANY (ARRAY['val1'::text, 'val2'::text, ...])
  const anyArrayMatch = expression.match(
    /ANY\s*\(\s*(?:ARRAY\s*\[)?((?:'[^']*'(?:::[\w\s]+)?(?:\s*,\s*)?)+)\]?\s*\)/i,
  )
  if (anyArrayMatch) {
    return extractQuotedValues(anyArrayMatch[1])
  }

  // Pattern 2: IN ('val1', 'val2', ...)
  const inMatch = expression.match(
    /\bIN\s*\(\s*((?:'[^']*'(?:::[\w\s]+)?(?:\s*,\s*)?)+)\s*\)/i,
  )
  if (inMatch) {
    return extractQuotedValues(inMatch[1])
  }

  // Pattern 3: OR chain: ((col)::text = 'val1'::text) OR ((col)::text = 'val2'::text)
  const orParts = expression.split(/\bOR\b/i)
  if (orParts.length >= 2) {
    const values: string[] = []
    for (const part of orParts) {
      const match = part.match(/=\s*'([^']*)'/)
      if (match) {
        values.push(match[1])
      }
    }
    if (values.length === orParts.length && values.length >= 2) {
      return values
    }
  }

  return null
}

function extractQuotedValues(str: string): string[] | null {
  const matches = str.match(/'([^']*)'/g)
  if (!matches || matches.length === 0) return null
  return matches.map((m) => m.slice(1, -1))
}
