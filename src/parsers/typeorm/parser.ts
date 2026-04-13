import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, resolve } from 'node:path'
import type {
  DatabaseSchema,
  TableDef,
  ColumnDef,
  ForeignKeyDef,
  PrimaryKeyDef,
  UniqueConstraintDef,
  EnumDef,
} from '../../types/schema.js'
import { NormalizedType, FKAction } from '../../types/schema.js'

// ─── Helpers ────────────────────────────────────────────────────────────────

function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z])/g, '_$1')
    .replace(/^_/, '')
    .toLowerCase()
}

function parseFKAction(raw: string | undefined): FKAction {
  if (!raw) return FKAction.NO_ACTION
  const upper = raw.toUpperCase().replace(/['"]/g, '').trim()
  switch (upper) {
    case 'CASCADE':
      return FKAction.CASCADE
    case 'SET NULL':
      return FKAction.SET_NULL
    case 'SET DEFAULT':
      return FKAction.SET_DEFAULT
    case 'RESTRICT':
      return FKAction.RESTRICT
    default:
      return FKAction.NO_ACTION
  }
}

function typeormTypeToNormalized(typeStr: string): NormalizedType {
  const t = typeStr.toLowerCase().replace(/['"]/g, '').trim()
  switch (t) {
    case 'varchar':
    case 'character varying':
      return NormalizedType.VARCHAR
    case 'char':
    case 'character':
      return NormalizedType.CHAR
    case 'text':
      return NormalizedType.TEXT
    case 'int':
    case 'integer':
    case 'int4':
      return NormalizedType.INTEGER
    case 'smallint':
    case 'int2':
      return NormalizedType.SMALLINT
    case 'bigint':
    case 'int8':
      return NormalizedType.BIGINT
    case 'real':
    case 'float4':
      return NormalizedType.REAL
    case 'double precision':
    case 'float':
    case 'float8':
      return NormalizedType.DOUBLE
    case 'decimal':
    case 'numeric':
      return NormalizedType.DECIMAL
    case 'boolean':
    case 'bool':
      return NormalizedType.BOOLEAN
    case 'date':
      return NormalizedType.DATE
    case 'time':
    case 'time without time zone':
      return NormalizedType.TIME
    case 'timestamp':
    case 'timestamp without time zone':
      return NormalizedType.TIMESTAMP
    case 'timestamptz':
    case 'timestamp with time zone':
      return NormalizedType.TIMESTAMPTZ
    case 'interval':
      return NormalizedType.INTERVAL
    case 'json':
      return NormalizedType.JSON
    case 'jsonb':
      return NormalizedType.JSONB
    case 'uuid':
      return NormalizedType.UUID
    case 'bytea':
      return NormalizedType.BYTEA
    case 'inet':
      return NormalizedType.INET
    case 'cidr':
      return NormalizedType.CIDR
    case 'macaddr':
      return NormalizedType.MACADDR
    case 'enum':
      return NormalizedType.ENUM
    case 'point':
      return NormalizedType.POINT
    case 'line':
      return NormalizedType.LINE
    case 'geometry':
      return NormalizedType.GEOMETRY
    default:
      return NormalizedType.UNKNOWN
  }
}

function tsTypeToNormalized(tsType: string): NormalizedType {
  const t = tsType.trim()
  if (t === 'string') return NormalizedType.TEXT
  if (t === 'number') return NormalizedType.INTEGER
  if (t === 'boolean') return NormalizedType.BOOLEAN
  if (t === 'Date') return NormalizedType.TIMESTAMPTZ
  return NormalizedType.TEXT
}

function normalizedTypeToNative(nt: NormalizedType): string {
  switch (nt) {
    case NormalizedType.VARCHAR:
      return 'varchar'
    case NormalizedType.CHAR:
      return 'char'
    case NormalizedType.TEXT:
      return 'text'
    case NormalizedType.SMALLINT:
      return 'smallint'
    case NormalizedType.INTEGER:
      return 'integer'
    case NormalizedType.BIGINT:
      return 'bigint'
    case NormalizedType.REAL:
      return 'real'
    case NormalizedType.DOUBLE:
      return 'double precision'
    case NormalizedType.DECIMAL:
      return 'decimal'
    case NormalizedType.BOOLEAN:
      return 'boolean'
    case NormalizedType.DATE:
      return 'date'
    case NormalizedType.TIME:
      return 'time'
    case NormalizedType.TIMESTAMP:
      return 'timestamp'
    case NormalizedType.TIMESTAMPTZ:
      return 'timestamptz'
    case NormalizedType.INTERVAL:
      return 'interval'
    case NormalizedType.JSON:
      return 'json'
    case NormalizedType.JSONB:
      return 'jsonb'
    case NormalizedType.UUID:
      return 'uuid'
    case NormalizedType.BYTEA:
      return 'bytea'
    case NormalizedType.INET:
      return 'inet'
    case NormalizedType.CIDR:
      return 'cidr'
    case NormalizedType.MACADDR:
      return 'macaddr'
    case NormalizedType.ENUM:
      return 'enum'
    case NormalizedType.POINT:
      return 'point'
    case NormalizedType.LINE:
      return 'line'
    case NormalizedType.GEOMETRY:
      return 'geometry'
    default:
      return 'text'
  }
}

// ─── Balanced Braces Extraction ─────────────────────────────────────────────

/**
 * Starting at `start` (which should point to an opening brace/paren),
 * return the substring up to and including the matching close.
 */
function extractBalanced(source: string, start: number, open: string, close: string): string {
  let depth = 0
  let inSingleQuote = false
  let inDoubleQuote = false
  let inTemplate = false
  for (let i = start; i < source.length; i++) {
    const ch = source[i]
    const prev = i > 0 ? source[i - 1] : ''
    if (prev !== '\\') {
      if (!inDoubleQuote && !inTemplate && ch === "'") inSingleQuote = !inSingleQuote
      else if (!inSingleQuote && !inTemplate && ch === '"') inDoubleQuote = !inDoubleQuote
      else if (!inSingleQuote && !inDoubleQuote && ch === '`') inTemplate = !inTemplate
    }
    if (inSingleQuote || inDoubleQuote || inTemplate) continue
    if (ch === open) depth++
    else if (ch === close) {
      depth--
      if (depth === 0) return source.slice(start, i + 1)
    }
  }
  return source.slice(start)
}

// ─── Decorator + Options Extraction ─────────────────────────────────────────

function extractDecoratorArgs(source: string, decoratorName: string): string | null {
  const pattern = new RegExp(`@${decoratorName}\\s*\\(`, 'g')
  const match = pattern.exec(source)
  if (!match) return null
  const parenStart = match.index + match[0].length - 1
  const balanced = extractBalanced(source, parenStart, '(', ')')
  // strip outer parens
  return balanced.slice(1, -1).trim()
}

function extractOptionValue(optionsStr: string, key: string): string | undefined {
  // Match key: value patterns, handling nested objects/arrays/arrow functions
  const pattern = new RegExp(`(?:^|[,{])\\s*${key}\\s*:\\s*`)
  const match = pattern.exec(optionsStr)
  if (!match) return undefined

  const valueStart = match.index + match[0].length
  const rest = optionsStr.slice(valueStart)

  // If value starts with [ or { or (, extract balanced
  if (rest.startsWith('[')) {
    return extractBalanced(rest, 0, '[', ']')
  }
  if (rest.startsWith('{')) {
    return extractBalanced(rest, 0, '{', '}')
  }
  if (rest.startsWith('(')) {
    return extractBalanced(rest, 0, '(', ')')
  }

  // Otherwise read until comma or closing brace
  const endMatch = /^((?:\([^)]*\)|[^,}])*)/.exec(rest)
  return endMatch ? endMatch[1].trim() : undefined
}

function unquote(s: string): string {
  return s.replace(/^['"`]|['"`]$/g, '').trim()
}

// ─── Enum Detection ─────────────────────────────────────────────────────────

interface ParsedEnum {
  name: string
  values: string[]
}

function extractEnumsFromSource(source: string): ParsedEnum[] {
  const results: ParsedEnum[] = []

  // Match: enum Name { A = 'a', B = 'b' }
  const enumRegex = /\benum\s+(\w+)\s*\{([^}]*)\}/g
  let m: RegExpExecArray | null
  while ((m = enumRegex.exec(source)) !== null) {
    const name = m[1]
    const body = m[2]
    const values: string[] = []

    // Parse enum members
    const memberRegex = /(\w+)\s*=\s*['"]([^'"]*)['"]/g
    let mm: RegExpExecArray | null
    while ((mm = memberRegex.exec(body)) !== null) {
      values.push(mm[2])
    }

    // If no string values found, use member names as values
    if (values.length === 0) {
      const nameRegex = /(\w+)\s*(?:=|,|$)/g
      let nm: RegExpExecArray | null
      while ((nm = nameRegex.exec(body)) !== null) {
        if (nm[1].trim()) values.push(nm[1].trim())
      }
    }

    if (values.length > 0) {
      results.push({ name, values })
    }
  }

  return results
}

// ─── Entity Parsing ─────────────────────────────────────────────────────────

interface ParsedColumn {
  name: string
  columnDef: ColumnDef
  isPrimary: boolean
}

interface ParsedRelation {
  propertyName: string
  type: 'ManyToOne' | 'OneToOne' | 'ManyToMany' | 'OneToMany'
  target: string
  joinColumnName: string | null
  joinTableName: string | null
  joinTableThisColumn: string | null
  joinTableInverseColumn: string | null
  onDelete: FKAction
  onUpdate: FKAction
}

interface ParsedEntity {
  className: string
  tableName: string
  columns: ParsedColumn[]
  relations: ParsedRelation[]
}

function parseEntityClass(classBlock: string, fullSource: string): ParsedEntity | null {
  // Extract class name and @Entity args
  const classMatch = /class\s+(\w+)/.exec(classBlock)
  if (!classMatch) return null
  const className = classMatch[1]

  // Extract @Entity decorator - look in the portion before "class"
  const classKeywordIdx = classBlock.indexOf('class ')
  const preClass = classBlock.slice(0, classKeywordIdx)

  let tableName = toSnakeCase(className)
  const entityArgs = extractDecoratorArgs(preClass, 'Entity')
  if (entityArgs !== null) {
    if (entityArgs.startsWith("'") || entityArgs.startsWith('"') || entityArgs.startsWith('`')) {
      tableName = unquote(entityArgs.split(',')[0])
    } else if (entityArgs.startsWith('{')) {
      const nameVal = extractOptionValue(entityArgs, 'name')
      if (nameVal) tableName = unquote(nameVal)
    } else if (entityArgs.length > 0 && !entityArgs.startsWith('{')) {
      // Could be a bare string without quotes (unlikely but handle)
      tableName = unquote(entityArgs.split(',')[0])
    }
  }

  // Extract class body (everything between the first { and matching })
  const classBodyStart = classBlock.indexOf('{', classBlock.indexOf('class '))
  if (classBodyStart === -1) return null
  const classBody = extractBalanced(classBlock, classBodyStart, '{', '}')
  const bodyContent = classBody.slice(1, -1)

  // Parse members: find all decorated properties
  const columns: ParsedColumn[] = []
  const relations: ParsedRelation[] = []
  const knownEnums = extractEnumsFromSource(fullSource)

  // Split body into member blocks by looking for decorator sequences
  const memberBlocks = splitIntoMembers(bodyContent)

  for (const block of memberBlocks) {
    const parsedCol = parseColumnMember(block, knownEnums)
    if (parsedCol) {
      columns.push(parsedCol)
      continue
    }

    const parsedRel = parseRelationMember(block, className)
    if (parsedRel) {
      relations.push(parsedRel)
    }
  }

  return { className, tableName, columns, relations }
}

function splitIntoMembers(bodyContent: string): string[] {
  const members: string[] = []

  // Find all @-decorator starting positions
  const decoratorStarts: number[] = []
  const atRegex = /(?:^|\n)\s*@\w+/g
  let m: RegExpExecArray | null
  while ((m = atRegex.exec(bodyContent)) !== null) {
    decoratorStarts.push(m.index)
  }

  // Group consecutive decorators that belong to the same property.
  // A decorator block "owns" the property declaration if it contains a
  // property-declaration line (e.g. `id!: number;` or `id!: number` under ASI).
  // Stacked decorators without a property line merge with the next decorator.
  let accumulatedStart = -1

  for (let i = 0; i < decoratorStarts.length; i++) {
    if (accumulatedStart === -1) {
      accumulatedStart = decoratorStarts[i]
    }

    const end = i + 1 < decoratorStarts.length ? decoratorStarts[i + 1] : bodyContent.length
    const block = bodyContent.slice(decoratorStarts[i], end).trim()

    if (blockHasPropertyDecl(block)) {
      // Found the property declaration — emit the accumulated member
      let fullBlock = bodyContent.slice(accumulatedStart, end).trim()
      const fullSemiIdx = findPropertyEnd(fullBlock)
      if (fullSemiIdx !== -1) {
        fullBlock = fullBlock.slice(0, fullSemiIdx + 1)
      }
      members.push(fullBlock)
      accumulatedStart = -1
    }
    // else: stacked decorator, merge with the next
  }

  return members
}

/**
 * True if the block contains a property-declaration line like
 * `id: number;`, `id!: number`, `firstName?: string`, etc. The line must
 * live outside the decorator's parenthesised arguments.
 */
function blockHasPropertyDecl(block: string): boolean {
  // Fast path: a ;-terminated member is always a property decl
  if (findPropertyEnd(block) !== -1) return true

  // Slow path: find a line outside decorator args matching `name[!?]?: type`
  const lines = block.split('\n')
  let parenDepth = 0
  for (const rawLine of lines) {
    const line = rawLine.trim()
    // Track parenthesis depth across lines so we skip multi-line decorator args
    const lineDepth = parenDepth
    for (const ch of rawLine) {
      if (ch === '(' || ch === '{' || ch === '[') parenDepth++
      else if (ch === ')' || ch === '}' || ch === ']') parenDepth--
    }
    if (lineDepth !== 0) continue
    if (line.length === 0 || line.startsWith('@') || line.startsWith('//')) continue
    if (/^(\w+)\s*[!?]?\s*:\s*[^=]+$/.test(line)) return true
  }
  return false
}

function findPropertyEnd(block: string): number {
  let depth = 0
  let inSingleQuote = false
  let inDoubleQuote = false
  let inTemplate = false
  for (let i = 0; i < block.length; i++) {
    const ch = block[i]
    const prev = i > 0 ? block[i - 1] : ''
    if (prev !== '\\') {
      if (!inDoubleQuote && !inTemplate && ch === "'") inSingleQuote = !inSingleQuote
      else if (!inSingleQuote && !inTemplate && ch === '"') inDoubleQuote = !inDoubleQuote
      else if (!inSingleQuote && !inDoubleQuote && ch === '`') inTemplate = !inTemplate
    }
    if (inSingleQuote || inDoubleQuote || inTemplate) continue
    if (ch === '(' || ch === '{' || ch === '[') depth++
    else if (ch === ')' || ch === '}' || ch === ']') depth--
    else if (ch === ';' && depth === 0) return i
  }
  return -1
}

/**
 * Extract the property declaration from a member block. Handles:
 *   propertyName: Type;
 *   propertyName?: Type;
 *   propertyName!: Type;         (definite-assignment, TS strict mode)
 *   propertyName!: Type          (ASI — no semicolon)
 */
function extractPropertyDecl(block: string): { propertyName: string; tsType: string } | null {
  const lines = block.split('\n')
  for (let i = lines.length - 1; i >= 0; i--) {
    const line = lines[i].trim()
    if (line.length === 0 || line.startsWith('@') || line.startsWith('//')) continue
    // Match both ;-terminated and ASI forms
    const m = /^(\w+)\s*[!?]?\s*:\s*(.+?)\s*;?\s*$/.exec(line)
    if (m && !m[2].includes('=')) {
      // Exclude assignment lines like `foo = bar` inside decorator args
      return { propertyName: m[1], tsType: m[2].replace(/;$/, '').trim() }
    }
  }
  return null
}

function parseColumnMember(block: string, knownEnums: ParsedEnum[]): ParsedColumn | null {
  // Check for column-type decorators
  const isPrimaryGenerated = /@PrimaryGeneratedColumn\s*\(/.test(block)
  const isPrimaryColumn = /@PrimaryColumn\s*\(/.test(block)
  const isColumn = /@Column\s*\(/.test(block)
  const isCreateDate = /@CreateDateColumn\s*\(/.test(block)
  const isUpdateDate = /@UpdateDateColumn\s*\(/.test(block)
  const isDeleteDate = /@DeleteDateColumn\s*\(/.test(block)

  if (
    !isPrimaryGenerated &&
    !isPrimaryColumn &&
    !isColumn &&
    !isCreateDate &&
    !isUpdateDate &&
    !isDeleteDate
  ) {
    return null
  }

  // Extract property name and TS type from the last line
  const propDecl = extractPropertyDecl(block)
  if (!propDecl) return null
  const { propertyName, tsType } = propDecl

  let columnName = toSnakeCase(propertyName)
  let dataType: NormalizedType = tsTypeToNormalized(tsType)
  let nativeType = normalizedTypeToNative(dataType)
  let isNullable = false
  let hasDefault = false
  let defaultValue: string | null = null
  let isAutoIncrement = false
  const isGenerated = false
  let maxLength: number | null = null
  let numericPrecision: number | null = null
  let numericScale: number | null = null
  let enumValues: string[] | null = null
  let isPrimary = false

  if (isPrimaryGenerated) {
    isPrimary = true
    isAutoIncrement = true
    // isGenerated = true is reserved for stored/computed columns (PG GENERATED
    // ALWAYS AS). Auto-increment PKs use isAutoIncrement and hasDefault.
    hasDefault = true

    const args = extractDecoratorArgs(block, 'PrimaryGeneratedColumn')
    if (args !== null && args.length > 0) {
      const firstArg = args.split(',')[0].trim()
      if (firstArg === "'uuid'" || firstArg === '"uuid"') {
        dataType = NormalizedType.UUID
        nativeType = 'uuid'
        isAutoIncrement = false
      } else if (firstArg === "'increment'" || firstArg === '"increment"' || firstArg === '') {
        dataType = NormalizedType.INTEGER
        nativeType = 'integer'
      } else if (firstArg.startsWith('{')) {
        // Options object as first arg
        const typeVal = extractOptionValue(firstArg, 'type')
        if (typeVal) {
          const unquoted = unquote(typeVal)
          if (unquoted === 'uuid') {
            dataType = NormalizedType.UUID
            nativeType = 'uuid'
            isAutoIncrement = false
          }
        }
      } else if (
        !firstArg.startsWith('{') &&
        !firstArg.startsWith("'") &&
        !firstArg.startsWith('"')
      ) {
        // bare identifier, might be options object for second arg
        dataType = NormalizedType.INTEGER
        nativeType = 'integer'
      }
    } else {
      dataType = NormalizedType.INTEGER
      nativeType = 'integer'
    }

    // Also check column name override
    if (args) {
      const nameVal = extractOptionValue(args, 'name')
      if (nameVal) columnName = unquote(nameVal)
    }
  } else if (isPrimaryColumn) {
    isPrimary = true
    const args = extractDecoratorArgs(block, 'PrimaryColumn')
    if (args) {
      parseColumnOptions(args)
    }
  } else if (isCreateDate || isUpdateDate) {
    dataType = NormalizedType.TIMESTAMPTZ
    nativeType = 'timestamptz'
    hasDefault = true

    const decoratorName = isCreateDate ? 'CreateDateColumn' : 'UpdateDateColumn'
    const args = extractDecoratorArgs(block, decoratorName)
    if (args) {
      const nameVal = extractOptionValue(args, 'name')
      if (nameVal) columnName = unquote(nameVal)
    }
  } else if (isDeleteDate) {
    dataType = NormalizedType.TIMESTAMPTZ
    nativeType = 'timestamptz'
    isNullable = true

    const args = extractDecoratorArgs(block, 'DeleteDateColumn')
    if (args) {
      const nameVal = extractOptionValue(args, 'name')
      if (nameVal) columnName = unquote(nameVal)
    }
  } else if (isColumn) {
    const args = extractDecoratorArgs(block, 'Column')
    if (args) {
      parseColumnOptions(args)
    }
  }

  function parseColumnOptions(args: string): void {
    // Check if first arg is a plain string (shorthand for type)
    const trimmed = args.trim()

    // Handle shorthand: @Column('varchar') or @Column('text')
    if ((trimmed.startsWith("'") || trimmed.startsWith('"')) && !trimmed.includes('{')) {
      const typeStr = unquote(trimmed.split(',')[0])
      dataType = typeormTypeToNormalized(typeStr)
      nativeType = typeStr
      return
    }

    // Handle object options
    const optionsStr = trimmed
    if (!optionsStr.startsWith('{') && !optionsStr.includes(':')) {
      // First arg might be type string, second might be options
      return
    }

    // Extract type
    const typeVal = extractOptionValue(optionsStr, 'type')
    if (typeVal) {
      const unquotedType = unquote(typeVal)
      dataType = typeormTypeToNormalized(unquotedType)
      nativeType = unquotedType
    }

    // Extract name
    const nameVal = extractOptionValue(optionsStr, 'name')
    if (nameVal) columnName = unquote(nameVal)

    // Extract length
    const lengthVal = extractOptionValue(optionsStr, 'length')
    if (lengthVal) {
      const parsed = parseInt(unquote(lengthVal), 10)
      if (!isNaN(parsed)) maxLength = parsed
    }

    // Extract nullable
    const nullableVal = extractOptionValue(optionsStr, 'nullable')
    if (nullableVal) isNullable = unquote(nullableVal) === 'true'

    // Extract unique (handled later in uniqueConstraints)

    // Extract default
    const defaultVal = extractOptionValue(optionsStr, 'default')
    if (defaultVal !== undefined) {
      hasDefault = true
      defaultValue = unquote(defaultVal)
    }

    // Extract precision
    const precisionVal = extractOptionValue(optionsStr, 'precision')
    if (precisionVal) {
      const parsed = parseInt(unquote(precisionVal), 10)
      if (!isNaN(parsed)) numericPrecision = parsed
    }

    // Extract scale
    const scaleVal = extractOptionValue(optionsStr, 'scale')
    if (scaleVal) {
      const parsed = parseInt(unquote(scaleVal), 10)
      if (!isNaN(parsed)) numericScale = parsed
    }

    // Extract enum values
    const enumVal = extractOptionValue(optionsStr, 'enum')
    if (enumVal) {
      dataType = NormalizedType.ENUM
      nativeType = 'enum'
      enumValues = parseEnumArg(enumVal, knownEnums)
    }
  }

  const col: ColumnDef = {
    name: columnName,
    dataType,
    nativeType,
    isNullable,
    hasDefault,
    defaultValue,
    isAutoIncrement,
    isGenerated,
    maxLength,
    numericPrecision,
    numericScale,
    enumValues,
    comment: null,
  }

  return { name: columnName, columnDef: col, isPrimary }
}

function parseEnumArg(enumVal: string, knownEnums: ParsedEnum[]): string[] {
  const trimmed = enumVal.trim()

  // Array literal: ['a', 'b', 'c']
  if (trimmed.startsWith('[')) {
    const inner = trimmed.slice(1, -1)
    const values: string[] = []
    const valRegex = /['"]([^'"]*)['"]/g
    let m: RegExpExecArray | null
    while ((m = valRegex.exec(inner)) !== null) {
      values.push(m[1])
    }
    return values
  }

  // Enum reference: SomeEnum
  const enumName = trimmed.trim()
  const found = knownEnums.find((e) => e.name === enumName)
  if (found) return found.values

  return []
}

function parseRelationMember(block: string, sourceClassName: string): ParsedRelation | null {
  const manyToOneMatch = /@ManyToOne\s*\(/.test(block)
  const oneToOneMatch = /@OneToOne\s*\(/.test(block)
  const manyToManyMatch = /@ManyToMany\s*\(/.test(block)
  const oneToManyMatch = /@OneToMany\s*\(/.test(block)

  if (!manyToOneMatch && !oneToOneMatch && !manyToManyMatch && !oneToManyMatch) return null

  // Determine relation type
  let relType: ParsedRelation['type']
  let decoratorName: string
  if (manyToOneMatch) {
    relType = 'ManyToOne'
    decoratorName = 'ManyToOne'
  } else if (oneToOneMatch) {
    relType = 'OneToOne'
    decoratorName = 'OneToOne'
  } else if (manyToManyMatch) {
    relType = 'ManyToMany'
    decoratorName = 'ManyToMany'
  } else {
    relType = 'OneToMany'
    decoratorName = 'OneToMany'
  }

  // Extract property name from the last line
  const propDecl = extractPropertyDecl(block)
  if (!propDecl) return null
  const propertyName = propDecl.propertyName

  // Extract target entity from arrow function: () => Target
  const args = extractDecoratorArgs(block, decoratorName)
  let target = ''
  if (args) {
    const arrowMatch = /\(\)\s*=>\s*(\w+)/.exec(args)
    if (arrowMatch) target = arrowMatch[1]
  }

  // Extract onDelete, onUpdate from relation options
  let onDelete = FKAction.NO_ACTION
  let onUpdate = FKAction.NO_ACTION
  if (args) {
    const onDeleteVal = extractOptionValue(args, 'onDelete')
    if (onDeleteVal) onDelete = parseFKAction(onDeleteVal)
    const onUpdateVal = extractOptionValue(args, 'onUpdate')
    if (onUpdateVal) onUpdate = parseFKAction(onUpdateVal)
  }

  // Extract @JoinColumn info
  let joinColumnName: string | null = null
  const joinColArgs = extractDecoratorArgs(block, 'JoinColumn')
  if (joinColArgs) {
    const nameVal = extractOptionValue(joinColArgs, 'name')
    if (nameVal) {
      joinColumnName = unquote(nameVal)
    } else {
      // Default JoinColumn name: propertyName + Id -> snake_case
      joinColumnName = toSnakeCase(propertyName) + '_id'
    }
  } else if (relType === 'ManyToOne') {
    // ManyToOne without explicit JoinColumn: TypeORM auto-generates
    joinColumnName = toSnakeCase(propertyName) + '_id'
  }

  // Extract @JoinTable info (for ManyToMany)
  let joinTableName: string | null = null
  let joinTableThisColumn: string | null = null
  let joinTableInverseColumn: string | null = null
  const joinTableArgs = extractDecoratorArgs(block, 'JoinTable')
  if (joinTableArgs !== null) {
    const tableNameVal = extractOptionValue(joinTableArgs, 'name')
    if (tableNameVal) {
      joinTableName = unquote(tableNameVal)
    } else {
      // Default: alphabetical combination of both table names
      const names = [toSnakeCase(sourceClassName), toSnakeCase(target)].sort()
      joinTableName = `${names[0]}_${names[1]}`
    }

    // joinColumn
    const joinColVal = extractOptionValue(joinTableArgs, 'joinColumn')
    if (joinColVal) {
      const jcName = extractOptionValue(joinColVal, 'name')
      if (jcName) joinTableThisColumn = unquote(jcName)
    }
    if (!joinTableThisColumn) {
      joinTableThisColumn = toSnakeCase(sourceClassName) + '_id'
    }

    // inverseJoinColumn
    const inverseColVal = extractOptionValue(joinTableArgs, 'inverseJoinColumn')
    if (inverseColVal) {
      const icName = extractOptionValue(inverseColVal, 'name')
      if (icName) joinTableInverseColumn = unquote(icName)
    }
    if (!joinTableInverseColumn) {
      joinTableInverseColumn = toSnakeCase(target) + '_id'
    }
  }

  return {
    propertyName,
    type: relType,
    target,
    joinColumnName,
    joinTableName,
    joinTableThisColumn,
    joinTableInverseColumn,
    onDelete,
    onUpdate,
  }
}

// ─── Main Parse Function ────────────────────────────────────────────────────

function extractEntityBlocks(source: string): string[] {
  const blocks: string[] = []

  // Find all @Entity decorators
  const entityRegex = /@Entity\s*\(/g
  let m: RegExpExecArray | null

  while ((m = entityRegex.exec(source)) !== null) {
    // Scan backwards to include any preceding decorators/comments
    const start = m.index

    // Find the class keyword after this @Entity
    const afterEntity = source.slice(m.index)
    const classMatch = /class\s+\w+/.exec(afterEntity)
    if (!classMatch) continue

    const classKeywordIdx = m.index + classMatch.index
    const classLine = source.slice(classKeywordIdx)

    // Find opening brace of class body
    const braceIdx = classLine.indexOf('{')
    if (braceIdx === -1) continue

    const absoluteBraceIdx = classKeywordIdx + braceIdx
    const classBody = extractBalanced(source, absoluteBraceIdx, '{', '}')
    const end = absoluteBraceIdx + classBody.length

    blocks.push(source.slice(start, end))
  }

  return blocks
}

export function parseTypeORMSource(source: string): ParsedEntity[] {
  const entities: ParsedEntity[] = []
  const blocks = extractEntityBlocks(source)

  for (const block of blocks) {
    const entity = parseEntityClass(block, source)
    if (entity) entities.push(entity)
  }

  return entities
}

export function parseTypeORMEntities(
  sources: Array<{ path: string; content: string }>,
): DatabaseSchema {
  const allEntities: ParsedEntity[] = []
  const allEnums: ParsedEnum[] = []

  for (const { content } of sources) {
    const entities = parseTypeORMSource(content)
    allEntities.push(...entities)
    allEnums.push(...extractEnumsFromSource(content))
  }

  const tables = new Map<string, TableDef>()
  const enumDefs = new Map<string, EnumDef>()
  const schema = 'public'

  // Build enum map
  for (const e of allEnums) {
    enumDefs.set(e.name, {
      name: e.name,
      schema,
      values: e.values,
    })
  }

  // Build entity-class-name to table-name map for FK resolution
  const classToTable = new Map<string, string>()
  for (const entity of allEntities) {
    classToTable.set(entity.className, entity.tableName)
  }

  // Build tables
  for (const entity of allEntities) {
    const columns = new Map<string, ColumnDef>()
    const pkColumns: string[] = []
    const foreignKeys: ForeignKeyDef[] = []
    const uniqueConstraints: UniqueConstraintDef[] = []

    // Process columns
    for (const col of entity.columns) {
      columns.set(col.name, col.columnDef)
      if (col.isPrimary) pkColumns.push(col.name)
    }

    // Process relations
    for (const rel of entity.relations) {
      if (rel.type === 'OneToMany') continue // inverse side, skip

      if (rel.type === 'ManyToMany' && rel.joinTableName) {
        // Create join table
        const referencedTable = classToTable.get(rel.target) ?? toSnakeCase(rel.target)
        const thisTable = entity.tableName

        // Find PKs of both tables
        const thisPkCol = entity.columns.find((c) => c.isPrimary)
        const thisPkName = thisPkCol ? thisPkCol.name : 'id'
        const thisPkType = thisPkCol ? thisPkCol.columnDef.dataType : NormalizedType.INTEGER

        // For referenced table, try to find it
        const refEntity = allEntities.find((e) => e.className === rel.target)
        const refPkCol = refEntity?.columns.find((c) => c.isPrimary)
        const refPkName = refPkCol ? refPkCol.name : 'id'
        const refPkType = refPkCol ? refPkCol.columnDef.dataType : NormalizedType.INTEGER

        const joinTableColumns = new Map<string, ColumnDef>()
        const thisColName = rel.joinTableThisColumn ?? toSnakeCase(entity.className) + '_id'
        const inverseColName = rel.joinTableInverseColumn ?? toSnakeCase(rel.target) + '_id'

        joinTableColumns.set(thisColName, {
          name: thisColName,
          dataType: thisPkType,
          nativeType: normalizedTypeToNative(thisPkType),
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
        })

        joinTableColumns.set(inverseColName, {
          name: inverseColName,
          dataType: refPkType,
          nativeType: normalizedTypeToNative(refPkType),
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
        })

        const joinTable: TableDef = {
          name: rel.joinTableName,
          schema,
          columns: joinTableColumns,
          primaryKey: {
            columns: [thisColName, inverseColName],
            name: `PK_${rel.joinTableName}`,
          },
          foreignKeys: [
            {
              name: `FK_${rel.joinTableName}_${thisTable}`,
              columns: [thisColName],
              referencedTable: thisTable,
              referencedSchema: schema,
              referencedColumns: [thisPkName],
              onDelete: FKAction.CASCADE,
              onUpdate: FKAction.NO_ACTION,
              isDeferrable: false,
              isDeferred: false,
              isVirtual: false,
            },
            {
              name: `FK_${rel.joinTableName}_${referencedTable}`,
              columns: [inverseColName],
              referencedTable: referencedTable,
              referencedSchema: schema,
              referencedColumns: [refPkName],
              onDelete: FKAction.CASCADE,
              onUpdate: FKAction.NO_ACTION,
              isDeferrable: false,
              isDeferred: false,
              isVirtual: false,
            },
          ],
          uniqueConstraints: [],
          checkConstraints: [],
          indexes: [],
          comment: null,
        }
        tables.set(rel.joinTableName, joinTable)
        continue
      }

      // ManyToOne or OneToOne with JoinColumn
      if (rel.joinColumnName) {
        const referencedTable = classToTable.get(rel.target) ?? toSnakeCase(rel.target)

        // Find referenced PK
        const refEntity = allEntities.find((e) => e.className === rel.target)
        const refPkCol = refEntity?.columns.find((c) => c.isPrimary)
        const refPkName = refPkCol ? refPkCol.name : 'id'
        const refPkType = refPkCol ? refPkCol.columnDef.dataType : NormalizedType.INTEGER

        // Add FK column to this table if not already there
        if (!columns.has(rel.joinColumnName)) {
          columns.set(rel.joinColumnName, {
            name: rel.joinColumnName,
            dataType: refPkType,
            nativeType: normalizedTypeToNative(refPkType),
            isNullable: rel.type === 'OneToOne' && !/@JoinColumn/.test(''), // OneToOne can be nullable
            hasDefault: false,
            defaultValue: null,
            isAutoIncrement: false,
            isGenerated: false,
            maxLength: null,
            numericPrecision: null,
            numericScale: null,
            enumValues: null,
            comment: null,
          })
        }

        foreignKeys.push({
          name: `FK_${entity.tableName}_${rel.joinColumnName}`,
          columns: [rel.joinColumnName],
          referencedTable,
          referencedSchema: schema,
          referencedColumns: [refPkName],
          onDelete: rel.onDelete,
          onUpdate: rel.onUpdate,
          isDeferrable: false,
          isDeferred: false,
          isVirtual: false,
        })
      }
    }

    const primaryKey: PrimaryKeyDef | null =
      pkColumns.length > 0 ? { columns: pkColumns, name: `PK_${entity.tableName}` } : null

    tables.set(entity.tableName, {
      name: entity.tableName,
      schema,
      columns,
      primaryKey,
      foreignKeys,
      uniqueConstraints,
      checkConstraints: [],
      indexes: [],
      comment: null,
    })
  }

  // Second pass: extract unique constraints from source
  for (const { content } of sources) {
    addUniqueConstraints(content, tables, classToTable)
  }

  return {
    name: 'typeorm',
    tables,
    enums: enumDefs,
    schemas: [schema],
  }
}

function addUniqueConstraints(
  source: string,
  tables: Map<string, TableDef>,
  classToTable: Map<string, string>,
): void {
  const blocks = extractEntityBlocks(source)
  for (const block of blocks) {
    const classMatch = /class\s+(\w+)/.exec(block)
    if (!classMatch) continue
    const className = classMatch[1]
    const tableName = classToTable.get(className)
    if (!tableName) continue
    const table = tables.get(tableName)
    if (!table) continue

    // Find columns with unique: true in @Column options
    const bodyStart = block.indexOf('{', block.indexOf('class '))
    if (bodyStart === -1) continue
    const body = extractBalanced(block, bodyStart, '{', '}')
    const members = splitIntoMembers(body.slice(1, -1))

    for (const member of members) {
      if (!/@Column\s*\(/.test(member)) continue
      const args = extractDecoratorArgs(member, 'Column')
      if (!args) continue
      const uniqueVal = extractOptionValue(args, 'unique')
      if (uniqueVal && unquote(uniqueVal) === 'true') {
        // Find property name
        const propDecl = extractPropertyDecl(member)
        if (propDecl) {
          const colName = toSnakeCase(propDecl.propertyName)
          table.uniqueConstraints.push({
            columns: [colName],
            name: `UQ_${tableName}_${colName}`,
          })
        }
      }
    }
  }
}

// ─── File System Scanning ───────────────────────────────────────────────────

export function scanDirectory(dirPath: string): Array<{ path: string; content: string }> {
  const resolvedPath = resolve(dirPath)
  const sources: Array<{ path: string; content: string }> = []

  function walk(dir: string): void {
    const entries = readdirSync(dir)
    for (const entry of entries) {
      const fullPath = join(dir, entry)
      const stat = statSync(fullPath)
      if (stat.isDirectory()) {
        walk(fullPath)
      } else if (
        entry.endsWith('.ts') &&
        !entry.endsWith('.d.ts') &&
        !entry.endsWith('.test.ts') &&
        !entry.endsWith('.spec.ts')
      ) {
        const content = readFileSync(fullPath, 'utf-8')
        if (content.includes('@Entity')) {
          sources.push({ path: fullPath, content })
        }
      }
    }
  }

  walk(resolvedPath)
  return sources
}

export function parseTypeORMDirectory(dirPath: string): DatabaseSchema {
  const sources = scanDirectory(dirPath)
  return parseTypeORMEntities(sources)
}
