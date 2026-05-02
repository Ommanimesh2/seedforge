import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, dirname } from 'node:path'
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

// ─── Java type → NormalizedType mapping ───────────────────────────────────────

const JAVA_TYPE_MAP: Record<string, NormalizedType> = {
  String: NormalizedType.VARCHAR,
  Integer: NormalizedType.INTEGER,
  int: NormalizedType.INTEGER,
  Long: NormalizedType.BIGINT,
  long: NormalizedType.BIGINT,
  Short: NormalizedType.SMALLINT,
  short: NormalizedType.SMALLINT,
  Double: NormalizedType.DOUBLE,
  double: NormalizedType.DOUBLE,
  Float: NormalizedType.REAL,
  float: NormalizedType.REAL,
  BigDecimal: NormalizedType.DECIMAL,
  Boolean: NormalizedType.BOOLEAN,
  boolean: NormalizedType.BOOLEAN,
  LocalDateTime: NormalizedType.TIMESTAMPTZ,
  Instant: NormalizedType.TIMESTAMPTZ,
  ZonedDateTime: NormalizedType.TIMESTAMPTZ,
  LocalDate: NormalizedType.DATE,
  LocalTime: NormalizedType.TIME,
  UUID: NormalizedType.UUID,
  'byte[]': NormalizedType.BYTEA,
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert camelCase / PascalCase to snake_case */
export function toSnakeCase(str: string): string {
  return str
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
    .replace(/([a-z\d])([A-Z])/g, '$1_$2')
    .toLowerCase()
}

/** Convert PascalCase class name to a default table name (lowercase) */
function classToTableName(className: string): string {
  return toSnakeCase(className)
}

/** Extract annotation attribute value: e.g. from `name = "users"` → `"users"` */
function extractAttr(annotationBody: string, attr: string): string | null {
  // Match attribute = "value" or attribute = value
  const re = new RegExp(`${attr}\\s*=\\s*(?:"([^"]*)"|(\\w+(?:\\.\\w+)*))`)
  const m = annotationBody.match(re)
  if (!m) return null
  return m[1] ?? m[2] ?? null
}

/** Extract numeric annotation attribute */
function extractNumericAttr(annotationBody: string, attr: string): number | null {
  const val = extractAttr(annotationBody, attr)
  if (val === null) return null
  const num = parseInt(val, 10)
  return isNaN(num) ? null : num
}

/** Extract boolean annotation attribute */
function extractBoolAttr(annotationBody: string, attr: string): boolean | null {
  const val = extractAttr(annotationBody, attr)
  if (val === null) return null
  return val === 'true'
}

/** Get annotation body text (everything between parens). Returns '' if no parens.
 *  Handles nested parentheses like @JoinTable(joinColumns = @JoinColumn(name = "x")) */
function getAnnotationBody(annotations: string, annotationName: string): string | null {
  const re = new RegExp(`@${annotationName}\\b`)
  const m = annotations.match(re)
  if (!m) return null

  const startIdx = m.index! + m[0].length
  // Find opening paren
  let i = startIdx
  while (i < annotations.length && /\s/.test(annotations[i])) i++

  if (i >= annotations.length || annotations[i] !== '(') {
    // Annotation without parentheses: @Entity, @Id, etc.
    return ''
  }

  // Walk through the body tracking nested parens
  let depth = 1
  const bodyStart = i + 1
  i = bodyStart
  while (i < annotations.length && depth > 0) {
    if (annotations[i] === '(') depth++
    else if (annotations[i] === ')') depth--
    i++
  }

  return annotations.slice(bodyStart, i - 1)
}

/** Check if a specific annotation is present */
function hasAnnotation(annotations: string, name: string): boolean {
  return new RegExp(`@${name}\\b`).test(annotations)
}

// ─── Parse Java enum definitions ─────────────────────────────────────────────

interface ParsedJavaEnum {
  name: string
  values: string[]
}

/** Parse Java enum declarations from source code. Handles enums with
 *  constructors and methods (`AMC_FEED(3), AMFI(2);  private final int p; ...`)
 *  by walking braces to capture the full body. */
export function parseJavaEnums(source: string): ParsedJavaEnum[] {
  const enums: ParsedJavaEnum[] = []
  const headerRe = /(?:public\s+)?enum\s+(\w+)\s*\{/g
  let m: RegExpExecArray | null
  while ((m = headerRe.exec(source)) !== null) {
    const name = m[1]
    const bodyStart = m.index + m[0].length
    // Walk balanced braces to find the matching `}`.
    let depth = 1
    let i = bodyStart
    while (i < source.length && depth > 0) {
      const ch = source[i]
      if (ch === '{') depth++
      else if (ch === '}') depth--
      else if (ch === '/' && source[i + 1] === '/') {
        // Skip line comment
        while (i < source.length && source[i] !== '\n') i++
      } else if (ch === '/' && source[i + 1] === '*') {
        // Skip block comment
        i += 2
        while (i < source.length - 1 && !(source[i] === '*' && source[i + 1] === '/')) i++
        i += 2
        continue
      }
      i++
    }
    if (depth !== 0) continue
    const body = source.slice(bodyStart, i - 1)

    // Enum constants are before the first semicolon (if any) or the whole body.
    const constantsPart = body.split(';')[0]
    // Strip out parenthesized argument lists (`AMC_FEED(3)` → `AMC_FEED`)
    // and inline comments. Done with a balanced-paren walk over each
    // comma-separated chunk so that nested commas in args don't split.
    const values: string[] = []
    let buf = ''
    let depthP = 0
    for (let k = 0; k < constantsPart.length; k++) {
      const c = constantsPart[k]
      if (c === '(') {
        depthP++
        continue
      }
      if (c === ')') {
        depthP--
        continue
      }
      if (depthP > 0) continue
      if (c === ',') {
        const v = stripCommentsAndAnnotations(buf).trim()
        if (v && /^[A-Z_][A-Z0-9_]*$/i.test(v)) values.push(v)
        buf = ''
        continue
      }
      buf += c
    }
    const last = stripCommentsAndAnnotations(buf).trim()
    if (last && /^[A-Z_][A-Z0-9_]*$/i.test(last)) values.push(last)

    if (values.length > 0) {
      enums.push({ name, values })
    }
  }
  return enums
}

function stripCommentsAndAnnotations(s: string): string {
  return s
    .replace(/\/\/.*$/gm, '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/@\w+(?:\([^)]*\))?/g, '')
    .trim()
}

/** Scan a directory for Java enum files and parse them */
export function scanForEnums(directory: string): Map<string, ParsedJavaEnum> {
  const enumMap = new Map<string, ParsedJavaEnum>()
  try {
    const files = scanJavaFiles(directory)
    for (const file of files) {
      const source = readFileSync(file, 'utf-8')
      const enums = parseJavaEnums(source)
      for (const e of enums) {
        enumMap.set(e.name, e)
      }
    }
  } catch {
    // Directory not readable or doesn't exist; return empty
  }
  return enumMap
}

/**
 * Walk upward from `entityDir` looking for the Java source root.
 * Real-world DDD codebases keep enum value-objects in a sibling
 * package (e.g. `commons/valueobject/`), so scanning only the entity
 * directory misses them.
 *
 * Strategies, in order:
 *   1. Look for `src/main/java` in the path (Maven/Gradle layout).
 *   2. Walk up looking for a project marker (`pom.xml`, `build.gradle`,
 *      `build.gradle.kts`, `settings.gradle`).
 *   3. Fall back to two directories above `entityDir`.
 *
 * Returns null only if even (3) goes above the filesystem root.
 */
export function findJavaSourceRoot(entityDir: string): string | null {
  // Strategy 1: src/main/java anywhere in the path.
  const srcMainJava = entityDir.indexOf(`${'/'}src${'/'}main${'/'}java`)
  if (srcMainJava >= 0) {
    return entityDir.slice(0, srcMainJava + `${'/'}src${'/'}main${'/'}java`.length)
  }

  // Strategy 2: walk up looking for project marker files.
  const markers = ['pom.xml', 'build.gradle', 'build.gradle.kts', 'settings.gradle']
  let cur = entityDir
  for (let i = 0; i < 12; i++) {
    for (const marker of markers) {
      try {
        if (statSync(join(cur, marker)).isFile()) {
          return cur
        }
      } catch {
        // not present — keep looking
      }
    }
    const parent = dirname(cur)
    if (parent === cur) break
    cur = parent
  }

  // Strategy 3: two levels up (sibling-package convention).
  cur = entityDir
  for (let i = 0; i < 2; i++) {
    const parent = dirname(cur)
    if (parent === cur) return null
    cur = parent
  }
  return cur
}

// ─── Entity field parsing ────────────────────────────────────────────────────

interface ParsedField {
  name: string
  javaType: string
  annotations: string
}

interface ParsedEntity {
  className: string
  classAnnotations: string
  fields: ParsedField[]
  sourceDir: string
  rawSource: string
  /** Name of superclass if `class X extends Y` was present. */
  extendsName: string | null
}

/** Parse a single Java entity class from source text */
export function parseEntityClass(source: string, sourceDir: string): ParsedEntity | null {
  // Check for @Entity annotation
  if (!/@Entity\b/.test(source)) return null

  // Walk forward collecting class-level annotations until we hit the
  // `class` keyword. Uses balanced-paren scanning so annotations like
  // @Table(name="x", uniqueConstraints={@UniqueConstraint(...)}) are
  // captured correctly.
  const located = locateClassDeclaration(source)
  if (!located) return null
  const { className, extendsName, classAnnotations, classBodyStart } = located

  const classBody = extractClassBody(source, classBodyStart)
  const fields = parseFields(classBody)

  return {
    className,
    classAnnotations,
    fields,
    sourceDir,
    rawSource: source,
    extendsName,
  }
}

/**
 * Walk through `source` from the first `package`/`import`-skipping
 * cursor, eat each `@Annotation(...)` block (with balanced parens),
 * then read the `[abstract] class Name [extends Y]` declaration and
 * return everything up to the opening `{`.
 */
function locateClassDeclaration(source: string): {
  className: string
  extendsName: string | null
  classAnnotations: string
  classBodyStart: number
} | null {
  // Class declaration with optional `extends X` and optional
  // `implements A, B, C` (Java entities frequently `extends BaseEntity
  // implements AggregateRoot`).
  const classRe =
    /\b(?:public\s+)?(?:abstract\s+)?class\s+(\w+)(?:\s+extends\s+(\w+))?(?:\s+implements\s+[\w,\s.]+?)?\s*\{/
  const m = classRe.exec(source)
  if (!m) return null
  const className = m[1]
  const extendsName = m[2] ?? null
  const classBodyStart = m.index + m[0].length - 1 // position of `{`

  // Walk back from m.index, collecting annotation blocks in order.
  // We iterate forward from 0, recognizing each `@Name(...)` chunk
  // until we reach `m.index`. Anything before the first `@` (package/
  // imports) is ignored.
  const annotations: string[] = []
  let i = 0
  while (i < m.index) {
    // Skip non-annotation chars.
    while (i < m.index && source[i] !== '@') i++
    if (i >= m.index) break
    // Found an `@`. Read annotation name.
    const annStart = i
    i++ // past @
    while (i < m.index && /\w/.test(source[i])) i++
    // Optional balanced parenthesized body.
    while (i < m.index && /\s/.test(source[i])) i++
    if (i < m.index && source[i] === '(') {
      let depth = 1
      i++ // past (
      while (i < source.length && depth > 0) {
        const ch = source[i]
        if (ch === '(') depth++
        else if (ch === ')') depth--
        i++
      }
    }
    annotations.push(source.slice(annStart, i))
  }

  return {
    className,
    extendsName,
    classAnnotations: annotations.join(' '),
    classBodyStart,
  }
}

/**
 * Parse a @MappedSuperclass class — same shape as an entity, no @Entity
 * annotation required. Returns its declared fields so subclasses can
 * inherit them.
 */
export function parseMappedSuperclass(source: string): ParsedEntity | null {
  if (!/@MappedSuperclass\b/.test(source)) return null
  const located = locateClassDeclaration(source)
  if (!located) return null

  const { className, extendsName, classAnnotations, classBodyStart } = located
  const classBody = extractClassBody(source, classBodyStart)
  const fields = parseFields(classBody)

  return {
    className,
    classAnnotations,
    fields,
    sourceDir: '',
    rawSource: source,
    extendsName,
  }
}

/** Scan a directory tree for @MappedSuperclass declarations */
export function scanForMappedSuperclasses(directory: string): Map<string, ParsedEntity> {
  const out = new Map<string, ParsedEntity>()
  try {
    for (const file of scanJavaFiles(directory)) {
      const source = readFileSync(file, 'utf-8')
      const sup = parseMappedSuperclass(source)
      if (sup) out.set(sup.className, sup)
    }
  } catch {
    // ignore
  }
  return out
}

/** Extract class body handling brace nesting */
function extractClassBody(source: string, openBrace: number): string {
  let depth = 1
  let i = openBrace + 1
  while (i < source.length && depth > 0) {
    if (source[i] === '{') depth++
    else if (source[i] === '}') depth--
    i++
  }
  return source.slice(openBrace + 1, i - 1)
}

/** Parse fields from a class body.
 *  Uses a statement-splitting approach to handle annotations with nested parentheses. */
function parseFields(classBody: string): ParsedField[] {
  const fields: ParsedField[] = []

  // Split class body into statements by semicolons (respecting nesting)
  const statements = splitStatements(classBody)

  for (const stmt of statements) {
    const trimmed = stmt.trim()
    if (!trimmed) continue

    // Try to match: (annotations)? (access modifier) type name
    // First, separate annotations from the field declaration
    let annotationsStr = ''
    let declPart = trimmed

    // Collect leading annotations
    let pos = 0
    const annotationParts: string[] = []
    while (pos < trimmed.length) {
      // Skip whitespace
      while (pos < trimmed.length && /\s/.test(trimmed[pos])) pos++
      if (pos >= trimmed.length || trimmed[pos] !== '@') break

      // Found an annotation
      const annStart = pos
      pos++ // skip '@'
      // Read annotation name (allowing dotted nested forms like
      // `@EqualsAndHashCode.Include` from Lombok).
      while (pos < trimmed.length && /[\w.]/.test(trimmed[pos])) pos++
      // Skip whitespace before potential parens
      while (pos < trimmed.length && /\s/.test(trimmed[pos])) pos++
      // If '(' follows, consume the balanced paren group
      if (pos < trimmed.length && trimmed[pos] === '(') {
        let depth = 1
        pos++ // skip '('
        while (pos < trimmed.length && depth > 0) {
          if (trimmed[pos] === '(') depth++
          else if (trimmed[pos] === ')') depth--
          pos++
        }
      }
      annotationParts.push(trimmed.slice(annStart, pos))
    }

    if (annotationParts.length > 0) {
      annotationsStr = annotationParts.join(' ')
      declPart = trimmed.slice(pos).trim()
    }

    // Now declPart should be something like: "private String name"
    // or "private Long id" or "private List<Employee> employees"
    // eslint-disable-next-line no-useless-escape
    const declRe = /^(?:private|protected|public)\s+([\w<>\[\],\s?]+?)\s+(\w+)$/
    const declMatch = declPart.match(declRe)
    if (!declMatch) continue

    let javaType = declMatch[1].trim().replace(/\s+/g, ' ')
    const name = declMatch[2]

    // Also handle byte[] which regex might struggle with
    if (javaType === 'byte' && declPart.includes('byte[]')) {
      javaType = 'byte[]'
    }

    fields.push({ name, javaType, annotations: annotationsStr })
  }

  return fields
}

/** Split a class body into statements by semicolons, respecting brace nesting (for methods) */
function splitStatements(body: string): string[] {
  const statements: string[] = []
  let current = ''
  let braceDepth = 0

  for (let i = 0; i < body.length; i++) {
    const ch = body[i]
    if (ch === '{') {
      braceDepth++
      current += ch
    } else if (ch === '}') {
      braceDepth--
      current += ch
    } else if (ch === ';' && braceDepth === 0) {
      statements.push(current)
      current = ''
    } else {
      current += ch
    }
  }

  if (current.trim()) {
    statements.push(current)
  }

  return statements
}

// ─── Build DatabaseSchema ────────────────────────────────────────────────────

interface JpaParseOptions {
  /** Default schema name for all tables */
  schemaName?: string
  /**
   * If true, skip ID-based FK inference (e.g. for codebases that
   * deliberately store loose UUID references that aren't FKs).
   */
  disableIdFkInference?: boolean
  /** If true, do not emit `console.warn` for skipped entities. */
  suppressWarnings?: boolean
}

/**
 * For each table, find columns matching `<base>_id` whose type is UUID
 * or BIGINT and whose target table exists in `tables`. Add an inferred
 * FK if one isn't already declared.
 *
 * Matching strategy:
 *   - `amc_id`  → `amc` exact, then `amcs` plural
 *   - `user_id` → `user` exact, then `users` plural
 *   - skips if the FK already exists for the same (column, target)
 *   - skips ambiguous matches (multiple plausible targets)
 */
export function inferIdBasedForeignKeys(tables: Map<string, TableDef>, schemaName: string): void {
  const tableNames = new Set(tables.keys())

  for (const [tableName, table] of tables) {
    for (const [columnName, column] of table.columns) {
      // Only UUID / BIGINT / INTEGER columns ending in _id are candidates.
      if (!columnName.endsWith('_id')) continue
      if (
        column.dataType !== NormalizedType.UUID &&
        column.dataType !== NormalizedType.BIGINT &&
        column.dataType !== NormalizedType.INTEGER
      ) {
        continue
      }
      // Don't shadow an existing FK on this column.
      const alreadyHasFk = table.foreignKeys.some((fk) => fk.columns.includes(columnName))
      if (alreadyHasFk) continue

      const base = columnName.slice(0, -'_id'.length) // strip _id
      // Try singular first, then naive plural (`amc` → `amcs`),
      // then `(base)es` (`scheme` → `schemes`).
      const candidates = [base, `${base}s`, `${base}es`]
      const target = candidates.find((c) => tableNames.has(c) && c !== tableName)
      if (!target) continue

      table.foreignKeys.push({
        name: `fk_inferred_${tableName}_${columnName}`,
        columns: [columnName],
        referencedTable: target,
        referencedSchema: schemaName,
        referencedColumns: ['id'],
        onDelete: FKAction.NO_ACTION,
        onUpdate: FKAction.NO_ACTION,
        isDeferrable: false,
        isDeferred: false,
        isVirtual: true, // marker: this FK was inferred, not declared
      })
    }
  }
}

/** Convert a parsed entity into a TableDef */
function entityToTableDef(
  entity: ParsedEntity,
  enumMap: Map<string, ParsedJavaEnum>,
  options: JpaParseOptions,
): { table: TableDef; enums: EnumDef[]; joinTables: TableDef[] } {
  const schemaName = options.schemaName ?? 'public'

  // Determine table name
  const tableAnnotation = getAnnotationBody(entity.classAnnotations, 'Table')
  let tableName: string
  if (tableAnnotation !== null) {
    const nameAttr = extractAttr(tableAnnotation, 'name')
    tableName = nameAttr ?? classToTableName(entity.className)
  } else {
    tableName = classToTableName(entity.className)
  }

  const columns = new Map<string, ColumnDef>()
  const foreignKeys: ForeignKeyDef[] = []
  const uniqueConstraints: UniqueConstraintDef[] = []
  const enumDefs: EnumDef[] = []
  const joinTables: TableDef[] = []
  let primaryKey: PrimaryKeyDef | null = null

  for (const field of entity.fields) {
    const { annotations, javaType, name: fieldName } = field

    // Skip @OneToMany(mappedBy = ...) — inverse side
    if (hasAnnotation(annotations, 'OneToMany')) {
      const oneToManyBody = getAnnotationBody(annotations, 'OneToMany')
      if (oneToManyBody && extractAttr(oneToManyBody, 'mappedBy')) {
        continue
      }
    }

    // Handle @ManyToMany + @JoinTable
    if (hasAnnotation(annotations, 'ManyToMany')) {
      const joinTable = parseManyToMany(annotations, fieldName, tableName, javaType, schemaName)
      if (joinTable) {
        joinTables.push(joinTable)
      }
      continue
    }

    // Handle @ManyToOne / @OneToOne with @JoinColumn
    const isRelation =
      hasAnnotation(annotations, 'ManyToOne') || hasAnnotation(annotations, 'OneToOne')

    if (isRelation) {
      const fkResult = parseRelationField(annotations, fieldName, javaType, tableName, schemaName)
      if (fkResult) {
        columns.set(fkResult.column.name, fkResult.column)
        foreignKeys.push(fkResult.fk)
        if (fkResult.isId) {
          primaryKey = { columns: [fkResult.column.name], name: `pk_${tableName}` }
        }
      }
      continue
    }

    // Skip collection types that aren't relations
    if (/^(List|Set|Collection)</.test(javaType)) {
      continue
    }

    // Determine column name
    const columnAnnotation = getAnnotationBody(annotations, 'Column')
    let columnName: string
    if (columnAnnotation !== null) {
      const nameAttr = extractAttr(columnAnnotation, 'name')
      columnName = nameAttr ?? toSnakeCase(fieldName)
    } else {
      columnName = toSnakeCase(fieldName)
    }

    // Determine type
    const isEnumerated = hasAnnotation(annotations, 'Enumerated')
    let dataType: NormalizedType
    let nativeType: string
    let enumValues: string[] | null = null

    if (isEnumerated) {
      dataType = NormalizedType.ENUM
      nativeType = javaType

      // Try to find enum values
      const foundEnum = enumMap.get(javaType)
      if (foundEnum) {
        enumValues = foundEnum.values
        enumDefs.push({
          name: toSnakeCase(javaType),
          schema: schemaName,
          values: foundEnum.values,
        })
      } else {
        // Generate guessed values based on type name
        enumValues = guessEnumValues(javaType)
        enumDefs.push({
          name: toSnakeCase(javaType),
          schema: schemaName,
          values: enumValues,
        })
      }
    } else {
      const mapped = JAVA_TYPE_MAP[javaType]
      dataType = mapped ?? NormalizedType.UNKNOWN
      nativeType = javaType
    }

    // Parse @Column attributes
    let isNullable = true
    let maxLength: number | null = null
    let numericPrecision: number | null = null
    let numericScale: number | null = null
    let isUnique = false

    if (columnAnnotation !== null) {
      const nullableAttr = extractBoolAttr(columnAnnotation, 'nullable')
      if (nullableAttr !== null) isNullable = nullableAttr

      const uniqueAttr = extractBoolAttr(columnAnnotation, 'unique')
      if (uniqueAttr !== null) isUnique = uniqueAttr

      maxLength = extractNumericAttr(columnAnnotation, 'length')
      numericPrecision = extractNumericAttr(columnAnnotation, 'precision')
      numericScale = extractNumericAttr(columnAnnotation, 'scale')
    }

    // Determine if this is an ID field
    const isId = hasAnnotation(annotations, 'Id')

    // Determine auto-increment
    let isAutoIncrement = false
    if (hasAnnotation(annotations, 'GeneratedValue')) {
      const genBody = getAnnotationBody(annotations, 'GeneratedValue')
      if (genBody) {
        const strategy = extractAttr(genBody, 'strategy')
        if (
          strategy &&
          (strategy.includes('IDENTITY') ||
            strategy.includes('AUTO') ||
            strategy.includes('SEQUENCE'))
        ) {
          isAutoIncrement = true
        }
      } else {
        // @GeneratedValue with no params defaults to AUTO
        isAutoIncrement = true
      }
    }

    // Check for timestamp annotations
    let hasDefault = false
    let defaultValue: string | null = null
    const isGenerated =
      hasAnnotation(annotations, 'CreationTimestamp') ||
      hasAnnotation(annotations, 'UpdateTimestamp')
    if (isGenerated) {
      hasDefault = true
      defaultValue = 'CURRENT_TIMESTAMP'
    }

    // If @Id, typically not nullable
    if (isId) {
      isNullable = false
    }

    // For VARCHAR without explicit length, set default 255
    if (dataType === NormalizedType.VARCHAR && maxLength === null) {
      maxLength = 255
    }

    const colDef: ColumnDef = {
      name: columnName,
      dataType,
      nativeType,
      isNullable,
      hasDefault: hasDefault || isAutoIncrement,
      defaultValue,
      isAutoIncrement,
      isGenerated,
      maxLength,
      numericPrecision,
      numericScale,
      enumValues,
      comment: null,
    }

    columns.set(columnName, colDef)

    if (isId) {
      primaryKey = { columns: [columnName], name: `pk_${tableName}` }
    }

    if (isUnique) {
      uniqueConstraints.push({
        columns: [columnName],
        name: `uq_${tableName}_${columnName}`,
      })
    }
  }

  const table: TableDef = {
    name: tableName,
    schema: schemaName,
    columns,
    primaryKey,
    foreignKeys,
    uniqueConstraints,
    checkConstraints: [],
    indexes: [],
    comment: null,
  }

  return { table, enums: enumDefs, joinTables }
}

/** Parse a @ManyToOne or @OneToOne relation field into a column + FK */
function parseRelationField(
  annotations: string,
  fieldName: string,
  javaType: string,
  ownerTable: string,
  schemaName: string,
): { column: ColumnDef; fk: ForeignKeyDef; isId: boolean } | null {
  const joinColBody = getAnnotationBody(annotations, 'JoinColumn')

  let columnName: string
  let referencedColumnName = 'id'

  if (joinColBody !== null) {
    const nameAttr = extractAttr(joinColBody, 'name')
    columnName = nameAttr ?? `${toSnakeCase(fieldName)}_id`
    const refCol = extractAttr(joinColBody, 'referencedColumnName')
    if (refCol) referencedColumnName = refCol
  } else {
    columnName = `${toSnakeCase(fieldName)}_id`
  }

  // Determine nullability from @JoinColumn or relation annotation
  let isNullable = true
  if (joinColBody !== null) {
    const nullableAttr = extractBoolAttr(joinColBody, 'nullable')
    if (nullableAttr !== null) isNullable = nullableAttr
  }

  // Determine referenced table name (snake_case of the Java type)
  const referencedTable = toSnakeCase(javaType.replace(/<.*>/, ''))

  // Determine cascade / FK actions
  let onDelete = FKAction.NO_ACTION
  const onUpdate = FKAction.NO_ACTION

  // Check for cascade type on relation annotation
  const relationAnnotation = hasAnnotation(annotations, 'ManyToOne') ? 'ManyToOne' : 'OneToOne'
  const relationBody = getAnnotationBody(annotations, relationAnnotation)
  if (relationBody) {
    const cascadeAttr = extractAttr(relationBody, 'cascade')
    if (cascadeAttr && (cascadeAttr.includes('ALL') || cascadeAttr.includes('REMOVE'))) {
      onDelete = FKAction.CASCADE
    }
  }

  const isId = hasAnnotation(annotations, 'Id')

  const column: ColumnDef = {
    name: columnName,
    dataType: NormalizedType.BIGINT,
    nativeType: 'Long',
    isNullable,
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

  const fk: ForeignKeyDef = {
    name: `fk_${ownerTable}_${columnName}`,
    columns: [columnName],
    referencedTable,
    referencedSchema: schemaName,
    referencedColumns: [referencedColumnName],
    onDelete,
    onUpdate,
    isDeferrable: false,
    isDeferred: false,
    isVirtual: false,
  }

  return { column, fk, isId }
}

/** Parse @ManyToMany + @JoinTable into a join table */
function parseManyToMany(
  annotations: string,
  fieldName: string,
  ownerTableName: string,
  javaType: string,
  schemaName: string,
): TableDef | null {
  // If mappedBy is set, this is the inverse side
  const manyToManyBody = getAnnotationBody(annotations, 'ManyToMany')
  if (manyToManyBody && extractAttr(manyToManyBody, 'mappedBy')) {
    return null
  }

  const joinTableBody = getAnnotationBody(annotations, 'JoinTable')

  let joinTableName: string
  let joinColumnName: string
  let inverseJoinColumnName: string

  // Extract type from generic: Set<Tag> → Tag
  const genericMatch = javaType.match(/<(\w+)>/)
  const targetType = genericMatch ? genericMatch[1] : fieldName
  const targetTable = toSnakeCase(targetType)

  if (joinTableBody !== null) {
    const nameAttr = extractAttr(joinTableBody, 'name')
    joinTableName = nameAttr ?? `${ownerTableName}_${targetTable}`

    // Parse joinColumns
    const joinColumnsMatch = joinTableBody.match(
      /joinColumns\s*=\s*@JoinColumn\s*\(\s*name\s*=\s*"([^"]*)"\s*\)/,
    )
    joinColumnName = joinColumnsMatch ? joinColumnsMatch[1] : `${ownerTableName}_id`

    // Parse inverseJoinColumns
    const inverseMatch = joinTableBody.match(
      /inverseJoinColumns\s*=\s*@JoinColumn\s*\(\s*name\s*=\s*"([^"]*)"\s*\)/,
    )
    inverseJoinColumnName = inverseMatch ? inverseMatch[1] : `${targetTable}_id`
  } else {
    joinTableName = `${ownerTableName}_${targetTable}`
    joinColumnName = `${ownerTableName}_id`
    inverseJoinColumnName = `${targetTable}_id`
  }

  const columns = new Map<string, ColumnDef>()
  columns.set(joinColumnName, {
    name: joinColumnName,
    dataType: NormalizedType.BIGINT,
    nativeType: 'Long',
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

  columns.set(inverseJoinColumnName, {
    name: inverseJoinColumnName,
    dataType: NormalizedType.BIGINT,
    nativeType: 'Long',
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
    name: joinTableName,
    schema: schemaName,
    columns,
    primaryKey: {
      columns: [joinColumnName, inverseJoinColumnName],
      name: `pk_${joinTableName}`,
    },
    foreignKeys: [
      {
        name: `fk_${joinTableName}_${joinColumnName}`,
        columns: [joinColumnName],
        referencedTable: ownerTableName,
        referencedSchema: schemaName,
        referencedColumns: ['id'],
        onDelete: FKAction.CASCADE,
        onUpdate: FKAction.NO_ACTION,
        isDeferrable: false,
        isDeferred: false,
        isVirtual: false,
      },
      {
        name: `fk_${joinTableName}_${inverseJoinColumnName}`,
        columns: [inverseJoinColumnName],
        referencedTable: targetTable,
        referencedSchema: schemaName,
        referencedColumns: ['id'],
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

  return joinTable
}

/** Guess enum values from a type name when actual enum class isn't available */
function guessEnumValues(typeName: string): string[] {
  // Common patterns
  const lower = typeName.toLowerCase()
  if (lower.includes('status')) return ['ACTIVE', 'INACTIVE', 'PENDING']
  if (lower.includes('role')) return ['ADMIN', 'USER', 'EDITOR']
  if (lower.includes('type')) return ['TYPE_A', 'TYPE_B', 'TYPE_C']
  if (lower.includes('priority')) return ['LOW', 'MEDIUM', 'HIGH']
  if (lower.includes('category')) return ['CATEGORY_A', 'CATEGORY_B', 'CATEGORY_C']
  return ['VALUE_1', 'VALUE_2', 'VALUE_3']
}

// ─── File scanning ───────────────────────────────────────────────────────────

/** Recursively scan a directory for .java files */
export function scanJavaFiles(dir: string): string[] {
  const results: string[] = []
  try {
    const entries = readdirSync(dir)
    for (const entry of entries) {
      const fullPath = join(dir, entry)
      try {
        const stat = statSync(fullPath)
        if (stat.isDirectory()) {
          results.push(...scanJavaFiles(fullPath))
        } else if (entry.endsWith('.java')) {
          results.push(fullPath)
        }
      } catch {
        // Skip unreadable entries
      }
    }
  } catch {
    // Directory unreadable
  }
  return results
}

// ─── Main parse function ─────────────────────────────────────────────────────

/** Parse a single Java source file into entities */
export function parseJavaFile(
  filePath: string,
  enumMap: Map<string, ParsedJavaEnum>,
  options: JpaParseOptions = {},
  mappedSuperclasses?: Map<string, ParsedEntity>,
): { table: TableDef; enums: EnumDef[]; joinTables: TableDef[] } | null {
  const source = readFileSync(filePath, 'utf-8')

  // Also scan enums in this file
  const localEnums = parseJavaEnums(source)
  for (const e of localEnums) {
    enumMap.set(e.name, e)
  }

  const entity = parseEntityClass(source, dirname(filePath))
  if (!entity) return null

  if (mappedSuperclasses) {
    inheritMappedSuperclassFields(entity, mappedSuperclasses)
  }

  return entityToTableDef(entity, enumMap, options)
}

/**
 * If `entity extends X` and X is a known @MappedSuperclass, prepend X's
 * fields to the entity's field list. Walks the chain so X-extends-Y
 * inherits Y's fields too. Subclass-declared fields take precedence
 * (same column name = subclass wins).
 */
function inheritMappedSuperclassFields(
  entity: ParsedEntity,
  mappedSuperclasses: Map<string, ParsedEntity>,
): void {
  const inherited: ParsedField[] = []
  let parentName = entity.extendsName
  const seen = new Set<string>()
  while (parentName && !seen.has(parentName)) {
    seen.add(parentName)
    const parent = mappedSuperclasses.get(parentName)
    if (!parent) break
    // Prepend so root-most ancestor's fields come first; later passes
    // override by name as needed.
    inherited.unshift(...parent.fields)
    parentName = parent.extendsName
  }
  if (inherited.length === 0) return
  // Subclass fields override inherited fields with the same Java field
  // name (rare but legal).
  const subclassNames = new Set(entity.fields.map((f) => f.name))
  const filtered = inherited.filter((f) => !subclassNames.has(f.name))
  entity.fields = [...filtered, ...entity.fields]
}

/** Parse a single Java source string (for testing / programmatic use) */
export function parseJavaSource(
  source: string,
  options: JpaParseOptions = {},
  enumMap?: Map<string, ParsedJavaEnum>,
): { table: TableDef; enums: EnumDef[]; joinTables: TableDef[] } | null {
  const effectiveEnumMap = enumMap ?? new Map<string, ParsedJavaEnum>()

  // Also scan enums in this source
  const localEnums = parseJavaEnums(source)
  for (const e of localEnums) {
    effectiveEnumMap.set(e.name, e)
  }

  const entity = parseEntityClass(source, '')
  if (!entity) return null

  return entityToTableDef(entity, effectiveEnumMap, options)
}

/** Parse all JPA entity files in a directory into a DatabaseSchema */
export function parseJpaDirectory(
  directory: string,
  options: JpaParseOptions = {},
): DatabaseSchema {
  const schemaName = options.schemaName ?? 'public'

  // First pass: scan all enums. Look in the entity directory itself, but
  // also look up the tree to the Java source root so value-object enums
  // declared in sibling packages (a DDD convention) are picked up.
  const enumMap = scanForEnums(directory)
  const sourceRoot = findJavaSourceRoot(directory)
  if (sourceRoot && sourceRoot !== directory) {
    const wider = scanForEnums(sourceRoot)
    for (const [name, value] of wider) {
      // Don't overwrite enums already found in the more specific scan.
      if (!enumMap.has(name)) enumMap.set(name, value)
    }
  }

  // Second pass: scan @MappedSuperclass declarations from the source
  // root so subclass entities can inherit @Id / timestamp fields.
  const mappedSuperclasses = sourceRoot
    ? scanForMappedSuperclasses(sourceRoot)
    : scanForMappedSuperclasses(directory)

  // Third pass: scan for entity files
  const javaFiles = scanJavaFiles(directory)
  const entityFiles = javaFiles.filter((f) => {
    const content = readFileSync(f, 'utf-8')
    return /@Entity\b/.test(content) && !/@MappedSuperclass\b/.test(content)
  })

  const tables = new Map<string, TableDef>()
  const enums = new Map<string, EnumDef>()
  const skipped: { file: string; reason: string }[] = []

  for (const file of entityFiles) {
    const result = parseJavaFile(file, enumMap, options, mappedSuperclasses)
    if (!result) {
      skipped.push({ file, reason: 'no @Entity class declaration found' })
      continue
    }
    if (!result.table.primaryKey) {
      skipped.push({ file, reason: 'no @Id annotation found on any field' })
      continue
    }

    tables.set(result.table.name, result.table)

    for (const enumDef of result.enums) {
      enums.set(enumDef.name, enumDef)
    }

    for (const joinTable of result.joinTables) {
      tables.set(joinTable.name, joinTable)
    }
  }

  // Third pass: ID-based FK inference for DDD-style entities that store
  // references as raw UUID/Long fields without @ManyToOne. For each
  // column matching `<base>_id`, look up an entity whose table name
  // matches `<base>` (singular or plural) and infer the FK if one
  // doesn't already exist.
  if (!options.disableIdFkInference) {
    inferIdBasedForeignKeys(tables, schemaName)
  }

  if (skipped.length > 0 && !options.suppressWarnings) {
    for (const { file, reason } of skipped) {
      console.warn(`WARNING [SF2010]: skipped JPA entity ${file}: ${reason}`)
    }
  }

  return {
    name: schemaName,
    tables,
    enums,
    schemas: [schemaName],
  }
}
