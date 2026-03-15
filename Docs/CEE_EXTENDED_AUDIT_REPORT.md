# CEE Extended Audit Report

**Date**: 2026-01-21
**Scope**: Comprehensive audit of node-affecting transforms, fallback mechanisms, and architectural issues
**Status**: CRITICAL ISSUES FOUND

---

## Executive Summary

This audit identified **1 critical bug**, **2 high-priority issues**, and **several architectural concerns** in the CEE pipeline's node handling logic. The most severe finding is a **PROTECTED_KINDS inconsistency** between `repair.ts` and `graphGuards.ts` that can cause option nodes to be incorrectly pruned.

### Quick Reference

| Severity | Count | Status |
|----------|-------|--------|
| CRITICAL | 1 | Requires immediate fix |
| HIGH | 2 | Should be fixed before next deploy |
| MEDIUM | 3 | Architectural improvements |
| LOW | 2 | Nice-to-have optimizations |

---

## Critical Finding: PROTECTED_KINDS Inconsistency

### Location
- [repair.ts:36](src/services/repair.ts#L36)
- [graphGuards.ts:219](src/utils/graphGuards.ts#L219)

### Issue

Two separate `PROTECTED_KINDS` constants exist with **different values**:

```typescript
// repair.ts:36 - CORRECT (includes option)
const PROTECTED_KINDS = new Set(["goal", "decision", "option", "outcome", "risk"]);

// graphGuards.ts:219 - INCORRECT (missing option)
const PROTECTED_KINDS = new Set(["goal", "decision", "outcome", "risk"]);
```

### Impact

When `pruneIsolatedNodes` in graphGuards.ts is called, **isolated option nodes will be pruned** because "option" is not protected. This directly contradicts the fix in repair.ts that was intended to preserve options.

### Root Cause

The two files were edited independently. When option was added to repair.ts (commit 212ce32), graphGuards.ts was not updated.

### Fix Required

```typescript
// graphGuards.ts:219 - Add "option"
const PROTECTED_KINDS = new Set(["goal", "decision", "option", "outcome", "risk"]);
```

---

## High Priority Issues

### 1. Adapter Node Capping Has No Protected Kind Awareness

**Locations**:
- [openai.ts:519](src/adapters/llm/openai.ts#L519)
- [anthropic.ts:522](src/adapters/llm/anthropic.ts#L522)

**Issue**: When the LLM returns more than 50 nodes, the adapters blindly slice:

```typescript
parsed.nodes = parsed.nodes.slice(0, GRAPH_MAX_NODES);
```

This can cut off protected kinds (goal, decision, option, outcome, risk) if they appear after position 50 in the array.

**Risk**: Low in practice (LLM rarely returns >50 nodes), but creates inconsistency with repair.ts logic.

**Recommendation**: Apply same protected-first logic as repair.ts.

---

### 2. graphGuards.ts Node Capping Has No Protected Kind Awareness

**Location**: [graphGuards.ts:411](src/utils/graphGuards.ts#L411)

**Issue**: The `enforceGraphCompliance` function caps nodes without considering protected kinds:

```typescript
if (nodes.length > maxNodes) {
  nodes = nodes.slice(0, maxNodes);
}
```

**Risk**: If a graph has 60 nodes with goals/decisions/outcomes/risks appearing after position 50, they will be dropped.

**Recommendation**: Use protected-first capping like repair.ts.

---

## Medium Priority Issues

### 3. simpleRepair Cap Mismatch

**Location**: [repair.ts:54](src/services/repair.ts#L54)

**Issue**: simpleRepair has a hard cap of 12 nodes:

```typescript
const maxUnprotected = Math.max(0, 12 - protectedNodes.length);
```

But the actual system limit is 50 nodes (GRAPH_MAX_NODES). This aggressive trimming causes connectivity failures when graphs have many factors.

**Analysis**:
- GRAPH_MAX_NODES = 50 (from graphCaps.ts)
- simpleRepair cap = 12
- A graph with 8 protected nodes + 20 factors = 28 nodes
- After simpleRepair: 8 protected + 4 factors = 12 nodes
- 16 factors dropped = 16+ edges become dangling = connectivity failure

**Recommendation**: Either:
1. Increase cap to match GRAPH_MAX_NODES (50), or
2. Add edge-preservation logic when dropping nodes, or
3. Remove simpleRepair entirely and rely on graphGuards

---

### 4. Edge Loss When Dropping Nodes

**Issue**: When simpleRepair or graphGuards drops nodes, edges referencing those nodes become "dangling" and are removed. This can break the causal chain required for graph connectivity.

**Example Failure Path**:
```
Before:  decision → option → factor_1 → outcome → goal
         option → factor_2 → factor_1  (factor_2 connects to factor_1)

After dropping factor_2:
         decision → option → factor_1 → outcome → goal
         (edge option → factor_2 is now dangling, removed)

If factor_1 was also dropped:
         decision → option → [BROKEN] → outcome → goal
         CONNECTIVITY FAILURE
```

**Recommendation**: When dropping nodes, check if doing so would break connectivity to goal. If so, keep the node.

---

### 5. Multiple Capping Stages Create Confusion

**Current capping locations**:

| Stage | Location | Cap | Protected? |
|-------|----------|-----|------------|
| 4 | openai.ts:519 | 50 | NO |
| 4 | anthropic.ts:522 | 50 | NO |
| 19 | graphGuards.ts:411 | 50 | NO |
| 23 | graphGuards.ts:282 | N/A (prune) | PARTIAL |
| fallback | repair.ts:55 | 12 | YES |

**Issue**: Nodes can be capped at multiple stages with different logic. The "protected" logic only exists in repair.ts and partially in graphGuards.ts pruning.

**Recommendation**: Create a single `capNodesPreservingStructure` utility function used by all stages.

---

## Low Priority Issues

### 6. Refinement Context Uses Different Cap

**Location**: [assist.draft-graph.ts:128-129](src/routes/assist.draft-graph.ts#L128-L129)

```typescript
const maxNodes = 20;
const maxEdges = 40;
```

**Issue**: When building refinement context for the LLM, only 20 nodes are included. This is appropriate for prompt length but differs from the system caps.

**Risk**: None - this is intentional for prompt optimization.

---

### 7. Edge Cap of 24 in simpleRepair

**Location**: [repair.ts:98](src/services/repair.ts#L98)

```typescript
const edges = validEdges.slice(0, 24);
```

**Issue**: Edge cap is 24, but GRAPH_MAX_EDGES is 200. Like the node cap, this is too aggressive.

**Recommendation**: Increase to match GRAPH_MAX_EDGES or remove simpleRepair.

---

## Architecture Recommendations

### Short-term (Next Deploy)

1. **Fix PROTECTED_KINDS in graphGuards.ts** - Add "option" to the set
2. **Increase simpleRepair caps** - Change 12→50 nodes, 24→200 edges

### Medium-term (Next Sprint)

3. **Create centralized capping utility**:
```typescript
// src/utils/nodeCappping.ts
export function capNodesPreservingStructure(
  nodes: NodeT[],
  maxNodes: number
): NodeT[] {
  const protected = nodes.filter(n => PROTECTED_KINDS.has(n.kind));
  const unprotected = nodes.filter(n => !PROTECTED_KINDS.has(n.kind));
  const maxUnprotected = Math.max(0, maxNodes - protected.length);
  return [...protected, ...unprotected.slice(0, maxUnprotected)];
}
```

4. **Add connectivity-aware dropping**:
```typescript
function wouldBreakConnectivity(
  nodes: NodeT[],
  edges: EdgeT[],
  nodeToRemove: string,
  goalId: string
): boolean {
  // Check if removing node breaks path from decision to goal
}
```

### Long-term (Architecture)

5. **Consider removing simpleRepair entirely** - It was a fallback for a specific error case but causes more problems than it solves. The main pipeline with graphGuards should handle all cases.

6. **Unified transform pipeline** - All node-affecting transforms should go through a single pipeline with consistent protected-kind logic:
   - Stage 1: Parse & validate
   - Stage 2: Normalize kinds
   - Stage 3: Cap counts (protected-first)
   - Stage 4: Remove dangling edges
   - Stage 5: Break cycles
   - Stage 6: Prune isolated (protected-aware)
   - Stage 7: Validate connectivity

---

## Node-Affecting Transforms Inventory

### Complete List

| File | Function | Operation | Protected Aware? |
|------|----------|-----------|------------------|
| openai.ts:519 | (inline) | nodes.slice(0, 50) | NO |
| anthropic.ts:522 | (inline) | nodes.slice(0, 50) | NO |
| graphGuards.ts:411 | enforceGraphCompliance | nodes.slice(0, maxNodes) | NO |
| graphGuards.ts:282 | pruneIsolatedNodes | filter isolated | PARTIAL (no option) |
| repair.ts:55 | simpleRepair | protected-first slice | YES |
| normalisation.ts:112 | normaliseDraftResponse | kind normalization | N/A (no removal) |
| enricher.ts:434 | enrichGraphWithFactorsAsync | add factor nodes | N/A (addition) |

### Edge-Affecting Transforms

| File | Function | Operation |
|------|----------|-----------|
| graphGuards.ts:459 | enforceGraphCompliance | filter dangling edges |
| graphGuards.ts:464 | breakCycles | remove cycle-causing edges |
| repair.ts:73 | simpleRepair | filter dangling edges |
| repair.ts:98 | simpleRepair | slice(0, 24) |

---

## Appendix: Debug Bundle Analysis

### Bundle: olumi-debug-34cab66f

**Node counts**:
- Raw: `{ decision: 1, option: 3, factor: 11, outcome: 3, risk: 4, goal: 1 }` = 23 nodes
- Normalised: `{ decision: 1, factor: 3, goal: 1, outcome: 3, risk: 4 }` = 12 nodes

**Analysis**:
1. 3 options → 0 options (LOST - fixed with option in PROTECTED_KINDS)
2. 11 factors → 3 factors (8 dropped by cap)
3. After fix: options preserved, but 8 factors still dropped
4. Factor drop causes edge loss → connectivity failure

**Error**: `CEE_GRAPH_CONNECTIVITY_FAILED`
- Goal is unreachable because factor→outcome edges were removed when factors were dropped

---

## Verification Checklist

Before deploying fixes:

- [ ] graphGuards.ts PROTECTED_KINDS includes "option"
- [ ] simpleRepair cap increased to 50 nodes
- [ ] simpleRepair edge cap increased to 200
- [ ] Unit tests added for protected-kind preservation
- [ ] Integration test with 25+ node graph validates connectivity
- [ ] Telemetry confirms no unexpected node kind loss

---

## Conclusion

The primary issue causing validation failures is the **PROTECTED_KINDS inconsistency** between repair.ts and graphGuards.ts. The secondary issue is the **aggressive simpleRepair caps** (12 nodes, 24 edges) that cause edge loss leading to connectivity failures.

The fix in repair.ts correctly addresses protected-kind preservation, but the inconsistency in graphGuards.ts can re-introduce the problem. Both files must be aligned, and the caps should be increased to match the actual system limits.
