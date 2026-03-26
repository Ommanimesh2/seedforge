import type { PatternEntry } from '../types.js'

const DOMAIN = 'person'

export const personPatterns: PatternEntry[] = [
  {
    names: ['first_name', 'firstname', 'fname'],
    generator: (faker) => faker.person.firstName(),
    fakerMethod: 'faker.person.firstName()',
    domain: DOMAIN,
  },
  {
    names: ['last_name', 'lastname', 'lname', 'surname'],
    generator: (faker) => faker.person.lastName(),
    fakerMethod: 'faker.person.lastName()',
    domain: DOMAIN,
  },
  {
    names: ['name', 'full_name', 'fullname', 'display_name'],
    generator: (faker) => faker.person.fullName(),
    fakerMethod: 'faker.person.fullName()',
    domain: DOMAIN,
  },
  {
    names: ['middle_name', 'middlename'],
    generator: (faker) => faker.person.middleName(),
    fakerMethod: 'faker.person.middleName()',
    domain: DOMAIN,
  },
  {
    names: ['prefix', 'title'],
    generator: (faker) => faker.person.prefix(),
    fakerMethod: 'faker.person.prefix()',
    domain: DOMAIN,
  },
  {
    names: ['suffix'],
    generator: (faker) => faker.person.suffix(),
    fakerMethod: 'faker.person.suffix()',
    domain: DOMAIN,
  },
  {
    names: ['nickname', 'username'],
    generator: (faker) => faker.internet.username(),
    fakerMethod: 'faker.internet.username()',
    domain: DOMAIN,
  },
  {
    names: ['gender', 'sex'],
    generator: (faker) => faker.person.sex(),
    fakerMethod: 'faker.person.sex()',
    domain: DOMAIN,
  },
  {
    names: ['date_of_birth', 'dob', 'birthday'],
    generator: (faker) => faker.date.birthdate(),
    fakerMethod: 'faker.date.birthdate()',
    domain: DOMAIN,
  },
  {
    names: ['age'],
    generator: (faker) => faker.number.int({ min: 18, max: 85 }),
    fakerMethod: 'faker.number.int({ min: 18, max: 85 })',
    domain: DOMAIN,
  },
  {
    names: ['bio', 'about'],
    generator: (faker) => faker.lorem.paragraph(),
    fakerMethod: 'faker.lorem.paragraph()',
    domain: DOMAIN,
  },
  {
    names: ['avatar', 'avatar_url', 'profile_image'],
    generator: (faker) => faker.image.avatar(),
    fakerMethod: 'faker.image.avatar()',
    domain: DOMAIN,
  },
]
