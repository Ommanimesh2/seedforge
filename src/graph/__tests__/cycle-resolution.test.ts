import { describe, it, expect } from 'vitest'
import { findCycles } from '../cycle-detection.js'
import { resolveCycles } from '../resolve-cycles.js'
import type { DependencyGraph, DependencyEdge } from '../types.js'
import type { ForeignKeyDef } from '../../types/schema.js'
import { FKAction } from '../../types/schema.js'

function makeFKDef(
  name: string,
  columns: string[],
  referencedTable: string,
  overrides: Partial<ForeignKeyDef> = {},
): ForeignKeyDef {
  return {
    name,
    columns,
    referencedTable,
    referencedSchema: 'public',
    referencedColumns: ['id'],
    onDelete: FKAction.NO_ACTION,
    onUpdate: FKAction.NO_ACTION,
    isDeferrable: false,
    isDeferred: false,
    isVirtual: false,
    ...overrides,
  }
}

function makeEdge(
  from: string,
  to: string,
  overrides: Partial<DependencyEdge> = {},
): DependencyEdge {
  return {
    from,
    to,
    fk: makeFKDef(`${from}_${to}_fk`, ['fk_col'], to.split('.')[1]),
    isNullable: false,
    isSelfRef: from === to,
    ...overrides,
  }
}

function makeCyclicGraph(
  nodes: string[],
  edgesSpec: Array<{ from: string; to: string; isNullable?: boolean; isDeferrable?: boolean }>,
): DependencyGraph {
  const nodeSet = new Set(nodes)
  const edges: DependencyEdge[] = []
  const adjacency = new Map<string, Set<string>>()
  const inDegree = new Map<string, number>()

  for (const node of nodes) {
    adjacency.set(node, new Set())
    inDegree.set(node, 0)
  }

  for (const spec of edgesSpec) {
    const edge = makeEdge(spec.from, spec.to, {
      isNullable: spec.isNullable ?? false,
      fk: makeFKDef(`${spec.from}_${spec.to}_fk`, ['fk_col'], spec.to.split('.')[1], {
        isDeferrable: spec.isDeferrable ?? false,
      }),
    })
    edges.push(edge)

    if (spec.from !== spec.to) {
      adjacency.get(spec.from)!.add(spec.to)
      inDegree.set(spec.from, (inDegree.get(spec.from) ?? 0) + 1)
    }
  }

  return { nodes: nodeSet, edges, adjacency, inDegree }
}

describe('findCycles', () => {
  it('finds simple cycle (A -> B -> A)', () => {
    const graph = makeCyclicGraph(
      ['public.a', 'public.b'],
      [
        { from: 'public.a', to: 'public.b' },
        { from: 'public.b', to: 'public.a' },
      ],
    )
    const cycles = findCycles(graph, ['public.a', 'public.b'])
    expect(cycles.length).toBe(1)
    expect(cycles[0]).toEqual(['public.a', 'public.b'])
  })

  it('finds triangle cycle (A -> B -> C -> A)', () => {
    const graph = makeCyclicGraph(
      ['public.a', 'public.b', 'public.c'],
      [
        { from: 'public.a', to: 'public.b' },
        { from: 'public.b', to: 'public.c' },
        { from: 'public.c', to: 'public.a' },
      ],
    )
    const cycles = findCycles(graph, ['public.a', 'public.b', 'public.c'])
    expect(cycles.length).toBe(1)
    expect(cycles[0]).toEqual(['public.a', 'public.b', 'public.c'])
  })

  it('finds two independent cycles', () => {
    const graph = makeCyclicGraph(
      ['public.a', 'public.b', 'public.c', 'public.d'],
      [
        { from: 'public.a', to: 'public.b' },
        { from: 'public.b', to: 'public.a' },
        { from: 'public.c', to: 'public.d' },
        { from: 'public.d', to: 'public.c' },
      ],
    )
    const cycles = findCycles(graph, ['public.a', 'public.b', 'public.c', 'public.d'])
    expect(cycles.length).toBe(2)
    // Each cycle should have 2 nodes
    expect(cycles[0].length).toBe(2)
    expect(cycles[1].length).toBe(2)
  })

  it('normalizes cycle regardless of starting node', () => {
    const graph1 = makeCyclicGraph(
      ['public.a', 'public.b', 'public.c'],
      [
        { from: 'public.a', to: 'public.b' },
        { from: 'public.b', to: 'public.c' },
        { from: 'public.c', to: 'public.a' },
      ],
    )
    const cycles = findCycles(graph1, ['public.a', 'public.b', 'public.c'])
    // Normalized: smallest node first
    expect(cycles[0][0]).toBe('public.a')
  })

  it('handles cycle with shared node (A -> B -> A and B -> C -> B)', () => {
    const graph = makeCyclicGraph(
      ['public.a', 'public.b', 'public.c'],
      [
        { from: 'public.a', to: 'public.b' },
        { from: 'public.b', to: 'public.a' },
        { from: 'public.b', to: 'public.c' },
        { from: 'public.c', to: 'public.b' },
      ],
    )
    const cycles = findCycles(graph, ['public.a', 'public.b', 'public.c'])
    expect(cycles.length).toBeGreaterThanOrEqual(2)
  })
})

