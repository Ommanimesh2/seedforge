import { faker, type Faker } from '@faker-js/faker'

/**
 * Creates a seeded faker instance for deterministic output.
 *
 * If seed is provided, calls faker.seed(seed) and returns the faker instance.
 * If no seed, returns the faker instance without seeding (non-deterministic mode).
 *
 * Returns a single faker instance that should be reused across all table mappings
 * for deterministic ordering.
 */
export function createSeededFaker(seed?: number): Faker {
  if (seed !== undefined) {
    faker.seed(seed)
  }
  return faker
}
