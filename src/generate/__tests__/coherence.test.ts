import { describe, it, expect } from 'vitest'
import { detectCoherenceGroups, generateCoherentRow } from '../coherence.js'
import { createSeededFaker } from '../../mapping/seeded-faker.js'
import type { TableDef, ColumnDef } from '../../types/schema.js'
import { NormalizedType } from '../../types/schema.js'

function makeColumn(name: string, overrides: Partial<ColumnDef> = {}): ColumnDef {
  return {
    name,
    dataType: NormalizedType.VARCHAR,
    nativeType: 'varchar',
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

function makeTable(
  name: string,
  columns: [string, Partial<ColumnDef>][],
): TableDef {
  return {
    name,
    schema: 'public',
    columns: new Map(
      columns.map(([colName, overrides]) => [colName, makeColumn(colName, overrides)]),
    ),
    primaryKey: null,
    foreignKeys: [],
    uniqueConstraints: [],
    checkConstraints: [],
    indexes: [],
    comment: null,
  }
}

describe('detectCoherenceGroups', () => {
  describe('name-gender detection', () => {
    it('detects first_name + gender pair', () => {
      const table = makeTable('users', [
        ['id', { dataType: NormalizedType.UUID }],
        ['first_name', {}],
        ['last_name', {}],
        ['gender', {}],
      ])

      const groups = detectCoherenceGroups(table)
      const nameGender = groups.find(g => g.type === 'name-gender')

      expect(nameGender).toBeDefined()
      expect(nameGender!.columns).toEqual(['first_name', 'gender'])
    })

    it('detects first_name + sex pair', () => {
      const table = makeTable('people', [
        ['first_name', {}],
        ['sex', {}],
      ])

      const groups = detectCoherenceGroups(table)
      const nameGender = groups.find(g => g.type === 'name-gender')

      expect(nameGender).toBeDefined()
      expect(nameGender!.columns).toContain('sex')
    })

    it('does not detect when only first_name exists', () => {
      const table = makeTable('users', [
        ['first_name', {}],
        ['email', {}],
      ])

      const groups = detectCoherenceGroups(table)
      const nameGender = groups.find(g => g.type === 'name-gender')

      expect(nameGender).toBeUndefined()
    })
  })

  describe('location detection', () => {
    it('detects city + state pair', () => {
      const table = makeTable('addresses', [
        ['id', { dataType: NormalizedType.UUID }],
        ['city', {}],
        ['state', {}],
      ])

      const groups = detectCoherenceGroups(table)
      const location = groups.find(g => g.type === 'location')

      expect(location).toBeDefined()
      expect(location!.columns).toContain('city')
      expect(location!.columns).toContain('state')
    })

    it('detects full location group: city + state + zip_code + country', () => {
      const table = makeTable('addresses', [
        ['city', {}],
        ['state', {}],
        ['zip_code', {}],
        ['country', {}],
      ])

      const groups = detectCoherenceGroups(table)
      const location = groups.find(g => g.type === 'location')

      expect(location).toBeDefined()
      expect(location!.columns).toContain('city')
      expect(location!.columns).toContain('state')
      expect(location!.columns).toContain('zip_code')
      expect(location!.columns).toContain('country')
    })

    it('does not detect with only city (no state)', () => {
      const table = makeTable('places', [
        ['city', {}],
        ['name', {}],
      ])

      const groups = detectCoherenceGroups(table)
      const location = groups.find(g => g.type === 'location')

      expect(location).toBeUndefined()
    })
  })

  describe('temporal detection', () => {
    it('detects start_date + end_date pair', () => {
      const table = makeTable('events', [
        ['id', { dataType: NormalizedType.UUID }],
        ['start_date', { dataType: NormalizedType.DATE }],
        ['end_date', { dataType: NormalizedType.DATE }],
      ])

      const groups = detectCoherenceGroups(table)
      const temporal = groups.find(g => g.type === 'temporal')

      expect(temporal).toBeDefined()
      expect(temporal!.columns).toEqual(['start_date', 'end_date'])
    })

    it('detects birth_date + hire_date pair', () => {
      const table = makeTable('employees', [
        ['birth_date', { dataType: NormalizedType.DATE }],
        ['hire_date', { dataType: NormalizedType.DATE }],
      ])

      const groups = detectCoherenceGroups(table)
      const temporal = groups.find(g => g.type === 'temporal')

      expect(temporal).toBeDefined()
      expect(temporal!.columns).toEqual(['birth_date', 'hire_date'])
    })

    it('detects order_date + ship_date + delivery_date (multiple pairs)', () => {
      const table = makeTable('orders', [
        ['order_date', { dataType: NormalizedType.TIMESTAMP }],
        ['ship_date', { dataType: NormalizedType.TIMESTAMP }],
        ['delivery_date', { dataType: NormalizedType.TIMESTAMP }],
      ])

      const groups = detectCoherenceGroups(table)
      const temporals = groups.filter(g => g.type === 'temporal')

      // Should find order_date < ship_date and order_date < delivery_date and ship_date < delivery_date
      expect(temporals.length).toBeGreaterThanOrEqual(2)
    })

    it('does not detect temporal pairs for non-date columns', () => {
      const table = makeTable('events', [
        ['start_date', { dataType: NormalizedType.VARCHAR }],
        ['end_date', { dataType: NormalizedType.VARCHAR }],
      ])

      const groups = detectCoherenceGroups(table)
      const temporal = groups.find(g => g.type === 'temporal')

      expect(temporal).toBeUndefined()
    })
  })

  it('detects multiple coherence groups in one table', () => {
    const table = makeTable('employees', [
      ['first_name', {}],
      ['gender', {}],
      ['city', {}],
      ['state', {}],
      ['birth_date', { dataType: NormalizedType.DATE }],
      ['hire_date', { dataType: NormalizedType.DATE }],
    ])

    const groups = detectCoherenceGroups(table)
    expect(groups.find(g => g.type === 'name-gender')).toBeDefined()
    expect(groups.find(g => g.type === 'location')).toBeDefined()
    expect(groups.find(g => g.type === 'temporal')).toBeDefined()
  })

  it('returns empty array for table with no coherence patterns', () => {
    const table = makeTable('items', [
      ['id', { dataType: NormalizedType.UUID }],
      ['name', {}],
      ['price', { dataType: NormalizedType.DECIMAL }],
    ])

    const groups = detectCoherenceGroups(table)
    expect(groups).toEqual([])
  })
})

describe('generateCoherentRow', () => {
  describe('name-gender coherence', () => {
    it('generates first_name that matches gender', () => {
      const groups = [{
        type: 'name-gender' as const,
        columns: ['first_name', 'gender'],
      }]

      const faker = createSeededFaker(42)
      const results = new Set<string>()

      // Generate multiple rows and check for both genders
      for (let i = 0; i < 50; i++) {
        const row = generateCoherentRow(groups, faker)
        expect(row).toHaveProperty('first_name')
        expect(row).toHaveProperty('gender')
        expect(typeof row.first_name).toBe('string')
        expect(['male', 'female']).toContain(row.gender)
        results.add(row.gender as string)
      }

      // Should produce both genders over 50 iterations
      expect(results.size).toBe(2)
    })
  })

  describe('location coherence', () => {
    it('generates geographically consistent values', () => {
      const groups = [{
        type: 'location' as const,
        columns: ['city', 'state', 'zip_code', 'country'],
      }]

      const faker = createSeededFaker(42)

      for (let i = 0; i < 20; i++) {
        const row = generateCoherentRow(groups, faker)
        expect(row).toHaveProperty('city')
        expect(row).toHaveProperty('state')
        expect(row).toHaveProperty('zip_code')
        expect(row).toHaveProperty('country')
        expect(typeof row.city).toBe('string')
        expect(typeof row.state).toBe('string')
        expect(typeof row.zip_code).toBe('string')
        expect(row.country).toBe('US')

        // Zip code should be 5 digits
        expect(String(row.zip_code)).toMatch(/^\d{3}\d{2}$/)
      }
    })

    it('generates minimal location group (city + state only)', () => {
      const groups = [{
        type: 'location' as const,
        columns: ['city', 'state'],
      }]

      const faker = createSeededFaker(42)
      const row = generateCoherentRow(groups, faker)

      expect(row).toHaveProperty('city')
      expect(row).toHaveProperty('state')
      expect(row).not.toHaveProperty('zip_code')
    })
  })

  describe('temporal coherence', () => {
    it('generates before < after dates', () => {
      const groups = [{
        type: 'temporal' as const,
        columns: ['start_date', 'end_date'],
      }]

      const faker = createSeededFaker(42)

      for (let i = 0; i < 20; i++) {
        const row = generateCoherentRow(groups, faker)
        const start = row.start_date as Date
        const end = row.end_date as Date

        expect(start).toBeInstanceOf(Date)
        expect(end).toBeInstanceOf(Date)
        expect(start.getTime()).toBeLessThanOrEqual(end.getTime())
      }
    })
  })

  it('handles multiple groups in one call', () => {
    const groups = [
      {
        type: 'name-gender' as const,
        columns: ['first_name', 'gender'],
      },
      {
        type: 'temporal' as const,
        columns: ['start_date', 'end_date'],
      },
    ]

    const faker = createSeededFaker(42)
    const row = generateCoherentRow(groups, faker)

    expect(row).toHaveProperty('first_name')
    expect(row).toHaveProperty('gender')
    expect(row).toHaveProperty('start_date')
    expect(row).toHaveProperty('end_date')
  })

  it('returns empty row for empty groups', () => {
    const faker = createSeededFaker(42)
    const row = generateCoherentRow([], faker)
    expect(Object.keys(row)).toHaveLength(0)
  })
})
