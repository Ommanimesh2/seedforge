/**
 * Drizzle ORM schema parser.
 *
 * Parses Drizzle schema TypeScript files into DatabaseSchema using
 * regex-based parsing (no TypeScript AST dependency).
 */

import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import {
  NormalizedType,
  FKAction,
  type ColumnDef,
  type PrimaryKeyDef,
  type ForeignKeyDef,
  type UniqueConstraintDef,
  type TableDef,
  type EnumDef,
  type DatabaseSchema,
} from '../../types/index.js'
import { SeedForgeError } from '../../errors/index.js'
import type {
  DrizzleDialect,
  ParsedColumn,
  ParsedEnum,
  ParsedTable,
  ParsedReference,
  DrizzleParseResult,
} from './types.js'
import { mapDrizzleType } from './type-map.js'

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class DrizzleParseError extends SeedForgeError {
  constructor(
    message: string,
    hints: string[] = [],
    context: Record<string, unknown> = {},
  ) {
    super('SF6001', message, hints, context)
    this.name = 'DrizzleParseError'
  }
}

// ---------------------------------------------------------------------------
// Dialect detection
// ---------------------------------------------------------------------------

const DIALECT_TABLE_FN: Record<string, DrizzleDialect> = {
  pgTable: 'pg',
  mysqlTable: 'mysql',
  sqliteTable: 'sqlite',
}

function detectDialect(source: string): DrizzleDialect {
  for (const [fn, dialect] of Object.entries(DIALECT_TABLE_FN)) {
    // Match usage like: pgTable( or import { pgTable }
    const pattern = new RegExp(`\\b${fn}\\b`)
    if (pattern.test(source)) {
      return dialect
    }
  }
  // Default to pg
  return 'pg'
}

// ---------------------------------------------------------------------------
// Enum parsing
// ---------------------------------------------------------------------------

function parseEnums(source: string): ParsedEnum[] {
  const enums: ParsedEnum[] = []

  // Match: export const someEnum = pgEnum('enum_name', ['val1', 'val2'])
  // Also handles mysqlEnum patterns, though they are typically inline
  const enumRegex = /export\s+const\s+(\w+)\s*=\s*(?:pg|mysql)?Enum\(\s*['"]([^'"]+)['"]\s*,\s*\[([^\]]*)\]\s*\)/g

  let match
  while ((match = enumRegex.exec(source)) !== null) {
    const variableName = match[1]
    const sqlName = match[2]
    const valuesStr = match[3]

    // Parse the values array
    const values: string[] = []
    const valueRegex = /['"]([^'"]*)['"]/g
    let valueMatch
    while ((valueMatch = valueRegex.exec(valuesStr)) !== null) {
      values.push(valueMatch[1])
    }

    enums.push({ variableName, sqlName, values })
  }

  return enums
}

// ---------------------------------------------------------------------------
// Table parsing
// ---------------------------------------------------------------------------

/**
 * Find balanced braces starting from a given position.
 * Returns the index after the closing brace.
 */
function findBalancedBrace(source: string, startIndex: number): number {
  let depth = 0
  let inString: string | null = null
  let escaped = false

  for (let i = startIndex; i < source.length; i++) {
    const ch = source[i]

    if (escaped) {
      escaped = false
      continue
    }

    if (ch === '\\') {
      escaped = true
      continue
    }

    if (inString) {
      if (ch === inString) {
        inString = null
      }
      continue
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      inString = ch
      continue
    }

    if (ch === '{') {
      depth++
    } else if (ch === '}') {
      depth--
      if (depth === 0) {
        return i + 1
      }
    }
  }

  return source.length
}

/**
 * Find balanced parentheses starting from a given position.
 * Returns the index after the closing paren.
 */
function findBalancedParen(source: string, startIndex: number): number {
  let depth = 0
  let inString: string | null = null
  let escaped = false

  for (let i = startIndex; i < source.length; i++) {
    const ch = source[i]

    if (escaped) {
      escaped = false
      continue
    }

    if (ch === '\\') {
      escaped = true
      continue
    }

    if (inString) {
      if (ch === inString) {
        inString = null
      }
      continue
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      inString = ch
      continue
    }

    if (ch === '(') {
      depth++
    } else if (ch === ')') {
      depth--
      if (depth === 0) {
        return i + 1
      }
    }
  }

  return source.length
}

