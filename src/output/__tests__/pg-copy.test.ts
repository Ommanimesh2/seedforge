import { describe, it, expect } from 'vitest'
import { formatCopyValue, rowToCsvLine } from '../../output/executors/pg-copy.js'

describe('formatCopyValue', () => {
  it('returns \\N for null', () => {
    expect(formatCopyValue(null)).toBe('\\N')
  })

  it('returns \\N for undefined', () => {
    expect(formatCopyValue(undefined)).toBe('\\N')
  })

  it('formats simple strings without quoting', () => {
    expect(formatCopyValue('hello')).toBe('hello')
  })

  it('formats numbers as strings', () => {
    expect(formatCopyValue(42)).toBe('42')
    expect(formatCopyValue(3.14)).toBe('3.14')
  })

  it('formats booleans as t/f', () => {
    expect(formatCopyValue(true)).toBe('t')
    expect(formatCopyValue(false)).toBe('f')
  })

  it('formats Date as ISO string', () => {
    const date = new Date('2024-01-15T10:30:00.000Z')
    expect(formatCopyValue(date)).toBe('2024-01-15T10:30:00.000Z')
  })

  it('quotes strings containing commas', () => {
    expect(formatCopyValue('hello, world')).toBe('"hello, world"')
  })

  it('quotes strings containing double quotes and doubles them', () => {
    expect(formatCopyValue('say "hello"')).toBe('"say ""hello"""')
  })

  it('quotes strings containing newlines', () => {
    expect(formatCopyValue('line1\nline2')).toBe('"line1\nline2"')
  })

  it('quotes strings containing backslashes', () => {
    expect(formatCopyValue('path\\to\\file')).toBe('"path\\to\\file"')
  })

  it('quotes strings containing carriage returns', () => {
    expect(formatCopyValue('line1\rline2')).toBe('"line1\rline2"')
  })

  it('formats objects as quoted JSON', () => {
    const obj = { key: 'value', nested: { a: 1 } }
    const result = formatCopyValue(obj)
    // JSON contains commas and potentially quotes, so should be quoted
    expect(result).toContain('"key"')
    // Should be valid CSV-escaped JSON
    const unquoted = result.startsWith('"') ? result.slice(1, -1).replace(/""/g, '"') : result
    expect(JSON.parse(unquoted)).toEqual(obj)
  })

  it('formats arrays as PostgreSQL array literals', () => {
    expect(formatCopyValue([1, 2, 3])).toBe('"{1,2,3}"')
  })

  it('handles arrays with NULL elements', () => {
    expect(formatCopyValue([1, null, 3])).toBe('"{1,NULL,3}"')
  })

  it('formats Buffer as hex string', () => {
    const buf = Buffer.from([0xde, 0xad, 0xbe, 0xef])
    expect(formatCopyValue(buf)).toBe('\\xdeadbeef')
  })

  it('formats Uint8Array as hex string', () => {
    const arr = new Uint8Array([0xca, 0xfe])
    expect(formatCopyValue(arr)).toBe('\\xcafe')
  })

  it('formats empty string without quoting', () => {
    expect(formatCopyValue('')).toBe('')
  })

  it('handles string with only double quotes', () => {
    expect(formatCopyValue('"')).toBe('""""')
  })
})

describe('rowToCsvLine', () => {
  it('formats a simple row as CSV', () => {
    const row = { id: 1, name: 'Alice', email: 'alice@test.com' }
    const line = rowToCsvLine(row, ['id', 'name', 'email'])
    expect(line).toBe('1,Alice,alice@test.com')
  })

  it('handles NULL values', () => {
    const row = { id: 1, name: null, email: 'bob@test.com' }
    const line = rowToCsvLine(row, ['id', 'name', 'email'])
    expect(line).toBe('1,\\N,bob@test.com')
  })

  it('handles missing columns as NULL', () => {
    const row = { id: 1 }
    const line = rowToCsvLine(row, ['id', 'name'])
    expect(line).toBe('1,\\N')
  })

  it('handles values with commas', () => {
    const row = { id: 1, name: 'Smith, John' }
    const line = rowToCsvLine(row, ['id', 'name'])
    expect(line).toBe('1,"Smith, John"')
  })

  it('handles values with quotes', () => {
    const row = { id: 1, name: 'O\'Brien "Bobby"' }
    const line = rowToCsvLine(row, ['id', 'name'])
    expect(line).toBe('1,"O\'Brien ""Bobby"""')
  })

  it('handles Date values', () => {
    const row = { id: 1, created_at: new Date('2024-06-01T12:00:00.000Z') }
    const line = rowToCsvLine(row, ['id', 'created_at'])
    expect(line).toBe('1,2024-06-01T12:00:00.000Z')
  })

  it('handles boolean values', () => {
    const row = { id: 1, active: true, deleted: false }
    const line = rowToCsvLine(row, ['id', 'active', 'deleted'])
    expect(line).toBe('1,t,f')
  })

  it('handles JSON object values', () => {
    const row = { id: 1, data: { key: 'value' } }
    const line = rowToCsvLine(row, ['id', 'data'])
    // JSON with commas/quotes should be properly CSV-escaped
    expect(line).toContain('1,')
    expect(line).toContain('key')
  })

  it('respects column ordering', () => {
    const row = { name: 'Alice', id: 1, email: 'alice@test.com' }
    const line = rowToCsvLine(row, ['email', 'id', 'name'])
    expect(line).toBe('alice@test.com,1,Alice')
  })

  it('handles empty row', () => {
    const row = {}
    const line = rowToCsvLine(row, ['id', 'name'])
    expect(line).toBe('\\N,\\N')
  })
})
