import type { AIProvider, AIConfig, AIProviderType } from './types.js'
import { OpenAIProvider } from './providers/openai.js'
import { AnthropicProvider } from './providers/anthropic.js'
import { OllamaProvider } from './providers/ollama.js'

/**
 * Create an AIProvider from configuration.
 *
 * Resolution order:
 * 1. Explicit provider in config
 * 2. Auto-detect from environment variables and local services
 */
export function createProvider(config: AIConfig): AIProvider {
  const providerType = config.provider ?? detectProvider(config)

  switch (providerType) {
    case 'openai':
      return new OpenAIProvider({
        apiKey: config.apiKey ?? resolveApiKey('OPENAI_API_KEY'),
        model: config.model,
        baseUrl: config.baseUrl,
        temperature: config.temperature,
      })

    case 'groq':
      return new OpenAIProvider({
        apiKey: config.apiKey ?? resolveApiKey('GROQ_API_KEY'),
        model: config.model ?? 'llama-3.1-8b-instant',
        baseUrl: config.baseUrl ?? 'https://api.groq.com/openai',
        temperature: config.temperature,
        name: 'groq',
      })

    case 'anthropic':
      return new AnthropicProvider({
        apiKey: config.apiKey ?? resolveApiKey('ANTHROPIC_API_KEY'),
        model: config.model,
        baseUrl: config.baseUrl,
        temperature: config.temperature,
      })

    case 'ollama':
      return new OllamaProvider({
        model: config.model,
        baseUrl: config.baseUrl,
        temperature: config.temperature,
      })
  }
}

/**
 * Auto-detect the best available provider from environment.
 */
export function detectProvider(config: AIConfig): AIProviderType {
  if (config.apiKey) {
    // If a key is provided but no provider, guess from the key prefix
    // Anthropic keys start with "sk-ant-", OpenAI keys start with "sk-"
    if (config.apiKey.startsWith('sk-ant-')) return 'anthropic'
    return 'openai'
  }

  if (process.env.OPENAI_API_KEY) return 'openai'
  if (process.env.ANTHROPIC_API_KEY) return 'anthropic'
  if (process.env.GROQ_API_KEY) return 'groq'

  // Default to Ollama (local, no key needed)
  return 'ollama'
}

function resolveApiKey(envVar: string): string {
  const key = process.env[envVar]
  if (!key) {
    throw new Error(
      `No API key found. Set the ${envVar} environment variable ` +
      'or pass apiKey in the AI config.',
    )
  }
  return key
}
