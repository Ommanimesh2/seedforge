import { describe, it, expect } from 'vitest'
import { formatMysqlTsvField, rowToMysqlTsvLine } from '../mysql-load-data.js'

describe('formatMysqlTsvField', () => {
  it('emits \\N for null and undefined', () => {
    expect(formatMysqlTsvField(null)).toBe('\\N')
    expect(formatMysqlTsvField(undefined)).toBe('\\N')
  })

  it('emits \\N for non-finite numbers', () => {
    expect(formatMysqlTsvField(NaN)).toBe('\\N')
    expect(formatMysqlTsvField(Infinity)).toBe('\\N')
    expect(formatMysqlTsvField(-Infinity)).toBe('\\N')
  })

  it('formats numbers, bigints, and booleans', () => {
    expect(formatMysqlTsvField(42)).toBe('42')
    expect(formatMysqlTsvField(3.14)).toBe('3.14')
    expect(formatMysqlTsvField(0)).toBe('0')
    expect(formatMysqlTsvField(-17)).toBe('-17')
    expect(formatMysqlTsvField(9007199254740993n)).toBe('9007199254740993')
    expect(formatMysqlTsvField(true)).toBe('1')
    expect(formatMysqlTsvField(false)).toBe('0')
  })

  it('formats Date as MySQL DATETIME (no T, no Z, no millis)', () => {
    const d = new Date('2026-04-15T09:30:15.123Z')
    expect(formatMysqlTsvField(d)).toBe('2026-04-15 09:30:15')
  })

  it('passes plain strings through unchanged when no special chars', () => {
    expect(formatMysqlTsvField('hello world')).toBe('hello world')
    expect(formatMysqlTsvField('café')).toBe('café')
  })

  it('escapes backslash first, then tab/newline/cr/nul', () => {
    expect(formatMysqlTsvField('a\\b')).toBe('a\\\\b')
    expect(formatMysqlTsvField('col1\tcol2')).toBe('col1\\tcol2')
    expect(formatMysqlTsvField('line1\nline2')).toBe('line1\\nline2')
    expect(formatMysqlTsvField('row\r\nnext')).toBe('row\\r\\nnext')
    expect(formatMysqlTsvField('null\0byte')).toBe('null\\0byte')
  })

  it('handles compound escape sequences without double-escaping', () => {
    // "a\tb" with a literal backslash, then tab → "\\" + "\t" → "\\\\\\t"
    expect(formatMysqlTsvField('a\\\tb')).toBe('a\\\\\\tb')
    // A backslash followed by N stays as "\\N" (double-backslash + N) so
    // MySQL does NOT interpret it as the NULL marker.
    expect(formatMysqlTsvField('\\N')).toBe('\\\\N')
  })

  it('serializes arrays and plain objects as JSON then escapes', () => {
    expect(formatMysqlTsvField({ k: 'v' })).toBe('{"k":"v"}')
    expect(formatMysqlTsvField([1, 2, 3])).toBe('[1,2,3]')
    // JSON with a tab inside a string value: JSON.stringify emits `\t`
    // (backslash + t), then our escape doubles that backslash → `\\t`.
    expect(formatMysqlTsvField({ s: 'a\tb' })).toBe('{"s":"a\\\\tb"}')
    // JSON string containing a backslash
    expect(formatMysqlTsvField({ s: 'a\\b' })).toBe('{"s":"a\\\\\\\\b"}')
  })

  it('encodes Buffer byte-by-byte with escape sequences for specials', () => {
    const buf = Buffer.from([0x00, 0x09, 0x0a, 0x0d, 0x5c, 0x41])
    expect(formatMysqlTsvField(buf)).toBe('\\0\\t\\n\\r\\\\A')
  })

  it('encodes Uint8Array the same as Buffer', () => {
    const u8 = new Uint8Array([0x5c, 0x74, 0x42])
    expect(formatMysqlTsvField(u8)).toBe('\\\\tB')
  })
})

describe('rowToMysqlTsvLine', () => {
  it('joins fields with tab and terminates with newline', () => {
    const row = { id: 1, name: 'alice', age: 30 }
    expect(rowToMysqlTsvLine(row, ['id', 'name', 'age'])).toBe('1\talice\t30\n')
  })

  it('respects column ordering — unlisted keys are skipped', () => {
    const row = { id: 1, name: 'alice', age: 30 }
    expect(rowToMysqlTsvLine(row, ['name', 'id'])).toBe('alice\t1\n')
  })

  it('emits \\N for missing columns', () => {
    const row = { id: 1 }
    expect(rowToMysqlTsvLine(row, ['id', 'missing'])).toBe('1\t\\N\n')
  })

  it('escapes per-field so embedded tabs and newlines do not break framing', () => {
    const row = { a: 'has\ttab', b: 'has\nnewline' }
    expect(rowToMysqlTsvLine(row, ['a', 'b'])).toBe('has\\ttab\thas\\nnewline\n')
  })

  it('formats mixed types in a single row', () => {
    const d = new Date('2026-04-15T12:00:00.000Z')
    const row = {
      id: 1,
      name: 'x',
      active: true,
      payload: { k: 'v' },
      deleted_at: null,
      ts: d,
    }
    expect(rowToMysqlTsvLine(row, ['id', 'name', 'active', 'payload', 'deleted_at', 'ts'])).toBe(
      '1\tx\t1\t{"k":"v"}\t\\N\t2026-04-15 12:00:00\n',
    )
  })
})
