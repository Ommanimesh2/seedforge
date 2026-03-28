import { readFileSync } from 'node:fs'
import type {
  DatabaseSchema,
  TableDef,
  ColumnDef,
  ForeignKeyDef,
  EnumDef,
  PrimaryKeyDef,
  UniqueConstraintDef,
} from '../../types/schema.js'
import { NormalizedType, FKAction } from '../../types/schema.js'
import { SeedForgeError } from '../../errors/index.js'

// ---------------------------------------------------------------------------
// Error class
// ---------------------------------------------------------------------------

export class PrismaParseError extends SeedForgeError {
  constructor(
    message: string,
    hints: string[] = [],
    context: Record<string, unknown> = {},
  ) {
    super('SF7001', message, hints, context)
    this.name = 'PrismaParseError'
  }
}

// ---------------------------------------------------------------------------
// Types local to the parser
// ---------------------------------------------------------------------------

interface PrismaField {
  name: string
  type: string
  isList: boolean
  isOptional: boolean
  attributes: PrismaAttribute[]
}

interface PrismaAttribute {
  name: string // e.g. "id", "default", "relation", "map", "unique"
  args: string // raw args string inside parentheses (empty string if none)
}

interface PrismaModel {
  /** Name as it appears after the `model` keyword */
  name: string
  /** Database table name (from @@map or camelCase->snake_case if not provided) */
  tableName: string
  fields: PrismaField[]
  /** Block-level attributes (@@id, @@unique, @@map, @@index) */
  blockAttributes: PrismaAttribute[]
}

interface PrismaEnum {
  name: string
  values: string[]
  /** From @@map if present */
  dbName: string | null
}

// ---------------------------------------------------------------------------
// Prisma type -> NormalizedType mapping
// ---------------------------------------------------------------------------

const PRISMA_TYPE_MAP: Record<string, NormalizedType> = {
  String: NormalizedType.TEXT,
  Int: NormalizedType.INTEGER,
  BigInt: NormalizedType.BIGINT,
  Float: NormalizedType.DOUBLE,
  Decimal: NormalizedType.DECIMAL,
  Boolean: NormalizedType.BOOLEAN,
  DateTime: NormalizedType.TIMESTAMPTZ,
  Json: NormalizedType.JSON,
  Bytes: NormalizedType.BYTEA,
}

// ---------------------------------------------------------------------------
// Attribute parsing helpers
// ---------------------------------------------------------------------------

function parseAttributes(raw: string): PrismaAttribute[] {
  const attrs: PrismaAttribute[] = []
  // Match @name — but NOT @@ (block-level)
  const attrStartRegex = /(?<!\w)@(?!@)(\w+)/g
  let m: RegExpExecArray | null
  while ((m = attrStartRegex.exec(raw)) !== null) {
    const name = m[1]
    const afterName = m.index + m[0].length
    if (afterName < raw.length && raw[afterName] === '(') {
      // Extract balanced parentheses content
      const args = extractBalancedParens(raw, afterName)
      attrs.push({ name, args })
      // Advance past the closing paren
      attrStartRegex.lastIndex = afterName + args.length + 2 // +2 for ( and )
    } else {
      attrs.push({ name, args: '' })
    }
  }
  return attrs
}

/**
 * Extract content between balanced parentheses starting at `raw[start]` which must be '('.
 * Returns the inner content (without the outer parens).
 */
function extractBalancedParens(raw: string, start: number): string {
  let depth = 0
  let i = start
  while (i < raw.length) {
    if (raw[i] === '(') depth++
    else if (raw[i] === ')') {
      depth--
      if (depth === 0) {
        return raw.slice(start + 1, i)
      }
    }
    i++
  }
  // Unbalanced — return whatever we got
  return raw.slice(start + 1)
}

function parseBlockAttributes(raw: string): PrismaAttribute[] {
  const attrs: PrismaAttribute[] = []
  const attrStartRegex = /@@(\w+)/g
  let m: RegExpExecArray | null
  while ((m = attrStartRegex.exec(raw)) !== null) {
    const name = m[1]
    const afterName = m.index + m[0].length
    if (afterName < raw.length && raw[afterName] === '(') {
      const args = extractBalancedParens(raw, afterName)
      attrs.push({ name, args })
      attrStartRegex.lastIndex = afterName + args.length + 2
    } else {
      attrs.push({ name, args: '' })
    }
  }
  return attrs
}

