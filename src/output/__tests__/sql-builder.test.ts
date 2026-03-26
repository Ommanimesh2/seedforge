import { describe, it, expect } from 'vitest'
import {
  buildInsertSQL,
  buildUpdateSQL,
  buildSequenceResetSQL,
  buildTransactionWrapper,
} from '../sql-builder.js'

describe('buildInsertSQL', () => {
  it('builds a simple single-row INSERT', () => {
    const sql = buildInsertSQL('users', 'public', ['name', 'age'], [['Alice', 30]])
    // pg-format does not quote standard lowercase identifiers
    expect(sql).toContain('INSERT INTO public.users')
    expect(sql).toContain('name, age')
    expect(sql).toContain("'Alice'")
    expect(sql).toContain("'30'")
    expect(sql).toMatch(/;$/)
  })

  it('builds a multi-row INSERT', () => {
    const sql = buildInsertSQL('users', 'public', ['name'], [
      ['Alice'],
      ['Bob'],
      ['Charlie'],
    ])
    expect(sql).toContain("'Alice'")
    expect(sql).toContain("'Bob'")
    expect(sql).toContain("'Charlie'")
    // Should have commas separating value tuples
    const valuesSection = sql.split('VALUES\n')[1]
    expect(valuesSection).toBeDefined()
    // Three tuples, two commas between them
    const tuples = valuesSection!.split(',\n')
    expect(tuples.length).toBe(3)
  })

  it('handles NULL values', () => {
    const sql = buildInsertSQL('users', 'public', ['name', 'email'], [
      ['Alice', null],
    ])
    expect(sql).toContain('NULL')
  })

  it('handles Date values as ISO strings', () => {
    const date = new Date('2024-01-15T10:30:00Z')
    const sql = buildInsertSQL('events', 'public', ['created_at'], [[date]])
    expect(sql).toContain('2024-01-15T10:30:00.000Z')
  })

  it('handles JSON/object values', () => {
    const obj = { key: 'value', nested: { a: 1 } }
    const sql = buildInsertSQL('data', 'public', ['metadata'], [[obj]])
    expect(sql).toContain('{"key":"value","nested":{"a":1}}')
  })

  it('handles boolean values', () => {
    const sql = buildInsertSQL('flags', 'public', ['active', 'deleted'], [
      [true, false],
    ])
    // pg-format formats booleans as 't' and 'f'
    expect(sql).toMatch(/'t'/)
    expect(sql).toMatch(/'f'/)
  })

  it('escapes single quotes in strings', () => {
    const sql = buildInsertSQL('users', 'public', ['name'], [
      ["O'Brien"],
    ])
    expect(sql).toContain("'O''Brien'")
  })

  it('properly qualifies schema and table', () => {
    // pg-format only quotes identifiers that need quoting
    const sql = buildInsertSQL('user_accounts', 'my_schema', ['id'], [[1]])
    expect(sql).toContain('my_schema.user_accounts')
  })

  it('quotes identifiers with uppercase letters', () => {
    const sql = buildInsertSQL('MyTable', 'MySchema', ['Id'], [[1]])
    expect(sql).toContain('"MySchema"."MyTable"')
    expect(sql).toContain('"Id"')
  })

  it('escapes column names that are reserved words', () => {
    const sql = buildInsertSQL('t', 'public', ['select', 'from', 'order'], [
      [1, 2, 3],
    ])
    expect(sql).toContain('"select"')
    expect(sql).toContain('"from"')
    expect(sql).toContain('"order"')
  })

  it('returns empty string for empty rows', () => {
    const sql = buildInsertSQL('users', 'public', ['name'], [])
    expect(sql).toBe('')
  })

  it('handles array values', () => {
    const sql = buildInsertSQL('t', 'public', ['tags'], [[['a', 'b', 'c']]])
    // pg-format handles arrays
    expect(sql).toContain('INSERT INTO')
  })
})

describe('buildUpdateSQL', () => {
  it('builds UPDATE with single PK column', () => {
    const sql = buildUpdateSQL('users', 'public', ['id'], [1], 'parent_id', 2)
    expect(sql).toContain('UPDATE public.users')
    expect(sql).toContain('parent_id')
    expect(sql).toContain('id = ')
    expect(sql).toMatch(/;$/)
  })

  it('builds UPDATE with composite PK', () => {
    const sql = buildUpdateSQL('t', 'public', ['id1', 'id2'], [1, 2], 'col', 'val')
    expect(sql).toContain('id1 = ')
    expect(sql).toContain(' AND ')
    expect(sql).toContain('id2 = ')
  })

  it('handles NULL set value', () => {
    const sql = buildUpdateSQL('users', 'public', ['id'], [1], 'parent_id', null)
    expect(sql).toContain('parent_id = NULL')
  })
})

describe('buildSequenceResetSQL', () => {
  it('builds SELECT setval statement', () => {
    const sql = buildSequenceResetSQL('public', 'users', 'id', 'users_id_seq')
    expect(sql).toContain("setval('users_id_seq'")
    expect(sql).toContain('MAX(id)')
    expect(sql).toContain('public.users')
    expect(sql).toContain('COALESCE')
    expect(sql).toMatch(/;$/)
  })

  it('uses schema-qualified table reference', () => {
    const sql = buildSequenceResetSQL('my_schema', 'accounts', 'account_id', 'accounts_account_id_seq')
    expect(sql).toContain('my_schema.accounts')
    expect(sql).toContain("'accounts_account_id_seq'")
  })
})

describe('buildTransactionWrapper', () => {
  it('wraps statements in BEGIN/COMMIT', () => {
    const result = buildTransactionWrapper([
      "INSERT INTO t VALUES (1);",
      "INSERT INTO t VALUES (2);",
    ])
    expect(result).toMatch(/^BEGIN;/)
    expect(result).toMatch(/COMMIT;$/)
    expect(result).toContain("INSERT INTO t VALUES (1);")
  })

  it('handles empty array', () => {
    const result = buildTransactionWrapper([])
    expect(result).toBe('BEGIN;\nCOMMIT;')
  })
})
