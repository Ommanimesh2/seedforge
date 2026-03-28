import type { ColumnDef, TableDef, CheckConstraintDef } from '../types/schema.js'
import { NormalizedType } from '../types/schema.js'
import {
  ConfidenceLevel,
  MappingSource,
  type ColumnMapping,
  type MappingResult,
} from './types.js'
import { normalizeColumnName } from './normalize.js'
import { buildRegistry, type Registry } from './registry.js'
import { handleEnumValues, handleCheckConstraint } from './constraint-handlers.js'
import { createSafeEmailGenerator } from './safe-email.js'
import { getTypeFallback } from './type-fallback.js'
import { scoreColumn } from './token-scorer.js'

// Build the registry once at module load time
let registry: Registry | null = null

function getRegistry(): Registry {
  if (!registry) {
    registry = buildRegistry()
  }
  return registry
}

const safeEmailGenerator = createSafeEmailGenerator()

/**
 * Maps a single column to a faker generator using the multi-tier detection algorithm:
 *
 * 1. Enum values (if column.enumValues is populated)
 * 2. Auto-increment / generated columns (skip)
 * 3. JSON/JSONB/ARRAY type shortcut (skip name heuristics)
 * 4. Exact name match (HIGH confidence)
 * 5. Suffix match (MEDIUM confidence)
 * 6. Prefix match (MEDIUM confidence)
 * 7. Pattern/regex match (MEDIUM confidence)
 * 8. Stem-based semantic match (MEDIUM confidence)
 * 9. CHECK constraint inferred values (HIGH confidence)
 * 10. Type-based fallback (LOW confidence)
 */
