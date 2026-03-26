import { NormalizedType } from '../types/schema.js'
import type { ColumnDef } from '../types/schema.js'
import type { GeneratorFn } from './types.js'

interface TypeFallbackResult {
  generator: GeneratorFn
  fakerMethod: string
}

export function getTypeFallback(column: ColumnDef): TypeFallbackResult {
  switch (column.dataType) {
    case NormalizedType.TEXT:
      return {
        generator: (faker) => faker.lorem.sentence(),
        fakerMethod: 'faker.lorem.sentence()',
      }

    case NormalizedType.VARCHAR: {
      const maxLen = column.maxLength
      return {
        generator: (faker) => {
          const words = faker.lorem.words(3)
          if (maxLen && words.length > maxLen) {
            return words.slice(0, maxLen)
          }
          return words
        },
        fakerMethod: 'faker.lorem.words()',
      }
    }

    case NormalizedType.CHAR: {
      const len = column.maxLength || 1
      return {
        generator: (faker) => faker.string.alpha(len),
        fakerMethod: 'faker.string.alpha()',
      }
    }

    case NormalizedType.SMALLINT:
      return {
        generator: (faker) => faker.number.int({ min: 0, max: 32767 }),
        fakerMethod: 'faker.number.int()',
      }

    case NormalizedType.INTEGER:
      return {
        generator: (faker) => faker.number.int({ min: 1, max: 100000 }),
        fakerMethod: 'faker.number.int()',
      }

    case NormalizedType.BIGINT:
      return {
        generator: (faker) => faker.number.int({ min: 1, max: 1000000 }),
        fakerMethod: 'faker.number.int()',
      }

    case NormalizedType.REAL:
      return {
        generator: (faker) => faker.number.float({ min: 0, max: 1000, fractionDigits: 2 }),
        fakerMethod: 'faker.number.float()',
      }

    case NormalizedType.DOUBLE:
      return {
        generator: (faker) => faker.number.float({ min: 0, max: 1000000, fractionDigits: 4 }),
        fakerMethod: 'faker.number.float()',
      }

    case NormalizedType.DECIMAL: {
      const precision = column.numericPrecision || 10
      const scale = column.numericScale || 2
      const maxVal = Math.pow(10, precision - scale) - 1
      return {
        generator: (faker) => faker.finance.amount({ min: 0, max: Math.min(maxVal, 999999), dec: scale }),
        fakerMethod: 'faker.finance.amount()',
      }
    }

    case NormalizedType.BOOLEAN:
      return {
        generator: (faker) => faker.datatype.boolean(),
        fakerMethod: 'faker.datatype.boolean()',
      }

    case NormalizedType.DATE:
      return {
        generator: (faker) => faker.date.past({ years: 2 }),
        fakerMethod: 'faker.date.past()',
      }

    case NormalizedType.TIME:
      return {
        generator: (faker) => {
          const d = faker.date.recent()
          return d.toISOString().split('T')[1]?.split('.')[0] ?? '00:00:00'
        },
        fakerMethod: 'faker.date.recent()',
      }

    case NormalizedType.TIMESTAMP:
      return {
        generator: (faker) => faker.date.past({ years: 2 }),
        fakerMethod: 'faker.date.past()',
      }

    case NormalizedType.TIMESTAMPTZ:
      return {
        generator: (faker) => faker.date.past({ years: 2 }),
        fakerMethod: 'faker.date.past()',
      }

    case NormalizedType.INTERVAL:
      return {
        generator: () => '1 day',
        fakerMethod: "static: '1 day'",
      }

    case NormalizedType.JSON:
      return {
        generator: () => ({}),
        fakerMethod: 'static: {}',
      }

    case NormalizedType.JSONB:
      return {
        generator: () => ({}),
        fakerMethod: 'static: {}',
      }

    case NormalizedType.UUID:
      return {
        generator: (faker) => faker.string.uuid(),
        fakerMethod: 'faker.string.uuid()',
      }

    case NormalizedType.BYTEA:
      return {
        generator: (faker) => Buffer.from(faker.string.alphanumeric(16)),
        fakerMethod: 'faker.string.alphanumeric()',
      }

    case NormalizedType.INET:
      return {
        generator: (faker) => faker.internet.ipv4(),
        fakerMethod: 'faker.internet.ipv4()',
      }

    case NormalizedType.CIDR:
      return {
        generator: (faker) => faker.internet.ipv4() + '/24',
        fakerMethod: 'faker.internet.ipv4()',
      }

    case NormalizedType.MACADDR:
      return {
        generator: (faker) => faker.internet.mac(),
        fakerMethod: 'faker.internet.mac()',
      }

    case NormalizedType.ARRAY:
      return {
        generator: () => '{}',
        fakerMethod: "static: '{}'",
      }

    case NormalizedType.ENUM:
      // Handled by enum logic in constraint-handlers, should not reach here
      // But if it does, return a safe fallback
      return {
        generator: () => null,
        fakerMethod: 'static: NULL',
      }

    case NormalizedType.POINT:
      return {
        generator: (faker) => `(${faker.location.latitude()},${faker.location.longitude()})`,
        fakerMethod: 'faker.location.latitude()',
      }

    case NormalizedType.LINE:
      return {
        generator: () => '{0,0,0}',
        fakerMethod: 'static: line',
      }

    case NormalizedType.GEOMETRY:
      return {
        generator: () => null,
        fakerMethod: 'static: NULL',
      }

    case NormalizedType.VECTOR:
      return {
        generator: (faker) => Array.from({ length: 3 }, () => faker.number.float({ min: -1, max: 1, fractionDigits: 6 })),
        fakerMethod: 'faker.number.float()',
      }

    case NormalizedType.UNKNOWN:
      return {
        generator: () => null,
        fakerMethod: 'static: NULL',
      }

    default:
      return {
        generator: () => null,
        fakerMethod: 'static: NULL',
      }
  }
}
