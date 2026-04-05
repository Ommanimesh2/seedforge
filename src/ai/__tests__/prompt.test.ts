import { describe, it, expect } from 'vitest'
import { buildPrompt, isAIEligibleColumn, AI_ELIGIBLE_COLUMNS } from '../prompt.js'
import type { AITextRequest } from '../types.js'

function makeRequest(overrides: Partial<AITextRequest> = {}): AITextRequest {
  return {
    table: 'products',
    column: 'description',
    columnDomain: 'text',
    count: 10,
    maxTokens: 200,
    ...overrides,
  }
}

describe('buildPrompt', () => {
  it('generates a domain-specific prompt for "description"', () => {
    const prompt = buildPrompt(makeRequest({ column: 'description' }))
    expect(prompt).toContain('10')
    expect(prompt).toContain('description')
    expect(prompt).toContain('JSON array')
  })

  it('generates a domain-specific prompt for "bio"', () => {
    const prompt = buildPrompt(makeRequest({ column: 'bio' }))
    expect(prompt).toContain('bio')
    expect(prompt).toContain('JSON array')
  })

  it('generates a domain-specific prompt for "review"', () => {
    const prompt = buildPrompt(makeRequest({ column: 'review' }))
    expect(prompt).toContain('review')
  })

  it('generates a domain-specific prompt for "title"', () => {
    const prompt = buildPrompt(makeRequest({ column: 'title' }))
    expect(prompt).toContain('title')
  })

  it('matches suffixed columns like "product_description"', () => {
    const prompt = buildPrompt(makeRequest({ column: 'product_description' }))
    expect(prompt).toContain('description')
    expect(prompt).toContain('JSON array')
  })

  it('uses fallback prompt for unknown column', () => {
    const prompt = buildPrompt(makeRequest({ column: 'xyz_field', table: 'mytable' }))
    expect(prompt).toContain('xyz_field')
    expect(prompt).toContain('mytable')
    expect(prompt).toContain('JSON array')
  })

  it('uses custom prompt when provided', () => {
    const prompt = buildPrompt(makeRequest({
      customPrompt: 'Generate {count} items for {table}.{column}',
    }))
    expect(prompt).toContain('Generate 10 items for products.description')
    expect(prompt).toContain('JSON array')
  })

  it('interpolates {count}, {table}, {column} in custom prompts', () => {
    const prompt = buildPrompt(makeRequest({
      column: 'notes',
      table: 'orders',
      count: 5,
      customPrompt: '{count} entries for {table}.{column}',
    }))
    expect(prompt).toContain('5 entries for orders.notes')
  })
})

describe('isAIEligibleColumn', () => {
  it('returns true for exact matches', () => {
    expect(isAIEligibleColumn('description')).toBe(true)
    expect(isAIEligibleColumn('bio')).toBe(true)
    expect(isAIEligibleColumn('body')).toBe(true)
    expect(isAIEligibleColumn('content')).toBe(true)
    expect(isAIEligibleColumn('title')).toBe(true)
    expect(isAIEligibleColumn('comment')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(isAIEligibleColumn('Description')).toBe(true)
    expect(isAIEligibleColumn('BIO')).toBe(true)
  })

  it('matches suffixed columns', () => {
    expect(isAIEligibleColumn('product_description')).toBe(true)
    expect(isAIEligibleColumn('user_bio')).toBe(true)
    expect(isAIEligibleColumn('post_content')).toBe(true)
    expect(isAIEligibleColumn('review_body')).toBe(true)
  })

  it('returns false for non-eligible columns', () => {
    expect(isAIEligibleColumn('id')).toBe(false)
    expect(isAIEligibleColumn('email')).toBe(false)
    expect(isAIEligibleColumn('price')).toBe(false)
    expect(isAIEligibleColumn('created_at')).toBe(false)
    expect(isAIEligibleColumn('user_id')).toBe(false)
  })
})

describe('AI_ELIGIBLE_COLUMNS', () => {
  it('contains expected text-domain columns', () => {
    const expected = ['description', 'summary', 'body', 'content', 'bio', 'title', 'comment', 'review']
    for (const col of expected) {
      expect(AI_ELIGIBLE_COLUMNS.has(col)).toBe(true)
    }
  })
})
