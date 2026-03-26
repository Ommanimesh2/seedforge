import type { PatternEntry } from '../types.js'

const DOMAIN = 'text'

export const textPatterns: PatternEntry[] = [
  {
    names: ['title', 'headline', 'subject', 'label', 'caption'],
    generator: (faker) => faker.lorem.sentence(),
    fakerMethod: 'faker.lorem.sentence()',
    domain: DOMAIN,
  },
  {
    names: ['description', 'summary', 'excerpt', 'abstract'],
    generator: (faker) => faker.lorem.paragraph(),
    fakerMethod: 'faker.lorem.paragraph()',
    domain: DOMAIN,
  },
  {
    names: ['body', 'content', 'text'],
    generator: (faker) => faker.lorem.paragraphs(3),
    fakerMethod: 'faker.lorem.paragraphs(3)',
    domain: DOMAIN,
  },
  {
    names: ['note', 'notes', 'comment', 'comments', 'message'],
    generator: (faker) => faker.lorem.sentences(2),
    fakerMethod: 'faker.lorem.sentences(2)',
    domain: DOMAIN,
  },
]
