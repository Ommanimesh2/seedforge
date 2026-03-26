import type { PatternEntry } from '../types.js'

const DOMAIN = 'temporal'

export const temporalPatterns: PatternEntry[] = [
  {
    names: ['created_at'],
    generator: (faker) => faker.date.past({ years: 2 }),
    fakerMethod: 'faker.date.past({ years: 2 })',
    domain: DOMAIN,
  },
  {
    names: ['updated_at', 'modified_at'],
    generator: (faker) => faker.date.recent({ days: 30 }),
    fakerMethod: 'faker.date.recent({ days: 30 })',
    domain: DOMAIN,
  },
  {
    names: ['deleted_at'],
    generator: (faker) => faker.date.recent({ days: 7 }),
    fakerMethod: 'faker.date.recent({ days: 7 })',
    domain: DOMAIN,
  },
  {
    names: ['published_at'],
    generator: (faker) => faker.date.past({ years: 1 }),
    fakerMethod: 'faker.date.past({ years: 1 })',
    domain: DOMAIN,
  },
  {
    names: ['expires_at', 'expired_at'],
    generator: (faker) => faker.date.future({ years: 1 }),
    fakerMethod: 'faker.date.future({ years: 1 })',
    domain: DOMAIN,
  },
  {
    names: ['start_date', 'hire_date'],
    generator: (faker) => faker.date.past({ years: 3 }),
    fakerMethod: 'faker.date.past({ years: 3 })',
    domain: DOMAIN,
  },
  {
    names: ['end_date', 'due_date'],
    generator: (faker) => faker.date.future({ years: 1 }),
    fakerMethod: 'faker.date.future({ years: 1 })',
    domain: DOMAIN,
  },
  {
    names: ['birth_date'],
    generator: (faker) => faker.date.birthdate(),
    fakerMethod: 'faker.date.birthdate()',
    domain: DOMAIN,
  },
  {
    names: ['start_time', 'end_time', 'time'],
    generator: (faker) => faker.date.recent(),
    fakerMethod: 'faker.date.recent()',
    domain: DOMAIN,
  },
  {
    names: ['timestamp', 'date'],
    suffixes: ['_at'],
    generator: (faker) => faker.date.recent({ days: 90 }),
    fakerMethod: 'faker.date.recent({ days: 90 })',
    domain: DOMAIN,
  },
  {
    names: [],
    suffixes: ['_date', '_on'],
    generator: (faker) => faker.date.past({ years: 2 }),
    fakerMethod: 'faker.date.past({ years: 2 })',
    domain: DOMAIN,
  },
  {
    names: ['year'],
    generator: (faker) => faker.number.int({ min: 2000, max: 2026 }),
    fakerMethod: 'faker.number.int({ min: 2000, max: 2026 })',
    domain: DOMAIN,
  },
  {
    names: ['month'],
    generator: (faker) => faker.number.int({ min: 1, max: 12 }),
    fakerMethod: 'faker.number.int({ min: 1, max: 12 })',
    domain: DOMAIN,
  },
  {
    names: ['day'],
    generator: (faker) => faker.number.int({ min: 1, max: 28 }),
    fakerMethod: 'faker.number.int({ min: 1, max: 28 })',
    domain: DOMAIN,
  },
  {
    names: ['hour'],
    generator: (faker) => faker.number.int({ min: 0, max: 23 }),
    fakerMethod: 'faker.number.int({ min: 0, max: 23 })',
    domain: DOMAIN,
  },
  {
    names: ['minute', 'second'],
    generator: (faker) => faker.number.int({ min: 0, max: 59 }),
    fakerMethod: 'faker.number.int({ min: 0, max: 59 })',
    domain: DOMAIN,
  },
]
