import { describe, it, expect, vi, afterEach } from 'vitest'
import { interpolateEnvVars, interpolateDeep } from '../env.js'
import { ConfigError } from '../../errors/index.js'

afterEach(() => {
  vi.unstubAllEnvs()
})

describe('interpolateEnvVars', () => {
  it('resolves a single env var', () => {
    vi.stubEnv('MY_VAR', 'hello')
    expect(interpolateEnvVars('${MY_VAR}')).toBe('hello')
  })

  it('resolves multiple env vars in one string', () => {
    vi.stubEnv('USER', 'admin')
    vi.stubEnv('PASS', 'secret')
    vi.stubEnv('HOST', 'localhost')
    expect(interpolateEnvVars('${USER}:${PASS}@${HOST}')).toBe(
      'admin:secret@localhost',
    )
  })

  it('throws SF5010 for undefined env var', () => {
    delete process.env.UNDEFINED_VAR_XYZ
    expect(() => interpolateEnvVars('${UNDEFINED_VAR_XYZ}')).toThrow(
      ConfigError,
    )
    try {
      interpolateEnvVars('${UNDEFINED_VAR_XYZ}')
    } catch (err) {
      const ce = err as ConfigError
      expect(ce.code).toBe('SF5010')
      expect(ce.message).toContain('UNDEFINED_VAR_XYZ')
    }
  })

  it('leaves literal $HOME (no braces) unchanged', () => {
    expect(interpolateEnvVars('$HOME')).toBe('$HOME')
  })

  it('leaves literal ${} (empty braces) unchanged', () => {
    expect(interpolateEnvVars('${}')).toBe('${}')
  })

  it('returns empty string unchanged', () => {
    expect(interpolateEnvVars('')).toBe('')
  })

  it('resolves env var embedded in a larger string', () => {
    vi.stubEnv('DB_PORT', '5432')
    expect(interpolateEnvVars('localhost:${DB_PORT}/mydb')).toBe(
      'localhost:5432/mydb',
    )
  })
})

describe('interpolateDeep', () => {
  it('interpolates string values in a deeply nested object', () => {
    vi.stubEnv('DEEP_VAR', 'resolved')
    const input = {
      a: {
        b: {
          c: '${DEEP_VAR}',
        },
      },
    }
    const result = interpolateDeep(input) as Record<string, unknown>
    expect((result.a as Record<string, unknown>).b).toEqual({
      c: 'resolved',
    })
  })

  it('interpolates strings in arrays', () => {
    vi.stubEnv('ARR_VAR', 'item')
    const input = ['${ARR_VAR}', 'plain']
    const result = interpolateDeep(input) as string[]
    expect(result).toEqual(['item', 'plain'])
  })

  it('passes through non-string values unchanged', () => {
    const input = { num: 42, bool: true, nil: null }
    const result = interpolateDeep(input)
    expect(result).toEqual({ num: 42, bool: true, nil: null })
  })

  it('handles mixed objects with strings, numbers, arrays', () => {
    vi.stubEnv('MIX_VAR', 'mixed')
    const input = {
      str: '${MIX_VAR}',
      num: 123,
      arr: ['${MIX_VAR}', 456],
      nested: { deep: '${MIX_VAR}' },
    }
    const result = interpolateDeep(input) as Record<string, unknown>
    expect(result).toEqual({
      str: 'mixed',
      num: 123,
      arr: ['mixed', 456],
      nested: { deep: 'mixed' },
    })
  })
})
