# Phase 4: Column-to-Faker Mapping

**Goal:** Semantic heuristic engine that maps column names and types to @faker-js/faker v10 generators using a 3-tier detection algorithm with confidence scoring.

**Requirements:** REQ-E05, REQ-E06, REQ-G01, REQ-G02, REQ-G03

**Depends on:** Phase 1 (types, error system). Does NOT depend on Phases 2 or 3 (introspection, graph). Can be developed in parallel with Phase 3.

**Code location:** `src/mapping/`

---

## Wave 1: Types, Interfaces & Column Name Normalization
*Foundation types that all subsequent waves build on. Tasks 4.1.1 and 4.1.2 are independent — run in parallel. Task 4.1.3 depends on both.*

### Task 4.1.1: Mapping result types
File: `src/mapping/types.ts`

Define the core types returned by the mapping engine:

- `ConfidenceLevel` enum: `HIGH`, `MEDIUM`, `LOW`
  - HIGH = exact column name match or enum/CHECK constraint values
  - MEDIUM = pattern/suffix/prefix match
  - LOW = type-based fallback
- `MappingSource` enum: `EXACT_NAME`, `SUFFIX`, `PREFIX`, `PATTERN`, `TYPE_FALLBACK`, `ENUM_VALUES`, `CHECK_CONSTRAINT`, `FOREIGN_KEY`, `AUTO_INCREMENT`
  - Tracks HOW the mapping was determined (for diagnostics/verbose output)
- `GeneratorFn` type: `(faker: Faker, rowIndex: number) => unknown`
  - The function signature every generator must conform to
  - Receives the faker instance (seeded) and the current row index
  - Returns the generated value
- `ColumnMapping` interface:
  - `column: string` — the column name
  - `table: string` — the table name (for context)
  - `generator: GeneratorFn` — the faker generator function
  - `confidence: ConfidenceLevel`
  - `source: MappingSource`
  - `fakerMethod: string` — human-readable label for the generator (e.g., `"faker.person.firstName()"`) used in verbose/dry-run output
  - `domain: string` — which semantic domain was matched (e.g., `"person"`, `"finance"`, `"location"`)
- `MappingResult` interface:
  - `mappings: Map<string, ColumnMapping>` — keyed by column name
  - `tableName: string`
  - `unmapped: string[]` — columns that could not be mapped at all (should be empty with type fallback)

Export all types from `src/mapping/index.ts`.

### Task 4.1.2: Column name normalizer
File: `src/mapping/normalize.ts`

Implement `normalizeColumnName(columnName: string, tableName: string): string` with these transformations applied in order:

1. Lowercase the column name
2. Strip table name prefix: if `tableName` is `users` and column is `user_email`, strip `user_` prefix to get `email`. Also strip singular form: `users` table with `user_email` strips `user_`. Handle both `tableName_` and `singularTableName_` prefixes.
3. Remove common suffixes that are just noise: `_col`, `_field`, `_val`, `_value`
4. Replace all separators (hyphens, double underscores) with single underscores
5. Strip leading/trailing underscores

Also implement `singularize(tableName: string): string` — a minimal singularizer for common table name patterns:
- `users` -> `user`, `orders` -> `order`, `addresses` -> `address`
- `categories` -> `category`, `companies` -> `company`
- `statuses` -> `status` (words ending in `-es` after consonant+`es`)
- Not a full NLP singularizer — just the 90% case for SQL table naming conventions

Edge cases to handle:
- Column name identical to table prefix (e.g., `users.user` -> `user`, not empty string)
- Very short table names (1-2 chars) should not be stripped as prefix
- Column `id` should remain `id` even after normalization

### Task 4.1.3: Normalizer unit tests
File: `src/mapping/__tests__/normalize.test.ts`

Test cases:
- Basic normalization: `"Email"` -> `"email"`, `"FIRST_NAME"` -> `"first_name"`
- Table prefix stripping: `users` table + `user_email` -> `"email"`
- Singular prefix stripping: `orders` table + `order_total` -> `"total"`
- No over-stripping: `users` table + `user` column -> `"user"` (not empty)
- Separator normalization: `"first--name"` -> `"first_name"`, `"first__name"` -> `"first_name"`
- Noise suffix removal: `"email_val"` -> `"email"`, `"name_field"` -> `"name"`
- Short table names ignored: `ab` table + `ab_email` -> `"ab_email"` (no strip)
- Singularizer: `"users"` -> `"user"`, `"categories"` -> `"category"`, `"statuses"` -> `"status"`, `"companies"` -> `"company"`, `"addresses"` -> `"address"`

---

