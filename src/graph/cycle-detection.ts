import type { DependencyGraph } from './types.js'

const UNVISITED = 0
const IN_STACK = 1
const DONE = 2

export function findCycles(
  graph: DependencyGraph,
  remainingNodes: string[],
): string[][] {
  const remaining = new Set(remainingNodes)

  // Build subgraph adjacency restricted to remaining nodes
  const subAdj = new Map<string, string[]>()
  for (const node of remaining) {
    const neighbors = graph.adjacency.get(node)
    if (neighbors) {
      subAdj.set(
        node,
        [...neighbors].filter((n) => remaining.has(n)),
      )
    } else {
      subAdj.set(node, [])
    }
  }

  const state = new Map<string, number>()
  for (const node of remaining) {
    state.set(node, UNVISITED)
  }

  const cycles: string[][] = []
  const stack: string[] = []

  function dfs(node: string): void {
    state.set(node, IN_STACK)
    stack.push(node)

    for (const neighbor of subAdj.get(node) ?? []) {
      if (state.get(neighbor) === IN_STACK) {
        // Found a cycle — extract from stack
        const cycleStart = stack.indexOf(neighbor)
        const cycle = stack.slice(cycleStart)
        cycles.push(cycle)
      } else if (state.get(neighbor) === UNVISITED) {
        dfs(neighbor)
      }
    }

    stack.pop()
    state.set(node, DONE)
  }

  // Process nodes in sorted order for determinism
  const sortedRemaining = [...remaining].sort()
  for (const node of sortedRemaining) {
    if (state.get(node) === UNVISITED) {
      dfs(node)
    }
  }

  // Normalize cycles: rotate so lexicographically smallest node is first, then deduplicate
  const normalized = cycles.map(normalizeCycle)
  return deduplicateCycles(normalized)
}

function normalizeCycle(cycle: string[]): string[] {
  if (cycle.length === 0) return cycle
  let minIdx = 0
  for (let i = 1; i < cycle.length; i++) {
    if (cycle[i] < cycle[minIdx]) {
      minIdx = i
    }
  }
  return [...cycle.slice(minIdx), ...cycle.slice(0, minIdx)]
}

function deduplicateCycles(cycles: string[][]): string[][] {
  const seen = new Set<string>()
  const result: string[][] = []
  for (const cycle of cycles) {
    const key = cycle.join(' -> ')
    if (!seen.has(key)) {
      seen.add(key)
      result.push(cycle)
    }
  }
  return result
}
