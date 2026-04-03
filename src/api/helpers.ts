import type { WithSeedOptions, Row, TableSeedOptions } from './types.js'
import type { Seeder } from './seeder.js'

/**
 * Test helper that creates a transactional seeder for use in test suites.
 *
 * The connection is lazily established on the first `seed()` call.
 * Calling `teardown()` rolls back all changes and disconnects.
 *
 * @example
 * import { withSeed } from '@otg-dev/seedforge'
 *
 * describe('user API', () => {
 *   const { seed, teardown } = withSeed('postgres://localhost/testdb', {
 *     seed: 42,
 *     transaction: true,
 *   })
 *
 *   afterAll(teardown)
 *
 *   it('lists users', async () => {
 *     await seed('users', 10)
 *     const res = await fetch('/api/users')
 *     expect(res.json()).toHaveLength(10)
 *   })
 * })
 */
export function withSeed(
  connectionUrl: string,
  options: WithSeedOptions = {},
): {
  seed: (tableName: string, count: number, seedOptions?: TableSeedOptions) => Promise<Row[]>
  teardown: () => Promise<void>
} {
  let seeder: Seeder | null = null
  let connecting: Promise<Seeder> | null = null

  const getSeeder = async (): Promise<Seeder> => {
    if (seeder) return seeder

    // Prevent concurrent connection attempts
    if (!connecting) {
      connecting = (async () => {
        const { createSeeder } = await import('./seeder.js')
        const s = await createSeeder(connectionUrl, {
          seed: options.seed,
          transaction: options.transaction ?? true,
          schema: options.schema,
          quiet: options.quiet ?? true,
        })
        seeder = s
        return s
      })()
    }

    return connecting
  }

  const seedFn = async (
    tableName: string,
    count: number,
    seedOptions?: TableSeedOptions,
  ): Promise<Row[]> => {
    const s = await getSeeder()
    return s.seed(tableName, count, seedOptions)
  }

  const teardown = async (): Promise<void> => {
    if (connecting) {
      try {
        const s = await connecting
        await s.teardown()
      } catch {
        // Swallow errors during teardown
      }
    }
    seeder = null
    connecting = null
  }

  return { seed: seedFn, teardown }
}
