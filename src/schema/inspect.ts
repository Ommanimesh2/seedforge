import type { DatabaseSchema, TableDef } from '../types/schema.js'
import { FKAction } from '../types/schema.js'
import { buildInsertPlan } from '../graph/plan.js'

export interface InspectColumn {
  name: string
  type: string
  nullable: boolean
  isPrimaryKey: boolean
  isUnique: boolean
  isForeignKey: boolean
  isEnum: boolean
  hasDefault: boolean
  defaultValue: string | null
  enumValues: string[] | null
  maxLength: number | null
  numericPrecision: number | null
  numericScale: number | null
  comment: string | null
}

export interface InspectForeignKey {
  name: string
  columns: string[]
  references: {
    schema: string
    table: string
    columns: string[]
  }
  onDelete: FKAction
  onUpdate: FKAction
  isVirtual: boolean
}

export interface InspectUniqueConstraint {
  name: string | null
  columns: string[]
}

export interface InspectCheckConstraint {
  name: string | null
  expression: string
  inferredValues: string[] | null
}

export type InspectCompatibility = 'ok' | 'risky' | 'blocked'

export interface InspectCompatibilityReason {
  /** Stable code consumers can switch on, e.g. `MISSING_PK`, `UNKNOWN_TYPE`. */
  code: string
  /** Human-readable explanation. */
  message: string
  /** Column name if the reason is column-scoped. */
  column?: string
}

export interface InspectTable {
  name: string
  schema: string
  orderIndex: number | null
  columns: InspectColumn[]
  primaryKey: string[] | null
  uniqueConstraints: InspectUniqueConstraint[]
  checkConstraints: InspectCheckConstraint[]
  foreignKeys: InspectForeignKey[]
  incomingFKCount: number
  outgoingFKCount: number
  notes: string[]
  /**
   * Compatibility verdict for this table at the current count of rows.
   *   - `ok`      → seedforge will produce realistic, valid rows.
   *   - `risky`   → seedforge can generate, but some columns may be low
   *                 fidelity (unknown types, free text without constraints).
   *   - `blocked` → seedforge cannot safely generate (no PK, missing
   *                 generator for a NOT NULL column, etc.).
   */
  compatibility: InspectCompatibility
  /** Concrete reasons for the compatibility verdict. */
  compatibilityReasons: InspectCompatibilityReason[]
}

export interface InspectEnum {
  name: string
  schema: string
  values: string[]
}

export interface InspectDeferredEdge {
  from: string
  to: string
  columns: string[]
  reason: 'cycle' | 'self-reference'
}

export interface InspectReport {
  tables: InspectTable[]
  enums: InspectEnum[]
  insertOrder: string[]
  selfReferencing: string[]
  deferredEdges: InspectDeferredEdge[]
  warnings: string[]
  summary: {
    tableCount: number
    columnCount: number
    foreignKeyCount: number
    uniqueConstraintCount: number
    checkConstraintCount: number
    enumCount: number
    compatibility: { ok: number; risky: number; blocked: number }
  }
}

function qualifiedName(table: TableDef): string {
  return `${table.schema}.${table.name}`
}

/**
 * Classify a table's compatibility with seedforge's defaults. The
 * verdict is conservative — anything we can't reason about positively
 * gets "risky" so the user sees it before generation runs.
 */
