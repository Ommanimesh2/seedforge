# Phase 3: Dependency Resolution

**Goal:** Build FK dependency graph, topological sort, and circular dependency handling.

**Requirements:** REQ-E02, REQ-E03, REQ-E04

**Depends on:** Phase 1 (types, error system). No dependency on Phase 2 — the graph module consumes `DatabaseSchema` which is already defined.

**Stack decision:** Roll our own topological sort (~30 lines, Kahn's algorithm). No external dependency.

---

## Wave 1: Core Graph Data Structures

*Foundation types and the directed graph builder. No algorithms yet — just the data model. All tasks in this wave are independent.*

### Task 3.1.1: Graph types
File: `src/graph/types.ts`

Define the data structures that the rest of the graph module operates on:

- `DependencyEdge` interface:
  - `from: string` — fully qualified source table name (`schema.table`)
  - `to: string` — fully qualified referenced table name (`schema.table`)
  - `fk: ForeignKeyDef` — the FK definition that created this edge
  - `isNullable: boolean` — whether ALL FK columns are nullable (breakable edge)
  - `isSelfRef: boolean` — `from === to`
- `DependencyGraph` interface:
  - `nodes: Set<string>` — all table names
  - `edges: DependencyEdge[]` — all FK edges
  - `adjacency: Map<string, Set<string>>` — outgoing adjacency list (`table -> tables it depends on`)
  - `inDegree: Map<string, number>` — in-degree per node (for Kahn's)
- `InsertPlan` interface:
  - `ordered: string[]` — tables in insertion order (topological)
  - `deferredEdges: DependencyEdge[]` — edges broken to resolve cycles (insert NULL, then UPDATE)
  - `selfRefTables: string[]` — self-referencing tables needing NULL-then-UPDATE
  - `warnings: string[]` — human-readable warnings (e.g., "cycle broken at orders.parent_id")

Export all types from `src/graph/index.ts`.

### Task 3.1.2: Graph builder function
File: `src/graph/build-graph.ts`

Implement `buildDependencyGraph(schema: DatabaseSchema): DependencyGraph`:

1. Initialize empty `nodes`, `edges`, `adjacency`, `inDegree`.
2. Iterate `schema.tables`:
   - Add each table to `nodes` (use `schema.table` qualified name).
   - Initialize `inDegree[table] = 0` and `adjacency[table] = new Set()`.
3. Iterate each table's `foreignKeys[]`:
   - Build the referenced table's qualified name from `fk.referencedSchema` + `fk.referencedTable`.
   - Skip if referenced table is not in `nodes` (cross-schema or missing — emit warning).
   - Determine `isNullable`: check if every column in `fk.columns` is nullable in the table's `columns` Map.
   - Determine `isSelfRef`: source and referenced table are the same.
   - If `isSelfRef`, record edge but do NOT add to adjacency/inDegree (self-loops break topo sort).
   - Otherwise, add edge: `adjacency[from].add(to)`, increment `inDegree[from]`.
4. Return the `DependencyGraph`.

Note on edge direction: `from` depends on `to`. A row in `from` references a row in `to`. Therefore `to` must be inserted first. The adjacency list encodes "A depends on B" as `adjacency[A].has(B)`. Kahn's processes nodes with in-degree 0 first (tables with no dependencies).

Key detail: The in-degree here counts how many distinct tables a node depends on (not how many tables depend on it). This is deliberate — Kahn's algorithm processes "sources" (nodes with no unmet dependencies) first, which are the tables that can be inserted immediately.

### Task 3.1.3: Graph builder tests
File: `src/graph/__tests__/build-graph.test.ts`

Test helper: `makeSchema(tables: ...)` factory that constructs a minimal `DatabaseSchema` with the provided tables, columns, and FKs. This helper will be reused across all graph test files.

Test cases:
- **No tables**: empty schema produces empty graph.
- **Single table, no FKs**: one node, no edges, in-degree 0.
- **Linear chain** (A -> B -> C): 3 nodes, 2 edges, correct in-degrees (A=1, B=1, C=0).
- **Diamond** (A -> B, A -> C, B -> D, C -> D): correct adjacency and in-degrees.
- **Self-referencing FK**: edge is created with `isSelfRef: true`, NOT added to adjacency/inDegree.
- **Nullable FK detection**: FK columns checked against column nullability.
- **Missing referenced table**: edge skipped, warning emitted (if we add warnings to graph).
- **Multiple FKs between same pair**: each produces an edge, but adjacency deduplicates.
- **Composite FK**: single edge with multi-column FK, `isNullable` only true if ALL columns nullable.

---

## Wave 2: Topological Sort (Kahn's Algorithm)

*Depends on Wave 1. Core ordering algorithm with cycle detection.*

### Task 3.2.1: Kahn's algorithm implementation
File: `src/graph/topological-sort.ts`

Implement `topologicalSort(graph: DependencyGraph): { sorted: string[]; remaining: string[] }`:

1. Clone `inDegree` map (algorithm is destructive).
2. Initialize queue with all nodes where `inDegree === 0`.
3. While queue is not empty:
   - Dequeue node `n`, add to `sorted[]`.
   - For each node `m` that depends on `n` (reverse lookup: find all nodes whose adjacency set contains `n`):
     - Decrement `inDegree[m]`.
     - If `inDegree[m] === 0`, enqueue `m`.
4. If `sorted.length < nodes.size`, remaining nodes are in cycles.
5. Return `{ sorted, remaining }` where `remaining` is all nodes not in `sorted`.

Implementation note: For the reverse lookup in step 3, pre-compute a `reverseDeps: Map<string, Set<string>>` from the adjacency list before the main loop. This maps each table to the set of tables that depend on it, enabling O(1) lookup during processing.

Stable ordering: when multiple nodes have in-degree 0, sort them alphabetically before enqueuing. This makes output deterministic regardless of Map iteration order.

### Task 3.2.2: Topological sort tests
File: `src/graph/__tests__/topological-sort.test.ts`

Reuse `makeSchema` helper from Task 3.1.3 (or build `DependencyGraph` objects directly).

Test cases:
- **Empty graph**: returns empty `sorted`, empty `remaining`.
- **Single node**: sorted = [node], remaining = [].
- **Linear chain** (A -> B -> C): sorted = [C, B, A] (dependencies first).
- **Diamond** (A -> B, A -> C, B -> D, C -> D): sorted starts with D, ends with A. B and C are in the middle (alphabetical tie-break).
- **Independent tables** (A, B, C no FKs): sorted = [A, B, C] (alphabetical).
- **Simple cycle** (A -> B -> A): sorted = [], remaining = [A, B].
- **Cycle with tail** (A -> B -> C -> B): sorted = [A], remaining = [B, C].
- **Large linear chain** (10 tables): verify correct order.
- **Determinism**: run same graph 100 times, assert identical output every time.

---

## Wave 3: Cycle Detection and Resolution

*Depends on Wave 2. The most complex wave — handles cycles by breaking nullable edges and falling back to deferred constraints.*

### Task 3.3.1: Cycle finder
File: `src/graph/cycle-detection.ts`

Implement `findCycles(graph: DependencyGraph, remainingNodes: string[]): string[][]`:

Given the set of nodes that Kahn's could not sort (the `remaining` output from `topologicalSort`), find the actual cycle paths.

Algorithm: Use DFS-based cycle detection on the subgraph induced by `remainingNodes`.

1. Build subgraph adjacency from `graph.adjacency` restricted to `remainingNodes`.
2. Track node states: UNVISITED, IN_STACK, DONE.
3. For each UNVISITED node, run DFS:
   - Mark IN_STACK.
   - For each neighbor in subgraph:
     - If IN_STACK: found a cycle. Trace back the recursion stack to extract the cycle path.
     - If UNVISITED: recurse.
   - Mark DONE.
4. Return list of cycles, each as an array of table names forming the cycle (last element connects back to first).

Deduplication: A cycle A -> B -> C -> A and B -> C -> A -> B are the same. Normalize by rotating so the lexicographically smallest node is first.

### Task 3.3.2: Cycle resolver
File: `src/graph/resolve-cycles.ts`

Implement `resolveCycles(graph: DependencyGraph, cycles: string[][]): { brokenEdges: DependencyEdge[]; unresolvedCycles: string[][] }`:

For each cycle, attempt resolution in priority order:

**Strategy 1 — Break at nullable FK edge:**
1. Walk the cycle edges.
2. Find edges where `isNullable === true`.
3. Among nullable edges, prefer non-deferrable over deferrable (simpler fix).
4. Pick the first nullable edge (deterministic: choose the one with the lexicographically smallest `from`).
5. Mark this edge as "broken" — it will be handled as NULL-then-UPDATE.

**Strategy 2 — Deferred constraints (PG only):**
1. If no nullable edge exists, check for edges where `fk.isDeferrable === true`.
2. Mark this edge as "deferred" — the INSERT will happen inside a transaction with `SET CONSTRAINTS ... DEFERRED`.
3. Still add to `brokenEdges` so the planner knows to use deferred mode.

**Strategy 3 — Unresolvable:**
1. If neither nullable nor deferrable edges exist, add cycle to `unresolvedCycles`.
2. These will produce an `SF3001` error with actionable hints.

Return: `brokenEdges` (edges to handle with NULL-then-UPDATE or deferred constraints), `unresolvedCycles` (cycles that cannot be resolved).

### Task 3.3.3: Cycle detection and resolution tests
File: `src/graph/__tests__/cycle-resolution.test.ts`

Test cases for `findCycles`:
- **Simple cycle** (A -> B -> A): returns [[A, B]].
- **Triangle cycle** (A -> B -> C -> A): returns [[A, B, C]].
- **Two independent cycles**: returns both.
- **Cycle with shared node** (A -> B -> A and B -> C -> B): returns both cycles.
- **Cycle normalization**: same cycle entered from different start node produces identical output.

Test cases for `resolveCycles`:
- **Cycle with one nullable edge**: that edge is broken, returned in `brokenEdges`.
- **Cycle with multiple nullable edges**: picks lexicographically first `from` node.
- **Cycle with no nullable but deferrable edge**: deferred edge returned in `brokenEdges`.
- **Completely unresolvable cycle**: returned in `unresolvedCycles`.
- **Mixed**: one resolvable cycle and one unresolvable cycle in same graph.

---

## Wave 4: Self-Referencing Tables and Insert Plan Assembly

*Depends on Waves 2 and 3. Combines everything into the final InsertPlan.*

### Task 3.4.1: Self-referencing table detection
File: `src/graph/self-ref.ts`

Implement `findSelfReferencingTables(graph: DependencyGraph): Map<string, DependencyEdge[]>`:

1. Filter `graph.edges` where `isSelfRef === true`.
2. Group by table name.
3. Return map from table name to its self-referencing FK edges.

These tables need special handling during data generation:
- Phase 1: INSERT all rows with self-referencing FK columns set to NULL.
- Phase 2: UPDATE rows to set self-referencing FK columns to valid values (from the same table).

Also validate: if a self-referencing FK is NOT nullable and NOT deferrable, emit a warning — this table cannot be seeded without deferred constraints.

### Task 3.4.2: Insert plan builder
File: `src/graph/plan.ts`

Implement `buildInsertPlan(schema: DatabaseSchema): InsertPlan`:

This is the main entry point — orchestrates the entire dependency resolution pipeline:

1. `const graph = buildDependencyGraph(schema)`
2. `const { sorted, remaining } = topologicalSort(graph)`
3. `const selfRefTables = findSelfReferencingTables(graph)`
4. If `remaining.length === 0`:
   - No cycles. Return `InsertPlan` with `ordered = sorted`, `deferredEdges = []`, `selfRefTables = [...selfRefTables.keys()]`.
5. If `remaining.length > 0`:
   - `const cycles = findCycles(graph, remaining)`
   - `const { brokenEdges, unresolvedCycles } = resolveCycles(graph, cycles)`
   - If `unresolvedCycles.length > 0`:
     - Throw `circularDependency(unresolvedCycles[0])` using the existing error factory.
   - Rebuild graph with broken edges removed from adjacency/inDegree.
   - Re-run topological sort on modified graph.
   - Assert new sort has no remaining nodes (should be resolved now).
   - Return `InsertPlan` with `ordered` from new sort, `deferredEdges = brokenEdges`, `selfRefTables`.
6. Populate `warnings[]`:
   - For each broken edge: `"Cycle broken at {from}.{fk.columns[0]}: will INSERT NULL then UPDATE"`
   - For each self-ref table: `"Self-referencing table {name}: will INSERT NULL then UPDATE"`

### Task 3.4.3: Self-referencing table tests
File: `src/graph/__tests__/self-ref.test.ts`

Test cases:
- **No self-refs**: returns empty map.
- **Single self-ref** (employees.manager_id -> employees.id): detected, edge has `isSelfRef: true`.
- **Multiple self-ref FKs on one table** (categories with parent_id and root_id): both edges returned.
- **Self-ref with nullable FK**: valid for NULL-then-UPDATE.
- **Self-ref with non-nullable, non-deferrable FK**: warning emitted.
- **Self-ref with deferrable FK**: valid for deferred constraint handling.

### Task 3.4.4: Insert plan integration tests
File: `src/graph/__tests__/plan.test.ts`

End-to-end tests of `buildInsertPlan` using realistic schema fixtures:

- **Simple blog schema** (users -> posts -> comments): ordered = [users, posts, comments].
- **E-commerce schema** (users, products, orders -> order_items): correct insertion order with diamond dependency.
- **Self-referencing categories** (categories.parent_id -> categories.id): categories in `selfRefTables`, still in `ordered`.
- **Resolvable cycle** (A -> B with nullable FK, B -> A): cycle broken, both tables in `ordered`, broken edge in `deferredEdges`.
- **Unresolvable cycle**: throws `GenerationError` with code `SF3001`.
- **Mixed graph**: combination of linear deps, diamond, self-ref, and resolvable cycle in a single schema.
- **Independent tables**: tables with no FKs appear in alphabetical order.
- **Schema with 20+ tables**: verify performance is acceptable and order is correct.

---

## Wave 5: Module API and Barrel Export

*Depends on Wave 4. Finalize public API surface and ensure clean imports.*

### Task 3.5.1: Module barrel export
File: `src/graph/index.ts`

Export the public API:
- `buildInsertPlan` (primary entry point for consumers)
- `buildDependencyGraph` (useful for debugging/visualization)
- `topologicalSort` (useful standalone)
- All types from `types.ts`: `DependencyEdge`, `DependencyGraph`, `InsertPlan`

Do NOT export:
- `findCycles` (internal implementation detail)
- `resolveCycles` (internal implementation detail)
- `findSelfReferencingTables` (internal implementation detail)

Update `src/index.ts` to re-export from `src/graph/index.ts`.

### Task 3.5.2: Cross-module integration verification
File: `src/graph/__tests__/integration.test.ts`

Verify that the graph module integrates cleanly with existing types:
- Import `DatabaseSchema` from `src/types` and `buildInsertPlan` from `src/graph`.
- Construct a `DatabaseSchema` using all existing type constructors.
- Run `buildInsertPlan` and verify the result matches `InsertPlan` interface.
- Verify error thrown for unresolvable cycles is a `GenerationError` with code `SF3001`.
- Verify the module compiles and exports correctly (`import { buildInsertPlan } from './graph/index.js'`).

### Task 3.5.3: Build and lint verification
- `npm run build` succeeds with no TypeScript errors from new files.
- `npm run lint` passes on all new files.
- `npm test` runs all new test files and passes.
- No circular imports between `src/graph/` and other modules.

---

## Completion Checklist

- [ ] `DependencyGraph` built correctly from `DatabaseSchema` FK relationships
- [ ] Kahn's algorithm produces correct topological order for all acyclic graphs
- [ ] Deterministic output: same schema always produces same insert order
- [ ] Cycle detection identifies all cycles in remaining nodes
- [ ] Cycle resolution breaks at nullable FK edges when possible
- [ ] Cycle resolution falls back to deferred constraints when no nullable edge
- [ ] Unresolvable cycles throw `GenerationError` SF3001 with clear cycle path
- [ ] Self-referencing tables detected and flagged for NULL-then-UPDATE
- [ ] `InsertPlan` contains complete information for Phase 5 data generation
- [ ] Linear, diamond, cycle, self-ref, and mixed topologies all tested
- [ ] `npm run build` succeeds
- [ ] `npm run lint` passes
- [ ] `npm test` passes all new tests
- [ ] No new runtime dependencies added

---

## Files Created

```
src/graph/
  index.ts                          # barrel export (public API)
  types.ts                          # DependencyEdge, DependencyGraph, InsertPlan
  build-graph.ts                    # buildDependencyGraph()
  topological-sort.ts               # topologicalSort() — Kahn's algorithm
  cycle-detection.ts                # findCycles() — DFS cycle finder
  resolve-cycles.ts                 # resolveCycles() — break nullable/deferrable edges
  self-ref.ts                       # findSelfReferencingTables()
  plan.ts                           # buildInsertPlan() — main orchestrator
  __tests__/
    build-graph.test.ts             # graph construction tests
    topological-sort.test.ts        # Kahn's algorithm tests
    cycle-resolution.test.ts        # cycle detection + resolution tests
    self-ref.test.ts                # self-referencing table tests
    plan.test.ts                    # end-to-end insert plan tests
    integration.test.ts             # cross-module integration tests
```

---

## Files Modified

```
src/index.ts                        # add re-export from src/graph/index.js
```