function parseTables(source: string): ParsedTable[] {
  const tables: ParsedTable[] = []

  // Match: export const users = pgTable('users', {
  // Captures: variableName, dialectFn, sqlName, then we find the columns block
  const tableRegex = /export\s+const\s+(\w+)\s*=\s*(pgTable|mysqlTable|sqliteTable)\(\s*['"]([^'"]+)['"]\s*,\s*\{/g

  let match
  while ((match = tableRegex.exec(source)) !== null) {
    const variableName = match[1]
    const dialectFn = match[2]
    const sqlName = match[3]

    // Find the end of the columns object (balanced braces)
    const braceStart = match.index + match[0].length - 1 // position of '{'
    const braceEnd = findBalancedBrace(source, braceStart)
    const rawColumnsBlock = source.slice(braceStart, braceEnd)

    const columns = parseColumns(rawColumnsBlock)

    tables.push({
      variableName,
      sqlName,
      dialectFn,
      columns,
      rawColumnsBlock,
    })
  }

  return tables
}

// ---------------------------------------------------------------------------
// Column parsing
// ---------------------------------------------------------------------------

function parseColumns(columnsBlock: string): ParsedColumn[] {
  const columns: ParsedColumn[] = []

  // Remove outer braces
  const inner = columnsBlock.slice(1, -1)

  // Split by top-level commas. We need to be careful about nested parens/braces.
  const columnDefs = splitTopLevelCommas(inner)

  for (const rawDef of columnDefs) {
    const trimmed = rawDef.trim()
    if (!trimmed) continue

    // Match pattern: propertyName: drizzleType('columnName', ...).modifier1().modifier2()
    // The property name could be on its own line
    const colMatch = trimmed.match(/^(\w+)\s*:\s*(\w+)\s*\(/)
    if (!colMatch) continue

    const drizzleType = colMatch[2]

    // Find the full call expression (from the function call through all chained modifiers)
    const fnStart = trimmed.indexOf(drizzleType + '(')
    if (fnStart === -1) continue

    const afterPropName = trimmed.slice(fnStart)

    // Find the first paren call
    const parenStart = afterPropName.indexOf('(')
    const parenEnd = findBalancedParen(afterPropName, parenStart)
    const argsStr = afterPropName.slice(parenStart + 1, parenEnd - 1)

    // Extract column name from first argument (string literal)
    const nameMatch = argsStr.match(/^['"]([^'"]+)['"]/)
    const columnName = nameMatch ? nameMatch[1] : colMatch[1]

    // Extract options (second argument if it's an object literal)
    let options: string | null = null
    const optionsMatch = argsStr.match(/,\s*(\{[^}]*\})/)
    if (optionsMatch) {
      options = optionsMatch[1]
    }

    // Parse chained modifiers after the main call
    const afterCall = afterPropName.slice(parenEnd)
    const modifiers = parseModifiers(afterCall)

    columns.push({
      name: columnName,
      drizzleType,
      options,
      modifiers,
      raw: trimmed,
    })
  }

  return columns
}

/**
 * Split a string by top-level commas (respecting nesting of parens, braces, brackets).
 */
function splitTopLevelCommas(source: string): string[] {
  const parts: string[] = []
  let current = ''
  let depth = 0
  let inString: string | null = null
  let escaped = false

  for (let i = 0; i < source.length; i++) {
    const ch = source[i]

    if (escaped) {
      current += ch
      escaped = false
      continue
    }

    if (ch === '\\') {
      current += ch
      escaped = true
      continue
    }

    if (inString) {
      current += ch
      if (ch === inString) {
        inString = null
      }
      continue
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      inString = ch
      current += ch
      continue
    }

    if (ch === '(' || ch === '{' || ch === '[') {
      depth++
      current += ch
      continue
    }

    if (ch === ')' || ch === '}' || ch === ']') {
      depth--
      current += ch
      continue
    }

    if (ch === ',' && depth === 0) {
      parts.push(current)
      current = ''
      continue
    }

    current += ch
  }

  if (current.trim()) {
    parts.push(current)
  }

  return parts
}

/**
 * Parse chained method calls like .primaryKey().notNull().default('foo').references(...)
 */
function parseModifiers(chain: string): string[] {
  const modifiers: string[] = []

  // Match .methodName(...) or .$methodName(...) — $ is valid in JS identifiers
  const modRegex = /\.(\$?\w+)\s*\(/g
  let modMatch

  while ((modMatch = modRegex.exec(chain)) !== null) {
    const parenStart = modMatch.index + modMatch[0].length - 1
    const parenEnd = findBalancedParen(chain, parenStart)
    const fullModifier = chain.slice(modMatch.index, parenEnd)
    modifiers.push(fullModifier)
    modRegex.lastIndex = parenEnd
  }

  return modifiers
}

// ---------------------------------------------------------------------------
// References parsing
// ---------------------------------------------------------------------------

function parseReferences(
  tables: ParsedTable[],
): Map<string, ParsedReference[]> {
  const refs = new Map<string, ParsedReference[]>()

  for (const table of tables) {
    const tableRefs: ParsedReference[] = []

    for (const col of table.columns) {
      for (const modifier of col.modifiers) {
        if (!modifier.startsWith('.references(')) continue

        // Extract the references() argument: .references(() => table.column, { ... })
        const refContent = modifier.slice('.references('.length, -1)

        // Parse the arrow function: () => tableVar.columnName
        const arrowMatch = refContent.match(
          /\(\)\s*=>\s*(\w+)\.(\w+)/,
        )
        if (!arrowMatch) continue

        const referencedTableVar = arrowMatch[1]
        const referencedColumn = arrowMatch[2]

        // Parse onDelete / onUpdate from options
        let onDelete: string | null = null
        let onUpdate: string | null = null

        const onDeleteMatch = refContent.match(
          /onDelete\s*:\s*['"](\w+)['"]/,
        )
        if (onDeleteMatch) {
          onDelete = onDeleteMatch[1]
        }

        const onUpdateMatch = refContent.match(
          /onUpdate\s*:\s*['"](\w+)['"]/,
        )
        if (onUpdateMatch) {
          onUpdate = onUpdateMatch[1]
        }

        tableRefs.push({
          columnName: col.name,
          referencedTableVar,
          referencedColumn,
          onDelete,
          onUpdate,
        })
      }
    }

    if (tableRefs.length > 0) {
      refs.set(table.variableName, tableRefs)
    }
  }

  return refs
}

// ---------------------------------------------------------------------------
// FK action mapping
// ---------------------------------------------------------------------------

function mapFKAction(action: string | null): FKAction {
  if (!action) return FKAction.NO_ACTION

  switch (action.toLowerCase()) {
    case 'cascade':
      return FKAction.CASCADE
    case 'set null':
    case 'setnull':
    case 'set_null':
      return FKAction.SET_NULL
    case 'set default':
    case 'setdefault':
    case 'set_default':
      return FKAction.SET_DEFAULT
    case 'restrict':
      return FKAction.RESTRICT
    case 'no action':
    case 'noaction':
    case 'no_action':
      return FKAction.NO_ACTION
    default:
      return FKAction.NO_ACTION
  }
}

// ---------------------------------------------------------------------------
// High-level parse: source string -> DrizzleParseResult
// ---------------------------------------------------------------------------

function parseSource(source: string): DrizzleParseResult {
  const dialect = detectDialect(source)
  const enums = parseEnums(source)
  const tables = parseTables(source)
  const references = parseReferences(tables)

  const tableVarToSqlName = new Map<string, string>()
  for (const table of tables) {
    tableVarToSqlName.set(table.variableName, table.sqlName)
  }

  return { dialect, tables, enums, references, tableVarToSqlName }
}

// ---------------------------------------------------------------------------
// Convert DrizzleParseResult -> DatabaseSchema
// ---------------------------------------------------------------------------

function buildDatabaseSchema(
  parseResult: DrizzleParseResult,
  schemaName: string = 'public',
): DatabaseSchema {
  const { dialect, tables, enums, references, tableVarToSqlName } = parseResult

  // Build enums map
  const enumsMap = new Map<string, EnumDef>()
  // Map from JS variable name to enum def for column type resolution
  const enumVarMap = new Map<string, EnumDef>()
  for (const e of enums) {
    const enumDef: EnumDef = {
      name: e.sqlName,
      schema: schemaName,
      values: e.values,
    }
    enumsMap.set(e.sqlName, enumDef)
    enumVarMap.set(e.variableName, enumDef)
  }

  // Build tables map
  const tablesMap = new Map<string, TableDef>()

  for (const parsedTable of tables) {
    const columnsMap = new Map<string, ColumnDef>()
    const pkColumns: string[] = []
    const uniqueConstraints: UniqueConstraintDef[] = []
    const foreignKeys: ForeignKeyDef[] = []

    for (const col of parsedTable.columns) {
      const typeInfo = mapDrizzleType(col.drizzleType, dialect)

      // Check if this is an enum column (drizzleType matches an enum variable)
      const enumDef = enumVarMap.get(col.drizzleType)

      let dataType = typeInfo.type
      let nativeType = typeInfo.nativeType
      let enumValues: string[] | null = null
      const isAutoIncrement = typeInfo.isAutoIncrement ?? false

      if (enumDef) {
        dataType = NormalizedType.ENUM
        nativeType = enumDef.name
        enumValues = enumDef.values
      }

      // Parse modifiers
      let isNullable = true
      let hasDefault = false
      let defaultValue: string | null = null
      let isPrimaryKey = false
      let isUnique = false

      // Auto-increment types have implicit defaults and are not nullable
      if (isAutoIncrement) {
        hasDefault = true
        isNullable = false
      }

      for (const modifier of col.modifiers) {
        if (modifier === '.primaryKey()') {
          isPrimaryKey = true
          isNullable = false
        } else if (modifier === '.notNull()') {
          isNullable = false
        } else if (modifier === '.unique()') {
          isUnique = true
        } else if (modifier === '.defaultNow()') {
          hasDefault = true
          defaultValue = 'now()'
        } else if (modifier.startsWith('.default(')) {
          hasDefault = true
          // Extract default value
          const defContent = modifier.slice('.default('.length, -1).trim()
          defaultValue = defContent
        } else if (modifier.startsWith('.$defaultFn(') || modifier.startsWith('.$default(')) {
          hasDefault = true
          defaultValue = null
        }
      }

      if (isPrimaryKey) {
        pkColumns.push(col.name)
      }

      if (isUnique) {
        uniqueConstraints.push({
          columns: [col.name],
          name: null,
        })
      }

      // Extract length from options like { length: 255 }
      let maxLength: number | null = null
      if (col.options) {
        const lengthMatch = col.options.match(/length\s*:\s*(\d+)/)
        if (lengthMatch) {
          maxLength = parseInt(lengthMatch[1], 10)
        }
      }

      // Extract precision and scale from options like { precision: 10, scale: 2 }
      let numericPrecision: number | null = null
      let numericScale: number | null = null
      if (col.options) {
        const precisionMatch = col.options.match(/precision\s*:\s*(\d+)/)
        if (precisionMatch) {
          numericPrecision = parseInt(precisionMatch[1], 10)
        }
        const scaleMatch = col.options.match(/scale\s*:\s*(\d+)/)
        if (scaleMatch) {
          numericScale = parseInt(scaleMatch[1], 10)
        }
      }

      const columnDef: ColumnDef = {
        name: col.name,
        dataType,
        nativeType,
        isNullable,
        hasDefault,
        defaultValue,
        isAutoIncrement,
        isGenerated: false,
        maxLength,
        numericPrecision,
        numericScale,
        enumValues,
        comment: null,
      }

      columnsMap.set(col.name, columnDef)
    }

    // Build foreign keys from references
    const tableRefs = references.get(parsedTable.variableName) ?? []
    for (const ref of tableRefs) {
      const referencedSqlName =
        tableVarToSqlName.get(ref.referencedTableVar) ?? ref.referencedTableVar

      const fkDef: ForeignKeyDef = {
        name: `${parsedTable.sqlName}_${ref.columnName}_fkey`,
        columns: [ref.columnName],
        referencedTable: referencedSqlName,
        referencedSchema: schemaName,
        referencedColumns: [ref.referencedColumn],
        onDelete: mapFKAction(ref.onDelete),
        onUpdate: mapFKAction(ref.onUpdate),
        isDeferrable: false,
        isDeferred: false,
        isVirtual: false,
      }

      foreignKeys.push(fkDef)
    }

    const primaryKey: PrimaryKeyDef | null =
      pkColumns.length > 0 ? { columns: pkColumns, name: null } : null

    const tableDef: TableDef = {
      name: parsedTable.sqlName,
      schema: schemaName,
      columns: columnsMap,
      primaryKey,
      foreignKeys,
      uniqueConstraints,
      checkConstraints: [],
      indexes: [],
      comment: null,
    }

    tablesMap.set(parsedTable.sqlName, tableDef)
  }

  return {
    name: schemaName,
    tables: tablesMap,
    enums: enumsMap,
    schemas: [schemaName],
  }
}

// ---------------------------------------------------------------------------
// File I/O
// ---------------------------------------------------------------------------

/**
 * Read all TypeScript files in a directory (recursively) that contain
 * Drizzle table definitions.
 */
function collectSchemaFiles(inputPath: string): string[] {
  const resolved = resolve(inputPath)
  let stat
  try {
    stat = statSync(resolved)
  } catch {
    throw new DrizzleParseError(
      `Path does not exist: ${inputPath}`,
      ['Check the path is correct'],
      { path: inputPath },
    )
  }

  if (stat.isFile()) {
    return [resolved]
  }

  if (!stat.isDirectory()) {
    throw new DrizzleParseError(
      `Path is not a file or directory: ${inputPath}`,
      ['Provide a .ts file or a directory containing Drizzle schema files'],
      { path: inputPath },
    )
  }

  const files: string[] = []
  const entries = readdirSync(resolved)

  for (const entry of entries) {
    if (entry === 'node_modules' || entry === 'dist' || entry.startsWith('.')) {
      continue
    }

    const fullPath = join(resolved, entry)
    let entryStat
    try {
      entryStat = statSync(fullPath)
    } catch {
      continue
    }

    if (entryStat.isDirectory()) {
      files.push(...collectSchemaFiles(fullPath))
    } else if (
      (entry.endsWith('.ts') || entry.endsWith('.js')) &&
      !entry.endsWith('.test.ts') &&
      !entry.endsWith('.spec.ts') &&
      !entry.endsWith('.d.ts')
    ) {
      files.push(fullPath)
    }
  }

  return files
}

function readSchemaFile(filePath: string): string {
  try {
    return readFileSync(filePath, 'utf-8')
  } catch {
    throw new DrizzleParseError(
      `Cannot read file: ${filePath}`,
      ['Check that the file exists and is readable'],
      { path: filePath },
    )
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a Drizzle schema source string into a DatabaseSchema.
 */
export function parseDrizzleSchema(
  source: string,
  schemaName: string = 'public',
): DatabaseSchema {
  const parseResult = parseSource(source)
  return buildDatabaseSchema(parseResult, schemaName)
}

/**
 * Parse a Drizzle schema from a file or directory path into a DatabaseSchema.
 */
export function parseDrizzleFile(
  inputPath: string,
  schemaName: string = 'public',
): DatabaseSchema {
  const files = collectSchemaFiles(inputPath)

  if (files.length === 0) {
    throw new DrizzleParseError(
      `No schema files found at: ${inputPath}`,
      ['Check that the path contains .ts or .js files with Drizzle table definitions'],
      { path: inputPath },
    )
  }

  // Read and concatenate all files. This handles multi-file schemas where
  // enums/tables are split across files.
  const sources: string[] = []
  for (const file of files) {
    const content = readSchemaFile(file)
    // Only include files that look like they have Drizzle content
    if (
      /(?:pgTable|mysqlTable|sqliteTable|pgEnum)\s*\(/.test(content)
    ) {
      sources.push(content)
    }
  }

  if (sources.length === 0) {
    throw new DrizzleParseError(
      `No Drizzle schema definitions found in: ${inputPath}`,
      [
        'Files must contain pgTable(), mysqlTable(), or sqliteTable() calls',
        'Make sure your Drizzle schema exports use these functions',
      ],
      { path: inputPath },
    )
  }

  const combinedSource = sources.join('\n\n')
  return parseDrizzleSchema(combinedSource, schemaName)
}

// Re-export types
export type { DrizzleDialect, DrizzleParseResult } from './types.js'
