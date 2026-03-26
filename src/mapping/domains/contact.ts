import type { PatternEntry } from '../types.js'

const DOMAIN = 'contact'

export const contactPatterns: PatternEntry[] = [
  {
    names: ['email', 'email_address'],
    suffixes: ['_email'],
    generator: (faker) => faker.internet.email(),
    fakerMethod: 'faker.internet.email()',
    domain: DOMAIN,
  },
  {
    names: ['phone', 'phone_number', 'telephone', 'mobile', 'cell'],
    suffixes: ['_phone', '_tel', '_mobile'],
    generator: (faker) => faker.phone.number(),
    fakerMethod: 'faker.phone.number()',
    domain: DOMAIN,
  },
  {
    names: ['fax'],
    suffixes: ['_fax'],
    generator: (faker) => faker.phone.number(),
    fakerMethod: 'faker.phone.number()',
    domain: DOMAIN,
  },
  {
    names: ['website', 'homepage', 'url'],
    suffixes: ['_url', '_website', '_homepage', '_uri'],
    generator: (faker) => faker.internet.url(),
    fakerMethod: 'faker.internet.url()',
    domain: DOMAIN,
  },
]