## Wave 2: Domain Pattern Registries
*The 80+ column name patterns organized into 10 semantic domains. All tasks in this wave are independent — run in parallel. Each task defines a mapping registry for one domain.*

Each registry is an array of `PatternEntry` objects (defined in `src/mapping/types.ts` in Task 4.1.1 — add it there):

```
PatternEntry {
  names: string[]           // exact name matches (normalized)
  suffixes?: string[]       // suffix patterns (e.g., "_email")
  prefixes?: string[]       // prefix patterns (e.g., "is_")
  pattern?: RegExp          // regex for complex matching
  generator: GeneratorFn
  fakerMethod: string       // human-readable label
  domain: string
}
```

### Task 4.2.1: Person domain registry (~15 patterns)
File: `src/mapping/domains/person.ts`

Exact names: `first_name`, `firstname`, `fname`, `last_name`, `lastname`, `lname`, `surname`, `name`, `full_name`, `fullname`, `middle_name`, `middlename`, `prefix`, `title`, `suffix`, `nickname`, `username`, `display_name`, `gender`, `sex`, `date_of_birth`, `dob`, `birthday`, `age`, `bio`, `about`, `avatar`, `avatar_url`, `profile_image`

Generators:
- `first_name/firstname/fname` -> `faker.person.firstName()`
- `last_name/lastname/lname/surname` -> `faker.person.lastName()`
- `name/full_name/fullname/display_name` -> `faker.person.fullName()`
- `middle_name/middlename` -> `faker.person.middleName()`
- `prefix/title` -> `faker.person.prefix()`
- `suffix` (when in person context) -> `faker.person.suffix()`
- `nickname/username` -> `faker.internet.username()`
- `gender/sex` -> `faker.person.sex()`
- `date_of_birth/dob/birthday` -> `faker.date.birthdate()`
- `age` -> `faker.number.int({ min: 18, max: 85 })`
- `bio/about` -> `faker.lorem.paragraph()`
- `avatar/avatar_url/profile_image` -> `faker.image.avatar()`

### Task 4.2.2: Contact domain registry (~10 patterns)
File: `src/mapping/domains/contact.ts`

Exact names: `email`, `email_address`, `phone`, `phone_number`, `telephone`, `mobile`, `cell`, `fax`, `website`, `homepage`, `url`

Suffixes: `_email`, `_phone`, `_tel`, `_mobile`, `_fax`, `_url`, `_website`, `_homepage`, `_uri`

Generators:
- `email/email_address` + `_email` suffix -> `faker.internet.email()` (with RFC 2606 override: use `@example.com` variants — see Task 4.4.2)
- `phone/phone_number/telephone/mobile/cell` + `_phone/_tel/_mobile` suffix -> `faker.phone.number()`
- `fax` + `_fax` suffix -> `faker.phone.number()`
- `website/homepage/url` + `_url/_website/_uri` suffix -> `faker.internet.url()`

### Task 4.2.3: Internet domain registry (~10 patterns)
File: `src/mapping/domains/internet.ts`

Exact names: `ip`, `ip_address`, `ipv4`, `ipv6`, `mac`, `mac_address`, `user_agent`, `useragent`, `slug`, `domain`, `domain_name`, `hostname`, `protocol`, `password`, `token`, `api_key`, `access_token`, `refresh_token`

Suffixes: `_ip`, `_mac`, `_slug`, `_domain`, `_token`, `_key`

Generators:
- `ip/ip_address/ipv4` -> `faker.internet.ipv4()`
- `ipv6` -> `faker.internet.ipv6()`
- `mac/mac_address` -> `faker.internet.mac()`
- `user_agent/useragent` -> `faker.internet.userAgent()`
- `slug` + `_slug` -> `faker.lorem.slug()`
- `domain/domain_name/hostname` -> `faker.internet.domainName()`
- `password` -> `faker.internet.password()`
- `token/api_key/access_token/refresh_token` + `_token/_key` -> `faker.string.alphanumeric(32)`

### Task 4.2.4: Location domain registry (~15 patterns)
File: `src/mapping/domains/location.ts`

Exact names: `address`, `street`, `street_address`, `address_line_1`, `address_line_2`, `address1`, `address2`, `city`, `town`, `state`, `province`, `region`, `country`, `country_code`, `zip`, `zipcode`, `zip_code`, `postal_code`, `postcode`, `latitude`, `lat`, `longitude`, `lng`, `lon`, `county`, `neighborhood`, `timezone`, `time_zone`

Suffixes: `_address`, `_city`, `_state`, `_country`, `_zip`, `_lat`, `_lng`, `_lon`

