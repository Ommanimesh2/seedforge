import { describe, it, expect } from 'vitest'
import { isTableExcluded, filterExcludedTables } from '../exclude.js'

describe('isTableExcluded', () => {
  it('exact match', () => {
    expect(isTableExcluded('schema_migrations', ['schema_migrations'])).toBe(
      true,
    )
  })

  it('no match', () => {
    expect(isTableExcluded('users', ['schema_migrations'])).toBe(false)
  })

  it('glob * prefix: pg_stat matches pg_*', () => {
    expect(isTableExcluded('pg_stat', ['pg_*'])).toBe(true)
  })

  it('glob * suffix: users_backup matches *_backup', () => {
    expect(isTableExcluded('users_backup', ['*_backup'])).toBe(true)
  })

  it('glob * middle: test_data_table matches test_*_table', () => {
    expect(isTableExcluded('test_data_table', ['test_*_table'])).toBe(true)
  })

  it('glob ? wildcard: v1 matches v?', () => {
    expect(isTableExcluded('v1', ['v?'])).toBe(true)
  })

  it('glob ? wildcard: v12 does NOT match v?', () => {
    expect(isTableExcluded('v12', ['v?'])).toBe(false)
  })

  it('multiple patterns: matches second pattern', () => {
    expect(
      isTableExcluded('_prisma_migrations', [
        'schema_migrations',
        '_prisma_migrations',
      ]),
    ).toBe(true)
  })

  it('no patterns (empty array): always returns false', () => {
    expect(isTableExcluded('anything', [])).toBe(false)
  })

  it('case sensitivity: Users does NOT match users', () => {
    expect(isTableExcluded('Users', ['users'])).toBe(false)
  })

  it('glob * matches zero characters', () => {
    expect(isTableExcluded('pg_', ['pg_*'])).toBe(true)
  })
})

describe('filterExcludedTables', () => {
  it('filters out matching tables, retains non-matching', () => {
    const tables = ['users', 'posts', 'schema_migrations', 'pg_stat']
    const result = filterExcludedTables(tables, [
      'schema_migrations',
      'pg_*',
    ])
    expect(result).toEqual(['users', 'posts'])
  })

  it('empty patterns returns all tables', () => {
    const tables = ['users', 'posts']
    expect(filterExcludedTables(tables, [])).toEqual(['users', 'posts'])
  })

  it('all tables excluded returns empty array', () => {
    const tables = ['pg_a', 'pg_b']
    expect(filterExcludedTables(tables, ['pg_*'])).toEqual([])
  })
})