/**
 * Extract the string value from a @map("name") or @@map("name") attribute.
 */
function extractMapName(attrs: PrismaAttribute[]): string | null {
  const mapAttr = attrs.find((a) => a.name === 'map')
  if (!mapAttr) return null
  const m = mapAttr.args.match(/^"([^"]+)"$/)
  return m ? m[1] : null
}

/**
 * Extract column names from @@id([col1, col2]) or @@unique([col1, col2]).
 */
function extractColumnList(args: string): string[] {
  const m = args.match(/\[([^\]]+)\]/)
  if (!m) return []
  return m[1].split(',').map((s) => s.trim())
}

// ---------------------------------------------------------------------------
// Block extraction: models and enums
// ---------------------------------------------------------------------------

interface RawBlock {
  kind: 'model' | 'enum'
  name: string
  body: string
}

function extractBlocks(source: string): RawBlock[] {
  const blocks: RawBlock[] = []
  // Strip single-line comments and multi-line comments
  const stripped = source
    .replace(/\/\/[^\n]*/g, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')

  const blockRegex = /\b(model|enum)\s+(\w+)\s*\{/g
  let m: RegExpExecArray | null
  while ((m = blockRegex.exec(stripped)) !== null) {
    const kind = m[1] as 'model' | 'enum'
    const name = m[2]
    const startBrace = m.index + m[0].length - 1
    // Find matching closing brace
    let depth = 1
    let i = startBrace + 1
    while (i < stripped.length && depth > 0) {
      if (stripped[i] === '{') depth++
      else if (stripped[i] === '}') depth--
      i++
    }
    const body = stripped.slice(startBrace + 1, i - 1)
    blocks.push({ kind, name, body })
  }
  return blocks
}

// ---------------------------------------------------------------------------
// Enum parser
// ---------------------------------------------------------------------------

function parseEnumBlock(block: RawBlock): PrismaEnum {
  const lines = block.body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  const values: string[] = []
  let dbName: string | null = null

  for (const line of lines) {
    if (line.startsWith('@@map')) {
      const m = line.match(/@@map\("([^"]+)"\)/)
      if (m) dbName = m[1]
      continue
    }
    // Enum values are just identifiers (possibly with @map)
    const valMatch = line.match(/^(\w+)/)
    if (valMatch) {
      values.push(valMatch[1])
    }
  }

  return { name: block.name, values, dbName }
}

// ---------------------------------------------------------------------------
// Model parser
// ---------------------------------------------------------------------------

function parseModelBlock(block: RawBlock): PrismaModel {
  const lines = block.body
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.length > 0)

  const fields: PrismaField[] = []
  const blockAttrs: PrismaAttribute[] = []

  for (const line of lines) {
    // Block-level attributes: @@id, @@unique, @@map, @@index
    if (line.startsWith('@@')) {
      blockAttrs.push(...parseBlockAttributes(line))
      continue
    }

    // Field line: name Type? @attr1 @attr2(...)
    const fieldMatch = line.match(/^(\w+)\s+(\w+)(\[\])?\s*(\?)?\s*(.*)$/)
    if (!fieldMatch) continue

    const [, fieldName, fieldType, listMarker, optionalMarker, rest] = fieldMatch
    const isList = !!listMarker
    const isOptional = !!optionalMarker

    const attributes = parseAttributes(rest)

    fields.push({
      name: fieldName,
      type: fieldType,
      isList,
      isOptional,
      attributes,
    })
  }

  // Determine table name from @@map or use model name as-is
  const mapName = extractMapName(blockAttrs)
  const tableName = mapName ?? block.name

  return {
    name: block.name,
    tableName,
    fields,
    blockAttributes: blockAttrs,
  }
}

// ---------------------------------------------------------------------------
// Relation extraction
// ---------------------------------------------------------------------------

interface RelationInfo {
  /** The scalar FK column names on the owning model (fields: [...]) */
  columns: string[]
  /** The referenced columns on the related model (references: [...]) */
  referencedColumns: string[]
  /** The related model name (from the field type) */
  relatedModelName: string
  /** onDelete action */
  onDelete: FKAction
  /** onUpdate action */
  onUpdate: FKAction
}

function parseFKAction(raw: string): FKAction {
  switch (raw) {
    case 'Cascade':
      return FKAction.CASCADE
    case 'SetNull':
      return FKAction.SET_NULL
    case 'SetDefault':
      return FKAction.SET_DEFAULT
    case 'Restrict':
      return FKAction.RESTRICT
    case 'NoAction':
      return FKAction.NO_ACTION
    default:
      return FKAction.NO_ACTION
  }
}

function extractRelations(model: PrismaModel): RelationInfo[] {
  const relations: RelationInfo[] = []

  for (const field of model.fields) {
    const relAttr = field.attributes.find((a) => a.name === 'relation')
    if (!relAttr) continue

    // Only process relation fields that have `fields:` (i.e., the owning side)
    const fieldsMatch = relAttr.args.match(/fields:\s*\[([^\]]+)\]/)
    if (!fieldsMatch) continue

    const refsMatch = relAttr.args.match(/references:\s*\[([^\]]+)\]/)
    if (!refsMatch) continue

    const columns = fieldsMatch[1].split(',').map((s) => s.trim())
    const referencedColumns = refsMatch[1].split(',').map((s) => s.trim())

    // onDelete
    const onDeleteMatch = relAttr.args.match(/onDelete:\s*(\w+)/)
    const onDelete = onDeleteMatch ? parseFKAction(onDeleteMatch[1]) : FKAction.NO_ACTION

    // onUpdate
    const onUpdateMatch = relAttr.args.match(/onUpdate:\s*(\w+)/)
    const onUpdate = onUpdateMatch ? parseFKAction(onUpdateMatch[1]) : FKAction.NO_ACTION

    relations.push({
      columns,
      referencedColumns,
      relatedModelName: field.type,
      onDelete,
      onUpdate,
    })
  }

  return relations
}

