import type { PatternEntry } from '../types.js'

const DOMAIN = 'location'

export const locationPatterns: PatternEntry[] = [
  {
    names: ['address', 'street', 'street_address', 'address_line_1', 'address1'],
    suffixes: ['_address'],
    generator: (faker) => faker.location.streetAddress(),
    fakerMethod: 'faker.location.streetAddress()',
    domain: DOMAIN,
  },
  {
    names: ['address_line_2', 'address2'],
    generator: (faker) => faker.location.secondaryAddress(),
    fakerMethod: 'faker.location.secondaryAddress()',
    domain: DOMAIN,
  },
  {
    names: ['city', 'town'],
    suffixes: ['_city'],
    generator: (faker) => faker.location.city(),
    fakerMethod: 'faker.location.city()',
    domain: DOMAIN,
  },
  {
    names: ['state', 'province', 'region'],
    suffixes: ['_state'],
    generator: (faker) => faker.location.state(),
    fakerMethod: 'faker.location.state()',
    domain: DOMAIN,
  },
  {
    names: ['country'],
    suffixes: ['_country'],
    generator: (faker) => faker.location.country(),
    fakerMethod: 'faker.location.country()',
    domain: DOMAIN,
  },
  {
    names: ['country_code'],
    generator: (faker) => faker.location.countryCode(),
    fakerMethod: 'faker.location.countryCode()',
    domain: DOMAIN,
  },
  {
    names: ['zip', 'zipcode', 'zip_code', 'postal_code', 'postcode'],
    suffixes: ['_zip'],
    generator: (faker) => faker.location.zipCode(),
    fakerMethod: 'faker.location.zipCode()',
    domain: DOMAIN,
  },
  {
    names: ['latitude', 'lat'],
    suffixes: ['_lat'],
    generator: (faker) => faker.location.latitude(),
    fakerMethod: 'faker.location.latitude()',
    domain: DOMAIN,
  },
  {
    names: ['longitude', 'lng', 'lon'],
    suffixes: ['_lng', '_lon'],
    generator: (faker) => faker.location.longitude(),
    fakerMethod: 'faker.location.longitude()',
    domain: DOMAIN,
  },
  {
    names: ['county'],
    generator: (faker) => faker.location.county(),
    fakerMethod: 'faker.location.county()',
    domain: DOMAIN,
  },
  {
    names: ['neighborhood'],
    generator: (faker) => faker.location.county(),
    fakerMethod: 'faker.location.county()',
    domain: DOMAIN,
  },
  {
    names: ['timezone', 'time_zone'],
    generator: (faker) => faker.location.timeZone(),
    fakerMethod: 'faker.location.timeZone()',
    domain: DOMAIN,
  },
]
