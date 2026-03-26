import { describe, it, expect } from 'vitest'
import {
  SeedForgeError,
  ConnectionError,
  IntrospectError,
  GenerationError,
  InsertionError,
  ConfigError,
  PluginError,
  connectionFailed,
  authenticationFailed,
  databaseNotFound,
  noTablesFound,
  circularDependency,
  uniqueValueExhaustion,
  redactConnectionString,
} from '../index.js'

describe('SeedForgeError', () => {
  it('creates error with code, message, and hints', () => {
    const err = new SeedForgeError('SF0001', 'Something went wrong', ['Try this', 'Or that'])
    expect(err.code).toBe('SF0001')
    expect(err.message).toBe('Something went wrong')
    expect(err.hints).toEqual(['Try this', 'Or that'])
    expect(err.name).toBe('SeedForgeError')
    expect(err).toBeInstanceOf(Error)
  })

  it('renders formatted output', () => {
    const err = new SeedForgeError('SF0001', 'Something went wrong', ['Try this'])
    const rendered = err.render()
    expect(rendered).toContain('ERROR [SF0001]')
    expect(rendered).toContain('Something went wrong')
    expect(rendered).toContain('Hints:')
    expect(rendered).toContain('Try this')
  })

  it('renders without hints', () => {
    const err = new SeedForgeError('SF0001', 'Something went wrong')
    const rendered = err.render()
    expect(rendered).toContain('ERROR [SF0001]')
    expect(rendered).not.toContain('Hints:')
  })
})

describe('Error subtypes', () => {
  it('ConnectionError has correct name', () => {
    const err = new ConnectionError('SF1001', 'Connection failed')
    expect(err.name).toBe('ConnectionError')
    expect(err).toBeInstanceOf(SeedForgeError)
    expect(err).toBeInstanceOf(Error)
  })

  it('IntrospectError has correct name', () => {
    const err = new IntrospectError('SF2001', 'Introspection failed')
    expect(err.name).toBe('IntrospectError')
    expect(err).toBeInstanceOf(SeedForgeError)
  })

  it('GenerationError has correct name', () => {
    const err = new GenerationError('SF3001', 'Generation failed')
    expect(err.name).toBe('GenerationError')
    expect(err).toBeInstanceOf(SeedForgeError)
  })

  it('InsertionError has correct name', () => {
    const err = new InsertionError('SF4001', 'Insertion failed')
    expect(err.name).toBe('InsertionError')
    expect(err).toBeInstanceOf(SeedForgeError)
  })

  it('ConfigError has correct name', () => {
    const err = new ConfigError('SF5001', 'Config invalid')
    expect(err.name).toBe('ConfigError')
    expect(err).toBeInstanceOf(SeedForgeError)
  })

  it('PluginError has correct name', () => {
    const err = new PluginError('SF6001', 'Plugin failed')
    expect(err.name).toBe('PluginError')
    expect(err).toBeInstanceOf(SeedForgeError)
  })
})

describe('Factory functions', () => {
  it('connectionFailed creates SF1001', () => {
    const err = connectionFailed('localhost', 5432)
    expect(err.code).toBe('SF1001')
    expect(err).toBeInstanceOf(ConnectionError)
    expect(err.message).toContain('localhost:5432')
    expect(err.hints.length).toBeGreaterThan(0)
  })

  it('authenticationFailed creates SF1002', () => {
    const err = authenticationFailed('admin')
    expect(err.code).toBe('SF1002')
    expect(err.message).toContain('admin')
  })

  it('databaseNotFound creates SF1003', () => {
    const err = databaseNotFound('mydb')
    expect(err.code).toBe('SF1003')
    expect(err.message).toContain('mydb')
    expect(err.hints[0]).toContain('createdb mydb')
  })

  it('noTablesFound creates SF2001', () => {
    const err = noTablesFound('public')
    expect(err.code).toBe('SF2001')
    expect(err).toBeInstanceOf(IntrospectError)
  })

  it('circularDependency creates SF3001', () => {
    const err = circularDependency(['users', 'orders', 'users'])
    expect(err.code).toBe('SF3001')
    expect(err.message).toContain('users -> orders -> users')
  })

  it('uniqueValueExhaustion creates SF3002', () => {
    const err = uniqueValueExhaustion('users', 'email', 100000)
    expect(err.code).toBe('SF3002')
    expect(err.message).toContain('users.email')
  })
})

describe('redactConnectionString', () => {
  it('redacts password from standard URL', () => {
    const result = redactConnectionString('postgres://user:password@host:5432/db')
    expect(result).not.toContain('password')
    expect(result).toContain('***')
    expect(result).toContain('user')
    expect(result).toContain('host')
  })

  it('leaves URL without password unchanged', () => {
    const result = redactConnectionString('postgres://user@host/db')
    expect(result).not.toContain('***')
    expect(result).toContain('user')
  })

  it('redacts URL-encoded passwords', () => {
    const result = redactConnectionString('postgres://user:p%40ssw0rd@host:5432/db')
    expect(result).not.toContain('p%40ssw0rd')
    expect(result).toContain('***')
  })

  it('handles malformed URLs via regex fallback', () => {
    const result = redactConnectionString('postgres://user:secret@host/db?extra')
    expect(result).not.toContain('secret')
  })
})