// ---------------------------------------------------------------------------
// Detect implicit many-to-many relations
// ---------------------------------------------------------------------------

interface ImplicitM2M {
  /** Join table name: _ModelAToModelB (sorted alphabetically) */
  joinTableName: string
  modelA: string
  modelB: string
}

function detectImplicitM2M(models: PrismaModel[]): ImplicitM2M[] {
  const m2ms: ImplicitM2M[] = []
  const seen = new Set<string>()

  for (const model of models) {
    for (const field of model.fields) {
      if (!field.isList) continue
      // Must reference another model, not a scalar
      const relatedModel = models.find((m) => m.name === field.type)
      if (!relatedModel) continue

      // Must NOT have a @relation with fields: (that's explicit)
      const relAttr = field.attributes.find((a) => a.name === 'relation')
      if (relAttr && relAttr.args.includes('fields:')) continue

      // Check the other side has a list field back
      const otherSide = relatedModel.fields.find(
        (f) => f.type === model.name && f.isList,
      )
      if (!otherSide) continue

      // Sort names alphabetically to deduplicate
      const sorted = [model.name, relatedModel.name].sort()
      const key = sorted.join(':')
      if (seen.has(key)) continue
      seen.add(key)

      m2ms.push({
        joinTableName: `_${sorted[0]}To${sorted[1]}`,
        modelA: sorted[0],
        modelB: sorted[1],
      })
    }
  }

  return m2ms
}

// ---------------------------------------------------------------------------
// Build join table for implicit M2M
// ---------------------------------------------------------------------------

