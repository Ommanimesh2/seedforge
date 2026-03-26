import { describe, it, expect } from 'vitest'
import { normalizeColumnName, singularize } from '../normalize.js'

describe('singularize', () => {
  it('singularizes "users" to "user"', () => {
    expect(singularize('users')).toBe('user')
  })

  it('singularizes "orders" to "order"', () => {
    expect(singularize('orders')).toBe('order')
  })

  it('singularizes "categories" to "category"', () => {
    expect(singularize('categories')).toBe('category')
  })

  it('singularizes "companies" to "company"', () => {
    expect(singularize('companies')).toBe('company')
  })

  it('singularizes "addresses" to "address"', () => {
    expect(singularize('addresses')).toBe('address')
  })

  it('singularizes "statuses" to "status"', () => {
    expect(singularize('statuses')).toBe('status')
  })

  it('does not modify already singular words', () => {
    expect(singularize('user')).toBe('user')
  })

  it('handles words ending in "ss" (no strip)', () => {
    expect(singularize('boss')).toBe('boss')
  })
})

describe('normalizeColumnName', () => {
  it('lowercases column name', () => {
    expect(normalizeColumnName('Email', 'users')).toBe('email')
    expect(normalizeColumnName('FIRST_NAME', 'users')).toBe('first_name')
  })

  it('strips table prefix (singular form)', () => {
    expect(normalizeColumnName('user_email', 'users')).toBe('email')
  })

  it('strips table prefix (plural form)', () => {
    expect(normalizeColumnName('users_email', 'users')).toBe('email')
  })

  it('strips singular prefix from orders table', () => {
    expect(normalizeColumnName('order_total', 'orders')).toBe('total')
  })

  it('does not over-strip: column name same as prefix', () => {
    // users.user should remain "user", not become empty string
    expect(normalizeColumnName('user', 'users')).toBe('user')
  })

  it('normalizes separators: double underscores', () => {
    expect(normalizeColumnName('first__name', 'test_table')).toBe('first_name')
  })

  it('normalizes separators: hyphens', () => {
    expect(normalizeColumnName('first-name', 'test_table')).toBe('first_name')
  })

  it('normalizes separators: mixed hyphens and double underscores', () => {
    expect(normalizeColumnName('first--name', 'test_table')).toBe('first_name')
  })

  it('removes noise suffix _val', () => {
    expect(normalizeColumnName('email_val', 'test_table')).toBe('email')
  })

  it('removes noise suffix _field', () => {
    expect(normalizeColumnName('name_field', 'test_table')).toBe('name')
  })

  it('removes noise suffix _col', () => {
    expect(normalizeColumnName('status_col', 'test_table')).toBe('status')
  })

  it('removes noise suffix _value', () => {
    expect(normalizeColumnName('amount_value', 'test_table')).toBe('amount')
  })

  it('does not strip prefix for short table names (<=2 chars)', () => {
    expect(normalizeColumnName('ab_email', 'ab')).toBe('ab_email')
  })

  it('preserves "id" column', () => {
    expect(normalizeColumnName('id', 'users')).toBe('id')
  })

  it('strips leading and trailing underscores', () => {
    expect(normalizeColumnName('_email_', 'test_table')).toBe('email')
  })
})