Generators:
- `address/street/street_address/address_line_1/address1` -> `faker.location.streetAddress()`
- `address_line_2/address2` -> `faker.location.secondaryAddress()`
- `city/town` + `_city` -> `faker.location.city()`
- `state/province/region` + `_state` -> `faker.location.state()`
- `country` + `_country` -> `faker.location.country()`
- `country_code` -> `faker.location.countryCode()`
- `zip/zipcode/zip_code/postal_code/postcode` + `_zip` -> `faker.location.zipCode()`
- `latitude/lat` + `_lat` -> `faker.location.latitude()`
- `longitude/lng/lon` + `_lng/_lon` -> `faker.location.longitude()`
- `county` -> `faker.location.county()`
- `timezone/time_zone` -> `faker.location.timeZone()`

### Task 4.2.5: Finance domain registry (~10 patterns)
File: `src/mapping/domains/finance.ts`

Exact names: `price`, `amount`, `cost`, `total`, `subtotal`, `tax`, `discount`, `balance`, `salary`, `revenue`, `profit`, `currency`, `currency_code`, `credit_card`, `card_number`, `account_number`, `routing_number`, `iban`, `bic`, `swift`

Suffixes: `_price`, `_amount`, `_cost`, `_total`, `_tax`, `_fee`, `_rate`

Generators:
- `price/amount/cost/total/subtotal/tax/discount/balance/salary/revenue/profit` + `_price/_amount/_cost/_total/_tax/_fee` -> `faker.finance.amount({ min: 1, max: 10000, dec: 2 })` (returns string — cast to float context-dependent)
- `_rate` suffix -> `faker.finance.amount({ min: 0, max: 1, dec: 4 })`
- `currency/currency_code` -> `faker.finance.currencyCode()`
- `credit_card/card_number` -> `faker.finance.creditCardNumber()`
- `account_number` -> `faker.finance.accountNumber()`
- `routing_number` -> `faker.finance.routingNumber()`
- `iban` -> `faker.finance.iban()`
- `bic/swift` -> `faker.finance.bic()`

### Task 4.2.6: Commerce domain registry (~5 patterns)
File: `src/mapping/domains/commerce.ts`

Exact names: `product`, `product_name`, `brand`, `category`, `department`, `sku`, `barcode`, `isbn`, `color`, `colour`, `size`, `weight`, `quantity`, `qty`, `rating`, `review`

Generators:
- `product/product_name` -> `faker.commerce.productName()`
- `brand` -> `faker.company.name()`
- `category/department` -> `faker.commerce.department()`
- `sku` -> `faker.string.alphanumeric(8).toUpperCase()`
- `barcode` -> `faker.commerce.isbn()`
- `isbn` -> `faker.commerce.isbn()`
- `color/colour` -> `faker.color.human()`
- `size` -> `faker.helpers.arrayElement(['XS', 'S', 'M', 'L', 'XL', 'XXL'])`
- `weight` -> `faker.number.float({ min: 0.1, max: 100, fractionDigits: 2 })`
- `quantity/qty` -> `faker.number.int({ min: 1, max: 100 })`
- `rating` -> `faker.number.float({ min: 1, max: 5, fractionDigits: 1 })`
- `review` -> `faker.lorem.paragraph()`

### Task 4.2.7: Text domain registry (~5 patterns)
File: `src/mapping/domains/text.ts`

Exact names: `description`, `summary`, `body`, `content`, `text`, `note`, `notes`, `comment`, `comments`, `message`, `subject`, `headline`, `title` (when not person context), `label`, `caption`, `excerpt`, `abstract`

Generators:
- `title/headline/subject/label/caption` -> `faker.lorem.sentence()`
- `description/summary/excerpt/abstract` -> `faker.lorem.paragraph()`
- `body/content/text` -> `faker.lorem.paragraphs(3)`
- `note/notes/comment/comments/message` -> `faker.lorem.sentences(2)`

### Task 4.2.8: Identifiers domain registry (~5 patterns)
File: `src/mapping/domains/identifiers.ts`

Exact names: `uuid`, `guid`, `code`, `reference`, `ref`, `hash`, `checksum`, `external_id`, `tracking_number`, `confirmation_code`, `serial_number`

Suffixes: `_uuid`, `_guid`, `_code`, `_ref`, `_hash`

Generators:
- `uuid/guid` + `_uuid/_guid` -> `faker.string.uuid()`
- `code/reference/ref` + `_code/_ref` -> `faker.string.alphanumeric(8).toUpperCase()`
- `hash/checksum` + `_hash` -> `faker.string.hexadecimal({ length: 40 })`
- `external_id` -> `faker.string.alphanumeric(12)`
- `tracking_number` -> `faker.string.alphanumeric(16).toUpperCase()`
- `confirmation_code` -> `faker.string.alphanumeric(6).toUpperCase()`
- `serial_number` -> `faker.string.alphanumeric(10).toUpperCase()`

