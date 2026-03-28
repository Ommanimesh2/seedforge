import { describe, it, expect } from 'vitest'
import { faker } from '@faker-js/faker'
import { scoreColumn } from '../token-scorer.js'
import { mapColumn } from '../mapper.js'
import { NormalizedType } from '../../types/schema.js'
import { MappingSource } from '../types.js'
import type { ColumnDef } from '../../types/schema.js'

function makeColumn(overrides: Partial<ColumnDef> = {}): ColumnDef {
  return {
    name: 'test_col',
    dataType: NormalizedType.TEXT,
    nativeType: 'text',
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
    ...overrides,
  }
}

describe('scoreColumn', () => {
  it('financial_data_set → finance domain', () => {
    const result = scoreColumn('financial_data_set', 'reports', NormalizedType.TEXT)
    expect(result).not.toBeNull()
    expect(result!.domain).toBe('finance')
    expect(result!.score).toBeGreaterThanOrEqual(0.5)
  })

  it('patient_diagnosis → medical domain', () => {
    const result = scoreColumn('patient_diagnosis', 'records', NormalizedType.TEXT)
    expect(result).not.toBeNull()
    expect(result!.domain).toBe('medical')
    expect(result!.score).toBeGreaterThanOrEqual(0.5)
  })

  it('vehicle_registration → transport domain', () => {
    // "vehicle" has weight 1.0 for transport, "registration" has weight 0.3 for transport
    // and 0.5 for identifiers. transport total = 1.3, identifiers total = 0.5
    const result = scoreColumn('vehicle_registration', 'vehicles', NormalizedType.TEXT)
    expect(result).not.toBeNull()
    expect(result!.domain).toBe('transport')
  })

  it('unknown_xyz_abc → null (no match)', () => {
    const result = scoreColumn('unknown_xyz_abc', 'test', NormalizedType.TEXT)
    expect(result).toBeNull()
  })

  it('all_noise_words → null', () => {
    const result = scoreColumn('data_type_value', 'test', NormalizedType.TEXT)
    expect(result).toBeNull()
  })

  it('finance domain with DECIMAL type → finance amount generator', () => {
    const result = scoreColumn('financial_data_set', 'reports', NormalizedType.DECIMAL)
    expect(result).not.toBeNull()
    expect(result!.domain).toBe('finance')
    expect(result!.fakerMethod).toContain('finance')
  })

  it('medical domain with TEXT type → lorem sentence generator', () => {
    const result = scoreColumn('patient_diagnosis', 'records', NormalizedType.TEXT)
    expect(result).not.toBeNull()
    expect(result!.domain).toBe('medical')
  })

  it('transport domain with VARCHAR type → vehicle generator', () => {
    const result = scoreColumn('vehicle_registration', 'fleet', NormalizedType.VARCHAR)
    expect(result).not.toBeNull()
    expect(result!.domain).toBe('transport')
    expect(result!.fakerMethod).toContain('vehicle')
  })

  it('handles camelCase column names', () => {
    const result = scoreColumn('patientDiagnosis', 'records', NormalizedType.TEXT)
    expect(result).not.toBeNull()
    expect(result!.domain).toBe('medical')
  })

  it('filters noise tokens before scoring', () => {
    // "hospital" alone should be enough for medical
    const result = scoreColumn('hospital_data', 'records', NormalizedType.TEXT)
    expect(result).not.toBeNull()
    expect(result!.domain).toBe('medical')
  })

  it('generator produces valid values', () => {
    faker.seed(42)
    const result = scoreColumn('financial_summary', 'reports', NormalizedType.TEXT)
    expect(result).not.toBeNull()
    const value = result!.generator(faker, 0)
    expect(value).toBeDefined()
    expect(typeof value === 'string' || typeof value === 'number').toBe(true)
  })
})

describe('stem scorer integration with mapColumn', () => {
  it('student_enrollment_date → temporal domain (suffix _date wins first)', () => {
    // The _date suffix should match via existing suffix matcher (higher priority)
    const col = makeColumn({ name: 'student_enrollment_date', dataType: NormalizedType.DATE })
    const result = mapColumn(col, 'students')

    // Existing suffix match for "_date" should win before stem scoring
    expect(result.source).toBe(MappingSource.SUFFIX)
    expect(result.domain).toBe('temporal')
  })

  it('financial_data_set with JSONB type → type fallback (JSON shortcut)', () => {
    // JSON/JSONB columns should skip all name heuristics including stem scoring
    const col = makeColumn({ name: 'financial_data_set', dataType: NormalizedType.JSONB })
    const result = mapColumn(col, 'reports')

    expect(result.source).toBe(MappingSource.TYPE_FALLBACK)
    expect(result.domain).toBe('type')
  })

  it('financial_data_set with ARRAY type → type fallback (ARRAY shortcut)', () => {
    const col = makeColumn({ name: 'financial_data_set', dataType: NormalizedType.ARRAY })
    const result = mapColumn(col, 'reports')

    expect(result.source).toBe(MappingSource.TYPE_FALLBACK)
    expect(result.domain).toBe('type')
  })

  it('hospital_ward with TEXT type → stem match (medical domain)', () => {
    // "hospital" is not an exact/suffix/prefix/pattern match in existing domains
    // but should be caught by the stem scorer
    const col = makeColumn({ name: 'hospital_ward', dataType: NormalizedType.TEXT })
    const result = mapColumn(col, 'facilities')

    expect(result.source).toBe(MappingSource.STEM_MATCH)
    expect(result.domain).toBe('medical')
    expect(result.generator).not.toBeNull()
  })

  it('vehicle_fuel_type with VARCHAR → stem match (transport domain)', () => {
    const col = makeColumn({ name: 'vehicle_fuel_type', dataType: NormalizedType.VARCHAR })
    const result = mapColumn(col, 'fleet')

    expect(result.source).toBe(MappingSource.STEM_MATCH)
    expect(result.domain).toBe('transport')
  })

  it('unknown_xyz_abc → type fallback (stem scorer returns null)', () => {
    const col = makeColumn({ name: 'unknown_xyz_abc', dataType: NormalizedType.INTEGER })
    const result = mapColumn(col, 'test_table')

    expect(result.source).toBe(MappingSource.TYPE_FALLBACK)
  })

  it('CHECK constraint still works when stem match fails', () => {
    const col = makeColumn({ name: 'priority_level', dataType: NormalizedType.VARCHAR })
    const constraints = [
      {
        expression: "priority_level IN ('low', 'medium', 'high')",
        name: 'chk_priority',
        inferredValues: ['low', 'medium', 'high'],
      },
    ]
    const result = mapColumn(col, 'tasks', constraints)

    // priority_level doesn't match any strong domain stems
    // so it falls through to CHECK constraint
    expect(result.source).toBe(MappingSource.CHECK_CONSTRAINT)
  })
})