describe('resolveCycles', () => {
  it('breaks cycle at nullable edge', () => {
    const graph = makeCyclicGraph(
      ['public.a', 'public.b'],
      [
        { from: 'public.a', to: 'public.b', isNullable: true },
        { from: 'public.b', to: 'public.a' },
      ],
    )
    const cycles = [['public.a', 'public.b']]
    const { brokenEdges, unresolvedCycles } = resolveCycles(graph, cycles)
    expect(brokenEdges.length).toBe(1)
    expect(brokenEdges[0].from).toBe('public.a')
    expect(brokenEdges[0].isNullable).toBe(true)
    expect(unresolvedCycles.length).toBe(0)
  })

  it('picks lexicographically first from-node among nullable edges', () => {
    const graph = makeCyclicGraph(
      ['public.alpha', 'public.beta', 'public.gamma'],
      [
        { from: 'public.alpha', to: 'public.beta' },
        { from: 'public.beta', to: 'public.gamma', isNullable: true },
        { from: 'public.gamma', to: 'public.alpha', isNullable: true },
      ],
    )
    const cycles = [['public.alpha', 'public.beta', 'public.gamma']]
    const { brokenEdges } = resolveCycles(graph, cycles)
    expect(brokenEdges.length).toBe(1)
    // Should pick the nullable edge with lexicographically first `from`
    expect(brokenEdges[0].from).toBe('public.beta')
  })

  it('falls back to deferrable edge when no nullable edge exists', () => {
    const graph = makeCyclicGraph(
      ['public.a', 'public.b'],
      [
        { from: 'public.a', to: 'public.b', isDeferrable: true },
        { from: 'public.b', to: 'public.a' },
      ],
    )
    const cycles = [['public.a', 'public.b']]
    const { brokenEdges, unresolvedCycles } = resolveCycles(graph, cycles)
    expect(brokenEdges.length).toBe(1)
    expect(brokenEdges[0].fk.isDeferrable).toBe(true)
    expect(unresolvedCycles.length).toBe(0)
  })

  it('returns unresolvable cycle when no nullable or deferrable edges', () => {
    const graph = makeCyclicGraph(
      ['public.a', 'public.b'],
      [
        { from: 'public.a', to: 'public.b' },
        { from: 'public.b', to: 'public.a' },
      ],
    )
    const cycles = [['public.a', 'public.b']]
    const { brokenEdges, unresolvedCycles } = resolveCycles(graph, cycles)
    expect(brokenEdges.length).toBe(0)
    expect(unresolvedCycles.length).toBe(1)
    expect(unresolvedCycles[0]).toEqual(['public.a', 'public.b'])
  })

  it('handles mixed: one resolvable and one unresolvable cycle', () => {
    // Build two separate cycles in one graph
    const graph = makeCyclicGraph(
      ['public.a', 'public.b', 'public.c', 'public.d'],
      [
        // Resolvable cycle: a <-> b with nullable edge
        { from: 'public.a', to: 'public.b', isNullable: true },
        { from: 'public.b', to: 'public.a' },
        // Unresolvable cycle: c <-> d
        { from: 'public.c', to: 'public.d' },
        { from: 'public.d', to: 'public.c' },
      ],
    )
    const cycles = [['public.a', 'public.b'], ['public.c', 'public.d']]
    const { brokenEdges, unresolvedCycles } = resolveCycles(graph, cycles)
    expect(brokenEdges.length).toBe(1)
    expect(brokenEdges[0].from).toBe('public.a')
    expect(unresolvedCycles.length).toBe(1)
    expect(unresolvedCycles[0]).toEqual(['public.c', 'public.d'])
  })

  it('prefers non-deferrable nullable edge over deferrable nullable edge', () => {
    const graph = makeCyclicGraph(
      ['public.a', 'public.b', 'public.c'],
      [
        { from: 'public.a', to: 'public.b', isNullable: true, isDeferrable: true },
        { from: 'public.b', to: 'public.c', isNullable: true, isDeferrable: false },
        { from: 'public.c', to: 'public.a' },
      ],
    )
    const cycles = [['public.a', 'public.b', 'public.c']]
    const { brokenEdges } = resolveCycles(graph, cycles)
    expect(brokenEdges.length).toBe(1)
    // Should prefer non-deferrable (public.b -> public.c)
    expect(brokenEdges[0].from).toBe('public.b')
    expect(brokenEdges[0].fk.isDeferrable).toBe(false)
  })
})