### Task 4.2.9: Temporal domain registry (~10 patterns)
File: `src/mapping/domains/temporal.ts`

Exact names: `created_at`, `updated_at`, `deleted_at`, `modified_at`, `published_at`, `expires_at`, `expired_at`, `start_date`, `end_date`, `due_date`, `birth_date`, `hire_date`, `start_time`, `end_time`, `timestamp`, `date`, `time`, `year`, `month`, `day`, `hour`, `minute`, `second`

Suffixes: `_at`, `_date`, `_time`, `_on`

Generators:
- `created_at` -> `faker.date.past({ years: 2 })`
- `updated_at` -> `faker.date.recent({ days: 30 })` (Phase 5 will enforce created < updated ordering)
- `deleted_at` -> `faker.date.recent({ days: 7 })` (often nullable — handled by nullable rate in Phase 5)
- `modified_at` -> `faker.date.recent({ days: 30 })`
- `published_at` -> `faker.date.past({ years: 1 })`
- `expires_at/expired_at` -> `faker.date.future({ years: 1 })`
- `start_date/hire_date` -> `faker.date.past({ years: 3 })`
- `end_date/due_date` -> `faker.date.future({ years: 1 })`
- `birth_date` -> `faker.date.birthdate()`
- `start_time/end_time/time` -> `faker.date.recent()`
- `_at` suffix (generic) -> `faker.date.recent({ days: 90 })`
- `_date/_on` suffix (generic) -> `faker.date.past({ years: 2 })`
- `timestamp/date` (exact, as fallback) -> `faker.date.past({ years: 2 })`
- `year` -> `faker.number.int({ min: 2000, max: 2026 })`
- `month` -> `faker.number.int({ min: 1, max: 12 })`
- `day` -> `faker.number.int({ min: 1, max: 28 })`
- `hour` -> `faker.number.int({ min: 0, max: 23 })`
- `minute/second` -> `faker.number.int({ min: 0, max: 59 })`

### Task 4.2.10: Boolean domain registry (~5 patterns)
File: `src/mapping/domains/boolean.ts`

Prefixes: `is_`, `has_`, `can_`, `should_`, `was_`, `will_`, `allow_`, `enable_`, `disable_`

Exact names: `active`, `enabled`, `disabled`, `verified`, `confirmed`, `approved`, `published`, `archived`, `deleted`, `visible`, `hidden`, `locked`, `featured`, `public`, `private`, `read`, `admin`, `subscribed`, `opted_in`

Generators:
- All boolean patterns -> `faker.datatype.boolean()` with confidence MEDIUM for prefix matches and HIGH for exact name matches
- Note: These only apply when `column.dataType === NormalizedType.BOOLEAN`. If the column type is not BOOLEAN, these patterns are skipped and the column falls through to other domains.

---

## Wave 3: Type-Based Fallback Generators & Registry Aggregation
*Depends on Wave 1 (types) and Wave 2 (domain registries). Tasks 4.3.1 and 4.3.2 are independent — run in parallel. Task 4.3.3 depends on both.*

### Task 4.3.1: Type-based fallback generator map
File: `src/mapping/type-fallback.ts`

Map every `NormalizedType` enum value to a default generator. These are the LOW confidence fallbacks used when no name-based match is found.

