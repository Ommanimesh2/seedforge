import type { PatternEntry } from '../types.js'

const DOMAIN = 'identifiers'

export const identifierPatterns: PatternEntry[] = [
  {
    names: ['uuid', 'guid'],
    suffixes: ['_uuid', '_guid'],
    generator: (faker) => faker.string.uuid(),
    fakerMethod: 'faker.string.uuid()',
    domain: DOMAIN,
  },
  {
    names: ['code', 'reference', 'ref'],
    suffixes: ['_code', '_ref'],
    generator: (faker) => faker.string.alphanumeric(8).toUpperCase(),
    fakerMethod: 'faker.string.alphanumeric(8).toUpperCase()',
    domain: DOMAIN,
  },
  {
    names: ['hash', 'checksum'],
    suffixes: ['_hash'],
    generator: (faker) => faker.string.hexadecimal({ length: 40, prefix: '' }),
    fakerMethod: 'faker.string.hexadecimal({ length: 40 })',
    domain: DOMAIN,
  },
  {
    names: ['external_id'],
    generator: (faker) => faker.string.alphanumeric(12),
    fakerMethod: 'faker.string.alphanumeric(12)',
    domain: DOMAIN,
  },
  {
    names: ['tracking_number'],
    generator: (faker) => faker.string.alphanumeric(16).toUpperCase(),
    fakerMethod: 'faker.string.alphanumeric(16).toUpperCase()',
    domain: DOMAIN,
  },
  {
    names: ['confirmation_code'],
    generator: (faker) => faker.string.alphanumeric(6).toUpperCase(),
    fakerMethod: 'faker.string.alphanumeric(6).toUpperCase()',
    domain: DOMAIN,
  },
  {
    names: ['serial_number'],
    generator: (faker) => faker.string.alphanumeric(10).toUpperCase(),
    fakerMethod: 'faker.string.alphanumeric(10).toUpperCase()',
    domain: DOMAIN,
  },
]
