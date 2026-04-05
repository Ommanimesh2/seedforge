import type { AITextRequest } from './types.js'

/**
 * Domain-specific prompt templates.
 * Each maps a column name pattern to a contextual generation prompt.
 */
const DOMAIN_PROMPTS: Record<string, string> = {
  // Text domain — descriptions, summaries
  description: 'Generate {count} unique, realistic product or item descriptions. Each should be 1-2 sentences describing features or qualities.',
  summary: 'Generate {count} unique, concise summaries. Each should be 1-2 sentences capturing the essence of a document or topic.',
  excerpt: 'Generate {count} unique article excerpts. Each should be 1-2 sentences that hook the reader.',
  abstract: 'Generate {count} unique academic-style abstracts. Each should be 2-3 sentences summarizing research or findings.',

  // Text domain — long-form content
  body: 'Generate {count} unique article body paragraphs. Each should be 2-4 sentences of coherent, engaging prose.',
  content: 'Generate {count} unique content paragraphs. Each should be 2-4 sentences on varied topics.',
  text: 'Generate {count} unique text paragraphs. Each should be 2-3 sentences of natural-sounding prose.',

  // Text domain — short form
  title: 'Generate {count} unique, catchy titles or headlines. Each should be 3-8 words.',
  headline: 'Generate {count} unique news headlines. Each should be 5-10 words.',
  subject: 'Generate {count} unique email subject lines. Each should be 4-8 words.',
  label: 'Generate {count} unique short labels or tags. Each should be 1-3 words.',
  caption: 'Generate {count} unique image captions. Each should be 1-2 sentences.',

  // Notes, comments, reviews
  note: 'Generate {count} unique short notes. Each should be 1-2 sentences.',
  comment: 'Generate {count} unique user comments. Each should be 1-3 sentences with varied tone (positive, neutral, constructive).',
  message: 'Generate {count} unique short messages. Each should be 1-2 casual sentences.',
  review: 'Generate {count} unique product or service reviews. Each should be 2-3 sentences with varied sentiment (mostly positive, some mixed).',
  feedback: 'Generate {count} unique user feedback entries. Each should be 1-3 sentences with constructive observations.',

  // Person-related
  bio: 'Generate {count} unique person bios. Each should be 2-3 sentences describing a professional background.',
  about: 'Generate {count} unique "about me" sections. Each should be 2-3 casual sentences about hobbies and interests.',
  tagline: 'Generate {count} unique personal or brand taglines. Each should be 5-10 words.',

  // Business
  reason: 'Generate {count} unique short reason or justification texts. Each should be 1-2 sentences.',
  instructions: 'Generate {count} unique instruction or how-to entries. Each should be 2-3 clear sentences.',
  address: 'Generate {count} unique fictional street addresses in US format.',
}

const FALLBACK_PROMPT = 'Generate {count} unique, realistic text values for a database column named "{column}" in the "{table}" table. Each should be 1-3 sentences of natural-sounding content.'

/**
 * Build a prompt for an AI text generation request.
 *
 * Resolution order:
 * 1. Custom prompt from config (with {table}, {column}, {count} interpolation)
 * 2. Domain-specific prompt based on column name
 * 3. Generic fallback prompt
 */
export function buildPrompt(request: AITextRequest): string {
  // 1. Custom prompt
  if (request.customPrompt) {
    return interpolate(request.customPrompt, request) + JSON_SUFFIX
  }

  // 2. Domain-specific: try exact column name, then partial matches
  const colLower = request.column.toLowerCase()
  const domainPrompt = findDomainPrompt(colLower)
  if (domainPrompt) {
    return interpolate(domainPrompt, request) + JSON_SUFFIX
  }

  // 3. Fallback
  return interpolate(FALLBACK_PROMPT, request) + JSON_SUFFIX
}

const JSON_SUFFIX = '\n\nReturn ONLY a valid JSON array of strings. No explanation, no markdown, no code fences.'

function findDomainPrompt(columnName: string): string | null {
  // Exact match
  if (DOMAIN_PROMPTS[columnName]) {
    return DOMAIN_PROMPTS[columnName]
  }

  // Suffix match: "product_description" → "description"
  for (const key of Object.keys(DOMAIN_PROMPTS)) {
    if (columnName.endsWith('_' + key) || columnName.endsWith(key)) {
      return DOMAIN_PROMPTS[key]
    }
  }

  return null
}

function interpolate(template: string, request: AITextRequest): string {
  return template
    .replace(/\{count\}/g, String(request.count))
    .replace(/\{table\}/g, request.table)
    .replace(/\{column\}/g, request.column)
}

/**
 * Columns that are eligible for AI text generation by default
 * (when no explicit columns list is provided).
 * These are the text-domain column names that benefit most from LLM output.
 */
export const AI_ELIGIBLE_COLUMNS = new Set([
  'description', 'summary', 'excerpt', 'abstract',
  'body', 'content', 'text',
  'bio', 'about', 'tagline',
  'note', 'notes', 'comment', 'comments', 'message',
  'review', 'feedback',
  'title', 'headline', 'subject', 'caption',
  'reason', 'instructions',
])

/**
 * Check if a column name is eligible for AI text generation.
 * Matches exact names and suffixed names (e.g., "product_description").
 */
export function isAIEligibleColumn(columnName: string): boolean {
  const lower = columnName.toLowerCase()
  if (AI_ELIGIBLE_COLUMNS.has(lower)) return true

  for (const eligible of AI_ELIGIBLE_COLUMNS) {
    if (lower.endsWith('_' + eligible)) return true
  }

  return false
}
