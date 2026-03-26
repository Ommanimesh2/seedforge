import type { PatternEntry } from '../types.js'

const DOMAIN = 'internet'

export const internetPatterns: PatternEntry[] = [
  {
    names: ['ip', 'ip_address', 'ipv4'],
    suffixes: ['_ip'],
    generator: (faker) => faker.internet.ipv4(),
    fakerMethod: 'faker.internet.ipv4()',
    domain: DOMAIN,
  },
  {
    names: ['ipv6'],
    generator: (faker) => faker.internet.ipv6(),
    fakerMethod: 'faker.internet.ipv6()',
    domain: DOMAIN,
  },
  {
    names: ['mac', 'mac_address'],
    suffixes: ['_mac'],
    generator: (faker) => faker.internet.mac(),
    fakerMethod: 'faker.internet.mac()',
    domain: DOMAIN,
  },
  {
    names: ['user_agent', 'useragent'],
    generator: (faker) => faker.internet.userAgent(),
    fakerMethod: 'faker.internet.userAgent()',
    domain: DOMAIN,
  },
  {
    names: ['slug'],
    suffixes: ['_slug'],
    generator: (faker) => faker.lorem.slug(),
    fakerMethod: 'faker.lorem.slug()',
    domain: DOMAIN,
  },
  {
    names: ['domain', 'domain_name', 'hostname'],
    suffixes: ['_domain'],
    generator: (faker) => faker.internet.domainName(),
    fakerMethod: 'faker.internet.domainName()',
    domain: DOMAIN,
  },
  {
    names: ['password'],
    generator: (faker) => faker.internet.password(),
    fakerMethod: 'faker.internet.password()',
    domain: DOMAIN,
  },
  {
    names: ['token', 'api_key', 'access_token', 'refresh_token'],
    suffixes: ['_token', '_key'],
    generator: (faker) => faker.string.alphanumeric(32),
    fakerMethod: 'faker.string.alphanumeric(32)',
    domain: DOMAIN,
  },
]