| NormalizedType | Generator | fakerMethod label |
|---|---|---|
| TEXT | `faker.lorem.sentence()` | `faker.lorem.sentence()` |
| VARCHAR | `faker.lorem.words(3)` (respecting maxLength if available) | `faker.lorem.words()` |
| CHAR | `faker.string.alpha(maxLength or 1)` | `faker.string.alpha()` |
| SMALLINT | `faker.number.int({ min: 0, max: 32767 })` | `faker.number.int()` |
| INTEGER | `faker.number.int({ min: 1, max: 100000 })` | `faker.number.int()` |
| BIGINT | `faker.number.int({ min: 1, max: 1000000 })` | `faker.number.int()` |
| REAL | `faker.number.float({ min: 0, max: 1000, fractionDigits: 2 })` | `faker.number.float()` |
| DOUBLE | `faker.number.float({ min: 0, max: 1000000, fractionDigits: 4 })` | `faker.number.float()` |
| DECIMAL | `faker.finance.amount()` (respects numericPrecision/scale) | `faker.finance.amount()` |
| BOOLEAN | `faker.datatype.boolean()` | `faker.datatype.boolean()` |
| DATE | `faker.date.past({ years: 2 })` | `faker.date.past()` |
| TIME | `faker.date.recent()` (format to time-only) | `faker.date.recent()` |
| TIMESTAMP | `faker.date.past({ years: 2 })` | `faker.date.past()` |
| TIMESTAMPTZ | `faker.date.past({ years: 2 })` | `faker.date.past()` |
| INTERVAL | `'1 day'` (static string) | `static: '1 day'` |
| JSON | `{}` (empty object) | `static: {}` |
| JSONB | `{}` (empty object) | `static: {}` |
| UUID | `faker.string.uuid()` | `faker.string.uuid()` |
| BYTEA | `Buffer.from(faker.string.alphanumeric(16))` | `faker.string.alphanumeric()` |
| INET | `faker.internet.ipv4()` | `faker.internet.ipv4()` |
| CIDR | `faker.internet.ipv4() + '/24'` | `faker.internet.ipv4()` |
| MACADDR | `faker.internet.mac()` | `faker.internet.mac()` |
| ARRAY | `'{}'` (empty PG array literal) | `static: '{}'` |
| ENUM | handled by enum logic (see Task 4.4.1), not reached here | — |
| POINT | `(lat, lng)` as PG point | `faker.location.latitude()` |
| LINE | `{0,0,0}` (static) | `static: line` |
| GEOMETRY | `NULL` (skip, warn) | `static: NULL` |
| VECTOR | array of random floats | `faker.number.float()` |
| UNKNOWN | `NULL` (skip, warn) | `static: NULL` |

The function signature: `getTypeFallback(column: ColumnDef): { generator: GeneratorFn, fakerMethod: string }`

Must handle `maxLength` for VARCHAR/CHAR (truncate generated value if longer than maxLength). Must handle `numericPrecision` and `numericScale` for DECIMAL.

### Task 4.3.2: Domain registry aggregator
File: `src/mapping/registry.ts`

Import all 10 domain registries and combine them into a single lookup structure optimized for the 3-tier detection:

1. **Exact name index:** `Map<string, PatternEntry>` — built by iterating all domain registries and indexing every entry in `names[]`. O(1) lookup by normalized column name.
2. **Suffix list:** Array of `{ suffix: string, entry: PatternEntry }` — sorted by suffix length descending (longest match first). Linear scan but the list is small (~30-40 entries).
3. **Prefix list:** Array of `{ prefix: string, entry: PatternEntry }` — same approach as suffixes.
4. **Pattern list:** Array of `{ pattern: RegExp, entry: PatternEntry }` — for entries with regex patterns.

Export `buildRegistry()` function that constructs this structure at module load time (called once).

Collision handling: If two domains register the same exact name (e.g., `title` in person and text), the first domain in a defined priority order wins. Document the priority order:
1. person (most specific names)
2. contact
3. internet
4. location
5. finance
6. commerce
7. identifiers
8. temporal
9. text (most generic — `title`, `description` are common)
10. boolean (only applies to BOOLEAN-typed columns anyway)

### Task 4.3.3: Registry aggregator tests
File: `src/mapping/__tests__/registry.test.ts`

Test cases:
- Exact name lookup returns correct entry for each domain
- Suffix matching returns correct entry and respects longest-match-first
- Prefix matching returns correct entry
- Collision resolution: `title` on a non-boolean column resolves to person domain (or text domain if the priority order places text above person for that name — verify the chosen priority)
- Registry contains at least 80 total unique exact names across all domains
- All entries have valid generator functions (call them with a seeded faker instance, verify no throws)
- All entries have non-empty `fakerMethod` and `domain` strings

---

## Wave 4: Core Mapping Engine
*Depends on Waves 1-3. This is the central orchestration logic. Task 4.4.1 depends on types, Task 4.4.2 is independent, Task 4.4.3 depends on 4.4.1 and 4.4.2.*

### Task 4.4.1: Enum and CHECK constraint handlers
File: `src/mapping/constraint-handlers.ts`

Two functions:

**`handleEnumValues(column: ColumnDef): ColumnMapping | null`**
- If `column.enumValues` is non-null and non-empty, return a mapping that picks from the enum values using `faker.helpers.arrayElement(column.enumValues)`
- Confidence: HIGH, Source: ENUM_VALUES
- fakerMethod: `"faker.helpers.arrayElement([...values])"` (truncated if >5 values)

**`handleCheckConstraint(column: ColumnDef, checkConstraints: CheckConstraintDef[]): ColumnMapping | null`**
- Find CHECK constraints that reference this column name
- If `inferredValues` is non-null and non-empty on any matching constraint, return a mapping that picks from those values using `faker.helpers.arrayElement(constraint.inferredValues)`
- Confidence: HIGH, Source: CHECK_CONSTRAINT
- fakerMethod: `"faker.helpers.arrayElement([...values])"` (truncated if >5 values)
- If no inferredValues, return null (fall through to name-based detection)

