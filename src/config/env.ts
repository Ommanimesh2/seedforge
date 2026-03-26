import { ConfigError } from '../errors/index.js'

const ENV_VAR_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g

/**
 * Replaces ${VAR_NAME} patterns in a string with process.env values.
 * Throws ConfigError (SF5010) if a referenced variable is not defined.
 */
export function interpolateEnvVars(value: string): string {
  return value.replace(ENV_VAR_PATTERN, (_match, varName: string) => {
    const envValue = process.env[varName]
    if (envValue === undefined) {
      throw new ConfigError(
        'SF5010',
        `Environment variable "${varName}" is not defined`,
        [
          `Set it with: export ${varName}=<value>`,
          `Or remove the \${${varName}} reference from .seedforge.yml`,
        ],
        { variable: varName },
      )
    }
    return envValue
  })
}

/**
 * Recursively walks an object/array tree and applies interpolateEnvVars
 * to every string value. Non-string primitives pass through unchanged.
 */
export function interpolateDeep(obj: unknown): unknown {
  if (typeof obj === 'string') {
    return interpolateEnvVars(obj)
  }
  if (Array.isArray(obj)) {
    return obj.map((item) => interpolateDeep(item))
  }
  if (obj !== null && typeof obj === 'object') {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(obj)) {
      result[key] = interpolateDeep(value)
    }
    return result
  }
  // number, boolean, null, undefined
  return obj
}
