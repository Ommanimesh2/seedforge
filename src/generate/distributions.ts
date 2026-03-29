import type { Faker } from '@faker-js/faker'

/**
 * Supported distribution types for value generation.
 */
export type DistributionType = 'uniform' | 'zipf' | 'normal' | 'exponential'

/**
 * Options for configuring a distribution.
 */
export interface DistributionOptions {
  /** Mean for normal distribution (default: 0.5, range 0..1) */
  mean?: number
  /** Standard deviation for normal distribution (default: 0.15) */
  stddev?: number
  /** Exponent for Zipf distribution (default: 1.0) */
  exponent?: number
  /** Rate/lambda for exponential distribution (default: 1.0) */
  rate?: number
}

/**
 * A distribution function that returns a value between 0 and 1.
 * The generator can then scale this to the column's range.
 *
 * @param faker - Seeded faker instance for deterministic randomness
 * @param index - Current row index (0-based)
 * @param total - Total number of rows being generated
 * @returns A number in [0, 1]
 */
export type DistributionFn = (faker: Faker, index: number, total: number) => number

/**
 * Creates a distribution function of the specified type.
 *
 * Each distribution returns a value between 0 and 1, which can be
 * scaled by the caller to fit the desired range.
 *
 * @param type - The distribution type
 * @param options - Optional parameters for the distribution
 * @returns A DistributionFn
 */
export function createDistribution(
  type: DistributionType,
  options?: DistributionOptions,
): DistributionFn {
  switch (type) {
    case 'uniform':
      return createUniformDistribution()
    case 'zipf':
      return createZipfDistribution(options?.exponent ?? 1.0)
    case 'normal':
      return createNormalDistribution(
        options?.mean ?? 0.5,
        options?.stddev ?? 0.15,
      )
    case 'exponential':
      return createExponentialDistribution(options?.rate ?? 1.0)
    default:
      return createUniformDistribution()
  }
}

/**
 * Uniform distribution: equal probability across [0, 1].
 * This matches the default/current behavior.
 */
function createUniformDistribution(): DistributionFn {
  return (faker: Faker): number => {
    return faker.number.float({ min: 0, max: 1 })
  }
}

/**
 * Zipf (power-law) distribution: most values cluster near 0, few near 1.
 * Good for order totals, page views, popularity rankings.
 *
 * Uses inverse transform sampling with the Zipf CDF.
 */
function createZipfDistribution(exponent: number): DistributionFn {
  return (faker: Faker, _index, total): number => {
    // Use N buckets (at least 100) to simulate a Zipf distribution
    const n = Math.max(total, 100)

    // Compute the harmonic number H(n, s) for normalization
    let harmonicN = 0
    for (let k = 1; k <= n; k++) {
      harmonicN += 1 / Math.pow(k, exponent)
    }

    // Generate a uniform random number and find the corresponding rank
    const u = faker.number.float({ min: 0, max: 1 })
    let cumulativeProb = 0
    for (let k = 1; k <= n; k++) {
      cumulativeProb += (1 / Math.pow(k, exponent)) / harmonicN
      if (u <= cumulativeProb) {
        // Map rank k (1..n) to [0..1] — lower ranks (higher probability) map to lower values
        return (k - 1) / (n - 1)
      }
    }

    // Fallback (should not be reached)
    return 1
  }
}

/**
 * Normal (Gaussian) distribution: bell curve centered at mean.
 * Uses Box-Muller transform, then clamps output to [0, 1].
 */
function createNormalDistribution(mean: number, stddev: number): DistributionFn {
  return (faker: Faker): number => {
    // Box-Muller transform
    const u1 = faker.number.float({ min: 0.0001, max: 1 })
    const u2 = faker.number.float({ min: 0, max: 1 })
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)

    // Scale and shift
    const value = mean + stddev * z

    // Clamp to [0, 1]
    return Math.max(0, Math.min(1, value))
  }
}

/**
 * Exponential distribution: exponential decay from 0.
 * Maps to [0, 1] using the CDF: 1 - e^(-rate * x).
 */
function createExponentialDistribution(rate: number): DistributionFn {
  return (faker: Faker): number => {
    // Inverse transform sampling: x = -ln(1 - u) / rate
    const u = faker.number.float({ min: 0, max: 0.9999 })
    const x = -Math.log(1 - u) / rate

    // Map x (which is [0, +inf)) to [0, 1] using CDF
    // CDF of exponential: 1 - e^(-rate*x)
    // Since x was generated via inverse CDF, the CDF value is just u
    // But we want values clustered near 0, so return the raw x clamped
    const normalized = 1 - Math.exp(-rate * x)
    return Math.max(0, Math.min(1, normalized))
  }
}

/**
 * Validates that a string is a recognized distribution type.
 */
export function isValidDistributionType(type: string): type is DistributionType {
  return ['uniform', 'zipf', 'normal', 'exponential'].includes(type)
}
