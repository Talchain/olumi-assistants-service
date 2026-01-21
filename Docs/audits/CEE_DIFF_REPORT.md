# CEE Diff Report

**Date**: 2026-01-21
**Audit Type**: Verification of Previous Findings and Fixes

---

## Summary

This report verifies the 25 stages documented in the previous audit and confirms fixes applied.

### Previous Audit Reference
- Plan file: `twinkling-moseying-newt.md`
- Extended audit: `CEE_EXTENDED_AUDIT_REPORT.md`

---

## Stage Verification

### Stages 1-2: Kind/V4 Normalisation
**File**: `src/adapters/llm/normalisation.ts`
**Status**: UNCHANGED

| Function | Line | Purpose | Verified |
|----------|------|---------|----------|
| `normaliseNodeKind` | 86 | Maps LLM node kinds to canonical kinds | YES |
| `normaliseDraftResponse` | 104 | Normalises full LLM response | YES |

---

### Stages 3-4: Node/Edge Capping
**Files**: `src/adapters/llm/openai.ts`, `src/adapters/llm/anthropic.ts`
**Status**: USES GRAPH_MAX_* CONSTANTS

| Location | Operation | Cap Source | Logged |
|----------|-----------|------------|--------|
| openai.ts:519 | `nodes.slice(0, GRAPH_MAX_NODES)` | graphCaps.ts | YES |
| openai.ts:524 | `edges.slice(0, GRAPH_MAX_EDGES)` | graphCaps.ts | YES |
| anthropic.ts:522 | `nodes.slice(0, GRAPH_MAX_NODES)` | graphCaps.ts | YES |
| anthropic.ts:527 | `edges.slice(0, GRAPH_MAX_EDGES)` | graphCaps.ts | YES |
| openai.ts:892 | `nodes.slice(0, GRAPH_MAX_NODES)` | graphCaps.ts | NO |
| openai.ts:896 | `edges.slice(0, GRAPH_MAX_EDGES)` | graphCaps.ts | NO |
| anthropic.ts:1041 | `nodes.slice(0, GRAPH_MAX_NODES)` | graphCaps.ts | NO |
| anthropic.ts:1044 | `edges.slice(0, GRAPH_MAX_EDGES)` | graphCaps.ts | NO |

**Note**: Repair adapter capping (lines ~890-896 and ~1041-1044) lacks logging.

---

### Stage 5: Dangling Edge Filter #1
**Files**: `src/adapters/llm/openai.ts`, `src/adapters/llm/anthropic.ts`
**Status**: LOGGED (previously was silent)

| Location | Event | Logged |
|----------|-------|--------|
| openai.ts:529 | `llm.draft.dangling_edges_removed` | YES |
| anthropic.ts:532 | `llm.draft.dangling_edges_removed` | YES |

---

### Stages 6-7: Edge ID Normalisation / Sorting
**Files**: `src/adapters/llm/openai.ts`, `src/adapters/llm/anthropic.ts`
**Status**: UNCHANGED

---

### Stages 8-11: Pipeline Stages
**File**: `src/cee/validation/pipeline.ts`
**Status**: UNCHANGED

| Stage | Function | Purpose |
|-------|----------|---------|
| 8 | LLM Draft | Initial graph from LLM |
| 9 | Factor Enrichment | Add factors from brief |
| 10 | First Stabilise | Apply graph guards |
| 11 | Goal Merge | Merge multiple goals |

---

### Stages 12-14: Structure Transforms
**File**: `src/cee/structure/index.ts`
**Status**: UNCHANGED

---

### Stages 15-18: Goal Inference
**File**: `src/cee/structure/goal-inference.ts`
**Status**: UNCHANGED

---

### Stages 19-23: Graph Guards Layer
**File**: `src/utils/graphGuards.ts`
**Status**: FIXED - PROTECTED_KINDS now includes "option"

| Constant | Previous Value | Current Value | Fixed |
|----------|----------------|---------------|-------|
| PROTECTED_KINDS | `["goal", "decision", "outcome", "risk"]` | `["goal", "decision", "option", "outcome", "risk"]` | YES |

**Functions verified**:
- `enforceGraphCompliance` (line 378)
- `pruneIsolatedNodes` (line 228) - Now protects options
- `breakCycles` (line 135)
- `normalizeEdgeIds` (line 21)
- `sortNodes` (line 50)
- `sortEdges` (line 57)
- `calculateMeta` (line 291)

---

### Stages 24-25: Edge ID / Meta
**File**: `src/utils/graphGuards.ts`
**Status**: UNCHANGED

---

## Fixes Verified

### Fix 1: PROTECTED_KINDS Consistency
**Issue**: PROTECTED_KINDS was defined differently in repair.ts vs graphGuards.ts
**Status**: FIXED

| File | Location | Value |
|------|----------|-------|
| repair.ts | Line 37 | `["goal", "decision", "option", "outcome", "risk"]` |
| graphGuards.ts | Line 222 | `["goal", "decision", "option", "outcome", "risk"]` |

Both now include all 5 structurally required kinds.

---

### Fix 2: simpleRepair Caps
**Issue**: simpleRepair had hardcoded cap of 12 nodes / 24 edges
**Status**: FIXED

| File | Location | Previous | Current |
|------|----------|----------|---------|
| repair.ts | Line 57 | `12` | `GRAPH_MAX_NODES` (50) |
| repair.ts | Line 102 | `24` | `GRAPH_MAX_EDGES` (200) |

---

## Issues Remaining

### Issue 1: Hardcoded Caps in share-redaction.ts
**File**: `src/utils/share-redaction.ts`
**Lines**: 91-92

```typescript
MAX_NODES: 50,
MAX_EDGES: 200,
```

**Risk**: Low - This is for share/export limits, not pipeline processing.
**Recommendation**: Import from graphCaps.ts for consistency.

---

### Issue 2: Repair Adapter Capping Lacks Logging
**Files**: openai.ts (lines 891-896), anthropic.ts (lines 1040-1044)
**Risk**: Medium - Silent capping in repair adapter path.
**Recommendation**: Add logging consistent with draft adapter capping.

---

### Issue 3: Multiple Capping Points
**Observation**: Nodes/edges can be capped at 4+ different points:
1. Adapter draft (openai.ts:519, anthropic.ts:522)
2. Adapter repair (openai.ts:892, anthropic.ts:1041)
3. simpleRepair (repair.ts:57, 102)
4. graphGuards (graphGuards.ts:399, 433)

**Risk**: Medium - Redundant capping, but all use GRAPH_MAX_* constants now.
**Recommendation**: Consider consolidating to single capping point.

---

## Verification Commands Used

```bash
# PROTECTED_KINDS consistency
grep -rn "PROTECTED_KINDS" src/ --include="*.ts"

# Cap references
grep -rn "GRAPH_MAX_NODES\|GRAPH_MAX_EDGES" src/ --include="*.ts"

# Dangling edge logging
grep -n "dangling" src/adapters/llm/*.ts
```

---

## Conclusion

All critical fixes from previous audit are verified:
- PROTECTED_KINDS includes "option" in both locations
- simpleRepair uses system caps (GRAPH_MAX_NODES/GRAPH_MAX_EDGES)
- Dangling edge filtering is logged

Minor issues remain (hardcoded caps in share-redaction.ts, silent repair adapter capping) but do not affect pipeline correctness.
