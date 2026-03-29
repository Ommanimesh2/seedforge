import type { Faker } from '@faker-js/faker'
import type { TableDef } from '../types/schema.js'
import { NormalizedType } from '../types/schema.js'
import type { Row } from './types.js'

/**
 * Types of coherence groups that can be detected.
 */
export type CoherenceType = 'name-gender' | 'location' | 'temporal'

/**
 * A group of columns that should be generated together for semantic coherence.
 */
export interface CoherenceGroup {
  type: CoherenceType
  columns: string[]
}

/**
 * Known patterns for temporal ordering beyond created/updated.
 * Each entry: [beforeColumnName, afterColumnName]
 */
const TEMPORAL_PAIR_PATTERNS: [string, string][] = [
  ['start_date', 'end_date'],
  ['start_at', 'end_at'],
  ['started_at', 'ended_at'],
  ['start_time', 'end_time'],
  ['begin_date', 'end_date'],
  ['begin_at', 'end_at'],
  ['birth_date', 'hire_date'],
  ['birth_date', 'death_date'],
  ['birthdate', 'hire_date'],
  ['date_of_birth', 'hire_date'],
  ['date_of_birth', 'date_of_death'],
  ['order_date', 'ship_date'],
  ['order_date', 'delivery_date'],
  ['ordered_at', 'shipped_at'],
  ['ordered_at', 'delivered_at'],
  ['ship_date', 'delivery_date'],
  ['shipped_at', 'delivered_at'],
  ['valid_from', 'valid_to'],
  ['valid_from', 'valid_until'],
  ['effective_from', 'effective_to'],
  ['check_in', 'check_out'],
  ['checkin_at', 'checkout_at'],
  ['check_in_date', 'check_out_date'],
]

/**
 * Name-gender column name patterns.
 */
const FIRST_NAME_PATTERNS = ['first_name', 'firstname', 'fname', 'given_name']
const GENDER_PATTERNS = ['gender', 'sex']

/**
 * Location column name patterns.
 */
const CITY_PATTERNS = ['city', 'city_name']
const STATE_PATTERNS = ['state', 'state_name', 'province', 'region']
const ZIP_PATTERNS = ['zip', 'zip_code', 'zipcode', 'postal_code', 'postalcode']
const COUNTRY_PATTERNS = ['country', 'country_name', 'country_code']

/**
 * Detects groups of columns that should be generated coherently.
 *
 * Analyzes a table's column names to find:
 * - Name-gender pairs (first_name + gender/sex)
 * - Location groups (city + state + zip_code + country)
 * - Temporal ordering pairs (start_date < end_date, birth_date < hire_date, etc.)
 *
 * @param table - The table definition to analyze
 * @returns Array of detected coherence groups
 */
export function detectCoherenceGroups(table: TableDef): CoherenceGroup[] {
  const groups: CoherenceGroup[] = []
  const columnNames = Array.from(table.columns.keys())
  const columnNameSet = new Set(columnNames)

  // 1. Detect name-gender coherence
  const nameGenderGroup = detectNameGender(columnNameSet)
  if (nameGenderGroup) {
    groups.push(nameGenderGroup)
  }

  // 2. Detect location coherence
  const locationGroup = detectLocation(columnNameSet)
  if (locationGroup) {
    groups.push(locationGroup)
  }

  // 3. Detect temporal ordering pairs
  const temporalGroups = detectTemporalPairs(table)
  groups.push(...temporalGroups)

  return groups
}

/**
 * Detects name-gender column pairs.
 */
function detectNameGender(columnNames: Set<string>): CoherenceGroup | null {
  const firstName = findMatchingColumn(columnNames, FIRST_NAME_PATTERNS)
  const gender = findMatchingColumn(columnNames, GENDER_PATTERNS)

  if (firstName && gender) {
    return {
      type: 'name-gender',
      columns: [firstName, gender],
    }
  }
  return null
}

/**
 * Detects location column groups.
 * Requires at least city + state to form a coherence group.
 */
function detectLocation(columnNames: Set<string>): CoherenceGroup | null {
  const city = findMatchingColumn(columnNames, CITY_PATTERNS)
  const state = findMatchingColumn(columnNames, STATE_PATTERNS)

  if (!city || !state) {
    return null
  }

  const columns = [city, state]

  const zip = findMatchingColumn(columnNames, ZIP_PATTERNS)
  if (zip) columns.push(zip)

  const country = findMatchingColumn(columnNames, COUNTRY_PATTERNS)
  if (country) columns.push(country)

  return {
    type: 'location',
    columns,
  }
}

/**
 * Detects temporal ordering pairs beyond the existing created/updated pairs.
 */
function detectTemporalPairs(table: TableDef): CoherenceGroup[] {
  const groups: CoherenceGroup[] = []
  const dateTypes = new Set([
    NormalizedType.DATE,
    NormalizedType.TIMESTAMP,
    NormalizedType.TIMESTAMPTZ,
  ])

  for (const [beforeName, afterName] of TEMPORAL_PAIR_PATTERNS) {
    const beforeCol = table.columns.get(beforeName)
    const afterCol = table.columns.get(afterName)

    if (
      beforeCol &&
      afterCol &&
      dateTypes.has(beforeCol.dataType) &&
      dateTypes.has(afterCol.dataType)
    ) {
      groups.push({
        type: 'temporal',
        columns: [beforeName, afterName],
      })
    }
  }

  return groups
}

