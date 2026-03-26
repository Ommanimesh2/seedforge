import type { ForeignKeyDef } from '../types/schema.js'

export interface DependencyEdge {
  from: string
  to: string
  fk: ForeignKeyDef
  isNullable: boolean
  isSelfRef: boolean
}

export interface DependencyGraph {
  nodes: Set<string>
  edges: DependencyEdge[]
  adjacency: Map<string, Set<string>>
  inDegree: Map<string, number>
}

export interface InsertPlan {
  ordered: string[]
  deferredEdges: DependencyEdge[]
  selfRefTables: string[]
  warnings: string[]
}
