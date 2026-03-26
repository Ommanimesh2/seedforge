/**
 * Standard dynamic programming Levenshtein edit distance.
 */
export function levenshtein(a: string, b: string): number {
  const m = a.length
  const n = b.length

  // Create a (m+1) x (n+1) matrix
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    Array.from({ length: n + 1 }, () => 0),
  )

  for (let i = 0; i <= m; i++) dp[i][0] = i
  for (let j = 0; j <= n; j++) dp[0][j] = j

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,       // deletion
        dp[i][j - 1] + 1,       // insertion
        dp[i - 1][j - 1] + cost, // substitution
      )
    }
  }

  return dp[m][n]
}

/**
 * Returns the closest valid key if its edit distance from `unknown` is <= 2.
 * Returns null if no close match.
 */
export function suggestKey(
  unknown: string,
  validKeys: string[],
): string | null {
  let bestKey: string | null = null
  let bestDist = 3 // threshold + 1

  for (const key of validKeys) {
    const dist = levenshtein(unknown, key)
    if (dist < bestDist) {
      bestDist = dist
      bestKey = key
    }
  }

  return bestKey
}
