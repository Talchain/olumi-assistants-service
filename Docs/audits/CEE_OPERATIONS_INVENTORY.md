# CEE Operations Inventory

**Date**: 2026-01-21
**Scope**: All operations that add, remove, or modify graph nodes and edges

---

## Node Operations

### Node Array Assignments

| # | Operation | File:Line | Type | Protected-Aware? | Logged? | Can Cause Loss? |
|---|-----------|-----------|------|------------------|---------|-----------------|
| N1 | `parsed.nodes = parsed.nodes.slice(0, GRAPH_MAX_NODES)` | openai.ts:519 | remove | NO | YES | YES |
| N2 | `parsed.nodes = parsed.nodes.slice(0, GRAPH_MAX_NODES)` | openai.ts:892 | remove | NO | NO | YES |
| N3 | `parsed.nodes = parsed.nodes.slice(0, GRAPH_MAX_NODES)` | anthropic.ts:522 | remove | NO | YES | YES |
| N4 | `parsed.nodes = parsed.nodes.slice(0, GRAPH_MAX_NODES)` | anthropic.ts:1041 | remove | NO | NO | YES |
| N5 | `obj.nodes = obj.nodes.map(...)` | normalisation.ts:112 | modify | N/A | YES | NO |

### Node Array Mutations (push)

| # | Operation | File:Line | Type | Context |
|---|-----------|-----------|------|---------|
| N6 | `nodes.push(result.node)` | to-risk-node.ts:214 | add | Adding constraint as risk node |
| N7 | `enrichedGraph.nodes.push(newNode)` | enricher.ts:224 | add | Factor enrichment (sync) |
| N8 | `enrichedGraph.nodes.push(newNode)` | enricher.ts:434 | add | Factor enrichment (async) |
| N9 | `patch.adds.nodes.push(node)` | answer-processor.ts:69 | add | Clarifier answer processing |

### Node Filtering Operations

| # | Operation | File:Line | Purpose | Can Remove Nodes? |
|---|-----------|-----------|---------|-------------------|
| N10 | `graph.nodes.filter((n) => !kindsToStrip.includes(n.kind))` | pipeline.ts:1545 | Strip unwanted kinds | YES |
| N11 | `nodes.filter((n) => PROTECTED_KINDS.has(n.kind))` | repair.ts:53 | Separate protected | NO (categorize) |
| N12 | `nodes.filter(n => !nodesToPrune.has(n.id))` | graphGuards.ts:285 | Prune isolated | YES (protected-aware) |
| N13 | `nodes.slice(0, maxNodes)` | graphGuards.ts:414 | Cap count | YES |

---

## Edge Operations

### Edge Array Assignments

| # | Operation | File:Line | Type | Logged? | Can Cause Loss? |
|---|-----------|-----------|------|---------|-----------------|
| E1 | `parsed.edges = parsed.edges.slice(0, GRAPH_MAX_EDGES)` | openai.ts:524 | remove | YES | YES |
| E2 | `parsed.edges = parsed.edges.slice(0, GRAPH_MAX_EDGES)` | openai.ts:896 | remove | NO | YES |
| E3 | `parsed.edges = parsed.edges.slice(0, GRAPH_MAX_EDGES)` | anthropic.ts:527 | remove | YES | YES |
| E4 | `parsed.edges = parsed.edges.slice(0, GRAPH_MAX_EDGES)` | anthropic.ts:1044 | remove | NO | YES |
| E5 | `obj.edges = obj.edges.map(...)` | normalisation.ts:137 | modify | NO | NO |

### Edge Array Mutations (push)

| # | Operation | File:Line | Type | Context |
|---|-----------|-----------|------|---------|
| E6 | `edges.push(result.edge)` | to-risk-node.ts:216 | add | Constraint to risk edge |
| E7 | `patch.adds.edges.push(edge)` | answer-processor.ts:94 | add | Clarifier answer |
| E8 | `enrichedGraph.edges.push(newEdge)` | enricher.ts:240 | add | Factor edge (sync) |
| E9 | `enrichedGraph.edges.push(newEdge)` | enricher.ts:462 | add | Factor edge (async) |

### Edge Filtering Operations

| # | Operation | File:Line | Purpose | Can Remove Edges? |
|---|-----------|-----------|---------|-------------------|
| E10 | `edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to))` | openai.ts:558 | Dangling filter | YES |
| E11 | `edges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to))` | anthropic.ts:562 | Dangling filter | YES |
| E12 | `g.edges.filter((edge) => nodeIds.has(edge.from) && nodeIds.has(edge.to))` | repair.ts:77 | Dangling filter | YES |
| E13 | `edges.filter(e => nodeIds.has(e.from) && nodeIds.has(e.to))` | graphGuards.ts:462 | Dangling filter | YES |
| E14 | `edges.filter(e => !edgeIdsToRemove.has(edgeId))` | graphGuards.ts:168 | Cycle breaking | YES |
| E15 | `edges.slice(0, maxEdges)` | graphGuards.ts:433 | Cap count | YES |
| E16 | `validEdges.slice(0, GRAPH_MAX_EDGES)` | repair.ts:102 | Cap count | YES |

---

## Property Operations

### Edge Property Modifications

