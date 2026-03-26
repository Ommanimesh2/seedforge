import type { DependencyGraph } from './types.js'

export function topologicalSort(
  graph: DependencyGraph,
): { sorted: string[]; remaining: string[] } {
  // Clone inDegree (algorithm is destructive)
  const inDegree = new Map<string, number>()
  for (const [node, degree] of graph.inDegree) {
    inDegree.set(node, degree)
  }

  // Pre-compute reverse dependency map: for each node, which nodes depend on it
  const reverseDeps = new Map<string, Set<string>>()
  for (const node of graph.nodes) {
    reverseDeps.set(node, new Set())
  }
  for (const [node, deps] of graph.adjacency) {
    for (const dep of deps) {
      reverseDeps.get(dep)!.add(node)
    }
  }

  // Initialize queue with nodes that have in-degree 0, sorted alphabetically
  const queue: string[] = []
  for (const [node, degree] of inDegree) {
    if (degree === 0) {
      queue.push(node)
    }
  }
  queue.sort()

  const sorted: string[] = []

  while (queue.length > 0) {
    const node = queue.shift()!
    sorted.push(node)

    // For each node that depends on this node, decrement in-degree
    const dependents = reverseDeps.get(node)
    if (dependents) {
      // Collect newly freed nodes, then sort for determinism
      const newlyFreed: string[] = []
      for (const dependent of dependents) {
        const newDegree = inDegree.get(dependent)! - 1
        inDegree.set(dependent, newDegree)
        if (newDegree === 0) {
          newlyFreed.push(dependent)
        }
      }
      // Insert newly freed nodes in sorted order into queue
      if (newlyFreed.length > 0) {
        newlyFreed.sort()
        // Merge into queue maintaining sorted order
        const merged: string[] = []
        let qi = 0
        let ni = 0
        while (qi < queue.length && ni < newlyFreed.length) {
          if (queue[qi] <= newlyFreed[ni]) {
            merged.push(queue[qi++])
          } else {
            merged.push(newlyFreed[ni++])
          }
        }
        while (qi < queue.length) merged.push(queue[qi++])
        while (ni < newlyFreed.length) merged.push(newlyFreed[ni++])
        queue.length = 0
        queue.push(...merged)
      }
    }
  }

  // Remaining nodes are in cycles
  const sortedSet = new Set(sorted)
  const remaining = [...graph.nodes].filter((n) => !sortedSet.has(n)).sort()

  return { sorted, remaining }
}
