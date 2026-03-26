import type { PatternEntry } from '../types.js'

const DOMAIN = 'finance'

export const financePatterns: PatternEntry[] = [
  {
    names: ['price', 'amount', 'cost', 'total', 'subtotal', 'tax', 'discount', 'balance', 'salary', 'revenue', 'profit'],
    suffixes: ['_price', '_amount', '_cost', '_total', '_tax', '_fee'],
    generator: (faker) => faker.finance.amount({ min: 1, max: 10000, dec: 2 }),
    fakerMethod: 'faker.finance.amount({ min: 1, max: 10000, dec: 2 })',
    domain: DOMAIN,
  },
  {
    names: [],
    suffixes: ['_rate'],
    generator: (faker) => faker.finance.amount({ min: 0, max: 1, dec: 4 }),
    fakerMethod: 'faker.finance.amount({ min: 0, max: 1, dec: 4 })',
    domain: DOMAIN,
  },
  {
    names: ['currency', 'currency_code'],
    generator: (faker) => faker.finance.currencyCode(),
    fakerMethod: 'faker.finance.currencyCode()',
    domain: DOMAIN,
  },
  {
    names: ['credit_card', 'card_number'],
    generator: (faker) => faker.finance.creditCardNumber(),
    fakerMethod: 'faker.finance.creditCardNumber()',
    domain: DOMAIN,
  },
  {
    names: ['account_number'],
    generator: (faker) => faker.finance.accountNumber(),
    fakerMethod: 'faker.finance.accountNumber()',
    domain: DOMAIN,
  },
  {
    names: ['routing_number'],
    generator: (faker) => faker.finance.routingNumber(),
    fakerMethod: 'faker.finance.routingNumber()',
    domain: DOMAIN,
  },
  {
    names: ['iban'],
    generator: (faker) => faker.finance.iban(),
    fakerMethod: 'faker.finance.iban()',
    domain: DOMAIN,
  },
  {
    names: ['bic', 'swift'],
    generator: (faker) => faker.finance.bic(),
    fakerMethod: 'faker.finance.bic()',
    domain: DOMAIN,
  },
]
