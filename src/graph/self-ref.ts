import type { DependencyEdge, DependencyGraph } from './types.js'

export function findSelfReferencingTables(
  graph: DependencyGraph,
): Map<string, DependencyEdge[]> {
  const result = new Map<string, DependencyEdge[]>()

  for (const edge of graph.edges) {
    if (edge.isSelfRef) {
      const existing = result.get(edge.from)
      if (existing) {
        existing.push(edge)
      } else {
        result.set(edge.from, [edge])
      }
    }
  }

  return result
}
