# CEE Pipeline Ledger Specification

**Version**: 1.0
**Date**: 2026-01-21
**Purpose**: Define the complete node/edge mutation ledger for the CEE pipeline

---

## Overview

This document specifies all stages in the CEE pipeline that can add, remove, or modify graph nodes and edges. Each stage is assigned a unique stage number for telemetry and debugging.

---

## Stage Definitions

### Phase 1: LLM Response Processing (Stages 1-10)

| Stage | Name | Location | Description | Mutations |
|-------|------|----------|-------------|-----------|
| 1 | LLM Raw Output | adapters/llm/*.ts | Raw JSON from LLM | N/A (source) |
| 2 | Kind Normalization | normalisation.ts:118 | Map non-standard kinds to canonical | `node.kind` modified |
| 3 | Property Coercion | normalisation.ts:136-278 | Coerce string numbers, clamp ranges | `strength_mean`, `belief_exists` modified |
| 4 | Controllable Factor Baseline | normalisation.ts:299-384 | Add `data.value: 1.0` to controllable factors | `node.data.value` added |
| 5 | Zod Validation | openai.ts/anthropic.ts | Schema validation | Fails on invalid |
| 6 | Node Capping #1 | openai.ts:519 | `slice(0, GRAPH_MAX_NODES)` | Nodes removed |
| 7 | Edge Capping #1 | openai.ts:524 | `slice(0, GRAPH_MAX_EDGES)` | Edges removed |
| 8 | Dangling Edge Filter #1 | openai.ts:558 | Remove edges to missing nodes | Edges removed |
| 9 | Edge ID Assignment | openai.ts:566 | Assign stable IDs `${from}::${to}::${idx}` | `edge.id` set |
| 10 | Adapter Sorting | openai.ts:574 | Sort nodes/edges deterministically | Order changed |

### Phase 2: Pipeline Entry (Stages 11-14)

| Stage | Name | Location | Description | Mutations |
|-------|------|----------|-------------|-----------|
| 11 | Kind Stripping | pipeline.ts:1545 | Remove unwanted node kinds | Nodes removed |
| 12 | Factor Enrichment (Sync) | enricher.ts:224 | Add factors from sync extraction | Nodes/edges added |
| 13 | Factor Enrichment (Async) | enricher.ts:434 | Add factors from async extraction | Nodes/edges added |
| 14 | Constraint Conversion | to-risk-node.ts:214 | Convert constraints to risk nodes | Nodes/edges added |

### Phase 3: First Stabilization (Stages 15-18)

| Stage | Name | Location | Description | Mutations |
|-------|------|----------|-------------|-----------|
| 15 | First stabiliseGraph() Entry | pipeline.ts | Call enforceGraphCompliance() | See sub-stages |
| 16 | Version Normalization | normaliseCeeGraphVersionAndProvenance | Ensure version field | Metadata modified |
| 17 | Graph Compliance Check | graphGuards.ts:378 | Begin compliance enforcement | See stages 19-25 |
| 18 | Empty Graph Guard | graphGuards.ts:393 | Return early for empty graphs | N/A (guard) |

### Phase 4: Graph Compliance Enforcement (Stages 19-25)

| Stage | Name | Location | Description | Mutations |
|-------|------|----------|-------------|-----------|
| 19 | Node Capping #2 | graphGuards.ts:399-414 | `slice(0, maxNodes)` | Nodes removed, logged |
| 20 | Edge Capping #2 | graphGuards.ts:417-434 | `slice(0, maxEdges)` | Edges removed, logged |
| 21 | Dangling Edge Filter #2 | graphGuards.ts:436-462 | Remove edges to missing nodes | Edges removed, logged |
| 22 | Cycle Breaking | graphGuards.ts:464-468 | Break cycles to enforce DAG | Edges removed, logged |
| 23 | Isolated Node Pruning | graphGuards.ts:471 | Prune isolated nodes (protected-aware) | Nodes removed, logged |
| 24 | Edge ID Normalization | graphGuards.ts:474 | Normalize to stable format | `edge.id` modified |
| 25 | Metadata Calculation | graphGuards.ts:481 | Calculate roots, leaves, positions | `meta` modified |

### Phase 5: Validation (Stages 26-28)

| Stage | Name | Location | Description | Mutations |
|-------|------|----------|-------------|-----------|
| 26 | Structure Validation | v3-validator.ts | Validate required structure | N/A (validate) |
| 27 | Missing Goals Check | v3-validator.ts | Exactly 1 goal required | N/A (validate) |
| 28 | Missing Options Check | v3-validator.ts | At least 2 options required | N/A (validate) |

### Phase 6: Repair Path (Stages 29-34)

| Stage | Name | Location | Description | Mutations |
|-------|------|----------|-------------|-----------|
| 29 | LLM Repair Invocation | repair.ts | Invoke LLM for repair | See adapter stages |
| 30 | simpleRepair Fallback | repair.ts:51 | Fallback when LLM fails | See stages 31-34 |
| 31 | Protected Node Separation | repair.ts:53-54 | Separate protected from unprotected | Node categorization |
| 32 | Protected-First Capping | repair.ts:57-58 | Keep all protected, cap unprotected | Nodes removed |
| 33 | Invalid Edge Logging | repair.ts:80-99 | Log invalid edge patterns (NOT removed) | N/A (telemetry) |
| 34 | Edge Capping in Repair | repair.ts:101-104 | `slice(0, GRAPH_MAX_EDGES)` | Edges removed |

### Phase 7: Second Stabilization (Stages 35-38)

| Stage | Name | Location | Description | Mutations |
|-------|------|----------|-------------|-----------|
| 35 | Second stabiliseGraph() | pipeline.ts | Call enforceGraphCompliance() | See stages 19-25 |
| 36 | Post-Repair Validation | pipeline.ts | Validate repaired graph | N/A (validate) |
| 37 | Final Sorting | graphGuards.ts:477-478 | Deterministic sort | Order changed |
| 38 | Meta Recalculation | graphGuards.ts:481 | Update roots/leaves | `meta` modified |

### Phase 8: Output Transform (Stages 39-42)

| Stage | Name | Location | Description | Mutations |
|-------|------|----------|-------------|-----------|
| 39 | V3 Transform Entry | schema-v3.ts | Transform for V3 API | See stages 40-42 |
| 40 | Kind Mapping to V3 | schema-v3.ts:96 | Map kinds to V3 format | `node.type` set |
| 41 | Edge Strength Mapping | schema-v3.ts | Map to V3 coefficient format | `edge.coefficient` set |
| 42 | Final Response | routes/assist.ts | Return to client | N/A (output) |

---

## Protected Kinds

The following node kinds MUST NEVER be silently removed:

```typescript
const PROTECTED_KINDS = ["goal", "decision", "option", "outcome", "risk"];
```

**Defined In**:
- [repair.ts:37](../src/services/repair.ts#L37)
- [graphGuards.ts:222](../src/utils/graphGuards.ts#L222)

**Rationale**:
- `goal`: Required target (exactly 1)
- `decision`: Required root (exactly 1)
- `option`: Required alternatives (minimum 2)
- `outcome`: Required positive consequences (minimum 1)
- `risk`: Required negative consequences (minimum 1)

---

## Caps Constants

```typescript
const GRAPH_MAX_NODES = 50;  // Environment: LIMIT_MAX_NODES or GRAPH_MAX_NODES
const GRAPH_MAX_EDGES = 200; // Environment: LIMIT_MAX_EDGES or GRAPH_MAX_EDGES
```

**Defined In**: [graphCaps.ts](../src/config/graphCaps.ts)

**Used In**:
- openai.ts (Stage 6-7)
- anthropic.ts (Stage 6-7)
- graphGuards.ts (Stage 19-20)
- repair.ts (Stage 32, 34)

---

## Mutation Types

### Node Mutations

| Type | Description | Example Stages |
|------|-------------|----------------|
| `node_added` | New node created | 12, 13, 14 |
| `node_removed` | Node deleted | 6, 11, 19, 23, 32 |
| `node_kind_changed` | Kind normalized | 2 |
| `node_property_changed` | Property modified | 3, 4 |

### Edge Mutations

| Type | Description | Example Stages |
|------|-------------|----------------|
| `edge_added` | New edge created | 12, 13, 14 |
| `edge_removed` | Edge deleted | 7, 8, 20, 21, 22, 34 |
| `edge_id_changed` | ID normalized | 9, 24 |
| `edge_property_changed` | Property modified | 3 |

---

## Invariants

### INV-1: Protected Kinds Preservation
Protected node kinds (`goal`, `decision`, `option`, `outcome`, `risk`) MUST survive all capping and pruning operations.

**Enforcement Points**:
- repair.ts:53-58 (Protected-first capping)
- graphGuards.ts:245-256 (Pruning exclusion)

### INV-2: Dangling Edge Removal
Edges MUST NOT reference nodes that don't exist in the graph.

**Enforcement Points**:
- openai.ts:558 (Adapter)
- anthropic.ts:562 (Adapter)
- repair.ts:77 (simpleRepair)
- graphGuards.ts:462 (Compliance)

### INV-3: DAG Enforcement
The graph MUST be a directed acyclic graph (no cycles).

**Enforcement Points**:
- graphGuards.ts:465-468 (Cycle breaking)

### INV-4: Stable Edge IDs
Edge IDs MUST follow format `${from}::${to}::${index}` for determinism.

**Enforcement Points**:
- openai.ts:566 (Adapter)
- graphGuards.ts:474 (Compliance)

### INV-5: Deterministic Sorting
Nodes sorted by `id` ASC, edges sorted by `(from, to, id)` triple.

**Enforcement Points**:
- graphGuards.ts:477-478 (Sorting)

### INV-6: Property Ranges
- `belief_exists` / `exists_probability`: [0.0, 1.0]
- `belief`: [0.0, 1.0]
- `strength_std`: > 0

**Enforcement Points**:
- normalisation.ts:166-223 (Clamping)

---

## Telemetry Events

| Event | Stage | Description |
|-------|-------|-------------|
| `NodeKindNormalized` | 2 | Node kind mapped to canonical |
| `FactorBaselineDefaulted` | 4 | Controllable factor given default value |
| `cee.simple_repair.protected_nodes_preserved` | 32 | Protected nodes kept during repair |
| `cee.simple_repair.invalid_edges_preserved` | 33 | Invalid edge patterns logged |
| `graph.compliance.dangling_edges_removed` | 21 | Dangling edges filtered |

---

## Correction Collector

The `CorrectionCollector` (defined in [corrections.ts](../src/cee/corrections.ts)) records all mutations with:

```typescript
interface Correction {
  stage: number;           // Stage number from this ledger
  type: MutationType;      // node_added, node_removed, edge_added, edge_removed, etc.
  target: TargetInfo;      // { node_id?, edge_id?, kind? }
  reason: string;          // Human-readable explanation
  before?: unknown;        // Original value
  after?: unknown;         // New value
}
```

**Usage**:
```typescript
collector.addByStage(
  23,                              // Stage 23: Isolated Node Pruning
  "node_removed",                  // Mutation type
  { node_id: "fac_orphan" },       // Target
  "Isolated node with no edges",   // Reason
  { id: "fac_orphan", kind: "factor" }, // Before
  undefined                        // After (removed)
);
```

---

## Test Coverage

Invariant tests are located in `tests/invariants/cee/`:

| Test File | Invariants Tested |
|-----------|-------------------|
| `protected-kinds.test.ts` | INV-1 |
| `caps-consistency.test.ts` | INV-2, caps usage |
| `edge-properties.test.ts` | INV-4, INV-6 |

---

## Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-01-21 | Initial specification |