### Task 4.4.2: RFC 2606 safe email generator
File: `src/mapping/safe-email.ts`

Create a wrapper around `faker.internet.email()` that ensures generated emails always use RFC 2606 reserved domains: `example.com`, `example.net`, `example.org`.

**`createSafeEmailGenerator(): GeneratorFn`**
- Generates an email using `faker.internet.email()` then replaces the domain portion with a random pick from `['example.com', 'example.net', 'example.org']`
- Alternative approach: use `faker.internet.email({ provider: 'example.com' })` if faker v10 supports the `provider` option (verify API)
- This is REQ-G07: "Use RFC 2606 reserved domains (@example.com) for generated emails"

### Task 4.4.3: Main mapping engine
File: `src/mapping/mapper.ts`

**`mapColumn(column: ColumnDef, tableName: string, checkConstraints: CheckConstraintDef[]): ColumnMapping`**

Implements the full 3-tier detection algorithm:

```
1. If column.enumValues is non-empty:
   → return handleEnumValues(column)

2. If column.isAutoIncrement or column.isGenerated:
   → return { generator: null (skip), source: AUTO_INCREMENT, confidence: HIGH }
   (Phase 5 will handle auto-increment/generated columns — mapper marks them as skip)

3. Normalize column name via normalizeColumnName(column.name, tableName)

4. Try exact name match in registry:
   → If found, return mapping with confidence: HIGH, source: EXACT_NAME
   → Special case: if the matched domain is "boolean" but column.dataType !== BOOLEAN, skip and continue

5. Try suffix match in registry (longest first):
   → If found, return mapping with confidence: MEDIUM, source: SUFFIX

6. Try prefix match in registry:
   → If found, return mapping with confidence: MEDIUM, source: PREFIX

7. Try pattern (regex) match in registry:
   → If found, return mapping with confidence: MEDIUM, source: PATTERN

8. Try CHECK constraint handler:
   → If found, return mapping with confidence: HIGH, source: CHECK_CONSTRAINT

9. Fall back to type-based generator:
   → return getTypeFallback(column) with confidence: LOW, source: TYPE_FALLBACK
```

Special handling for email generators: when the matched domain is "contact" and the fakerMethod involves email, substitute the safe email generator from Task 4.4.2.

**`mapTable(table: TableDef, checkConstraints: CheckConstraintDef[]): MappingResult`**

Iterate all columns in `table.columns`, call `mapColumn()` for each, return a `MappingResult` with all mappings and any unmapped columns.

### Task 4.4.4: Deterministic seeding wrapper
File: `src/mapping/seeded-faker.ts`

**`createSeededFaker(seed?: number): Faker`**

- If `seed` is provided, call `faker.seed(seed)` and return the faker instance
- If no seed, return the faker instance without seeding (non-deterministic mode)
- This is REQ-G01: "Deterministic output: same seed value produces identical data across runs"
- The seed value comes from the CLI `--seed` flag (parsed in Phase 1)
- Returns a single faker instance that should be reused across all table mappings for deterministic ordering

---

## Wave 5: Comprehensive Unit Tests
*Depends on Waves 1-4. All test files are independent — run in parallel.*

### Task 4.5.1: Person domain mapping tests
File: `src/mapping/__tests__/domains/person.test.ts`

Test every exact name match in the person domain:
- `first_name` -> generates a string, fakerMethod contains `firstName`
- `last_name` -> generates a string, fakerMethod contains `lastName`
- `full_name` / `name` -> generates a string with a space (first + last)
- `gender` -> generates one of expected values
- `dob` / `date_of_birth` -> generates a Date
- `age` -> generates number between 18 and 85
- `avatar` -> generates a URL string

Table prefix stripping: test that `users.user_first_name` maps the same as `first_name`.

### Task 4.5.2: Contact domain mapping tests
File: `src/mapping/__tests__/domains/contact.test.ts`

- `email` -> generates email string containing `@example.com` (RFC 2606)
- `phone` / `phone_number` -> generates string
- `website` / `url` -> generates URL string
- Suffix: `contact_email` -> maps to email generator
- Suffix: `work_phone` -> maps to phone generator

### Task 4.5.3: Internet domain mapping tests
File: `src/mapping/__tests__/domains/internet.test.ts`

- `ip_address` / `ipv4` -> generates valid IPv4 string
- `ipv6` -> generates valid IPv6 string
- `mac_address` -> generates MAC string
- `slug` -> generates slug string (lowercase, hyphens)
- `token` / `api_key` -> generates alphanumeric string