function classifyCompatibility(table: TableDef): {
  compatibility: InspectCompatibility
  reasons: InspectCompatibilityReason[]
} {
  const reasons: InspectCompatibilityReason[] = []
  let blocked = false
  let risky = false

  // BLOCKER: no primary key. Generator can't INSERT predictably.
  if (!table.primaryKey || table.primaryKey.columns.length === 0) {
    reasons.push({
      code: 'MISSING_PRIMARY_KEY',
      message: 'no primary key — seedforge cannot generate rows safely',
    })
    blocked = true
  }

  for (const [name, col] of table.columns) {
    // BLOCKER: NOT NULL column with type seedforge doesn't recognize and
    // no default. We can't fill it.
    if (col.dataType === 'UNKNOWN' && !col.isNullable && !col.hasDefault && !col.isAutoIncrement) {
      reasons.push({
        code: 'UNGENERATABLE_COLUMN',
        column: name,
        message: `NOT NULL column with unknown type "${col.nativeType}" and no default`,
      })
      blocked = true
      continue
    }

    // RISKY: unknown type but column is nullable or has a default — we
    // can fall through but the values may not match the user's intent.
    if (col.dataType === 'UNKNOWN') {
      reasons.push({
        code: 'UNKNOWN_TYPE',
        column: name,
        message: `column type "${col.nativeType}" not recognized — values may be low fidelity`,
      })
      risky = true
      continue
    }

    // RISKY: free-text (TEXT/VARCHAR) with no length cap, no enum, no
    // CHECK constraint — generator falls back to faker.lorem which is
    // valid-shaped but not domain-specific.
    if (
      (col.dataType === 'TEXT' || col.dataType === 'VARCHAR') &&
      !col.isNullable &&
      col.enumValues === null
    ) {
      const isCovered =
        looksLikeNamedColumn(name) || (col.maxLength !== null && col.maxLength <= 32)
      if (!isCovered) {
        reasons.push({
          code: 'UNCONSTRAINED_TEXT',
          column: name,
          message: 'free-text column without enum/check; generator falls back to lorem',
        })
        risky = true
      }
    }
  }

  if (blocked) return { compatibility: 'blocked', reasons }
  if (risky) return { compatibility: 'risky', reasons }
  return { compatibility: 'ok', reasons }
}

/**
 * Heuristic: column names that the mapper has good generators for
 * (`email`, `name`, `phone`, `url`, …) shouldn't be flagged as risky
 * just because the type is free-text.
 */
function looksLikeNamedColumn(name: string): boolean {
  const lower = name.toLowerCase()
  return /(^|_)(email|name|first_name|last_name|phone|url|website|address|city|state|country|zip|postal|company|title|description|slug|username|user|handle|domain|category|tag|label|sku|isbn|currency|locale|language|timezone)($|_)/.test(
    lower,
  )
}

function buildColumn(col: import('../types/schema.js').ColumnDef, table: TableDef): InspectColumn {
  const isPK = table.primaryKey?.columns.includes(col.name) ?? false
  const isUnique = table.uniqueConstraints.some(
    (u) => u.columns.length === 1 && u.columns[0] === col.name,
  )
  const isFK = table.foreignKeys.some((fk) => fk.columns.includes(col.name))
  const isEnum = col.dataType === 'ENUM' || (col.enumValues !== null && col.enumValues.length > 0)

  return {
    name: col.name,
    type: col.nativeType || col.dataType,
    nullable: col.isNullable,
    isPrimaryKey: isPK,
    isUnique,
    isForeignKey: isFK,
    isEnum,
    hasDefault: col.hasDefault,
    defaultValue: col.defaultValue,
    enumValues: col.enumValues,
    maxLength: col.maxLength,
    numericPrecision: col.numericPrecision,
    numericScale: col.numericScale,
    comment: col.comment,
  }
}

/**
 * Produce a structured, read-only description of what seedforge sees in a
 * DatabaseSchema: columns, constraints, relationships, and generation order.
 *
 * This is the data source for both the CLI `--inspect` flag and the browser
 * playground "detected schema" panel. It never mutates the input schema.
 */
