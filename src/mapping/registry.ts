import type { PatternEntry } from './types.js'
import { personPatterns } from './domains/person.js'
import { contactPatterns } from './domains/contact.js'
import { internetPatterns } from './domains/internet.js'
import { locationPatterns } from './domains/location.js'
import { financePatterns } from './domains/finance.js'
import { commercePatterns } from './domains/commerce.js'
import { textPatterns } from './domains/text.js'
import { identifierPatterns } from './domains/identifiers.js'
import { temporalPatterns } from './domains/temporal.js'
import { booleanPatterns } from './domains/boolean.js'

export interface Registry {
  exactNames: Map<string, PatternEntry>
  suffixes: Array<{ suffix: string; entry: PatternEntry }>
  prefixes: Array<{ prefix: string; entry: PatternEntry }>
  patterns: Array<{ pattern: RegExp; entry: PatternEntry }>
}

/**
 * Domain priority order (first wins on collision):
 * 1. person (most specific names)
 * 2. contact
 * 3. internet
 * 4. location
 * 5. finance
 * 6. commerce
 * 7. identifiers
 * 8. temporal
 * 9. text (most generic)
 * 10. boolean (only applies to BOOLEAN-typed columns anyway)
 */
const DOMAIN_PRIORITY: PatternEntry[][] = [
  personPatterns,
  contactPatterns,
  internetPatterns,
  locationPatterns,
  financePatterns,
  commercePatterns,
  identifierPatterns,
  temporalPatterns,
  textPatterns,
  booleanPatterns,
]

export function buildRegistry(): Registry {
  const exactNames = new Map<string, PatternEntry>()
  const suffixes: Array<{ suffix: string; entry: PatternEntry }> = []
  const prefixes: Array<{ prefix: string; entry: PatternEntry }> = []
  const patterns: Array<{ pattern: RegExp; entry: PatternEntry }> = []

  for (const domainPatterns of DOMAIN_PRIORITY) {
    for (const entry of domainPatterns) {
      // Index exact names (first registration wins)
      for (const name of entry.names) {
        if (!exactNames.has(name)) {
          exactNames.set(name, entry)
        }
      }

      // Index suffixes
      if (entry.suffixes) {
        for (const suffix of entry.suffixes) {
          suffixes.push({ suffix, entry })
        }
      }

      // Index prefixes
      if (entry.prefixes) {
        for (const prefix of entry.prefixes) {
          prefixes.push({ prefix, entry })
        }
      }

      // Index regex patterns
      if (entry.pattern) {
        patterns.push({ pattern: entry.pattern, entry })
      }
    }
  }

  // Sort suffixes by length descending (longest match first)
  suffixes.sort((a, b) => b.suffix.length - a.suffix.length)

  // Sort prefixes by length descending (longest match first)
  prefixes.sort((a, b) => b.prefix.length - a.prefix.length)

  return { exactNames, suffixes, prefixes, patterns }
}