### Task 4.5.4: Location domain mapping tests
File: `src/mapping/__tests__/domains/location.test.ts`

- `city` -> generates city name string
- `state` -> generates state name string
- `country` -> generates country name string
- `country_code` -> generates 2-3 character code
- `latitude` / `lat` -> generates number between -90 and 90
- `longitude` / `lng` -> generates number between -180 and 180
- `zip_code` / `postal_code` -> generates postal code string

### Task 4.5.5: Finance domain mapping tests
File: `src/mapping/__tests__/domains/finance.test.ts`

- `price` / `amount` -> generates numeric string or number
- `currency` / `currency_code` -> generates 3-character code (e.g., "USD")
- `iban` -> generates IBAN string
- Suffix: `order_total` -> maps to finance amount generator
- Suffix: `tax_rate` -> maps to rate generator (value between 0 and 1)

### Task 4.5.6: Commerce, text, identifiers domain tests
File: `src/mapping/__tests__/domains/misc.test.ts`

Commerce:
- `product_name` -> generates product name
- `sku` -> generates alphanumeric uppercase string
- `color` -> generates color name
- `quantity` -> generates integer

Text:
- `description` -> generates paragraph
- `body` / `content` -> generates multiple paragraphs
- `subject` / `headline` -> generates sentence

Identifiers:
- `uuid` -> generates UUID format string
- `hash` -> generates hexadecimal string
- `tracking_number` -> generates alphanumeric string

### Task 4.5.7: Temporal and boolean domain tests
File: `src/mapping/__tests__/domains/temporal-boolean.test.ts`

Temporal:
- `created_at` -> generates Date in the past
- `updated_at` -> generates recent Date
- `expires_at` -> generates future Date
- `start_date` / `end_date` -> generates Dates
- Suffix: `published_on` -> maps to date generator (via `_on` suffix)
- `year` -> generates integer 2000-2026
- `month` -> generates integer 1-12

Boolean:
- `is_active` -> generates boolean (prefix match `is_`)
- `has_subscription` -> generates boolean (prefix match `has_`)
- `active` / `verified` / `enabled` -> generates boolean (exact match)
- `is_active` on a VARCHAR column -> does NOT match boolean domain (skipped)

### Task 4.5.8: Constraint handler tests
File: `src/mapping/__tests__/constraint-handlers.test.ts`

Enum handling:
- Column with `enumValues: ['active', 'inactive', 'pending']` -> generator picks from those values
- Column with `enumValues: null` -> returns null
- Column with `enumValues: []` -> returns null
- Confidence is HIGH, source is ENUM_VALUES
- Generated value is always one of the enum values (test 100 iterations)

CHECK constraint handling:
- CheckConstraintDef with `inferredValues: ['a', 'b', 'c']` -> generator picks from those values
- Multiple CHECK constraints, only the one referencing the column is used
- No matching CHECK constraint -> returns null
- Confidence is HIGH, source is CHECK_CONSTRAINT

### Task 4.5.9: Full mapping engine integration tests
File: `src/mapping/__tests__/mapper.test.ts`

End-to-end tests using `mapColumn()` and `mapTable()`:

- **Tier 1 test:** Column named `email` with type TEXT -> exact name match, confidence HIGH, domain "contact", RFC 2606 email
- **Tier 2 test:** Column named `customer_phone` with type VARCHAR -> suffix match `_phone`, confidence MEDIUM
- **Tier 3 test:** Column named `xyzzy` with type INTEGER -> type fallback, confidence LOW
- **Enum override:** Column named `email` with `enumValues: ['a@b.com', 'c@d.com']` -> enum takes priority over name match
- **Auto-increment skip:** Column with `isAutoIncrement: true` -> marked as skip
- **Generated column skip:** Column with `isGenerated: true` -> marked as skip
- **Table prefix stripping:** Column `user_email` on table `users` -> matches `email` exact
- **Boolean type guard:** Column `is_active` with type VARCHAR -> does NOT match boolean, falls through to type fallback

`mapTable()` tests:
- Create a mock TableDef with 5-6 columns covering different tiers -> verify all columns mapped
- Verify `MappingResult.unmapped` is empty (everything has at least a type fallback)
- Verify deterministic output: same seed produces same generated values across two runs

### Task 4.5.10: Deterministic seeding tests
File: `src/mapping/__tests__/seeded-faker.test.ts`

- `createSeededFaker(42)` -> two sequential calls to `faker.person.firstName()` produce the same names across two separate test runs
- `createSeededFaker(42)` vs `createSeededFaker(99)` -> produce different values
- `createSeededFaker(undefined)` -> does not throw, returns working faker instance
- Deterministic end-to-end: seed a faker, map a table with 10 rows, verify the generated values are identical across two runs with the same seed

