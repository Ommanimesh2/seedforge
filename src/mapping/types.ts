import type { Faker } from '@faker-js/faker'

export enum ConfidenceLevel {
  HIGH = 'HIGH',
  MEDIUM = 'MEDIUM',
  LOW = 'LOW',
}

export enum MappingSource {
  EXACT_NAME = 'EXACT_NAME',
  SUFFIX = 'SUFFIX',
  PREFIX = 'PREFIX',
  PATTERN = 'PATTERN',
  TYPE_FALLBACK = 'TYPE_FALLBACK',
  ENUM_VALUES = 'ENUM_VALUES',
  CHECK_CONSTRAINT = 'CHECK_CONSTRAINT',
  FOREIGN_KEY = 'FOREIGN_KEY',
  AUTO_INCREMENT = 'AUTO_INCREMENT',
}

export type GeneratorFn = (faker: Faker, rowIndex: number) => unknown

export interface ColumnMapping {
  column: string
  table: string
  generator: GeneratorFn | null
  confidence: ConfidenceLevel
  source: MappingSource
  fakerMethod: string
  domain: string
}

export interface MappingResult {
  mappings: Map<string, ColumnMapping>
  tableName: string
  unmapped: string[]
}

export interface PatternEntry {
  names: string[]
  suffixes?: string[]
  prefixes?: string[]
  pattern?: RegExp
  generator: GeneratorFn
  fakerMethod: string
  domain: string
}
