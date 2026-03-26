import { describe, it, expect } from 'vitest'
import {
  InsertionError,
  insertFailed,
  updateFailed,
  fileWriteFailed,
  transactionFailed,
  sequenceResetFailed,
  missingConnection,
  missingOutputPath,
} from '../../errors/index.js'

describe('Insertion error factories', () => {
  it('insertFailed creates SF4001', () => {
    const err = insertFailed('users', 'unique violation')
    expect(err.code).toBe('SF4001')
    expect(err).toBeInstanceOf(InsertionError)
    expect(err.message).toContain('INSERT failed for table users')
    expect(err.message).toContain('unique violation')
    expect(err.hints.length).toBeGreaterThan(0)
    expect(err.context.tableName).toBe('users')
  })

  it('insertFailed truncates SQL to 500 chars', () => {
    const longSql = 'A'.repeat(1000)
    const err = insertFailed('users', 'error', longSql)
    expect((err.context.sql as string).length).toBeLessThanOrEqual(500)
  })

  it('updateFailed creates SF4002', () => {
    const err = updateFailed('users', 'parent_id', 'FK violation')
    expect(err.code).toBe('SF4002')
    expect(err).toBeInstanceOf(InsertionError)
    expect(err.message).toContain('Deferred UPDATE failed for users.parent_id')
    expect(err.hints.length).toBeGreaterThan(0)
    expect(err.context.tableName).toBe('users')
    expect(err.context.column).toBe('parent_id')
  })

  it('fileWriteFailed creates SF4003', () => {
    const err = fileWriteFailed('/tmp/out.sql', 'permission denied')
    expect(err.code).toBe('SF4003')
    expect(err).toBeInstanceOf(InsertionError)
    expect(err.message).toContain('/tmp/out.sql')
    expect(err.hints.length).toBeGreaterThan(0)
    expect(err.context.filePath).toBe('/tmp/out.sql')
  })

  it('transactionFailed creates SF4004', () => {
    const err = transactionFailed('users', 'deadlock detected')
    expect(err.code).toBe('SF4004')
    expect(err).toBeInstanceOf(InsertionError)
    expect(err.message).toContain('Transaction failed for table users')
    expect(err.hints.length).toBeGreaterThan(0)
  })

  it('sequenceResetFailed creates SF4005', () => {
    const err = sequenceResetFailed('users_id_seq', 'not found')
    expect(err.code).toBe('SF4005')
    expect(err).toBeInstanceOf(InsertionError)
    expect(err.message).toContain('Failed to reset sequence users_id_seq')
    expect(err.hints.length).toBeGreaterThan(0)
    expect(err.context.sequenceName).toBe('users_id_seq')
  })

  it('missingConnection creates SF4006', () => {
    const err = missingConnection()
    expect(err.code).toBe('SF4006')
    expect(err).toBeInstanceOf(InsertionError)
    expect(err.message).toContain('database connection')
    expect(err.hints.length).toBeGreaterThan(0)
  })

  it('missingOutputPath creates SF4007', () => {
    const err = missingOutputPath()
    expect(err.code).toBe('SF4007')
    expect(err).toBeInstanceOf(InsertionError)
    expect(err.message).toContain('output path')
    expect(err.hints.length).toBeGreaterThan(0)
  })

  it('all errors have render() output with code and message', () => {
    const errors = [
      insertFailed('t', 'msg'),
      updateFailed('t', 'c', 'msg'),
      fileWriteFailed('/path', 'msg'),
      transactionFailed('t', 'msg'),
      sequenceResetFailed('seq', 'msg'),
      missingConnection(),
      missingOutputPath(),
    ]

    for (const err of errors) {
      const rendered = err.render()
      expect(rendered).toContain(`ERROR [${err.code}]`)
      expect(rendered).toContain(err.message)
      expect(rendered).toContain('Hints:')
    }
  })
})