---

## Wave 6: Module Export & Integration Surface
*Depends on all previous waves. Final wiring.*

### Task 4.6.1: Module barrel export
File: `src/mapping/index.ts`

Export the public API of the mapping module:
- `mapColumn`, `mapTable` from `mapper.ts`
- `createSeededFaker` from `seeded-faker.ts`
- `normalizeColumnName` from `normalize.ts`
- All types from `types.ts`: `ConfidenceLevel`, `MappingSource`, `GeneratorFn`, `ColumnMapping`, `MappingResult`, `PatternEntry`
- `buildRegistry` from `registry.ts` (for testing/inspection)
- `createSafeEmailGenerator` from `safe-email.ts`

Update `src/index.ts` to re-export from `./mapping/index.js`.

### Task 4.6.2: Verify full test suite passes
Run `npm test` and verify:
- All mapping tests pass
- No regressions in existing Phase 1 tests (errors, CLI)
- Total test count is significantly increased (60+ new tests expected)

### Task 4.6.3: Lint and type-check pass
Run `npm run lint` and `npm run build`:
- No lint errors in any `src/mapping/` files
- No TypeScript compilation errors
- All exports resolve correctly

---

## Completion Checklist

- [ ] 80+ column name patterns defined across 10 domains
- [ ] Exact name match lookup works with O(1) map access
- [ ] Suffix match works with longest-match-first ordering
- [ ] Prefix match works for boolean patterns (`is_`, `has_`, `can_`, etc.)
- [ ] Type fallback covers every NormalizedType enum value
- [ ] Confidence scoring: HIGH for exact/enum, MEDIUM for suffix/prefix/pattern, LOW for type fallback
- [ ] Enum values used when `column.enumValues` is populated
- [ ] CHECK constraint inferred values used when available
- [ ] Table name prefix stripping works (singular and plural forms)
- [ ] RFC 2606 safe emails generated (no real domains)
- [ ] Auto-increment and generated columns detected and marked for skip
- [ ] Deterministic output: `faker.seed(n)` produces identical mappings
- [ ] Boolean domain only matches BOOLEAN-typed columns
- [ ] `mapTable()` returns a complete MappingResult with zero unmapped columns
- [ ] All domain tests pass (person, contact, internet, location, finance, commerce, text, identifiers, temporal, boolean)
- [ ] Constraint handler tests pass
- [ ] Integration tests pass (3-tier detection verified end-to-end)
- [ ] Seeding determinism tests pass
- [ ] No regressions in Phase 1 tests
- [ ] `npm run lint` passes
- [ ] `npm run build` passes

---

## Files Created

```
src/mapping/
  index.ts                              # Barrel export
  types.ts                              # ConfidenceLevel, MappingSource, GeneratorFn, ColumnMapping, MappingResult, PatternEntry
  normalize.ts                          # normalizeColumnName(), singularize()
  registry.ts                           # buildRegistry() — aggregates all domains into lookup structure
  mapper.ts                             # mapColumn(), mapTable() — core 3-tier detection engine
  type-fallback.ts                      # getTypeFallback() — NormalizedType -> generator map
  constraint-handlers.ts                # handleEnumValues(), handleCheckConstraint()
  safe-email.ts                         # createSafeEmailGenerator() — RFC 2606 wrapper
  seeded-faker.ts                       # createSeededFaker() — deterministic seeding
  domains/
    person.ts                           # ~15 patterns
    contact.ts                          # ~10 patterns
    internet.ts                         # ~10 patterns
    location.ts                         # ~15 patterns
    finance.ts                          # ~10 patterns
    commerce.ts                         # ~5 patterns
    text.ts                             # ~5 patterns
    identifiers.ts                      # ~5 patterns
    temporal.ts                         # ~10 patterns
    boolean.ts                          # ~5 patterns
  __tests__/
    normalize.test.ts                   # Column name normalization tests
    registry.test.ts                    # Registry aggregation tests
    constraint-handlers.test.ts         # Enum/CHECK handler tests
    mapper.test.ts                      # Full mapping engine integration tests
    seeded-faker.test.ts                # Deterministic seeding tests
    domains/
      person.test.ts                    # Person domain mapping tests
      contact.test.ts                   # Contact domain mapping tests
      internet.test.ts                  # Internet domain mapping tests
      location.test.ts                  # Location domain mapping tests
      finance.test.ts                   # Finance domain mapping tests
      misc.test.ts                      # Commerce + text + identifiers tests
      temporal-boolean.test.ts          # Temporal + boolean domain tests
```