| # | Operation | File:Line | Property | Transform | Logged? |
|---|-----------|-----------|----------|-----------|---------|
| P1 | `strength_mean` clamping | normalisation.ts:188-198 | strength_mean | Number() coercion | YES (debug) |
| P2 | `strength_std` clamping | normalisation.ts:199-202 | strength_std | Positive check | NO |
| P3 | `belief_exists` clamping | normalisation.ts:166-182 | belief_exists | Clamp [0,1] | YES (warn) |
| P4 | `exists_probability` clamping | normalisation.ts:207-223 | exists_probability | Clamp [0,1] | YES (warn) |
| P5 | `belief` clamping | normalisation.ts:232-248 | belief | Clamp [0,1] | YES (warn) |
| P6 | `weight` parsing | normalisation.ts:252-258 | weight | Number() | NO |
| P7 | Edge ID assignment | repair.ts:103 | id | Generate if missing | NO |
| P8 | Edge ID normalization | graphGuards.ts:36-40 | id | `${from}::${to}::${idx}` | NO |
| P9 | `strength_mean` correction | pipeline.ts:892 | strength_mean | Sign correction | NO |
| P10 | `belief_exists` default | structure/index.ts:415 | belief_exists | Set to 1.0 | NO |

### Node Property Modifications

| # | Operation | File:Line | Property | Transform | Logged? |
|---|-----------|-----------|----------|-----------|---------|
| P11 | `kind` normalization | normalisation.ts:118-128 | kind | Map to canonical | YES |
| P12 | `data.value` default | normalisation.ts:356-370 | data.value | Default 1.0 for controllable | YES |

---

## Constant Definitions

| Constant | File:Line | Value | Consistent? |
|----------|-----------|-------|-------------|
| `GRAPH_MAX_NODES` | graphCaps.ts:43 | 50 (env override) | YES - single source |
| `GRAPH_MAX_EDGES` | graphCaps.ts:49 | 200 (env override) | YES - single source |
| `PROTECTED_KINDS` | repair.ts:37 | `["goal", "decision", "option", "outcome", "risk"]` | YES |
| `PROTECTED_KINDS` | graphGuards.ts:222 | `["goal", "decision", "option", "outcome", "risk"]` | YES |
| `MAX_NODES` (share) | share-redaction.ts:91 | 50 | NO - hardcoded |
| `MAX_EDGES` (share) | share-redaction.ts:92 | 200 | NO - hardcoded |

---

## Graph-Level Return Statements

| # | Location | Pattern | Creates New Graph? |
|---|----------|---------|-------------------|
| G1 | to-risk-node.ts:230 | `return { nodes, edges }` | YES |
| G2 | repair.ts:106 | `return { ...g, nodes, edges }` | YES (spread) |
| G3 | openai.ts:362 | `return { nodes: nodesSorted, edges: edgesSorted }` | YES |
| G4 | anthropic.ts:400 | `return { ...graph, nodes: sortedNodes, edges: sortedEdges }` | YES (spread) |

---

## Suspicious Patterns

### Silent Catches

| # | File:Line | What Happens | Risk |
|---|-----------|--------------|------|
| S1 | validateClient.ts:catch | Returns `{ ok: false, violations: ["validate_unreachable"] }` | Low - explicit failure |
| S2 | model-selector.ts:catch | Returns DEFAULT_CONFIG | Medium - hides config errors |
| S3 | question-generator.ts:catch | Returns null | Low - explicit null |
| S4 | redis.ts:catch | Returns false | Low - explicit failure |
| S5 | openai.ts:catch (serialize) | Returns `'[serialization failed]'` | Low - debug only |

### Type Coercion Points

| # | File:Line | Pattern | Risk |
|---|-----------|---------|------|
| C1 | normalisation.ts:188 | `Number(strength.mean)` | Low - NaN check follows |
| C2 | normalisation.ts:233 | `Number(e.belief)` | Low - NaN check follows |
| C3 | numeric-parser.ts:* | Multiple `parseFloat()` | Low - numeric extraction utility |
| C4 | detectors.ts:294 | `Number(percentMatch[1])` | Low - regex guarantees numeric |

---

## Data Flow Summary

```
LLM JSON Output
    ↓
[1] normaliseDraftResponse() - Kind mapping, property coercion
    ↓
[2] OpenAIDraftResponse.safeParse() - Zod validation
    ↓
[3] Node/edge capping (adapter) - slice(0, GRAPH_MAX_*)
    ↓
[4] Dangling edge filter (adapter) - Remove edges to missing nodes
    ↓
[5] Edge ID normalization (adapter) - Generate stable IDs
    ↓
[6] Sorting (adapter) - Deterministic order
    ↓
[7] Pipeline receives graph
    ↓
[8] Factor enrichment - Add extracted factors
    ↓
[9] First stabiliseGraph() - enforceGraphCompliance()
    ↓
    [9a] Node capping - slice(0, maxNodes)
    [9b] Edge capping - slice(0, maxEdges)
    [9c] Dangling edge filter
    [9d] Cycle breaking - Remove back edges
    [9e] Isolated node pruning - Protected-aware
    [9f] Edge ID normalization
    [9g] Sorting
    [9h] Meta calculation
    ↓
[10] Validation - Check structure requirements
    ↓
[11] Repair (if needed)
    ↓
    [11a] LLM Repair attempt
    [11b] simpleRepair fallback - Protected-first capping
    ↓
[12] Second stabiliseGraph()
    ↓
[13] Final validation
    ↓
[14] V3 Transform (if API v3)
    ↓
API Response
```

---

## Recommendations

### High Priority

1. **Add logging to repair adapter capping** (openai.ts:891-896, anthropic.ts:1040-1044)
2. **Import caps in share-redaction.ts** from graphCaps.ts

### Medium Priority

3. **Consolidate capping** - Consider single capping point with protected-awareness
4. **Add telemetry for property clamping** - Currently only warn-level for out-of-range

### Low Priority

5. **Document type coercion behavior** - Especially NaN handling
6. **Add invariant tests** for all property range constraints
