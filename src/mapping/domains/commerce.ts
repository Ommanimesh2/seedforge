import type { PatternEntry } from '../types.js'

const DOMAIN = 'commerce'

export const commercePatterns: PatternEntry[] = [
  {
    names: ['product', 'product_name'],
    generator: (faker) => faker.commerce.productName(),
    fakerMethod: 'faker.commerce.productName()',
    domain: DOMAIN,
  },
  {
    names: ['brand'],
    generator: (faker) => faker.company.name(),
    fakerMethod: 'faker.company.name()',
    domain: DOMAIN,
  },
  {
    names: ['category', 'department'],
    generator: (faker) => faker.commerce.department(),
    fakerMethod: 'faker.commerce.department()',
    domain: DOMAIN,
  },
  {
    names: ['sku'],
    generator: (faker) => faker.string.alphanumeric(8).toUpperCase(),
    fakerMethod: 'faker.string.alphanumeric(8).toUpperCase()',
    domain: DOMAIN,
  },
  {
    names: ['barcode'],
    generator: (faker) => faker.commerce.isbn(),
    fakerMethod: 'faker.commerce.isbn()',
    domain: DOMAIN,
  },
  {
    names: ['isbn'],
    generator: (faker) => faker.commerce.isbn(),
    fakerMethod: 'faker.commerce.isbn()',
    domain: DOMAIN,
  },
  {
    names: ['color', 'colour'],
    generator: (faker) => faker.color.human(),
    fakerMethod: 'faker.color.human()',
    domain: DOMAIN,
  },
  {
    names: ['size'],
    generator: (faker) => faker.helpers.arrayElement(['XS', 'S', 'M', 'L', 'XL', 'XXL']),
    fakerMethod: "faker.helpers.arrayElement(['XS', 'S', 'M', 'L', 'XL', 'XXL'])",
    domain: DOMAIN,
  },
  {
    names: ['weight'],
    generator: (faker) => faker.number.float({ min: 0.1, max: 100, fractionDigits: 2 }),
    fakerMethod: 'faker.number.float({ min: 0.1, max: 100, fractionDigits: 2 })',
    domain: DOMAIN,
  },
  {
    names: ['quantity', 'qty'],
    generator: (faker) => faker.number.int({ min: 1, max: 100 }),
    fakerMethod: 'faker.number.int({ min: 1, max: 100 })',
    domain: DOMAIN,
  },
  {
    names: ['rating'],
    generator: (faker) => faker.number.int({ min: 1, max: 5 }),
    fakerMethod: 'faker.number.int({ min: 1, max: 5 })',
    domain: DOMAIN,
  },
  {
    names: ['review'],
    generator: (faker) => faker.lorem.paragraph(),
    fakerMethod: 'faker.lorem.paragraph()',
    domain: DOMAIN,
  },
]
