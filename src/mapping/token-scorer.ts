/**
 * Token-based semantic scorer for column names.
 *
 * When exact/suffix/prefix/pattern matching all fail, the token scorer
 * tokenizes the column name, stems each token, looks up stems in the
 * stem dictionary, and accumulates weighted scores per domain.
 *
 * The highest-scoring domain (if above threshold) is used to select
 * a domain-appropriate Faker generator.
 */

import { stem } from './stemmer.js'
import { STEM_DICTIONARY, NOISE_STEMS } from './stem-dictionary.js'
import { getDomainGenerator } from './domain-generators.js'
import { getTypeFallback } from './type-fallback.js'
import type { NormalizedType } from '../types/schema.js'
import type { GeneratorFn } from './types.js'

/** Minimum accumulated score for a domain to be considered a match. */
const SCORE_THRESHOLD = 0.5

export interface StemScoreResult {
  domain: string
  score: number
  generator: GeneratorFn
  fakerMethod: string
}

/**
 * Tokenize a column name by splitting on underscores and camelCase boundaries.
 *
 * @example
 * tokenize('patient_diagnosis') // => ['patient', 'diagnosis']
 * tokenize('patientDiagnosis')  // => ['patient', 'Diagnosis']
 * tokenize('vehicleVIN')        // => ['vehicle', 'VIN']
 */
function tokenize(name: string): string[] {
  // First, split on underscores and hyphens
  const parts = name.split(/[_-]+/)

  const tokens: string[] = []
  for (const part of parts) {
    if (!part) continue

    // Split camelCase: insert boundary before uppercase letters
    // "patientDiagnosis" → ["patient", "Diagnosis"]
    // "vehicleVIN" → ["vehicle", "VIN"]
    const camelParts = part.replace(/([a-z])([A-Z])/g, '$1_$2').split('_')
    for (const cp of camelParts) {
      if (cp) tokens.push(cp.toLowerCase())
    }
  }

  return tokens
}

/**
 * Score a column name against the stem dictionary to identify its domain.
 *
 * @param columnName - The raw column name (e.g., "patient_diagnosis")
 * @param _tableName - The table name (reserved for future context-aware scoring)
 * @param dataType - The column's normalized data type
 * @returns A StemScoreResult with the best domain match, or null if no domain scores above threshold
 */
export function scoreColumn(
  columnName: string,
  _tableName: string,
  dataType: NormalizedType,
): StemScoreResult | null {
  const tokens = tokenize(columnName)

  // Filter out noise words and stem remaining tokens
  const stemmedTokens: string[] = []
  for (const token of tokens) {
    const stemmed = stem(token)

    // Skip noise words (check both original token and stemmed form)
    if (NOISE_STEMS.has(token) || NOISE_STEMS.has(stemmed)) {
      continue
    }

    stemmedTokens.push(stemmed)
  }

  // No meaningful tokens after filtering
  if (stemmedTokens.length === 0) return null

  // Accumulate weighted scores per domain
  const domainScores = new Map<string, number>()

  for (const stemmed of stemmedTokens) {
    const entries = STEM_DICTIONARY.get(stemmed)
    if (!entries) continue

    for (const entry of entries) {
      const current = domainScores.get(entry.domain) ?? 0
      domainScores.set(entry.domain, current + entry.weight)
    }
  }

  // No domains matched
  if (domainScores.size === 0) return null

  // Find the highest-scoring domain
  let bestDomain = ''
  let bestScore = 0
  for (const [domain, score] of domainScores) {
    if (score > bestScore) {
      bestScore = score
      bestDomain = domain
    }
  }

  // Below threshold
  if (bestScore < SCORE_THRESHOLD) return null

  // Look up the best generator for this domain + type
  const domainGen = getDomainGenerator(bestDomain, dataType)
  if (domainGen) {
    return {
      domain: bestDomain,
      score: bestScore,
      generator: domainGen.generator,
      fakerMethod: domainGen.fakerMethod,
    }
  }

  // Domain matched but no specific generator for this type — use type fallback
  // but still report the domain match
  const fallback = getTypeFallback({ dataType } as Parameters<typeof getTypeFallback>[0])
  return {
    domain: bestDomain,
    score: bestScore,
    generator: fallback.generator,
    fakerMethod: fallback.fakerMethod,
  }
}