/**
 * Finds the first column name from a set that matches any of the given patterns.
 */
function findMatchingColumn(
  columnNames: Set<string>,
  patterns: string[],
): string | null {
  for (const pattern of patterns) {
    if (columnNames.has(pattern)) {
      return pattern
    }
  }
  return null
}

/**
 * US states with representative cities and zip code prefixes for location coherence.
 */
const US_LOCATIONS: Array<{
  state: string
  city: string
  zipPrefix: string
  country: string
}> = [
  { state: 'California', city: 'Los Angeles', zipPrefix: '900', country: 'US' },
  { state: 'California', city: 'San Francisco', zipPrefix: '941', country: 'US' },
  { state: 'California', city: 'San Diego', zipPrefix: '921', country: 'US' },
  { state: 'New York', city: 'New York', zipPrefix: '100', country: 'US' },
  { state: 'New York', city: 'Buffalo', zipPrefix: '142', country: 'US' },
  { state: 'Texas', city: 'Houston', zipPrefix: '770', country: 'US' },
  { state: 'Texas', city: 'Dallas', zipPrefix: '752', country: 'US' },
  { state: 'Texas', city: 'Austin', zipPrefix: '787', country: 'US' },
  { state: 'Florida', city: 'Miami', zipPrefix: '331', country: 'US' },
  { state: 'Florida', city: 'Orlando', zipPrefix: '328', country: 'US' },
  { state: 'Illinois', city: 'Chicago', zipPrefix: '606', country: 'US' },
  { state: 'Pennsylvania', city: 'Philadelphia', zipPrefix: '191', country: 'US' },
  { state: 'Arizona', city: 'Phoenix', zipPrefix: '850', country: 'US' },
  { state: 'Georgia', city: 'Atlanta', zipPrefix: '303', country: 'US' },
  { state: 'Washington', city: 'Seattle', zipPrefix: '981', country: 'US' },
  { state: 'Massachusetts', city: 'Boston', zipPrefix: '021', country: 'US' },
  { state: 'Colorado', city: 'Denver', zipPrefix: '802', country: 'US' },
  { state: 'Oregon', city: 'Portland', zipPrefix: '972', country: 'US' },
  { state: 'Nevada', city: 'Las Vegas', zipPrefix: '891', country: 'US' },
  { state: 'Ohio', city: 'Columbus', zipPrefix: '432', country: 'US' },
]

/**
 * Generates a partial row with coherent values for the detected groups.
 *
 * The returned partial row should be applied before individual column generation.
 * Columns present in the coherent row take precedence over individually generated values.
 *
 * @param groups - Detected coherence groups for this table
 * @param faker - Seeded faker instance
 * @returns A partial Row with coherent values
 */
export function generateCoherentRow(
  groups: CoherenceGroup[],
  faker: Faker,
): Row {
  const row: Row = {}

  for (const group of groups) {
    switch (group.type) {
      case 'name-gender':
        generateNameGender(group, faker, row)
        break
      case 'location':
        generateLocation(group, faker, row)
        break
      case 'temporal':
        generateTemporal(group, faker, row)
        break
    }
  }

  return row
}

/**
 * Generates coherent name-gender values.
 * If gender is female, generates a female first name, and vice versa.
 */
function generateNameGender(
  group: CoherenceGroup,
  faker: Faker,
  row: Row,
): void {
  const [firstNameCol, genderCol] = group.columns

  // Pick gender first
  const isFemale = faker.datatype.boolean()
  const sex = isFemale ? 'female' : 'male'
  const gender = isFemale ? 'female' : 'male'

  // Generate matching first name
  const firstName = faker.person.firstName(sex)

  row[firstNameCol] = firstName
  row[genderCol] = gender
}

/**
 * Generates coherent location values.
 * Picks a real US location so city, state, zip and country all match.
 */
function generateLocation(
  group: CoherenceGroup,
  faker: Faker,
  row: Row,
): void {
  const location = faker.helpers.arrayElement(US_LOCATIONS)

  for (const col of group.columns) {
    const lowerCol = col.toLowerCase()
    if (CITY_PATTERNS.includes(lowerCol)) {
      row[col] = location.city
    } else if (STATE_PATTERNS.includes(lowerCol)) {
      row[col] = location.state
    } else if (ZIP_PATTERNS.includes(lowerCol)) {
      // Generate a 5-digit zip using the prefix
      const suffix = faker.string.numeric(5 - location.zipPrefix.length)
      row[col] = location.zipPrefix + suffix
    } else if (COUNTRY_PATTERNS.includes(lowerCol)) {
      row[col] = location.country
    }
  }
}

/**
 * Generates coherent temporal values where the "before" column is
 * chronologically before the "after" column.
 */
function generateTemporal(
  group: CoherenceGroup,
  faker: Faker,
  row: Row,
): void {
  const [beforeCol, afterCol] = group.columns

  const beforeDate = faker.date.past({ years: 5 })
  const afterDate = faker.date.between({ from: beforeDate, to: new Date() })

  row[beforeCol] = beforeDate
  row[afterCol] = afterDate
}
