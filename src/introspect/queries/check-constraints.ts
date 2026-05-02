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

  // Pattern 1: ANY (ARRAY[...]) — covers Postgres's full form including
  // cast wrappers like `ANY ((ARRAY['A'::varchar, ...])::text[])` that
  // a regex can't reliably bracket-match.
  const anyValues = extractFromAnyArray(expression)
  if (anyValues) return anyValues

  // Pattern 2: IN ('val1', 'val2', ...) — also handles
  // ((col)::text IN (...)) wrappers and casts on each value.
  const inValues = extractFromInList(expression)
  if (inValues) return inValues

  // Pattern 3: OR chain like
  //   ((col)::text = 'a') OR ((col)::text = 'b') OR ...
  const orValues = extractFromOrChain(expression)
  if (orValues) return orValues

  return null
}

/**
 * Find an `ANY ( ... ARRAY[ ... ] ... )` span and pull out every quoted
 * literal inside the matching `[...]`. Tolerates arbitrary parens and
 * cast suffixes around the array, which Postgres routinely emits.
 */
function extractFromAnyArray(expression: string): string[] | null {
  const anyIdx = expression.search(/\bANY\b/i)
  if (anyIdx < 0) return null
  const arrayIdx = expression.toUpperCase().indexOf('ARRAY[', anyIdx)
  if (arrayIdx < 0) return null
  const bracketStart = expression.indexOf('[', arrayIdx)
  if (bracketStart < 0) return null
  const bracketEnd = findMatchingBracket(expression, bracketStart, '[', ']')
  if (bracketEnd < 0) return null
  const inner = expression.slice(bracketStart + 1, bracketEnd)
  return extractQuotedValues(inner)
}

/**
 * Find an `IN ( ... )` span — `\bIN\b` followed by an open paren — and
 * pull quoted literals out of the matching paren span. Only succeeds
 * when the span contains at least one quoted literal AND every
 * comma-separated chunk inside is a quoted literal (rejects ranges,
 * subqueries, and arithmetic, which would not be enum lists).
 */
function extractFromInList(expression: string): string[] | null {
  const re = /\bIN\s*\(/gi
  let match: RegExpExecArray | null
  while ((match = re.exec(expression)) !== null) {
    const open = expression.indexOf('(', match.index)
    if (open < 0) continue
    const close = findMatchingBracket(expression, open, '(', ')')
    if (close < 0) continue
    const inner = expression.slice(open + 1, close)
    const values = extractQuotedValues(inner)
    if (!values) continue
    if (!isPureQuotedList(inner, values.length)) continue
    return values
  }
  return null
}

/**
 * Detect `((col) = 'a' OR (col) = 'b' OR ...)` style chains. Splits
 * on top-level OR and checks each clause is a literal-equality.
 */
function extractFromOrChain(expression: string): string[] | null {
  const orParts = expression.split(/\bOR\b/i)
  if (orParts.length < 2) return null
  const values: string[] = []
  for (const part of orParts) {
    const m = part.match(/=\s*'([^']*)'/)
    if (m) values.push(m[1])
  }
  if (values.length === orParts.length && values.length >= 2) {
    return values
  }
  return null
}

function extractQuotedValues(str: string): string[] | null {
  // Postgres strings use '' for an embedded apostrophe.
  // Tokenize manually so we don't split a value with `''` inside.
  const out: string[] = []
  let i = 0
  while (i < str.length) {
    if (str[i] === "'") {
      let j = i + 1
      let buf = ''
      while (j < str.length) {
        if (str[j] === "'" && str[j + 1] === "'") {
          buf += "'"
          j += 2
          continue
        }
        if (str[j] === "'") break
        buf += str[j]
        j += 1
      }
      out.push(buf)
      i = j + 1
    } else {
      i += 1
    }
  }
  return out.length === 0 ? null : out
}

/**
 * For a span like `'a', 'b'::text, 'c'`, confirm that the only
 * non-whitespace, non-comma, non-cast tokens are exactly `count` quoted
 * literals. Rejects spans like `1, 2, 3` or `SELECT id FROM t`.
 */
function isPureQuotedList(inner: string, count: number): boolean {
  // Strip quoted literals (with '' escapes) first, then check leftovers.
  let stripped = ''
  let i = 0
  let stripped_count = 0
  while (i < inner.length) {
    if (inner[i] === "'") {
      let j = i + 1
      while (j < inner.length) {
        if (inner[j] === "'" && inner[j + 1] === "'") {
          j += 2
          continue
        }
        if (inner[j] === "'") break
        j += 1
      }
      stripped_count += 1
      i = j + 1
    } else {
      stripped += inner[i]
      i += 1
    }
  }
  if (stripped_count !== count) return false
  // What remains should only be commas, whitespace, and cast suffixes
  // like `::text` or `::character varying`.
  const leftovers = stripped.replace(/::\s*[\w\s]+/g, '').replace(/[,\s]+/g, '')
  return leftovers.length === 0
}

function findMatchingBracket(s: string, startIdx: number, open: string, close: string): number {
  let depth = 0
  let inString = false
  for (let i = startIdx; i < s.length; i++) {
    const ch = s[i]
    if (ch === "'") {
      // Toggle on single quote, but skip escaped doubles ('').
      if (inString && s[i + 1] === "'") {
        i++
        continue
      }
      inString = !inString
      continue
    }
    if (inString) continue
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return i
    }
  }
  return -1
}