function buildJoinTable(
  m2m: ImplicitM2M,
  modelMap: Map<string, PrismaModel>,
): TableDef {
  const colA: ColumnDef = {
    name: 'A',
    dataType: NormalizedType.INTEGER,
    nativeType: 'integer',
    isNullable: false,
    hasDefault: false,
    defaultValue: null,
    isAutoIncrement: false,
    isGenerated: false,
    maxLength: null,
    numericPrecision: null,
    numericScale: null,
    enumValues: null,
    comment: null,
  }

  const colB: ColumnDef = {
    name: 'B',
    dataType: NormalizedType.INTEGER,
    nativeType: 'integer',
    isNullable: false,
    hasDefault: false,
    defaultValue: null,
    isAutoIncrement: false,
    isGenerated: false,
    maxLength: null,
    numericPrecision: null,
    numericScale: null,
    enumValues: null,
    comment: null,
  }

  const modelA = modelMap.get(m2m.modelA)!
  const modelB = modelMap.get(m2m.modelB)!

  const fkA: ForeignKeyDef = {
    name: `${m2m.joinTableName}_A_fkey`,
    columns: ['A'],
    referencedTable: modelA.tableName,
    referencedSchema: 'public',
    referencedColumns: ['id'],
    onDelete: FKAction.CASCADE,
    onUpdate: FKAction.CASCADE,
    isDeferrable: false,
    isDeferred: false,
    isVirtual: false,
  }

  const fkB: ForeignKeyDef = {
    name: `${m2m.joinTableName}_B_fkey`,
    columns: ['B'],
    referencedTable: modelB.tableName,
    referencedSchema: 'public',
    referencedColumns: ['id'],
    onDelete: FKAction.CASCADE,
    onUpdate: FKAction.CASCADE,
    isDeferrable: false,
    isDeferred: false,
    isVirtual: false,
  }

  const columns = new Map<string, ColumnDef>()
  columns.set('A', colA)
  columns.set('B', colB)

  return {
    name: m2m.joinTableName,
    schema: 'public',
    columns,
    primaryKey: null,
    foreignKeys: [fkA, fkB],
    uniqueConstraints: [{ columns: ['A', 'B'], name: `${m2m.joinTableName}_AB_unique` }],
    checkConstraints: [],
    indexes: [
      { columns: ['A', 'B'], name: `${m2m.joinTableName}_AB_unique`, isUnique: true },
      { columns: ['B'], name: `${m2m.joinTableName}_B_index`, isUnique: false },
    ],
    comment: null,
  }
}

// ---------------------------------------------------------------------------
// Build TableDef from a PrismaModel
// ---------------------------------------------------------------------------

function isRelationField(field: PrismaField, models: PrismaModel[]): boolean {
  return models.some((m) => m.name === field.type)
}

function resolveColumnName(field: PrismaField): string {
  return extractMapName(field.attributes) ?? field.name
}

function resolveFieldType(
  field: PrismaField,
  enumMap: Map<string, PrismaEnum>,
): { dataType: NormalizedType; nativeType: string; enumValues: string[] | null } {
  // Check if it's an enum type
  const prismaEnum = enumMap.get(field.type)
  if (prismaEnum) {
    return {
      dataType: NormalizedType.ENUM,
      nativeType: field.type,
      enumValues: prismaEnum.values,
    }
  }

  const mapped = PRISMA_TYPE_MAP[field.type]
  if (mapped) {
    return { dataType: mapped, nativeType: field.type, enumValues: null }
  }

  return { dataType: NormalizedType.UNKNOWN, nativeType: field.type, enumValues: null }
}

function fieldHasDefault(field: PrismaField): {
  hasDefault: boolean
  defaultValue: string | null
  isAutoIncrement: boolean
  isUUID: boolean
} {
  const defAttr = field.attributes.find((a) => a.name === 'default')
  const updatedAt = field.attributes.find((a) => a.name === 'updatedAt')

  if (updatedAt) {
    return { hasDefault: true, defaultValue: null, isAutoIncrement: false, isUUID: false }
  }

  if (!defAttr) {
    return { hasDefault: false, defaultValue: null, isAutoIncrement: false, isUUID: false }
  }

  const args = defAttr.args.trim()

  if (args === 'autoincrement()') {
    return { hasDefault: true, defaultValue: null, isAutoIncrement: true, isUUID: false }
  }

  if (args === 'uuid()') {
    return { hasDefault: true, defaultValue: null, isAutoIncrement: false, isUUID: true }
  }

  if (args === 'now()') {
    return { hasDefault: true, defaultValue: 'now()', isAutoIncrement: false, isUUID: false }
  }

  if (args === 'cuid()') {
    return { hasDefault: true, defaultValue: null, isAutoIncrement: false, isUUID: false }
  }

  if (args === 'true' || args === 'false') {
    return { hasDefault: true, defaultValue: args, isAutoIncrement: false, isUUID: false }
  }

  // String literal: "value"
  const strMatch = args.match(/^"([^"]*)"$/)
  if (strMatch) {
    return { hasDefault: true, defaultValue: strMatch[1], isAutoIncrement: false, isUUID: false }
  }

  // Numeric literal
  if (/^-?\d+(\.\d+)?$/.test(args)) {
    return { hasDefault: true, defaultValue: args, isAutoIncrement: false, isUUID: false }
  }

  // dbgenerated() or other function
  return { hasDefault: true, defaultValue: args, isAutoIncrement: false, isUUID: false }
}

