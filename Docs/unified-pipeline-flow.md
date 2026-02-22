# Unified Pipeline Flow Documentation

**Version:** 1.0
**Date:** 22 February 2026
**Pipeline Version:** CIL Phase 3B (6-stage + 1 optional stage)

---

## Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Stage-by-Stage Flow](#stage-by-stage-flow)
4. [StageContext Reference](#stagecontext-reference)
5. [Data Flow Diagram](#data-flow-diagram)
6. [Error Handling](#error-handling)
7. [Checkpoints](#checkpoints)
8. [Integration Points](#integration-points)
9. [Troubleshooting](#troubleshooting)

---

## Overview

### What is the Unified Pipeline?

The Unified Pipeline (CIL Phase 3B) replaces the nested Pipeline A + Pipeline B architecture with a single, linear 6-stage pipeline. Each stage calls existing functions from their current locations — **no logic rewrite**, only orchestration changes.

### Why Unified Pipeline?

**Problems with Legacy Pipeline:**
- **Nested complexity:** Pipeline A calls Pipeline B, making flow hard to trace
- **Duplicate enrichment:** Factor enrichment ran twice (once in A, once in B)
- **Unclear boundaries:** Stage responsibilities overlapped

**Benefits of Unified Pipeline:**
- **Linear flow:** Clear stage progression from Parse → Boundary
- **Single enrichment:** Runs exactly once (Stage 3)
- **Mutable context:** `StageContext` carries state through all stages
- **Better observability:** Telemetry events at each stage boundary
- **Parity verified:** Produces structurally equivalent outputs to legacy

### Feature Flag

**Environment Variable:**
```bash
CEE_UNIFIED_PIPELINE_ENABLED=true  # Use unified pipeline
CEE_UNIFIED_PIPELINE_ENABLED=false # Use legacy Pipeline A+B (default)
```

**Config Location:** `src/config/index.ts:301`

---

## Architecture

### High-Level Flow

```
[Client Request]
       ↓
[Route: /assist/v1/draft-graph]
       ↓
[Feature Flag Check: CEE_UNIFIED_PIPELINE_ENABLED?]
       ↓ (yes)
┌──────────────────────────────────────┐
│  Unified Pipeline Orchestrator      │
│  (src/cee/unified-pipeline/index.ts) │
└──────────────────────────────────────┘
       ↓
┌─────────────────────────────────┐
│ Stage 1: Parse                  │  ← LLM draft + adapter normalization
├─────────────────────────────────┤
│ Stage 2: Normalise              │  ← STRP + risk coefficients
├─────────────────────────────────┤
│ Stage 3: Enrich                 │  ← Factor enrichment (ONCE)
├─────────────────────────────────┤
│ Stage 4: Repair                 │  ← Validation + repair + goal merge
├─────────────────────────────────┤
│ Stage 4b: Threshold Sweep       │  ← Deterministic goal threshold hygiene
├─────────────────────────────────┤
│ Stage 5: Package                │  ← Caps + warnings + quality + trace
├─────────────────────────────────┤
│ Stage 6: Boundary               │  ← V3 transform + analysis_ready
└─────────────────────────────────┘
       ↓
[Response to Client]
```

### File Structure

```
src/cee/unified-pipeline/
├── index.ts                      ← Main orchestrator
├── types.ts                      ← StageContext, types
└── stages/
    ├── parse.ts                  ← Stage 1
    ├── normalise.ts              ← Stage 2
    ├── enrich.ts                 ← Stage 3
    ├── repair/
    │   └── index.ts              ← Stage 4
    ├── threshold-sweep.ts        ← Stage 4b
    ├── package.ts                ← Stage 5
    └── boundary.ts               ← Stage 6
```

---

## Stage-by-Stage Flow

### Stage 1: Parse

**Purpose:** Generate initial graph from LLM and normalize fields

**File:** `src/cee/unified-pipeline/stages/parse.ts`

**What It Does:**
1. Call LLM with brief and context
2. Parse LLM response into GraphT
3. Apply adapter-specific normalizations
4. Capture rationales and confidence

**Inputs:**
- `ctx.input.brief` — User's decision brief
- `ctx.input.docs` — Optional documents (up to 5KB each)
- `ctx.input.previous_graph` — Optional seed graph
- `ctx.request` — Fastify request object

**Outputs:**
- `ctx.graph` — Initial GraphT
- `ctx.rationales` — LLM explanations for edges
- `ctx.draftCost` — Token usage cost
- `ctx.draftAdapter` — Which LLM adapter was used
- `ctx.llmMeta` — LLM metadata (model, tokens, etc.)
- `ctx.confidence` — LLM confidence score
- `ctx.draftDurationMs` — Time spent in LLM call

**Key Functions Called:**
- `draftGraph()` from `src/cee/draft/index.ts`
- `adaptLLMResponse()` from adapter (Anthropic or OpenAI)

**Telemetry Events:**
```typescript
"cee.unified_pipeline.stage_started" { stage: "parse" }
"cee.parse.completed" { nodeCount, edgeCount, draftDurationMs }
"cee.unified_pipeline.stage_completed" { stage: "parse", durationMs }
```

**Error Handling:**
- `LLMTimeoutError` → Propagate to client (blocker)
- `RequestBudgetExceededError` → Propagate to client (blocker)
- Other LLM errors → Retry with failover provider (if configured)

---

### Stage 2: Normalise

**Purpose:** Apply structural transformations to edge fields

**File:** `src/cee/unified-pipeline/stages/normalise.ts`

**What It Does:**
1. Run **STRP** (Structural Risk Parameter Normalisation)
   - Normalize option→factor edges to canonical values
   - Mean: 1.0, Std: 0.01, Belief: 1.0, Direction: "positive"
2. Apply **risk coefficient** field transforms
   - Convert legacy `weight`, `belief` fields to V4 fields
   - Ensure `strength_mean`, `strength_std`, `belief_exists` are set

**Inputs:**
- `ctx.graph` — Graph from Stage 1

**Outputs:**
- `ctx.strpResult` — Normalisation result (edges normalized, count)
- `ctx.riskCoefficientCorrections` — List of field transform corrections
- `ctx.transforms` — Detailed transform log

**Key Functions Called:**
- `normaliseStructuralEdges()` from `src/cee/structural-edge-normaliser.ts`
- `applyRiskCoefficientTransforms()` (if applicable)

**Telemetry Events:**
```typescript
"cee.unified_pipeline.stage_started" { stage: "normalise" }
"cee.normalise.strp_completed" { normalisedCount, edgeCount }
"cee.unified_pipeline.stage_completed" { stage: "normalise", durationMs }
```

**Error Handling:**
- Non-critical stage — failures logged but don't block pipeline

---

### Stage 3: Enrich

**Purpose:** Run factor enrichment **exactly once**

**File:** `src/cee/unified-pipeline/stages/enrich.ts`

**What It Does:**
1. Detect cycles in graph (optional)
2. Call LLM for factor enrichment
   - Add `factor_type` (cost, price, time, etc.)
   - Add `uncertainty_drivers` (1-2 short phrases)
   - Add `baseline`, `range`, `unit` metadata
3. Record enrichment result

**Inputs:**
- `ctx.graph` — Graph from Stage 2
- `ctx.effectiveBrief` — Brief text for context

**Outputs:**
- `ctx.enrichmentResult` — Enrichment metadata (called_count, source, etc.)
- `ctx.hadCycles` — Boolean, true if cycles detected
- `ctx.graph` — Updated with enriched factor data

**Key Functions Called:**
- `enrichFactors()` from `src/cee/factor-enrichment/index.ts`

**Telemetry Events:**
```typescript
"cee.unified_pipeline.stage_started" { stage: "enrich" }
"cee.enrich.completed" { factorCount, enrichedCount, hadCycles }
"cee.unified_pipeline.stage_completed" { stage: "enrich", durationMs }
```

**Parity Verification:**
- **CRITICAL:** `ctx.enrichmentResult.called_count` must equal `1`
- If > 1, indicates duplicate enrichment (pipeline bug)

**Error Handling:**
- Enrichment failure → Log warning, continue without enrichment
- LLM timeout → Skip enrichment, mark as `enrich_skipped`

---

### Stage 4: Repair

**Purpose:** Validate graph and fix violations

**File:** `src/cee/unified-pipeline/stages/repair/index.ts`

**What It Does:**
1. **Run deterministic sweep:**
   - Bucket violations into A (auto-fix), B (heuristic fix), C (LLM needed)
   - Apply deterministic repairs (STRP, controllability, etc.)
2. **Run LLM repair (if needed):**
   - Only if Bucket C has violations
   - Budget-aware: skip if too close to token limit
3. **Goal merge:**
   - Merge multiple goals into compound goal (if `CEE_ENFORCE_SINGLE_GOAL=true`)
4. **Connectivity validation:**
   - Ensure all options connect to goal
   - Prune unreachable nodes
5. **Optional clarifier:**
   - If `CEE_CLARIFIER_ENABLED=true` and quality below threshold
   - Ask user clarifying questions (up to 3 rounds)

**Inputs:**
- `ctx.graph` — Graph from Stage 3
- `ctx.input.clarificationAnswers` — Optional answers from previous round

**Outputs:**
- `ctx.validationSummary` — Validation result (errors, warnings, fixes)
- `ctx.repairCost` — Token cost of LLM repair
- `ctx.repairFallbackReason` — If LLM repair was skipped, why?
- `ctx.clarifierResult` — Clarifier result (questions asked, answers)
- `ctx.structuralMeta` — Structural analysis metadata
- `ctx.goalConstraints` — Extracted compound goal constraints
- `ctx.graph` — Repaired graph

**Key Functions Called:**
- `runDeterministicSweep()` from `src/cee/repair/deterministic-sweep.ts`
- `repairGraph()` from `src/cee/repair/index.ts`
- `validateAndFixGraph()` from `src/cee/structure/index.ts`
- `runClarifier()` from `src/cee/clarifier/index.ts` (if enabled)

**Telemetry Events:**
```typescript
"cee.unified_pipeline.stage_started" { stage: "repair" }
"cee.deterministic_sweep.completed" { violations_in, violations_out, repairs_count }
"REPAIR_SKIPPED" { reason: "budget_exceeded" | "deterministic_sweep_sufficient" }
"cee.repair.completed" { repairCost, violations_remaining }
"cee.unified_pipeline.stage_completed" { stage: "repair", durationMs }
```

**Error Handling:**
- Validation errors → Attempt repair
- Repair timeout → Use deterministic fixes only, mark as `repair_timeout`
- Budget exceeded → Skip LLM repair, use deterministic fixes

---

### Stage 4b: Threshold Sweep (Optional)

**Purpose:** Apply deterministic goal threshold hygiene

**File:** `src/cee/unified-pipeline/stages/threshold-sweep.ts`

**What It Does:**
1. Scan goal nodes for threshold-related violations
2. Apply deterministic fixes:
   - Normalize `goal_threshold` to [0, 1]
   - Ensure `goal_threshold_raw`, `goal_threshold_unit`, `goal_threshold_cap` consistency
3. **Non-critical:** Wrapped in try/catch, failures don't block pipeline

**Inputs:**
- `ctx.graph` — Graph from Stage 4

**Outputs:**
- `ctx.graph` — Updated with threshold repairs (if any)

**Key Functions Called:**
- `runThresholdSweep()` (internal)

**Telemetry Events:**
```typescript
"cee.threshold_sweep.completed" { repair_count, codes: [...] }
```

**Error Handling:**
- **Wrapped in try/catch** — failures logged, pipeline continues
- Non-critical stage, designed to be resilient

---

### Stage 5: Package

**Purpose:** Assemble final response with caps, warnings, quality, trace

**File:** `src/cee/unified-pipeline/stages/package.ts`

**What It Does:**
1. **Calculate graph caps:**
   - Node count, edge count vs limits
   - Token budget remaining
2. **Generate draft warnings:**
   - Structural warnings (uniform strengths, missing evidence, etc.)
   - Quality warnings (low readiness, high uncertainty, etc.)
3. **Assess quality:**
   - Readiness score (0-1)
   - Archetype detection (strategic, operational, hybrid)
4. **Build pipeline trace:**
   - Checkpoint snapshots (if `CEE_PIPELINE_CHECKPOINTS_ENABLED=true`)
   - Stage timing breakdown
   - Correction log
5. **Assemble CEE response:**
   - Graph, rationales, confidence
   - Draft warnings, quality metadata
   - Pipeline trace

**Inputs:**
- `ctx.graph` — Repaired graph from Stage 4
- All context fields from Stages 1-4

**Outputs:**
- `ctx.quality` — Quality assessment (readiness, level, archetype)
- `ctx.archetype` — Detected archetype (strategic, operational, hybrid)
- `ctx.draftWarnings` — List of warnings (structural, quality)
- `ctx.ceeResponse` — Complete CEE response object
- `ctx.pipelineTrace` — Detailed trace for observability

**Key Functions Called:**
- `calculateGraphCaps()` from `src/cee/caps.ts`
- `detectStructuralWarnings()` from `src/cee/structure/index.ts`
- `assessQuality()` from `src/cee/quality/index.ts`
- `buildPipelineTrace()` (internal)

**Telemetry Events:**
```typescript
"cee.unified_pipeline.stage_started" { stage: "package" }
"cee.package.quality_assessed" { readiness_score, readiness_level, archetype }
"cee.package.warnings_generated" { warningCount, structuralCount, qualityCount }
"cee.unified_pipeline.stage_completed" { stage: "package", durationMs }
```

**Error Handling:**
- Non-blocking — failures in quality assessment use fallback defaults

---

### Stage 6: Boundary

**Purpose:** Transform to V3 schema and build analysis_ready

**File:** `src/cee/unified-pipeline/stages/boundary.ts`

**What It Does:**
1. **Transform to V3 schema:**
   - Convert GraphT → CEEGraphResponseV3
   - Add `meta.source`, `meta.version`
   - Validate against OpenAPI schema
2. **Build analysis_ready:**
   - Detect option interventions
   - Map factor targets
   - Generate user questions for unmapped interventions
   - Compute `status`: "ready", "needs_mapping", "needs_encoding", "blocked"
3. **Add model_adjustments:**
   - Recommendations for user (e.g., "add_evidence", "clarify_relationship")

**Inputs:**
- `ctx.ceeResponse` — CEE response from Stage 5

**Outputs:**
- `ctx.finalResponse` — Final V3 response object
- **Returned to client**

**Key Functions Called:**
- `transformToV3()` from `src/cee/schema-v3/transform.ts`
- `buildAnalysisReady()` from `src/cee/analysis-ready/index.ts`
- `generateModelAdjustments()` from `src/cee/model-adjustments/index.ts`

**Telemetry Events:**
```typescript
"cee.unified_pipeline.stage_started" { stage: "boundary" }
"cee.analysis_ready.built" { status, optionCount, blockerCount, userQuestionCount }
"cee.schema_v3.transform_complete" { nodeCount, edgeCount, analysisReadyStatus }
"cee.unified_pipeline.stage_completed" { stage: "boundary", durationMs }
"boundary.response" { status: 200, elapsed_ms, response_hash }
```

**Error Handling:**
- Schema validation failure → Log error, return response anyway (non-blocking)
- Analysis_ready failure → Return `status: "blocked"` with blocker details

---

## StageContext Reference

### Type Definition

**File:** `src/cee/unified-pipeline/types.ts`

```typescript
export interface StageContext {
  // ── Inputs ──
  input: DraftInputWithCeeExtras;
  rawBody: unknown;
  request: FastifyRequest;
  requestId: string;
  opts: UnifiedPipelineOpts;
  start: number; // Request start timestamp

  // ── Mutable Graph ──
  graph: GraphT | undefined;

  // ── Stage 1 Outputs ──
  rationales: string[];
  draftCost: number;
  draftAdapter: "anthropic" | "openai" | "fixtures" | undefined;
  llmMeta: Record<string, unknown> | undefined;
  confidence: number | undefined;
  clarifierStatus: "skipped" | "ran" | "failed" | undefined;
  effectiveBrief: string;
  edgeFieldStash: Record<string, unknown> | undefined;
  skipRepairDueToBudget: boolean;
  repairTimeoutMs: number;
  draftDurationMs: number;

  // ── Stage 2 Outputs ──
  strpResult: { graph: GraphT; normalisedCount: number } | undefined;
  riskCoefficientCorrections: Correction[];
  transforms: Transform[];

  // ── Stage 3 Outputs ──
  enrichmentResult: EnrichmentResult | undefined;
  hadCycles: boolean;

  // ── Stage 4 Outputs ──
  nodeRenames: Map<string, string>;
  goalConstraints: GoalConstraint[] | undefined;
  constraintStrpResult: unknown | undefined;
  repairCost: number;
  repairFallbackReason: string | undefined;
  clarifierResult: ClarifierResult | undefined;
  structuralMeta: StructuralMeta | undefined;
  validationSummary: ValidationSummary | undefined;

  // ── Stage 5 Outputs ──
  quality: QualityAssessment | undefined;
  archetype: "strategic" | "operational" | "hybrid" | undefined;
  draftWarnings: DraftWarning[];
  ceeResponse: CEEDraftGraphResponse | undefined;
  pipelineTrace: PipelineTrace | undefined;

  // ── Stage 6 Outputs ──
  finalResponse: CEEGraphResponseV3 | undefined;

  // ── Cross-Cutting ──
  collector: CorrectionCollector;
  pipelineCheckpoints: StageSnapshot[];
  checkpointsEnabled: boolean;
}
```

### Mutable State Pattern

**Key Principle:** `StageContext` is **mutable** and passed by reference through all stages.

**Why Mutable?**
- Avoids deep cloning of large graphs at each stage
- Clear ownership: each stage modifies specific fields
- Telemetry can access full context at any point

**Example:**
```typescript
// Stage 1
ctx.graph = await parseGraph(ctx.input);
ctx.draftCost = 1500; // tokens

// Stage 2
ctx.graph = normaliseEdges(ctx.graph); // Mutate in place
ctx.strpResult = { normalisedCount: 3 };

// Stage 3
ctx.graph = enrichFactors(ctx.graph); // Mutate in place
ctx.enrichmentResult = { called_count: 1 };
```

---

## Data Flow Diagram

### Input → Output Transformation

```
┌──────────────────────────────────────────────────────────────┐
│ INPUT: DraftGraphInput                                       │
│   - brief: string                                            │
│   - docs?: Document[]                                        │
│   - previous_graph?: GraphV1                                 │
│   - clarificationAnswers?: ClarificationAnswer[]             │
└──────────────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────────┐
│ STAGE 1: Parse                                               │
│   [brief + docs + context] → [LLM] → GraphT                  │
│   Output: graph, rationales, draftCost                       │
└──────────────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────────┐
│ STAGE 2: Normalise                                           │
│   GraphT → [STRP + RiskCoeff] → GraphT (normalized)          │
│   Output: strpResult, transforms                             │
└──────────────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────────┐
│ STAGE 3: Enrich                                              │
│   GraphT → [LLM Factor Enrichment] → GraphT (enriched)       │
│   Output: enrichmentResult (called_count: 1)                 │
└──────────────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────────┐
│ STAGE 4: Repair                                              │
│   GraphT → [Validate + Fix + Merge + Clarify] → GraphT       │
│   Output: validationSummary, repairCost, clarifierResult     │
└──────────────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────────┐
│ STAGE 4b: Threshold Sweep                                    │
│   GraphT → [Deterministic Goal Hygiene] → GraphT             │
│   Output: (graph mutations, non-critical)                    │
└──────────────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────────┐
│ STAGE 5: Package                                             │
│   GraphT → [Caps + Warnings + Quality + Trace] → CEEResponse │
│   Output: ceeResponse, quality, draftWarnings, pipelineTrace │
└──────────────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────────┐
│ STAGE 6: Boundary                                            │
│   CEEResponse → [V3 Transform + Analysis Ready] → V3Response │
│   Output: finalResponse (CEEGraphResponseV3)                 │
└──────────────────────────────────────────────────────────────┘
                         ↓
┌──────────────────────────────────────────────────────────────┐
│ OUTPUT: CEEGraphResponseV3                                   │
│   - graph: GraphV1 (V3 schema)                               │
│   - meta: { source, version, ...}                            │
│   - analysis_ready: { status, options, blockers, ... }       │
│   - model_adjustments: Adjustment[]                          │
│   - trace: { pipeline, corrections, ...}                     │
└──────────────────────────────────────────────────────────────┘
```

### Token Budget Flow

```
Request Budget: 100,000 tokens
    ↓
Stage 1 (Parse): -15,000 tokens → Remaining: 85,000
    ↓
Stage 2 (Normalise): 0 tokens → Remaining: 85,000
    ↓
Stage 3 (Enrich): -5,000 tokens → Remaining: 80,000
    ↓
Stage 4 (Repair): -8,000 tokens (or skip if < threshold) → Remaining: 72,000
    ↓
Stage 5 (Package): 0 tokens → Remaining: 72,000
    ↓
Stage 6 (Boundary): 0 tokens → Remaining: 72,000

Final Budget Used: 28,000 tokens (28%)
```

**Budget-Aware Decisions:**
- If remaining budget < `REPAIR_SKIP_THRESHOLD`, skip LLM repair
- If remaining budget < `ENRICH_SKIP_THRESHOLD`, skip enrichment
- Track budget in `ctx.opts.remainingBudget`

---

## Error Handling

### Error Categories

| Category | Examples | Handling Strategy |
|----------|----------|-------------------|
| **Blocker Errors** | `LLMTimeoutError`, `RequestBudgetExceededError`, `ClientDisconnectError` | Immediately abort pipeline, return error response to client |
| **Recoverable Errors** | LLM rate limit, temporary network issue | Retry with exponential backoff (up to 3 retries) |
| **Stage Failures** | Enrichment failed, repair timeout | Log warning, continue pipeline with fallback defaults |
| **Non-Critical Errors** | Threshold sweep failed, checkpoint failed | Log error, continue pipeline (wrapped in try/catch) |

### Error Response Format

**Blocker Error Example:**
```typescript
{
  "error": {
    "code": "LLM_TIMEOUT",
    "message": "LLM request timed out after 30000ms",
    "stage": "parse",
    "requestId": "abc123",
    "details": {
      "timeoutMs": 30000,
      "provider": "anthropic"
    }
  }
}
```

**Recoverable Error Example:**
```typescript
// Logged, but pipeline continues:
{
  "level": "warn",
  "event": "cee.enrich.failed",
  "error": "LLM rate limit exceeded",
  "fallback": "skip_enrichment",
  "requestId": "abc123"
}
```

### Client Disconnect Handling

**Mechanism:** `AbortController` + socket monitoring

**File:** `src/routes/assist.v1.draft-graph.ts:386-400`

```typescript
const pipelineAbortController = new AbortController();
const socket = req.raw?.socket;

const socketCloseHandler = () => {
  log.warn({ requestId }, "Client disconnected during unified pipeline");
  pipelineAbortController.abort();
};

if (socket && !socket.destroyed) {
  socket.once("close", socketCloseHandler);
}

try {
  const result = await runUnifiedPipeline(ctx, {
    ...opts,
    signal: pipelineAbortController.signal
  });
} finally {
  if (socket && socketCloseHandler) {
    socket.off("close", socketCloseHandler);
  }
}
```

**When Abort Triggered:**
- LLM calls check `signal.aborted` before making request
- Stages check signal between sub-operations
- Immediate cleanup and exit

---

## Checkpoints

### Purpose

Capture snapshots of graph state at key pipeline stages for debugging and observability.

### Configuration

**Environment Variable:**
```bash
CEE_PIPELINE_CHECKPOINTS_ENABLED=true  # Enable checkpoint capture
CEE_PIPELINE_CHECKPOINTS_ENABLED=false # Disable (default)
```

**Performance Impact:**
- ~1-2ms per checkpoint (5 checkpoints = ~5-10ms total overhead)
- Increases trace payload size by ~20%

### Checkpoint Schema

**Type:** `StageSnapshot`

```typescript
interface StageSnapshot {
  stage: string;              // e.g., "parse", "normalise", "enrich"
  timestamp: number;          // Unix timestamp
  nodeCount: number;          // Node count at this stage
  edgeCount: number;          // Edge count at this stage
  edgeFieldPresence: {        // Which fields are present on edges
    strength_mean: number;    // Count of edges with this field
    strength_std: number;
    belief_exists: number;
    effect_direction: number;
    edge_type: number;
    provenance: number;
    provenance_source: number;
  };
}
```

### Checkpoint Locations

1. **After Stage 1 (Parse):** Initial LLM draft
2. **After Stage 2 (Normalise):** Post-STRP normalization
3. **After Stage 3 (Enrich):** Post-factor enrichment
4. **After Stage 4 (Repair):** Post-validation and repair
5. **After Stage 5 (Package):** Final graph before boundary transform

### Example Trace with Checkpoints

```json
{
  "trace": {
    "pipeline": {
      "pipeline_path": "unified",
      "checkpoints": [
        {
          "stage": "parse",
          "timestamp": 1709123456789,
          "nodeCount": 8,
          "edgeCount": 12,
          "edgeFieldPresence": {
            "strength_mean": 12,
            "strength_std": 10,
            "belief_exists": 12,
            "effect_direction": 8,
            "edge_type": 12,
            "provenance": 5,
            "provenance_source": 5
          }
        },
        // ... more checkpoints
      ]
    }
  }
}
```

---

## Integration Points

### Where Unified Pipeline is Invoked

**Primary Route:** `src/routes/assist.v1.draft-graph.ts`

```typescript
// Line 378
if (config.cee.unifiedPipelineEnabled) {
  const result = await runUnifiedPipeline(
    input,
    rawBody,
    req,
    {
      requestStartMs: Date.now(),
      signal: pipelineAbortController.signal,
      // ... other opts
    }
  );
  return result.finalResponse;
}
```

### Shared Functions with Legacy Pipeline

Both unified and legacy pipelines use these shared functions:

| Function | Location | Used By |
|----------|----------|---------|
| `draftGraph()` | `src/cee/draft/index.ts` | Stage 1 (Parse) |
| `normaliseStructuralEdges()` | `src/cee/structural-edge-normaliser.ts` | Stage 2 (Normalise) |
| `enrichFactors()` | `src/cee/factor-enrichment/index.ts` | Stage 3 (Enrich) |
| `validateAndFixGraph()` | `src/cee/structure/index.ts` | Stage 4 (Repair) |
| `repairGraph()` | `src/cee/repair/index.ts` | Stage 4 (Repair) |
| `runDeterministicSweep()` | `src/cee/repair/deterministic-sweep.ts` | Stage 4 (Repair) |
| `buildAnalysisReady()` | `src/cee/analysis-ready/index.ts` | Stage 6 (Boundary) |
| `transformToV3()` | `src/cee/schema-v3/transform.ts` | Stage 6 (Boundary) |

### External Service Calls

**LLM Adapters:**
- `src/adapters/llm/anthropic.ts` — Claude API calls
- `src/adapters/llm/openai.ts` — GPT API calls
- Used in Stage 1 (Parse), Stage 3 (Enrich), Stage 4 (Repair)

**Validation Service:**
- `src/services/validateClient.ts` — Graph topology validation
- Used in Stage 4 (Repair) if external validation enabled

**ISL (Inference Service Layer):**
- **Not called in unified pipeline**
- ISL integration happens post-draft in separate endpoints

---

## Troubleshooting

### Common Issues

#### Issue 1: Enrichment Running Twice

**Symptom:**
```json
{
  "trace": {
    "pipeline": {
      "enrich": {
        "called_count": 2  // ❌ Should be 1
      }
    }
  }
}
```

**Root Cause:** Legacy pipeline code path accidentally invoked

**Fix:** Verify `CEE_UNIFIED_PIPELINE_ENABLED=true` in environment

**Verification:**
```bash
grep "enrich.called_count" logs/*.json | jq '.trace.pipeline.enrich.called_count'
# Should always output: 1
```

#### Issue 2: Pipeline Timeout

**Symptom:** Request takes > 30s and times out

**Root Cause:** One of the LLM stages (Parse, Enrich, Repair) is slow

**Debugging Steps:**
1. Check stage timing in trace:
   ```json
   {
     "trace": {
       "pipeline": {
         "stages": {
           "parse": { "durationMs": 15000 },
           "enrich": { "durationMs": 12000 },  // Slow!
           "repair": { "durationMs": 5000 }
         }
       }
     }
   }
   ```
2. Identify slow stage
3. Check LLM provider latency logs
4. Consider increasing stage timeout:
   ```bash
   CEE_ENRICH_TIMEOUT_MS=20000  # Increase from default 15000
   ```

#### Issue 3: Budget Exceeded Mid-Pipeline

**Symptom:**
```json
{
  "event": "REPAIR_SKIPPED",
  "reason": "budget_exceeded",
  "remaining_budget": 2000
}
```

**Root Cause:** Parse or Enrich stage consumed too many tokens

**Fix:**
1. Reduce brief length
2. Reduce document count/size
3. Increase request budget:
   ```bash
   CEE_MAX_REQUEST_BUDGET_TOKENS=150000  # Increase from default 100000
   ```

#### Issue 4: Analysis_ready Status "blocked"

**Symptom:**
```json
{
  "analysis_ready": {
    "status": "blocked",
    "blockers": [
      {
        "type": "missing_intervention_target",
        "optionId": "opt_1",
        "factorId": "fac_unknown"
      }
    ]
  }
}
```

**Root Cause:** Option references factor that doesn't exist in graph

**Fix:**
1. Check if factor was pruned during repair
2. Verify option.data.interventions map to valid factor IDs
3. Review repair logs for node deletions

#### Issue 5: Structural Equivalence Failure

**Symptom:** Parity test fails on edge field comparison

**Debugging:**
1. Run parity test with verbose output:
   ```bash
   pnpm test tests/integration/cee.unified-pipeline.parity.test.ts --reporter=verbose
   ```
2. Compare traces:
   ```javascript
   // Unified trace
   {
     "pipeline_path": "unified",
     "enrich": { "source": "unified_pipeline", "called_count": 1 }
   }

   // Legacy trace
   {
     "pipeline_path": "A",
     "enrich": { "source": "pipeline_b", "called_count": 1 }
   }
   ```
3. Check for field drift in normalisation

---

## Appendix: Pipeline Comparison

### Legacy (Pipeline A + B) vs Unified

| Aspect | Legacy (A+B) | Unified |
|--------|-------------|---------|
| **Stages** | A: Parse, Normalise, Enrich<br>B: Repair, Package, Boundary | Linear 1-6 |
| **Enrichment** | Runs in both A and B (duplicate) | Runs once (Stage 3) |
| **Complexity** | Nested function calls | Flat orchestration |
| **Context** | Separate contexts for A and B | Single mutable StageContext |
| **Observability** | A-level trace + B-level trace | Unified trace with checkpoints |
| **Testing** | Separate A and B test suites | Single parity test suite |
| **Maintainability** | Higher (two code paths) | Lower (one code path) |

### Migration Path

**Phase 1:** Enable unified pipeline in staging ✅ (Current)
**Phase 2:** Monitor metrics for 2 weeks
**Phase 3:** Enable in production (canary 10%)
**Phase 4:** Full production rollout
**Phase 5:** Deprecate legacy pipeline (set `CEE_LEGACY_PIPELINE_ENABLED=false`)
**Phase 6:** Remove legacy pipeline code

---

## Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-02-22 | Initial documentation — 6-stage unified pipeline (CIL Phase 3B) |

---

**Document Maintainer:** CEE Team
**Last Updated:** 22 February 2026
**Next Review:** 2026-03-22 (1 month)
