import type { DatabaseSchema } from '../types/schema.js'
import type { MappingResult } from '../mapping/types.js'
import type { AIConfig, AITextRequest } from './types.js'
import { createProvider } from './provider.js'
import { AICache } from './cache.js'
import { isAIEligibleColumn } from './prompt.js'
import { estimateTotalTokens, formatCostEstimate, isPaidProvider } from './cost.js'

/**
 * Pre-generate all AI text values before row generation.
 *
 * Returns a pool map keyed by "schema.table.column" with arrays of generated
 * text values. During row generation, columns with pool entries pull from
 * the pool instead of calling Faker.
 *
 * @returns Map<"schema.table.column", string[]>
 */
export async function generateAITextPool(
  schema: DatabaseSchema,
  config: AIConfig,
  tableCounts: Map<string, number>,
  mappingResults?: Map<string, MappingResult>,
  options?: { quiet?: boolean; skipConfirmation?: boolean },
): Promise<Map<string, string[]>> {
  const pool = new Map<string, string[]>()
  const provider = createProvider(config)
  const cache = config.cache !== false ? new AICache() : null
  const batchSize = config.batchSize ?? 20

  // 1. Identify AI-eligible columns
  const requests = collectRequests(schema, config, tableCounts, mappingResults)

  if (requests.length === 0) {
    return pool
  }

  // 2. Check cost and confirm for paid providers
  if (!options?.quiet) {
    const providerType = config.provider ?? 'ollama'
    const model = config.model ?? getDefaultModel(providerType)
    const totalTokens = estimateTotalTokens(provider, requests)
    const costStr = formatCostEstimate(totalTokens, providerType, model)
    console.log(`AI text generation: ${requests.length} columns, ${costStr}`)

    if (isPaidProvider(providerType) && !options?.skipConfirmation) {
      console.log('Using paid API. Pass --yes to skip confirmation.')
    }
  }

  // 3. Generate text for each request (with cache + batching)
  for (const request of requests) {
    const key = `${request.table}.${request.column}`

    // Check cache
    if (cache) {
      const cached = cache.read({
        table: request.table,
        column: request.column,
        count: request.count,
        model: config.model ?? 'default',
        seed: undefined,
        prompt: request.customPrompt,
      })
      if (cached && cached.length >= request.count) {
        pool.set(key, cached.slice(0, request.count))
        continue
      }
    }

    // Generate in batches
    const allValues: string[] = []
    let remaining = request.count

    while (remaining > 0) {
      const batchCount = Math.min(remaining, batchSize)
      const batchRequest: AITextRequest = { ...request, count: batchCount }

      try {
        const values = await provider.generate(batchRequest)
        allValues.push(...values)
        remaining -= batchCount
      } catch (err) {
        // Log warning and fall back to Faker for this column
        if (!options?.quiet) {
          const detail = err instanceof Error ? err.message : String(err)
          console.warn(`AI generation failed for ${key}: ${detail}. Falling back to Faker.`)
        }
        break
      }
    }

    if (allValues.length > 0) {
      pool.set(key, allValues)

      // Write to cache
      if (cache) {
        cache.write(
          {
            table: request.table,
            column: request.column,
            count: allValues.length,
            model: config.model ?? 'default',
            prompt: request.customPrompt,
          },
          allValues,
        )
      }
    }
  }

  return pool
}

/**
 * Collect AI text generation requests by scanning tables for eligible columns.
 */
function collectRequests(
  schema: DatabaseSchema,
  config: AIConfig,
  tableCounts: Map<string, number>,
  mappingResults?: Map<string, MappingResult>,
): AITextRequest[] {
  const requests: AITextRequest[] = []
  const maxTokens = config.maxTokensPerField ?? 200
  const explicitColumns = config.columns
    ? new Set(config.columns.map((c) => c.toLowerCase()))
    : null

  for (const [qualifiedName, table] of schema.tables) {
    const count = tableCounts.get(qualifiedName) ?? 0
    if (count === 0) continue

    for (const [columnName, column] of table.columns) {
      // Skip non-text columns, auto-increment, generated
      if (column.isAutoIncrement || column.isGenerated) continue

      const qualifiedColumn = `${table.name}.${columnName}`.toLowerCase()
      const isExplicit = explicitColumns
        ? (explicitColumns.has(qualifiedColumn) || explicitColumns.has(columnName.toLowerCase()))
        : false

      // Determine eligibility
      let eligible = isExplicit
      if (!eligible && !explicitColumns) {
        // Auto-detect: check if column name matches text-domain patterns
        eligible = isAIEligibleColumn(columnName)
      }
      // Also check mapping domain if available
      if (!eligible && !explicitColumns && mappingResults) {
        const mapping = mappingResults.get(qualifiedName)
        const colMapping = mapping?.mappings.get(columnName)
        if (colMapping?.domain === 'text') {
          eligible = true
        }
      }

      if (!eligible) continue

      requests.push({
        table: qualifiedName,
        column: columnName,
        columnDomain: 'text',
        count,
        maxTokens,
        customPrompt: config.prompt,
      })
    }
  }

  return requests
}

function getDefaultModel(providerType: string): string {
  switch (providerType) {
    case 'openai': return 'gpt-4o-mini'
    case 'anthropic': return 'claude-haiku-4-5-20251001'
    case 'groq': return 'llama-3.1-8b-instant'
    case 'ollama': return 'llama3.2'
    default: return 'unknown'
  }
}