export function mapColumn(
  column: ColumnDef,
  tableName: string,
  checkConstraints: CheckConstraintDef[] = [],
): ColumnMapping {
  // 1. Enum values take highest priority
  const enumMapping = handleEnumValues(column, tableName)
  if (enumMapping) {
    return enumMapping
  }

  // 2. Auto-increment and generated columns are skipped
  if (column.isAutoIncrement || column.isGenerated) {
    return {
      column: column.name,
      table: tableName,
      generator: null,
      confidence: ConfidenceLevel.HIGH,
      source: MappingSource.AUTO_INCREMENT,
      fakerMethod: 'skip (auto-increment/generated)',
      domain: 'auto',
    }
  }

  // 3. For JSON/JSONB/ARRAY columns, skip name heuristics — they produce string values
  //    that are invalid for structured types. Go straight to type fallback.
  if (column.dataType === NormalizedType.JSON || column.dataType === NormalizedType.JSONB || column.dataType === NormalizedType.ARRAY) {
    const fallback = getTypeFallback(column)
    return {
      column: column.name,
      table: tableName,
      generator: fallback.generator,
      confidence: ConfidenceLevel.LOW,
      source: MappingSource.TYPE_FALLBACK,
      fakerMethod: fallback.fakerMethod,
      domain: 'type',
    }
  }

  // 4. Normalize column name for pattern matching
  const lowered = column.name.toLowerCase()
  const normalized = normalizeColumnName(column.name, tableName)
  const reg = getRegistry()

  // 4. Exact name match — try original lowercased name first, then normalized
  // This ensures "product_name" on a "products" table still matches commerce
  // before normalization strips the table prefix to just "name"
  const namesToTry = lowered !== normalized ? [lowered, normalized] : [normalized]
  for (const candidate of namesToTry) {
    const exactMatch = reg.exactNames.get(candidate)
    if (exactMatch) {
      // Boolean domain only applies to BOOLEAN-typed columns
      if (exactMatch.domain === 'boolean' && column.dataType !== NormalizedType.BOOLEAN) {
        continue
      }

      // Special handling for email generators: use safe email
      const generator =
        exactMatch.domain === 'contact' && exactMatch.fakerMethod.includes('email')
          ? safeEmailGenerator
          : exactMatch.generator

      return {
        column: column.name,
        table: tableName,
        generator,
        confidence: ConfidenceLevel.HIGH,
        source: MappingSource.EXACT_NAME,
        fakerMethod: exactMatch.fakerMethod,
        domain: exactMatch.domain,
      }
    }
  }

  // 5. Suffix match (longest first due to sorted registry)
  for (const { suffix, entry } of reg.suffixes) {
    // Suffix must match at a word boundary: the suffix includes the leading underscore
    // e.g., "_email" should match "contact_email" but not "femail"
    if (normalized.endsWith(suffix) && normalized.length > suffix.length) {
      // Boolean domain only applies to BOOLEAN-typed columns
      if (entry.domain === 'boolean' && column.dataType !== NormalizedType.BOOLEAN) {
        continue
      }

      // Special handling for email generators: use safe email
      const generator =
        entry.domain === 'contact' && entry.fakerMethod.includes('email')
          ? safeEmailGenerator
          : entry.generator

      return {
        column: column.name,
        table: tableName,
        generator,
        confidence: ConfidenceLevel.MEDIUM,
        source: MappingSource.SUFFIX,
        fakerMethod: entry.fakerMethod,
        domain: entry.domain,
      }
    }
  }

  // 6. Prefix match
  for (const { prefix, entry } of reg.prefixes) {
    if (normalized.startsWith(prefix.replace(/_$/, '') + '_') || normalized.startsWith(prefix)) {
      // Boolean domain only applies to BOOLEAN-typed columns
      if (entry.domain === 'boolean' && column.dataType !== NormalizedType.BOOLEAN) {
        continue
      }

      return {
        column: column.name,
        table: tableName,
        generator: entry.generator,
        confidence: ConfidenceLevel.MEDIUM,
        source: MappingSource.PREFIX,
        fakerMethod: entry.fakerMethod,
        domain: entry.domain,
      }
    }
  }

  // 7. Pattern/regex match
  for (const { pattern, entry } of reg.patterns) {
    if (pattern.test(normalized)) {
      // Boolean domain only applies to BOOLEAN-typed columns
      if (entry.domain === 'boolean' && column.dataType !== NormalizedType.BOOLEAN) {
        continue
      }

      return {
        column: column.name,
        table: tableName,
        generator: entry.generator,
        confidence: ConfidenceLevel.MEDIUM,
        source: MappingSource.PATTERN,
        fakerMethod: entry.fakerMethod,
        domain: entry.domain,
      }
    }
  }

  // 8. Stem-based semantic matching — tokenize, stem, and score against domain dictionary
  const stemResult = scoreColumn(column.name, tableName, column.dataType)
  if (stemResult) {
    return {
      column: column.name,
      table: tableName,
      generator: stemResult.generator,
      confidence: ConfidenceLevel.MEDIUM,
      source: MappingSource.STEM_MATCH,
      fakerMethod: stemResult.fakerMethod,
      domain: stemResult.domain,
    }
  }

  // 9. CHECK constraint handler
  const checkMapping = handleCheckConstraint(column, tableName, checkConstraints)
  if (checkMapping) {
    return checkMapping
  }

  // 10. Type-based fallback
  const fallback = getTypeFallback(column)
  return {
    column: column.name,
    table: tableName,
    generator: fallback.generator,
    confidence: ConfidenceLevel.LOW,
    source: MappingSource.TYPE_FALLBACK,
    fakerMethod: fallback.fakerMethod,
    domain: 'type_fallback',
  }
}

/**
 * Maps all columns in a table to faker generators.
 * Returns a MappingResult with all mappings and any unmapped columns.
 */
export function mapTable(
  table: TableDef,
  checkConstraints?: CheckConstraintDef[],
): MappingResult {
  const mappings = new Map<string, ColumnMapping>()
  const unmapped: string[] = []
  const constraints = checkConstraints ?? table.checkConstraints

  for (const [columnName, column] of table.columns) {
    const mapping = mapColumn(column, table.name, constraints)
    mappings.set(columnName, mapping)
  }

  return {
    mappings,
    tableName: table.name,
    unmapped,
  }
}
