import type { PatternEntry } from '../types.js'

const DOMAIN = 'boolean'

export const booleanPatterns: PatternEntry[] = [
  {
    names: [
      'active', 'enabled', 'disabled', 'verified', 'confirmed',
      'approved', 'published', 'archived', 'deleted', 'visible',
      'hidden', 'locked', 'featured', 'public', 'private',
      'read', 'admin', 'subscribed', 'opted_in',
    ],
    generator: (faker) => faker.datatype.boolean(),
    fakerMethod: 'faker.datatype.boolean()',
    domain: DOMAIN,
  },
  {
    names: [],
    prefixes: ['is_', 'has_', 'can_', 'should_', 'was_', 'will_', 'allow_', 'enable_', 'disable_'],
    generator: (faker) => faker.datatype.boolean(),
    fakerMethod: 'faker.datatype.boolean()',
    domain: DOMAIN,
  },
]
