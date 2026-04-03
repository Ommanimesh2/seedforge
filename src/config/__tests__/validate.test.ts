import { describe, it, expect } from 'vitest'
import { validateConfig } from '../validate.js'
import { ExistingDataMode } from '../types.js'
import { ConfigError } from '../../errors/index.js'

describe('validateConfig', () => {
  describe('valid configs', () => {
    it('minimal config (just connection.url) produces correct defaults', () => {
      const result = validateConfig({
        connection: { url: 'postgres://localhost/mydb' },
      })
      expect(result.connection.url).toBe('postgres://localhost/mydb')
      expect(result.connection.schema).toBe('public')
      expect(result.count).toBe(50)
      expect(result.locale).toBe('en')
      expect(result.existingData).toBe(ExistingDataMode.AUGMENT)
      expect(result.tables).toEqual({})
      expect(result.exclude).toEqual([])
      expect(result.virtualForeignKeys).toEqual([])
      expect(result.seed).toBeUndefined()
    })

    it('empty object produces all defaults', () => {
      const result = validateConfig({})
      expect(result.count).toBe(50)
      expect(result.locale).toBe('en')
      expect(result.existingData).toBe(ExistingDataMode.AUGMENT)
    })

    it('full config with all fields parses successfully', () => {
      const result = validateConfig({
        connection: { url: 'postgres://localhost/db', schema: 'myschema' },
        seed: 42,
        count: 200,
        locale: 'de',
        existingData: { mode: 'truncate' },
        tables: {
          users: {
            count: 500,
            columns: {
              email: { generator: 'faker.internet.email', unique: true },
              role: {
                values: ['admin', 'editor', 'viewer'],
                weights: [0.05, 0.25, 0.70],
              },
              bio: { nullable: 0.3 },
            },
          },
        },
        exclude: ['schema_migrations', 'pg_*'],
        virtualForeignKeys: [
          {
            source: { table: 'comments', column: 'commentable_id' },
            target: { table: 'posts', column: 'id' },
          },
        ],
      })

      expect(result.connection.url).toBe('postgres://localhost/db')
      expect(result.connection.schema).toBe('myschema')
      expect(result.seed).toBe(42)
      expect(result.count).toBe(200)
      expect(result.locale).toBe('de')
      expect(result.existingData).toBe(ExistingDataMode.TRUNCATE)
      expect(result.tables.users.count).toBe(500)
      expect(result.tables.users.columns?.email.generator).toBe(
        'faker.internet.email',
      )
      expect(result.tables.users.columns?.email.unique).toBe(true)
      expect(result.tables.users.columns?.role.values).toEqual([
        'admin',
        'editor',
        'viewer',
      ])
      expect(result.tables.users.columns?.role.weights).toEqual([
        0.05, 0.25, 0.70,
      ])
      expect(result.tables.users.columns?.bio.nullable).toBe(0.3)
      expect(result.exclude).toEqual(['schema_migrations', 'pg_*'])
      expect(result.virtualForeignKeys).toHaveLength(1)
    })

    it('existingData mode is case-insensitive', () => {
      const result = validateConfig({
        existingData: { mode: 'Error' },
      })
      expect(result.existingData).toBe(ExistingDataMode.ERROR)
    })
  })

  describe('error conditions', () => {
    it('unknown top-level key -> SF5003 with typo suggestion', () => {
      try {
        validateConfig({ conection: {} })
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError)
        const ce = err as ConfigError
        expect(ce.code).toBe('SF5003')
        expect(ce.hints.some((h) => h.includes('connection'))).toBe(true)
      }
    })

    it('seed as string -> SF5004', () => {
      try {
        validateConfig({ seed: 'abc' })
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError)
        expect((err as ConfigError).code).toBe('SF5004')
      }
    })

    it('seed as negative number -> SF5004', () => {
      try {
        validateConfig({ seed: -1 })
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError)
        expect((err as ConfigError).code).toBe('SF5004')
      }
    })

    it('count as 0 -> SF5005', () => {
      try {
        validateConfig({ count: 0 })
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError)
        expect((err as ConfigError).code).toBe('SF5005')
      }
    })

    it('count as float -> SF5005', () => {
      try {
        validateConfig({ count: 1.5 })
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError)
        expect((err as ConfigError).code).toBe('SF5005')
      }
    })

    it('invalid existingData.mode -> SF5006', () => {
      try {
        validateConfig({ existingData: { mode: 'invalid' } })
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError)
        expect((err as ConfigError).code).toBe('SF5006')
      }
    })

    it('generator not starting with faker. -> SF5007', () => {
      try {
        validateConfig({
          tables: {
            users: {
              columns: {
                name: { generator: 'person.firstName' },
              },
            },
          },
        })
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError)
        expect((err as ConfigError).code).toBe('SF5007')
      }
    })

    it('nullable as 1.5 -> SF5008', () => {
      try {
        validateConfig({
          tables: {
            users: {
              columns: {
                bio: { nullable: 1.5 },
              },
            },
          },
        })
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError)
        expect((err as ConfigError).code).toBe('SF5008')
      }
    })

    it('nullable as -0.1 -> SF5008', () => {
      try {
        validateConfig({
          tables: {
            users: {
              columns: {
                bio: { nullable: -0.1 },
              },
            },
          },
        })
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError)
        expect((err as ConfigError).code).toBe('SF5008')
      }
    })

    it('weights length mismatch with values -> SF5009', () => {
      try {
        validateConfig({
          tables: {
            users: {
              columns: {
                role: {
                  values: ['a', 'b', 'c'],
                  weights: [0.5, 0.5],
                },
              },
            },
          },
        })
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError)
        expect((err as ConfigError).code).toBe('SF5009')
      }
    })

    it('weights without values -> SF5009', () => {
      try {
        validateConfig({
          tables: {
            users: {
              columns: {
                role: { weights: [0.5, 0.5] },
              },
            },
          },
        })
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError)
        expect((err as ConfigError).code).toBe('SF5009')
      }
    })

    it('both generator and values on same column -> SF5011', () => {
      try {
        validateConfig({
          tables: {
            users: {
              columns: {
                name: {
                  generator: 'faker.person.firstName',
                  values: ['Alice', 'Bob'],
                },
              },
            },
          },
        })
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError)
        expect((err as ConfigError).code).toBe('SF5011')
      }
    })

    it('exclude with non-string element -> SF5012', () => {
      try {
        validateConfig({ exclude: ['valid', 123 as unknown as string] })
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError)
        expect((err as ConfigError).code).toBe('SF5012')
      }
    })

    it('virtualForeignKeys entry missing source.table -> SF5013', () => {
      try {
        validateConfig({
          virtualForeignKeys: [
            {
              source: { column: 'id' },
              target: { table: 'posts', column: 'id' },
            },
          ],
        })
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError)
        expect((err as ConfigError).code).toBe('SF5013')
      }
    })

    it('unknown key in column override -> SF5003', () => {
      try {
        validateConfig({
          tables: {
            users: {
              columns: {
                name: { genrator: 'faker.person.firstName' },
              },
            },
          },
        })
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError)
        expect((err as ConfigError).code).toBe('SF5003')
      }
    })
  })

  describe('relationships config', () => {
    it('valid range cardinality parses correctly', () => {
      const result = validateConfig({
        tables: {
          orders: {
            relationships: {
              user_id: { cardinality: '1..10' },
            },
          },
        },
      })
      expect(result.tables.orders.relationships).toBeDefined()
      expect(result.tables.orders.relationships!.user_id.cardinality).toBe('1..10')
    })

    it('valid range with distribution parses correctly', () => {
      const result = validateConfig({
        tables: {
          orders: {
            relationships: {
              user_id: { cardinality: '1..10', distribution: 'zipf' },
            },
          },
        },
      })
      expect(result.tables.orders.relationships!.user_id.distribution).toBe('zipf')
    })

    it('valid discrete cardinality with weights', () => {
      const result = validateConfig({
        tables: {
          orders: {
            relationships: {
              user_id: { cardinality: [1, 3, 5], weights: [0.6, 0.3, 0.1] },
            },
          },
        },
      })
      expect(result.tables.orders.relationships!.user_id.cardinality).toEqual([1, 3, 5])
      expect(result.tables.orders.relationships!.user_id.weights).toEqual([0.6, 0.3, 0.1])
    })

    it('missing cardinality throws SF5021', () => {
      try {
        validateConfig({
          tables: {
            orders: {
              relationships: {
                user_id: {} as Record<string, unknown>,
              },
            },
          },
        })
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError)
        expect((err as ConfigError).code).toBe('SF5021')
      }
    })

    it('invalid range format throws SF5022', () => {
      try {
        validateConfig({
          tables: {
            orders: {
              relationships: {
                user_id: { cardinality: 'abc' },
              },
            },
          },
        })
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError)
        expect((err as ConfigError).code).toBe('SF5022')
      }
    })

    it('reversed range throws SF5022', () => {
      try {
        validateConfig({
          tables: {
            orders: {
              relationships: {
                user_id: { cardinality: '10..1' },
              },
            },
          },
        })
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError)
        expect((err as ConfigError).code).toBe('SF5022')
      }
    })

    it('invalid distribution throws SF5024', () => {
      try {
        validateConfig({
          tables: {
            orders: {
              relationships: {
                user_id: { cardinality: '1..10', distribution: 'fibonacci' },
              },
            },
          },
        })
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError)
        expect((err as ConfigError).code).toBe('SF5024')
      }
    })

    it('weights without array cardinality throws SF5025', () => {
      try {
        validateConfig({
          tables: {
            orders: {
              relationships: {
                user_id: { cardinality: '1..10', weights: [0.5, 0.5] },
              },
            },
          },
        })
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError)
        expect((err as ConfigError).code).toBe('SF5025')
      }
    })

    it('weights length mismatch throws SF5025', () => {
      try {
        validateConfig({
          tables: {
            orders: {
              relationships: {
                user_id: { cardinality: [1, 3, 5], weights: [0.5, 0.5] },
              },
            },
          },
        })
        expect.fail('Should have thrown')
      } catch (err) {
        expect(err).toBeInstanceOf(ConfigError)
        expect((err as ConfigError).code).toBe('SF5025')
      }
    })
  })
})
