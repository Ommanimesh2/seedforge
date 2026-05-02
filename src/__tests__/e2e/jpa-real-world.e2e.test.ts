/**
 * E2e coverage for Wave 1.4 — JPA real-world hardening.
 *
 * Validates the parser against a vendored DDD-style codebase where
 * entities use raw UUID `_id` references (not @ManyToOne), inherit
 * id/timestamps from a @MappedSuperclass, and reference enum
 * value-objects in a sibling package. These are the patterns from
 * Curie's transactions-service that the previous parser broke on.
 *
 * The fixture lives at src/__tests__/e2e/fixtures/jpa-real-world/.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { parseJpaDirectory, inferIdBasedForeignKeys } from '../../parsers/jpa/parser.js'
import { NormalizedType } from '../../types/schema.js'

const here = dirname(fileURLToPath(import.meta.url))
const ENTITY_DIR = join(here, 'fixtures', 'jpa-real-world', 'domain', 'entity')

describe('JPA real-world parsing (e2e)', () => {
  let warnSpy: ReturnType<typeof vi.spyOn>

  beforeEach(() => {
    warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
  })

  afterEach(() => {
    warnSpy.mockRestore()
  })

  it('parses DDD entities — BaseEntity merged, real tables only', () => {
    const schema = parseJpaDirectory(ENTITY_DIR)

    // BaseEntity is @MappedSuperclass and must NOT appear as a table.
    expect(schema.tables.has('base_entity')).toBe(false)
    expect([...schema.tables.keys()].sort()).toEqual(['amcs', 'folios', 'scheme_navs', 'schemes'])
  })

  it('inherits @Id, created_at, updated_at from BaseEntity', () => {
    const schema = parseJpaDirectory(ENTITY_DIR)

    for (const tableName of ['amcs', 'folios', 'schemes', 'scheme_navs']) {
      const table = schema.tables.get(tableName)!
      expect(table.primaryKey?.columns).toEqual(['id'])
      expect(table.columns.has('id')).toBe(true)
      expect(table.columns.has('created_at')).toBe(true)
      expect(table.columns.has('updated_at')).toBe(true)
      const idCol = table.columns.get('id')!
      expect(idCol.dataType).toBe(NormalizedType.UUID)
    }
  })

  it('reads real enum constants from sibling package (commons/valueobject)', () => {
    const schema = parseJpaDirectory(ENTITY_DIR)

    // The Rta enum lives in commons/valueobject/, NOT in the entity dir.
    // Without the source-root scan, the previous parser produced
    // (VALUE_1, VALUE_2, VALUE_3). Now it produces real constants.
    expect(schema.enums.get('rta')?.values).toEqual(['KFINTECH', 'CAMS'])
    expect(schema.enums.get('scheme_type')?.values).toEqual(['EQUITY', 'DEBT', 'HYBRID', 'OTHER'])

    // The columns that reference these enums also carry the real values.
    expect(schema.tables.get('amcs')!.columns.get('rta')!.enumValues).toEqual(['KFINTECH', 'CAMS'])
    expect(schema.tables.get('schemes')!.columns.get('scheme_type')!.enumValues).toEqual([
      'EQUITY',
      'DEBT',
      'HYBRID',
      'OTHER',
    ])
  })

  it('infers FKs from raw UUID `<name>_id` columns (DDD style, no @ManyToOne)', () => {
    const schema = parseJpaDirectory(ENTITY_DIR)

    // folios.amc_id → amcs.id  (no @ManyToOne in the entity)
    const folios = schema.tables.get('folios')!
    expect(folios.foreignKeys).toHaveLength(1)
    expect(folios.foreignKeys[0]).toMatchObject({
      columns: ['amc_id'],
      referencedTable: 'amcs',
      referencedColumns: ['id'],
      isVirtual: true, // marker that this FK was inferred, not declared
    })

    // schemes.amc_id → amcs.id
    const schemes = schema.tables.get('schemes')!
    expect(schemes.foreignKeys.some((fk) => fk.referencedTable === 'amcs')).toBe(true)

    // scheme_navs.scheme_id → schemes.id
    const navs = schema.tables.get('scheme_navs')!
    expect(navs.foreignKeys.some((fk) => fk.referencedTable === 'schemes')).toBe(true)

    // user_id has no matching `users` entity → no FK inferred (correct).
    expect(folios.foreignKeys.some((fk) => fk.columns.includes('user_id'))).toBe(false)
  })

  it('honors disableIdFkInference for codebases with loose UUID references', () => {
    const schema = parseJpaDirectory(ENTITY_DIR, { disableIdFkInference: true })
    const folios = schema.tables.get('folios')!
    expect(folios.foreignKeys).toHaveLength(0)
  })

  it('inferIdBasedForeignKeys is idempotent and skips ambiguous targets', () => {
    const schema = parseJpaDirectory(ENTITY_DIR)
    const before = schema.tables.get('folios')!.foreignKeys.length
    inferIdBasedForeignKeys(schema.tables, 'public')
    const after = schema.tables.get('folios')!.foreignKeys.length
    expect(after).toBe(before)
  })
})