export function inspectSchema(schema: DatabaseSchema): InspectReport {
  const plan = buildInsertPlan(schema)
  const orderIndex = new Map<string, number>()
  plan.ordered.forEach((key, i) => orderIndex.set(key, i))

  // Count incoming FKs per target table, keyed by qualified name.
  const incomingByTable = new Map<string, number>()
  for (const [, table] of schema.tables) {
    for (const fk of table.foreignKeys) {
      const target = `${fk.referencedSchema}.${fk.referencedTable}`
      incomingByTable.set(target, (incomingByTable.get(target) ?? 0) + 1)
    }
  }

  const deferredEdges: InspectDeferredEdge[] = plan.deferredEdges.map((edge) => ({
    from: edge.from,
    to: edge.to,
    columns: edge.fk.columns,
    reason: 'cycle' as const,
  }))

  const selfRefSet = new Set(plan.selfRefTables)

  const tables: InspectTable[] = []
  let totalColumns = 0
  let totalFKs = 0
  let totalUnique = 0
  let totalCheck = 0

  for (const [, table] of schema.tables) {
    const columns: InspectColumn[] = []
    for (const [, col] of table.columns) {
      columns.push(buildColumn(col, table))
    }

    const qname = qualifiedName(table)
    const notes: string[] = []
    if (selfRefSet.has(qname)) {
      notes.push('Self-referencing: will INSERT with NULL then UPDATE')
    }
    const deferredForThis = plan.deferredEdges.filter((e) => e.from === qname)
    if (deferredForThis.length > 0) {
      const cols = deferredForThis.flatMap((e) => e.fk.columns).join(', ')
      notes.push(`Part of FK cycle — deferred columns: ${cols}`)
    }

    const outgoing = table.foreignKeys.length
    const incoming = incomingByTable.get(qname) ?? 0

    const { compatibility, reasons: compatibilityReasons } = classifyCompatibility(table)

    tables.push({
      name: table.name,
      schema: table.schema,
      orderIndex: orderIndex.get(qname) ?? null,
      columns,
      primaryKey: table.primaryKey?.columns ?? null,
      uniqueConstraints: table.uniqueConstraints.map((u) => ({
        name: u.name,
        columns: u.columns,
      })),
      checkConstraints: table.checkConstraints.map((c) => ({
        name: c.name,
        expression: c.expression,
        inferredValues: c.inferredValues,
      })),
      foreignKeys: table.foreignKeys.map((fk) => ({
        name: fk.name,
        columns: fk.columns,
        references: {
          schema: fk.referencedSchema,
          table: fk.referencedTable,
          columns: fk.referencedColumns,
        },
        onDelete: fk.onDelete,
        onUpdate: fk.onUpdate,
        isVirtual: fk.isVirtual,
      })),
      incomingFKCount: incoming,
      outgoingFKCount: outgoing,
      notes,
      compatibility,
      compatibilityReasons,
    })

    totalColumns += table.columns.size
    totalFKs += table.foreignKeys.length
    totalUnique += table.uniqueConstraints.length
    totalCheck += table.checkConstraints.length
  }

  // Sort tables by their position in the insert plan for stable display
  tables.sort((a, b) => {
    const ai = a.orderIndex ?? Number.MAX_SAFE_INTEGER
    const bi = b.orderIndex ?? Number.MAX_SAFE_INTEGER
    if (ai !== bi) return ai - bi
    return a.name.localeCompare(b.name)
  })

  const enums: InspectEnum[] = []
  for (const [, e] of schema.enums) {
    enums.push({ name: e.name, schema: e.schema, values: e.values })
  }
  enums.sort((a, b) => a.name.localeCompare(b.name))

  return {
    tables,
    enums,
    insertOrder: plan.ordered,
    selfReferencing: plan.selfRefTables,
    deferredEdges,
    warnings: plan.warnings,
    summary: {
      tableCount: schema.tables.size,
      columnCount: totalColumns,
      foreignKeyCount: totalFKs,
      uniqueConstraintCount: totalUnique,
      checkConstraintCount: totalCheck,
      enumCount: schema.enums.size,
      compatibility: {
        ok: tables.filter((t) => t.compatibility === 'ok').length,
        risky: tables.filter((t) => t.compatibility === 'risky').length,
        blocked: tables.filter((t) => t.compatibility === 'blocked').length,
      },
    },
  }
}

function padRight(str: string, width: number): string {
  if (str.length >= width) return str
  return str + ' '.repeat(width - str.length)
}

/**
 * Render an InspectReport as human-readable plain text for CLI output.
 */
