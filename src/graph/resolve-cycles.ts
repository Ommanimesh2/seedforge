import type { DependencyEdge, DependencyGraph } from './types.js'

export function resolveCycles(
  graph: DependencyGraph,
  cycles: string[][],
): { brokenEdges: DependencyEdge[]; unresolvedCycles: string[][] } {
  const brokenEdges: DependencyEdge[] = []
  const unresolvedCycles: string[][] = []

  for (const cycle of cycles) {
    // Collect edges that form this cycle
    const cycleEdges = getCycleEdges(graph, cycle)

    // Strategy 1: Break at nullable FK edge
    const nullableEdges = cycleEdges
      .filter((e) => e.isNullable)
      .sort((a, b) => a.from.localeCompare(b.from))

    if (nullableEdges.length > 0) {
      // Prefer non-deferrable over deferrable (simpler fix)
      const nonDeferrable = nullableEdges.filter((e) => !e.fk.isDeferrable)
      const chosen = nonDeferrable.length > 0 ? nonDeferrable[0] : nullableEdges[0]
      brokenEdges.push(chosen)
      continue
    }

    // Strategy 2: Deferred constraints
    const deferrableEdges = cycleEdges
      .filter((e) => e.fk.isDeferrable)
      .sort((a, b) => a.from.localeCompare(b.from))

    if (deferrableEdges.length > 0) {
      brokenEdges.push(deferrableEdges[0])
      continue
    }

    // Strategy 3: Unresolvable
    unresolvedCycles.push(cycle)
  }

  return { brokenEdges, unresolvedCycles }
}

function getCycleEdges(
  graph: DependencyGraph,
  cycle: string[],
): DependencyEdge[] {
  const result: DependencyEdge[] = []

  for (let i = 0; i < cycle.length; i++) {
    const from = cycle[i]
    const to = cycle[(i + 1) % cycle.length]

    // Find all edges from -> to
    const matching = graph.edges.filter(
      (e) => e.from === from && e.to === to && !e.isSelfRef,
    )
    result.push(...matching)
  }

  return result
}