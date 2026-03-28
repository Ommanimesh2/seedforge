/**
 * Domain + NormalizedType → best Faker generator.
 *
 * When the stem scorer identifies a domain (e.g., "finance") and we know the
 * column's NormalizedType (e.g., DECIMAL), this map provides the most
 * semantically appropriate Faker generator.
 *
 * Domains without specialized Faker modules (medical, transport, education,
 * government, legal) fall back to generic generators for their types.
 */

import { NormalizedType } from '../types/schema.js'
import type { GeneratorFn } from './types.js'

export interface DomainGeneratorResult {
  generator: GeneratorFn
  fakerMethod: string
}

type TypeGeneratorMap = Partial<Record<NormalizedType, DomainGeneratorResult>>

const domainTypeMap: Record<string, TypeGeneratorMap> = {
  // ── PERSON ────────────────────────────────────────────────
  person: {
    [NormalizedType.TEXT]: {
      generator: (faker) => faker.person.fullName(),
      fakerMethod: 'faker.person.fullName()',
    },
    [NormalizedType.VARCHAR]: {
      generator: (faker) => faker.person.fullName(),
      fakerMethod: 'faker.person.fullName()',
    },
    [NormalizedType.INTEGER]: {
      generator: (faker) => faker.number.int({ min: 18, max: 85 }),
      fakerMethod: 'faker.number.int({ min: 18, max: 85 })',
    },
    [NormalizedType.SMALLINT]: {
      generator: (faker) => faker.number.int({ min: 18, max: 85 }),
      fakerMethod: 'faker.number.int({ min: 18, max: 85 })',
    },
  },

  // ── CONTACT ───────────────────────────────────────────────
  contact: {
    [NormalizedType.TEXT]: {
      generator: (faker) => faker.phone.number(),
      fakerMethod: 'faker.phone.number()',
    },
    [NormalizedType.VARCHAR]: {
      generator: (faker) => faker.phone.number(),
      fakerMethod: 'faker.phone.number()',
    },
  },

  // ── INTERNET ──────────────────────────────────────────────
  internet: {
    [NormalizedType.TEXT]: {
      generator: (faker) => faker.internet.url(),
      fakerMethod: 'faker.internet.url()',
    },
    [NormalizedType.VARCHAR]: {
      generator: (faker) => faker.internet.url(),
      fakerMethod: 'faker.internet.url()',
    },
  },

  // ── LOCATION ──────────────────────────────────────────────
  location: {
    [NormalizedType.TEXT]: {
      generator: (faker) => faker.location.streetAddress(),
      fakerMethod: 'faker.location.streetAddress()',
    },
    [NormalizedType.VARCHAR]: {
      generator: (faker) => faker.location.city(),
      fakerMethod: 'faker.location.city()',
    },
    [NormalizedType.REAL]: {
      generator: (faker) => faker.location.latitude(),
      fakerMethod: 'faker.location.latitude()',
    },
    [NormalizedType.DOUBLE]: {
      generator: (faker) => faker.location.latitude(),
      fakerMethod: 'faker.location.latitude()',
    },
    [NormalizedType.DECIMAL]: {
      generator: (faker) => faker.location.latitude(),
      fakerMethod: 'faker.location.latitude()',
    },
  },

  // ── FINANCE ───────────────────────────────────────────────
  finance: {
    [NormalizedType.TEXT]: {
      generator: (faker) => faker.finance.transactionDescription(),
      fakerMethod: 'faker.finance.transactionDescription()',
    },
    [NormalizedType.VARCHAR]: {
      generator: (faker) => faker.finance.currencyCode(),
      fakerMethod: 'faker.finance.currencyCode()',
    },
    [NormalizedType.DECIMAL]: {
      generator: (faker) => faker.finance.amount({ min: 1, max: 10000, dec: 2 }),
      fakerMethod: 'faker.finance.amount({ min: 1, max: 10000, dec: 2 })',
    },
    [NormalizedType.REAL]: {
      generator: (faker) => faker.number.float({ min: 0, max: 10000, fractionDigits: 2 }),
      fakerMethod: 'faker.number.float({ min: 0, max: 10000, fractionDigits: 2 })',
    },
    [NormalizedType.DOUBLE]: {
      generator: (faker) => faker.number.float({ min: 0, max: 100000, fractionDigits: 4 }),
      fakerMethod: 'faker.number.float({ min: 0, max: 100000, fractionDigits: 4 })',
    },
    [NormalizedType.INTEGER]: {
      generator: (faker) => faker.number.int({ min: 1, max: 100000 }),
      fakerMethod: 'faker.number.int({ min: 1, max: 100000 })',
    },
    [NormalizedType.BIGINT]: {
      generator: (faker) => faker.number.int({ min: 1, max: 1000000 }),
      fakerMethod: 'faker.number.int({ min: 1, max: 1000000 })',
    },
    [NormalizedType.SMALLINT]: {
      generator: (faker) => faker.number.int({ min: 1, max: 32000 }),
      fakerMethod: 'faker.number.int({ min: 1, max: 32000 })',
    },
  },

  // ── COMMERCE ──────────────────────────────────────────────
  commerce: {
    [NormalizedType.TEXT]: {
      generator: (faker) => faker.commerce.productName(),
      fakerMethod: 'faker.commerce.productName()',
    },
    [NormalizedType.VARCHAR]: {
      generator: (faker) => faker.commerce.productName(),
      fakerMethod: 'faker.commerce.productName()',
    },
    [NormalizedType.DECIMAL]: {
      generator: (faker) => faker.commerce.price({ min: 1, max: 1000 }),
      fakerMethod: 'faker.commerce.price({ min: 1, max: 1000 })',
    },
    [NormalizedType.INTEGER]: {
      generator: (faker) => faker.number.int({ min: 1, max: 100 }),
      fakerMethod: 'faker.number.int({ min: 1, max: 100 })',
    },
    [NormalizedType.SMALLINT]: {
      generator: (faker) => faker.number.int({ min: 1, max: 100 }),
      fakerMethod: 'faker.number.int({ min: 1, max: 100 })',
    },
  },

  // ── TEXT ───────────────────────────────────────────────────
  text: {
    [NormalizedType.TEXT]: {
      generator: (faker) => faker.lorem.paragraph(),
      fakerMethod: 'faker.lorem.paragraph()',
    },
    [NormalizedType.VARCHAR]: {
      generator: (faker) => faker.lorem.sentence(),
      fakerMethod: 'faker.lorem.sentence()',
    },
  },

  // ── IDENTIFIERS ───────────────────────────────────────────
  identifiers: {
    [NormalizedType.TEXT]: {
      generator: (faker) => faker.string.alphanumeric(12).toUpperCase(),
      fakerMethod: 'faker.string.alphanumeric(12).toUpperCase()',
    },
    [NormalizedType.VARCHAR]: {
      generator: (faker) => faker.string.alphanumeric(8).toUpperCase(),
      fakerMethod: 'faker.string.alphanumeric(8).toUpperCase()',
    },
    [NormalizedType.UUID]: {
      generator: (faker) => faker.string.uuid(),
      fakerMethod: 'faker.string.uuid()',
    },
    [NormalizedType.INTEGER]: {
      generator: (faker) => faker.number.int({ min: 100000, max: 999999 }),
      fakerMethod: 'faker.number.int({ min: 100000, max: 999999 })',
    },
    [NormalizedType.BIGINT]: {
      generator: (faker) => faker.number.int({ min: 1000000, max: 9999999 }),
      fakerMethod: 'faker.number.int({ min: 1000000, max: 9999999 })',
    },
  },

  // ── TEMPORAL ──────────────────────────────────────────────
  temporal: {
    [NormalizedType.TEXT]: {
      generator: (faker) => faker.date.recent({ days: 90 }).toISOString(),
      fakerMethod: 'faker.date.recent({ days: 90 }).toISOString()',
    },
    [NormalizedType.VARCHAR]: {
      generator: (faker) => faker.date.recent({ days: 90 }).toISOString(),
      fakerMethod: 'faker.date.recent({ days: 90 }).toISOString()',
    },
    [NormalizedType.DATE]: {
      generator: (faker) => faker.date.past({ years: 2 }),
      fakerMethod: 'faker.date.past({ years: 2 })',
    },
    [NormalizedType.TIMESTAMP]: {
      generator: (faker) => faker.date.past({ years: 2 }),
      fakerMethod: 'faker.date.past({ years: 2 })',
    },
    [NormalizedType.TIMESTAMPTZ]: {
      generator: (faker) => faker.date.past({ years: 2 }),
      fakerMethod: 'faker.date.past({ years: 2 })',
    },
    [NormalizedType.INTEGER]: {
      generator: (faker) => faker.number.int({ min: 2000, max: 2026 }),
      fakerMethod: 'faker.number.int({ min: 2000, max: 2026 })',
    },
    [NormalizedType.BIGINT]: {
      generator: (faker) => Math.floor(faker.date.past({ years: 2 }).getTime() / 1000),
      fakerMethod: 'faker.date.past({ years: 2 }).getTime() / 1000',
    },
  },

  // ── MEDICAL ───────────────────────────────────────────────
  // No specialized Faker module — use sensible fallbacks
  medical: {
    [NormalizedType.TEXT]: {
      generator: (faker) => faker.lorem.sentence(),
      fakerMethod: 'faker.lorem.sentence()',
    },
    [NormalizedType.VARCHAR]: {
      generator: (faker) => faker.lorem.words(3),
      fakerMethod: 'faker.lorem.words(3)',
    },
    [NormalizedType.INTEGER]: {
      generator: (faker) => faker.number.int({ min: 1, max: 1000 }),
      fakerMethod: 'faker.number.int({ min: 1, max: 1000 })',
    },
    [NormalizedType.DECIMAL]: {
      generator: (faker) => faker.number.float({ min: 0, max: 500, fractionDigits: 2 }),
      fakerMethod: 'faker.number.float({ min: 0, max: 500, fractionDigits: 2 })',
    },
  },

  // ── TRANSPORT ─────────────────────────────────────────────
  transport: {
    [NormalizedType.TEXT]: {
      generator: (faker) => faker.vehicle.vehicle(),
      fakerMethod: 'faker.vehicle.vehicle()',
    },
    [NormalizedType.VARCHAR]: {
      generator: (faker) => faker.vehicle.vehicle(),
      fakerMethod: 'faker.vehicle.vehicle()',
    },
    [NormalizedType.INTEGER]: {
      generator: (faker) => faker.number.int({ min: 1, max: 999999 }),
      fakerMethod: 'faker.number.int({ min: 1, max: 999999 })',
    },
    [NormalizedType.DECIMAL]: {
      generator: (faker) => faker.number.float({ min: 0, max: 500000, fractionDigits: 1 }),
      fakerMethod: 'faker.number.float({ min: 0, max: 500000, fractionDigits: 1 })',
    },
  },

  // ── EDUCATION ─────────────────────────────────────────────
  education: {
    [NormalizedType.TEXT]: {
      generator: (faker) => faker.lorem.sentence(),
      fakerMethod: 'faker.lorem.sentence()',
    },
    [NormalizedType.VARCHAR]: {
      generator: (faker) => faker.lorem.words(3),
      fakerMethod: 'faker.lorem.words(3)',
    },
    [NormalizedType.INTEGER]: {
      generator: (faker) => faker.number.int({ min: 1, max: 1000 }),
      fakerMethod: 'faker.number.int({ min: 1, max: 1000 })',
    },
    [NormalizedType.DECIMAL]: {
      generator: (faker) => faker.number.float({ min: 0, max: 4, fractionDigits: 2 }),
      fakerMethod: 'faker.number.float({ min: 0, max: 4, fractionDigits: 2 })',
    },
  },

  // ── GOVERNMENT ────────────────────────────────────────────
  government: {
    [NormalizedType.TEXT]: {
      generator: (faker) => faker.lorem.sentence(),
      fakerMethod: 'faker.lorem.sentence()',
    },
    [NormalizedType.VARCHAR]: {
      generator: (faker) => faker.string.alphanumeric(10).toUpperCase(),
      fakerMethod: 'faker.string.alphanumeric(10).toUpperCase()',
    },
    [NormalizedType.INTEGER]: {
      generator: (faker) => faker.number.int({ min: 10000, max: 99999 }),
      fakerMethod: 'faker.number.int({ min: 10000, max: 99999 })',
    },
  },

  // ── LEGAL ─────────────────────────────────────────────────
  legal: {
    [NormalizedType.TEXT]: {
      generator: (faker) => faker.lorem.paragraph(),
      fakerMethod: 'faker.lorem.paragraph()',
    },
    [NormalizedType.VARCHAR]: {
      generator: (faker) => faker.lorem.sentence(),
      fakerMethod: 'faker.lorem.sentence()',
    },
    [NormalizedType.INTEGER]: {
      generator: (faker) => faker.number.int({ min: 1, max: 100000 }),
      fakerMethod: 'faker.number.int({ min: 1, max: 100000 })',
    },
    [NormalizedType.DATE]: {
      generator: (faker) => faker.date.past({ years: 5 }),
      fakerMethod: 'faker.date.past({ years: 5 })',
    },
    [NormalizedType.TIMESTAMP]: {
      generator: (faker) => faker.date.past({ years: 5 }),
      fakerMethod: 'faker.date.past({ years: 5 })',
    },
  },

  // ── BOOLEAN ───────────────────────────────────────────────
  boolean: {
    [NormalizedType.BOOLEAN]: {
      generator: (faker) => faker.datatype.boolean(),
      fakerMethod: 'faker.datatype.boolean()',
    },
  },
}

/**
 * Look up the best generator for a given domain and NormalizedType.
 * Returns null if no specific generator exists for this combination.
 */
export function getDomainGenerator(
  domain: string,
  dataType: NormalizedType,
): DomainGeneratorResult | null {
  const typeMap = domainTypeMap[domain]
  if (!typeMap) return null

  const result = typeMap[dataType]
  return result ?? null
}
