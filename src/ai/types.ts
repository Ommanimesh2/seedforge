/**
 * Configuration for LLM-enhanced text generation.
 *
 * AI text generation is opt-in: it is never invoked unless explicitly
 * configured via --ai flag or config file.
 */
export interface AIConfig {
  /** Enable AI text generation */
  enabled: boolean
  /** LLM provider (auto-detected from env vars if omitted) */
  provider?: AIProviderType
  /** Provider-specific model name */
  model?: string
  /** Custom API base URL (for self-hosted or compatible endpoints) */
  baseUrl?: string
  /** API key (falls back to env vars: OPENAI_API_KEY, ANTHROPIC_API_KEY, etc.) */
  apiKey?: string
  /** Columns to enhance: "table.column" or just "column" (auto-detects text columns if omitted) */
  columns?: string[]
  /** Sampling temperature (default: 0.7) */
  temperature?: number
  /** Max tokens per generated field (default: 200) */
  maxTokensPerField?: number
  /** Number of values to generate per API call (default: 20) */
  batchSize?: number
  /** Enable file-based response cache (default: true) */
  cache?: boolean
  /** Custom prompt template with {table}, {column}, {count} placeholders */
  prompt?: string
}

export type AIProviderType = 'openai' | 'anthropic' | 'ollama' | 'groq'

/**
 * A request to generate AI text for a specific table column.
 */
export interface AITextRequest {
  /** Table name */
  table: string
  /** Column name */
  column: string
  /** Detected column domain from mapping (e.g., "text") */
  columnDomain: string
  /** Number of text values to generate */
  count: number
  /** Max tokens per value */
  maxTokens: number
  /** Custom prompt template (overrides domain default) */
  customPrompt?: string
}

/**
 * Provider-agnostic interface for LLM text generation.
 *
 * All providers implement this interface so that swapping between
 * OpenAI, Anthropic, Ollama, etc. requires only a config change.
 */
export interface AIProvider {
  /** Provider name for display */
  name: string
  /** Generate text values. Returns one string per count in the request. */
  generate(request: AITextRequest): Promise<string[]>
  /** Estimate token usage for a request (for cost display). */
  estimateTokens(request: AITextRequest): number
}

/**
 * Options passed to the provider factory.
 */
export interface ProviderFactoryOptions {
  provider?: AIProviderType
  model?: string
  baseUrl?: string
  apiKey?: string
  temperature?: number
}
