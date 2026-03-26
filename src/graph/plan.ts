import type { DatabaseSchema } from '../types/schema.js'
import { circularDependency } from '../errors/index.js'
import { buildDependencyGraph } from './build-graph.js'
import { topologicalSort } from './topological-sort.js'
import { findCycles } from './cycle-detection.js'
import { resolveCycles } from './resolve-cycles.js'
import { findSelfReferencingTables } from './self-ref.js'
import type { InsertPlan } from './types.js'

export function buildInsertPlan(schema: DatabaseSchema): InsertPlan {
  const graph = buildDependencyGraph(schema)
  const { sorted, remaining } = topologicalSort(graph)
  const selfRefMap = findSelfReferencingTables(graph)
  const selfRefTables = [...selfRefMap.keys()].sort()
  const warnings: string[] = []

  if (remaining.length === 0) {
    // No cycles — straightforward plan
    for (const table of selfRefTables) {
      warnings.push(
        `Self-referencing table ${table}: will INSERT NULL then UPDATE`,
      )
    }

    return {
      ordered: sorted,
      deferredEdges: [],
      selfRefTables,
      warnings,
    }
  }

  // Cycles detected — attempt resolution
  const cycles = findCycles(graph, remaining)
  const { brokenEdges, unresolvedCycles } = resolveCycles(graph, cycles)

  if (unresolvedCycles.length > 0) {
    throw circularDependency(unresolvedCycles[0])
  }

  // Rebuild graph with broken edges removed from adjacency/inDegree
  const brokenEdgeKeys = new Set(
    brokenEdges.map((e) => `${e.from}->${e.to}`),
  )

  // Rebuild adjacency and inDegree from scratch without broken edges
  const newAdjacency = new Map<string, Set<string>>()
  const newInDegree = new Map<string, number>()

  for (const node of graph.nodes) {
    newAdjacency.set(node, new Set())
    newInDegree.set(node, 0)
  }

  for (const edge of graph.edges) {
    if (edge.isSelfRef) continue
    const key = `${edge.from}->${edge.to}`
    if (brokenEdgeKeys.has(key)) continue

    const adj = newAdjacency.get(edge.from)!
    if (!adj.has(edge.to)) {
      adj.add(edge.to)
      newInDegree.set(edge.from, (newInDegree.get(edge.from) ?? 0) + 1)
    }
  }

  const modifiedGraph = {
    nodes: graph.nodes,
    edges: graph.edges,
    adjacency: newAdjacency,
    inDegree: newInDegree,
  }

  const { sorted: newSorted } = topologicalSort(modifiedGraph)

  // Populate warnings
  for (const edge of brokenEdges) {
    warnings.push(
      `Cycle broken at ${edge.from}.${edge.fk.columns[0]}: will INSERT NULL then UPDATE`,
    )
  }
  for (const table of selfRefTables) {
    warnings.push(
      `Self-referencing table ${table}: will INSERT NULL then UPDATE`,
    )
  }

  return {
    ordered: newSorted,
    deferredEdges: brokenEdges,
    selfRefTables,
    warnings,
  }
}