function buildTableDef(
  model: PrismaModel,
  models: PrismaModel[],
  enumMap: Map<string, PrismaEnum>,
  modelTableMap: Map<string, string>,
): TableDef {
  const columns = new Map<string, ColumnDef>()
  const foreignKeys: ForeignKeyDef[] = []
  const uniqueConstraints: UniqueConstraintDef[] = []
  let primaryKey: PrimaryKeyDef | null = null

  // Column-level field name -> DB column name resolution map
  const fieldToColumn = new Map<string, string>()

  // First pass: collect field name to DB column name mapping for all scalar fields
  for (const field of model.fields) {
    if (isRelationField(field, models) || field.isList) continue
    const colName = resolveColumnName(field)
    fieldToColumn.set(field.name, colName)
  }

  // Second pass: build columns and detect PKs/uniques
  const pkColumns: string[] = []

  for (const field of model.fields) {
    // Skip relation fields (they don't map to DB columns)
    if (isRelationField(field, models)) continue
    // Skip list fields (they are the "many" side of relations)
    if (field.isList) continue

    const colName = resolveColumnName(field)
    const { dataType: resolvedType, nativeType, enumValues } = resolveFieldType(field, enumMap)
    const { hasDefault, defaultValue, isAutoIncrement, isUUID } = fieldHasDefault(field)

    // If @default(uuid()), override type to UUID
    let dataType = resolvedType
    if (isUUID && resolvedType === NormalizedType.TEXT) {
      dataType = NormalizedType.UUID
    }

    const col: ColumnDef = {
      name: colName,
      dataType,
      nativeType,
      isNullable: field.isOptional,
      hasDefault,
      defaultValue,
      isAutoIncrement,
      isGenerated: false,
      maxLength: null,
      numericPrecision: null,
      numericScale: null,
      enumValues,
      comment: null,
    }

    columns.set(colName, col)

    // @id -> primary key
    if (field.attributes.some((a) => a.name === 'id')) {
      pkColumns.push(colName)
    }

    // @unique -> unique constraint
    if (field.attributes.some((a) => a.name === 'unique')) {
      uniqueConstraints.push({
        columns: [colName],
        name: `${model.tableName}_${colName}_key`,
      })
    }
  }

  // Single-column PK from @id on a field
  if (pkColumns.length > 0) {
    primaryKey = { columns: pkColumns, name: `${model.tableName}_pkey` }
  }

  // Block-level @@id for composite PKs
  const compositeIdAttr = model.blockAttributes.find((a) => a.name === 'id')
  if (compositeIdAttr) {
    const fieldNames = extractColumnList(compositeIdAttr.args)
    const colNames = fieldNames.map((f) => fieldToColumn.get(f) ?? f)
    primaryKey = { columns: colNames, name: `${model.tableName}_pkey` }
  }

  // Block-level @@unique
  const compositeUniqueAttrs = model.blockAttributes.filter((a) => a.name === 'unique')
  for (const attr of compositeUniqueAttrs) {
    const fieldNames = extractColumnList(attr.args)
    const colNames = fieldNames.map((f) => fieldToColumn.get(f) ?? f)
    uniqueConstraints.push({
      columns: colNames,
      name: `${model.tableName}_${colNames.join('_')}_key`,
    })
  }

  // Extract relations
  const relations = extractRelations(model)
  for (const rel of relations) {
    // Resolve FK column names (from field names to DB column names)
    const fkColumns = rel.columns.map((f) => fieldToColumn.get(f) ?? f)
    // Resolve referenced table name from the model name
    const refTableName = modelTableMap.get(rel.relatedModelName) ?? rel.relatedModelName

    foreignKeys.push({
      name: `${model.tableName}_${fkColumns.join('_')}_fkey`,
      columns: fkColumns,
      referencedTable: refTableName,
      referencedSchema: 'public',
      referencedColumns: rel.referencedColumns,
      onDelete: rel.onDelete,
      onUpdate: rel.onUpdate,
      isDeferrable: false,
      isDeferred: false,
      isVirtual: false,
    })
  }

  return {
    name: model.tableName,
    schema: 'public',
    columns,
    primaryKey,
    foreignKeys,
    uniqueConstraints,
    checkConstraints: [],
    indexes: [],
    comment: null,
  }
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse a Prisma schema string into a DatabaseSchema.
 *
 * This parser handles:
 * - model blocks with field types and attributes
 * - @@map / @map for table/column name overrides
 * - @id, @@id for primary keys (including composite)
 * - @unique, @@unique for unique constraints
 * - @default with autoincrement(), uuid(), now(), literals
 * - @relation for foreign keys with onDelete/onUpdate
 * - enum blocks
 * - implicit many-to-many join tables
 *
 * No external Prisma dependencies are used; parsing is done entirely
 * with regex and string processing.
 */
export function parsePrismaSchema(source: string): DatabaseSchema {
  const blocks = extractBlocks(source)

  // Parse enums
  const prismaEnums: PrismaEnum[] = []
  const enumMap = new Map<string, PrismaEnum>()
  for (const block of blocks) {
    if (block.kind === 'enum') {
      const pe = parseEnumBlock(block)
      prismaEnums.push(pe)
      enumMap.set(pe.name, pe)
    }
  }

  // Parse models
  const prismaModels: PrismaModel[] = []
  for (const block of blocks) {
    if (block.kind === 'model') {
      prismaModels.push(parseModelBlock(block))
    }
  }

  // Build model name -> table name mapping
  const modelTableMap = new Map<string, string>()
  const modelMap = new Map<string, PrismaModel>()
  for (const model of prismaModels) {
    modelTableMap.set(model.name, model.tableName)
    modelMap.set(model.name, model)
  }

  // Build DatabaseSchema
  const tables = new Map<string, TableDef>()
  for (const model of prismaModels) {
    const table = buildTableDef(model, prismaModels, enumMap, modelTableMap)
    tables.set(table.name, table)
  }

  // Detect and build implicit M2M join tables
  const m2ms = detectImplicitM2M(prismaModels)
  for (const m2m of m2ms) {
    const joinTable = buildJoinTable(m2m, modelMap)
    tables.set(joinTable.name, joinTable)
  }

  // Build enum definitions
  const enums = new Map<string, EnumDef>()
  for (const pe of prismaEnums) {
    const dbName = pe.dbName ?? pe.name
    enums.set(dbName, {
      name: dbName,
      schema: 'public',
      values: pe.values,
    })
  }

  return {
    name: 'prisma',
    tables,
    enums,
    schemas: ['public'],
  }
}

/**
 * Parse a Prisma schema from a file path into a DatabaseSchema.
 *
 * Reads the file from disk then delegates to `parsePrismaSchema`.
 */
export function parsePrismaFile(filePath: string): DatabaseSchema {
  let content: string
  try {
    content = readFileSync(filePath, 'utf-8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new PrismaParseError(
      `Failed to read Prisma schema file: ${filePath}`,
      [
        'Check that the file exists and is readable',
        'Verify the path is correct',
      ],
      { path: filePath, detail: message },
    )
  }

  if (!content.trim()) {
    throw new PrismaParseError(
      `Prisma schema file is empty: ${filePath}`,
      ['Add model definitions to your schema.prisma file'],
      { path: filePath },
    )
  }

  return parsePrismaSchema(content)
}
