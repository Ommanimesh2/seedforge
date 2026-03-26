import type { DatabaseSchema } from '../types/schema.js'
import type { DependencyEdge, DependencyGraph } from './types.js'

export function buildDependencyGraph(schema: DatabaseSchema): DependencyGraph {
  const nodes = new Set<string>()
  const edges: DependencyEdge[] = []
  const adjacency = new Map<string, Set<string>>()
  const inDegree = new Map<string, number>()

  // Step 1: Initialize nodes
  for (const [, table] of schema.tables) {
    const qualifiedName = `${table.schema}.${table.name}`
    nodes.add(qualifiedName)
    adjacency.set(qualifiedName, new Set())
    inDegree.set(qualifiedName, 0)
  }

  // Step 2: Process foreign keys
  for (const [, table] of schema.tables) {
    const from = `${table.schema}.${table.name}`

    for (const fk of table.foreignKeys) {
      const to = `${fk.referencedSchema}.${fk.referencedTable}`

      // Skip if referenced table is not in our schema
      if (!nodes.has(to)) {
        continue
      }

      // Determine if all FK columns are nullable
      const isNullable = fk.columns.every((col) => {
        const colDef = table.columns.get(col)
        return colDef !== undefined && colDef.isNullable
      })

      const isSelfRef = from === to

      const edge: DependencyEdge = { from, to, fk, isNullable, isSelfRef }
      edges.push(edge)

      // Self-referencing edges do not affect adjacency/inDegree
      if (!isSelfRef) {
        const adj = adjacency.get(from)!
        if (!adj.has(to)) {
          adj.add(to)
          inDegree.set(from, (inDegree.get(from) ?? 0) + 1)
        }
      }
    }
  }

  return { nodes, edges, adjacency, inDegree }
}