export function formatInspectReport(report: InspectReport): string {
  const lines: string[] = []
  const s = report.summary
  lines.push('━━━ seedforge schema inspection ━━━')
  lines.push('')
  lines.push(
    `Summary: ${s.tableCount} tables · ${s.columnCount} columns · ${s.foreignKeyCount} FKs · ${s.uniqueConstraintCount} unique · ${s.checkConstraintCount} check · ${s.enumCount} enums`,
  )
  lines.push(
    `Compatibility: ${s.compatibility.ok} ok · ${s.compatibility.risky} risky · ${s.compatibility.blocked} blocked`,
  )
  lines.push('')

  // Compatibility report up front: developers want to know what will and
  // won't work before the rest of the schema dump.
  if (s.compatibility.blocked > 0 || s.compatibility.risky > 0) {
    lines.push('Compatibility report:')
    for (const t of report.tables) {
      if (t.compatibility === 'ok') continue
      const tag = t.compatibility === 'blocked' ? 'BLOCKED' : 'RISKY  '
      lines.push(`  [${tag}] ${t.schema}.${t.name}`)
      for (const r of t.compatibilityReasons) {
        const where = r.column ? `${r.column}: ` : ''
        lines.push(`           ${where}${r.message}`)
      }
    }
    lines.push('')
  }

  if (report.enums.length > 0) {
    lines.push('Enums:')
    for (const e of report.enums) {
      lines.push(`  ${e.schema}.${e.name} = (${e.values.join(', ')})`)
    }
    lines.push('')
  }

  lines.push('Insert order:')
  if (report.insertOrder.length === 0) {
    lines.push('  (empty)')
  } else {
    const pretty = report.insertOrder.join(' → ')
    lines.push(`  ${pretty}`)
  }
  lines.push('')

  if (report.deferredEdges.length > 0) {
    lines.push('Deferred edges (cycles broken):')
    for (const e of report.deferredEdges) {
      lines.push(`  ${e.from}.(${e.columns.join(', ')}) → ${e.to}`)
    }
    lines.push('')
  }

  if (report.selfReferencing.length > 0) {
    lines.push(`Self-referencing tables: ${report.selfReferencing.join(', ')}`)
    lines.push('')
  }

  lines.push('Tables:')
  for (const t of report.tables) {
    const idx = t.orderIndex !== null ? `#${t.orderIndex + 1}` : '  '
    lines.push('')
    lines.push(`${idx} ${t.schema}.${t.name}`)
    lines.push(`    columns:`)
    for (const c of t.columns) {
      const flags: string[] = []
      if (c.isPrimaryKey) flags.push('PK')
      if (c.isForeignKey) flags.push('FK')
      if (c.isUnique && !c.isPrimaryKey) flags.push('UNIQUE')
      if (!c.nullable) flags.push('NOT NULL')
      if (c.hasDefault) flags.push(`default=${c.defaultValue ?? 'NULL'}`)
      if (c.isEnum && c.enumValues) {
        flags.push(
          `enum(${c.enumValues.slice(0, 5).join('|')}${c.enumValues.length > 5 ? '…' : ''})`,
        )
      }
      const flagStr = flags.length > 0 ? `  [${flags.join(', ')}]` : ''
      lines.push(`      ${padRight(c.name, 24)} ${padRight(c.type, 18)}${flagStr}`)
    }
    if (t.foreignKeys.length > 0) {
      lines.push(`    foreign keys:`)
      for (const fk of t.foreignKeys) {
        const virt = fk.isVirtual ? ' (virtual)' : ''
        lines.push(
          `      (${fk.columns.join(', ')}) → ${fk.references.schema}.${fk.references.table}(${fk.references.columns.join(', ')}) onDelete=${fk.onDelete}${virt}`,
        )
      }
    }
    if (t.checkConstraints.length > 0) {
      lines.push(`    check constraints:`)
      for (const c of t.checkConstraints) {
        const inferred = c.inferredValues ? ` (inferred: ${c.inferredValues.join('|')})` : ''
        lines.push(`      ${c.expression}${inferred}`)
      }
    }
    if (t.uniqueConstraints.length > 0) {
      const composite = t.uniqueConstraints.filter((u) => u.columns.length > 1)
      if (composite.length > 0) {
        lines.push(`    composite unique:`)
        for (const u of composite) {
          lines.push(`      (${u.columns.join(', ')})`)
        }
      }
    }
    if (t.notes.length > 0) {
      for (const note of t.notes) {
        lines.push(`    note: ${note}`)
      }
    }
    lines.push(
      `    relationships: ${t.outgoingFKCount} outgoing FK · ${t.incomingFKCount} incoming FK`,
    )
  }

  return lines.join('\n')
}
