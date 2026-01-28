# CEE Orchestration & Assistance Audit

**Generated:** 2026-01-21
**Scope:** All `/assist/v1/*` endpoints, prompt tasks, orchestration flows

---

## 1. Endpoint Inventory

### 1.1 Core Graph Endpoints (LLM-Powered)

| Endpoint | Method | Purpose | LLM? | Caller | File |
|----------|--------|---------|------|--------|------|
| `/assist/v1/draft-graph` | POST | Generate decision graph from brief | ✅ gpt-5.2 | PLoT | [assist.v1.draft-graph.ts](../src/routes/assist.v1.draft-graph.ts) |
| `/assist/v1/draft-graph/stream` | POST | SSE streaming draft generation | ✅ gpt-5.2 | PLoT | [assist.v1.draft-graph-stream.ts](../src/routes/assist.v1.draft-graph-stream.ts) |
| `/assist/v1/ask` | POST | Conversational Q&A on decision model | ✅ | PLoT UI | [assist.v1.ask.ts](../src/routes/assist.v1.ask.ts) |

### 1.2 Pre-Inference Endpoints (Graph Processing)

These endpoints work on the **graph** before ISL inference runs.

| Endpoint | Method | Purpose | LLM? | Caller | File |
|----------|--------|---------|------|--------|------|
| `/assist/v1/options` | POST | Generate strategic options for graph | ❌ | PLoT | [assist.v1.options.ts](../src/routes/assist.v1.options.ts) |
| `/assist/v1/graph-readiness` | POST | Assess graph quality for inference | ❌ | PLoT | [assist.v1.graph-readiness.ts](../src/routes/assist.v1.graph-readiness.ts) |
| `/assist/v1/bias-check` | POST | Detect cognitive biases in graph | ❌ | PLoT | [assist.v1.bias-check.ts](../src/routes/assist.v1.bias-check.ts) |
| `/assist/v1/key-insight` | POST | Extract key insights from graph | ❌ | PLoT | [assist.v1.key-insight.ts](../src/routes/assist.v1.key-insight.ts) |
| `/assist/v1/team-perspectives` | POST | Summarize team belief distributions | ❌ | PLoT | [assist.v1.team-perspectives.ts](../src/routes/assist.v1.team-perspectives.ts) |
| `/assist/v1/evidence-helper` | POST | Score evidence quality | ❌ | PLoT | [assist.v1.evidence-helper.ts](../src/routes/assist.v1.evidence-helper.ts) |
| `/assist/v1/suggest-edge-function` | POST | Suggest non-linear edge functions | ❌ | PLoT | [assist.v1.suggest-edge-function.ts](../src/routes/assist.v1.suggest-edge-function.ts) |
| `/assist/v1/suggest-utility-weights` | POST | Suggest goal utility weights | ❌ | PLoT | [assist.v1.suggest-utility-weights.ts](../src/routes/assist.v1.suggest-utility-weights.ts) |

### 1.3 Post-Inference Endpoints (ISL Results Processing)

These endpoints work on **inference results** after ISL engine runs.

| Endpoint | Method | Purpose | LLM? | Caller | File |
|----------|--------|---------|------|--------|------|
| `/assist/v1/review` | POST | Comprehensive decision review | ❌ | PLoT | [assist.v1.review.ts](../src/routes/assist.v1.review.ts) |
| `/assist/v1/enhanced-decision-review` | POST | Enhanced review with robustness | ❌ | PLoT | [assist.v1.enhanced-decision-review.ts](../src/routes/assist.v1.enhanced-decision-review.ts) |
| `/assist/v1/sensitivity-coach` | POST | Sensitivity analysis guidance | ❌ | PLoT | [assist.v1.sensitivity-coach.ts](../src/routes/assist.v1.sensitivity-coach.ts) |
| `/assist/v1/explain-graph` | POST | Explain inference results | ❌ | PLoT | [assist.v1.explain-graph.ts](../src/routes/assist.v1.explain-graph.ts) |
| `/assist/v1/isl-synthesis` | POST | Convert ISL results to narratives | ❌ | PLoT | [assist.v1.isl-synthesis.ts](../src/routes/assist.v1.isl-synthesis.ts) |

### 1.4 Preference Elicitation Endpoints

| Endpoint | Method | Purpose | LLM? | Caller | File |
|----------|--------|---------|------|--------|------|
| `/assist/v1/elicit-belief` | POST | Convert NL to probability | ❌ | PLoT | [assist.v1.elicit-belief.ts](../src/routes/assist.v1.elicit-belief.ts) |
| `/assist/v1/elicit/preferences` | POST | Select preference questions | ❌ | PLoT | [assist.v1.elicit-preferences.ts](../src/routes/assist.v1.elicit-preferences.ts) |
| `/assist/v1/elicit-preferences/answer` | POST | Process preference answers | ❌ | PLoT | [assist.v1.elicit-preferences-answer.ts](../src/routes/assist.v1.elicit-preferences-answer.ts) |
| `/assist/v1/elicit-risk-tolerance` | POST | Assess risk tolerance | ❌ | PLoT | [assist.v1.elicit-risk-tolerance.ts](../src/routes/assist.v1.elicit-risk-tolerance.ts) |
| `/assist/v1/explain/tradeoff` | POST | Explain option trade-offs | ❌ | PLoT | [assist.v1.explain-tradeoff.ts](../src/routes/assist.v1.explain-tradeoff.ts) |

### 1.5 Narrative Generation Endpoints (Template-Based)

| Endpoint | Method | Purpose | LLM? | Caller | File |
|----------|--------|---------|------|--------|------|
| `/assist/v1/generate-recommendation` | POST | Generate recommendation narrative | ❌ | PLoT | [assist.v1.generate-recommendation.ts](../src/routes/assist.v1.generate-recommendation.ts) |
| `/assist/v1/explain-policy` | POST | Explain sequential policy logic | ❌ | PLoT | [assist.v1.explain-policy.ts](../src/routes/assist.v1.explain-policy.ts) |
| `/assist/v1/narrate-conditions` | POST | Generate conditional narratives | ❌ | PLoT | [assist.v1.narrate-conditions.ts](../src/routes/assist.v1.narrate-conditions.ts) |

### 1.6 Health & Admin

| Endpoint | Method | Purpose | LLM? | Caller | File |
|----------|--------|---------|------|--------|------|
| `/assist/v1/health` | GET | Health check | ❌ | Infra | [assist.v1.health.ts](../src/routes/assist.v1.health.ts) |

---

## 2. Prompt Inventory

### 2.1 Registered Prompt Tasks

From [prompt-tasks.ts](../src/constants/prompt-tasks.ts):

| Task ID | Display Label | Default Model | Quality Required? |
|---------|--------------|---------------|-------------------|
| `draft_graph` | Draft Graph | gpt-5.2 | ✅ Yes |
| `suggest_options` | Suggest Options | gpt-5.2 | ❌ No |
| `repair_graph` | Repair Graph | gpt-5.2 | ❌ No |
| `clarify_brief` | Clarify Brief | gpt-5-mini | ❌ No |
| `critique_graph` | Critique Graph | gpt-5.2 | ❌ No |
| `bias_check` | Bias Check | gpt-5.2 | ✅ Yes |
| `evidence_helper` | Evidence Helper | gpt-5-mini | ❌ No |
| `sensitivity_coach` | Sensitivity Coach | gpt-5-mini | ❌ No |
| `explainer` | Explainer | gpt-5-mini | ❌ No |
| `preflight` | Preflight | gpt-5-mini | ❌ No |

### 2.2 Model Routing Tiers

From [model-routing.ts](../src/config/model-routing.ts):

**Fast Tier (gpt-5-mini):** Speed-sensitive tasks
- clarification, preflight, explainer, evidence_helper, sensitivity_coach

**Premium Tier (gpt-5.2):** Advanced reasoning
- options, draft_graph, repair_graph, bias_check, critique_graph

### 2.3 Task vs Endpoint Mapping

| Prompt Task | Endpoint(s) |
|-------------|-------------|
| `draft_graph` | `/assist/v1/draft-graph`, `/draft-graph/stream` |
| `repair_graph` | Internal repair loop (not exposed) |
| `clarify_brief` | Clarification flow in draft pipeline |
| `critique_graph` | `/assist/v1/bias-check` (uses critique) |
| `bias_check` | `/assist/v1/bias-check` |
| `sensitivity_coach` | `/assist/v1/sensitivity-coach` |
| `evidence_helper` | `/assist/v1/evidence-helper` |
| `explainer` | `/assist/v1/explain-graph` |
| `preflight` | Internal preflight validation |

---

## 3. Orchestration Flows

### 3.1 Draft Graph Pipeline

```
Brief Input
    │
    ├─► Clarification (optional, up to 3 rounds)
    │       └─► clarify_brief prompt → user answers
    │
    ├─► Document Grounding (if attachments)
    │       └─► processAttachments() → DocPreview[]
    │
    ├─► LLM Draft Generation
    │       └─► draft_graph prompt → raw JSON
    │
    ├─► Response Normalisation
    │       └─► normaliseDraftResponse() → GraphT
    │
    ├─► Structure Validation
    │       └─► checkMinimumStructure() → goal/decision/option check
    │       └─► validateAndFixGraph() → goal repair, edge repair
    │
    ├─► DAG Enforcement
    │       └─► ensureDagAndPrune() → cycle removal
    │       └─► stabiliseGraph() → node/edge caps (50/200)
    │
    ├─► Risk Coefficient Normalisation
    │       └─► normaliseRiskCoefficients() → risk→goal = negative
    │
    ├─► Factor Enrichment (async)
    │       └─► enrichGraphWithFactorsAsync()
    │
    └─► Response Construction
            └─► finaliseCeeDraftResponse() → CEEDraftGraphResponseV1
```

**Key Files:**
- [pipeline.ts](../src/cee/validation/pipeline.ts) - Main orchestration
- [assist.draft-graph.ts](../src/routes/assist.draft-graph.ts) - runDraftGraphPipeline
- [normalisation.ts](../src/adapters/llm/normalisation.ts) - Response normalization

### 3.2 Review Flow (Post-Inference)

```
PLoT calls ISL Engine
    │
    ├─► ISL returns inference + robustness results
    │
    └─► PLoT calls /assist/v1/review
            │
            ├─► Validate input (graph + inference)
            │
            ├─► Build Blocks
            │       ├─► buildAllBlocks()
            │       ├─► buildReadinessBlock()
            │       └─► aggregateInsights()
            │
            ├─► Compute Quality
            │       └─► computeDecisionQuality()
            │
            ├─► Generate Guidance
            │       └─► generateImprovementGuidance()
            │
            └─► Return ReviewResponseT
```

**Key Files:**
- [assist.v1.review.ts](../src/routes/assist.v1.review.ts)
- [review/index.ts](../src/services/review/index.js)

### 3.3 Bias Check Flow

```
Graph Input
    │
    ├─► Validate Graph (Zod schema)
    │
    ├─► Detect Biases
    │       └─► detectBiases() → BiasFindings[]
    │
    ├─► Sort & Cap Findings
    │       └─► sortBiasFindings() → top N
    │
    ├─► Compute Quality
    │       └─► computeQuality()
    │
    └─► Return CEEBiasCheckResponseV1
```

---

## 4. Pre vs Post-Inference Analysis

### 4.1 Pre-Inference Endpoints

These endpoints work **before** ISL inference runs. They receive a **graph** but no inference results.

| Endpoint | Input | Purpose |
|----------|-------|---------|
| `/assist/v1/draft-graph` | brief, docs | Generate graph |
| `/assist/v1/options` | graph, archetype | Generate options |
| `/assist/v1/graph-readiness` | graph | Assess if ready for inference |
| `/assist/v1/bias-check` | graph | Detect cognitive biases |
| `/assist/v1/key-insight` | graph | Extract key insights |
| `/assist/v1/evidence-helper` | evidence[] | Score evidence quality |
| `/assist/v1/suggest-edge-function` | edge context | Suggest function type |
| `/assist/v1/elicit-belief` | NL expression | Convert to probability |
| `/assist/v1/elicit/preferences` | options, goals | Select questions |

### 4.2 Post-Inference Endpoints

These endpoints work **after** ISL inference runs. They receive **graph + inference results**.

| Endpoint | Input | Purpose |
|----------|-------|---------|
| `/assist/v1/review` | graph + inference + robustness | Comprehensive review |
| `/assist/v1/enhanced-decision-review` | graph + inference | Enhanced review |
| `/assist/v1/sensitivity-coach` | graph + inference.explain.top_drivers | Sensitivity guidance |
| `/assist/v1/explain-graph` | graph + inference | Explain results |
| `/assist/v1/isl-synthesis` | sensitivity, voi, tipping_points | Narratives |

### 4.3 Inference-Independent Endpoints

These endpoints don't need the graph or inference - they're pure utility endpoints.

| Endpoint | Purpose |
|----------|---------|
| `/assist/v1/generate-recommendation` | Narrative from ranked_actions |
| `/assist/v1/explain-policy` | Narrative from policy_steps |
| `/assist/v1/narrate-conditions` | Conditional narrative |
| `/assist/v1/explain/tradeoff` | Trade-off explanation |

---

## 5. Current Issues & Recommendations

### 5.1 Rate Limiting Pattern Duplication

**Issue:** Each endpoint implements its own in-memory rate limiting with identical bucket logic.

**Files Affected:**
- All `assist.v1.*.ts` files (copy-pasted ~50 lines each)

**Evidence:**
```typescript
// Repeated in 20+ files:
const WINDOW_MS = 60_000;
const MAX_BUCKETS = 10_000;
const MAX_BUCKET_AGE_MS = WINDOW_MS * 10;
const ceeXxxBuckets = new Map<string, BucketState>();
function pruneBuckets(...) { ... }
function checkCeeXxxLimit(...) { ... }
```

**Recommendation:** Already partially addressed with `getCeeFeatureRateLimiter()` in some endpoints. Migrate all endpoints to use shared rate limiter.

---

### 5.2 Missing Endpoints in PROMPT_TASKS Registry

**Issue:** Some CEE tasks have endpoints but aren't registered in `PROMPT_TASKS`.

**Missing:**
- `ask` - Conversational endpoint
- `review` - Decision review
- `isl_synthesis` - ISL narrative generation
- `elicit_belief` - Belief elicitation
- `elicit_preferences` - Preference elicitation

**Impact:** Admin UI dropdown won't show these tasks for prompt testing.

**Recommendation:** Add missing tasks to [prompt-tasks.ts](../src/constants/prompt-tasks.ts) or clarify that PROMPT_TASKS is only for LLM-powered prompts.

---

### 5.3 Inconsistent Error Response Schemas

**Issue:** Endpoints use different error response builders.

| Pattern | Used By |
|---------|---------|
| `buildCeeErrorResponse()` | Most CEE endpoints |
| `buildAskErrorResponse()` | `/assist/v1/ask` |
| `buildReviewErrorResponse()` | `/assist/v1/review` |
| Direct object construction | Some endpoints |

**Recommendation:** Standardize on single `buildCeeErrorResponse()` for consistency.

---

### 5.4 Template-Based Endpoints Declare "quality: 80"

**Issue:** Several template-based endpoints hardcode quality scores.

**Evidence:**
```typescript
// In multiple files:
quality: {
  overall: 80, // Template-based, consistent quality
  structure: 90,
  coverage: 80,
}
```

**Files:**
- [assist.v1.isl-synthesis.ts:131](../src/routes/assist.v1.isl-synthesis.ts#L131)
- [assist.v1.generate-recommendation.ts:136](../src/routes/assist.v1.generate-recommendation.ts#L136)
- [assist.v1.explain-policy.ts:133](../src/routes/assist.v1.explain-policy.ts#L133)
- [assist.v1.narrate-conditions.ts:131](../src/routes/assist.v1.narrate-conditions.ts#L131)

**Recommendation:** Consider computing quality based on input completeness rather than hardcoding.

---

### 5.5 Verification Pipeline Not Applied Uniformly

**Issue:** Only some endpoints use `verificationPipeline.verify()`.

**Uses Verification:**
- `/assist/v1/options`
- `/assist/v1/team-perspectives`
- `/assist/v1/sensitivity-coach`
- `/assist/v1/evidence-helper`
- `/assist/v1/explain-graph`

**Skips Verification:**
- `/assist/v1/elicit-belief` (manual safeParse only)
- `/assist/v1/elicit/preferences` (manual safeParse only)
- `/assist/v1/explain/tradeoff` (manual safeParse only)
- All template-based narrative endpoints

**Recommendation:** Consider whether verification is needed for elicitation endpoints.

---

### 5.6 LLM Task to Model Mismatch

**Issue:** `CeeTask` type in model-routing.ts includes `clarification` but PROMPT_TASKS has `clarify_brief`.

**Evidence:**
```typescript
// model-routing.ts
export type CeeTask =
  | "clarification"  // ← Different name
  // ...

// prompt-tasks.ts
export const PROMPT_TASKS = [
  'clarify_brief',  // ← Different name
  // ...
]
```

**Recommendation:** Align naming between `CeeTask` and `PromptTask` types.

---

## 6. Summary Statistics

| Metric | Count |
|--------|-------|
| Total `/assist/v1/*` endpoints | 26 |
| LLM-powered endpoints | 2 (draft-graph, ask) |
| Pre-inference endpoints | 9 |
| Post-inference endpoints | 5 |
| Template-based narrative endpoints | 3 |
| Preference elicitation endpoints | 5 |
| Registered PROMPT_TASKS | 10 |
| Unique rate limiter implementations | ~20 (should be 1) |

---

## 7. Appendix: Endpoint-to-File Quick Reference

```
/assist/v1/ask                      → src/routes/assist.v1.ask.ts
/assist/v1/bias-check               → src/routes/assist.v1.bias-check.ts
/assist/v1/draft-graph              → src/routes/assist.v1.draft-graph.ts
/assist/v1/draft-graph/stream       → src/routes/assist.v1.draft-graph-stream.ts
/assist/v1/elicit-belief            → src/routes/assist.v1.elicit-belief.ts
/assist/v1/elicit/preferences       → src/routes/assist.v1.elicit-preferences.ts
/assist/v1/elicit-preferences/answer→ src/routes/assist.v1.elicit-preferences-answer.ts
/assist/v1/elicit-risk-tolerance    → src/routes/assist.v1.elicit-risk-tolerance.ts
/assist/v1/enhanced-decision-review → src/routes/assist.v1.enhanced-decision-review.ts
/assist/v1/evidence-helper          → src/routes/assist.v1.evidence-helper.ts
/assist/v1/explain-graph            → src/routes/assist.v1.explain-graph.ts
/assist/v1/explain-policy           → src/routes/assist.v1.explain-policy.ts
/assist/v1/explain/tradeoff         → src/routes/assist.v1.explain-tradeoff.ts
/assist/v1/generate-recommendation  → src/routes/assist.v1.generate-recommendation.ts
/assist/v1/graph-readiness          → src/routes/assist.v1.graph-readiness.ts
/assist/v1/health                   → src/routes/assist.v1.health.ts
/assist/v1/isl-synthesis            → src/routes/assist.v1.isl-synthesis.ts
/assist/v1/key-insight              → src/routes/assist.v1.key-insight.ts
/assist/v1/narrate-conditions       → src/routes/assist.v1.narrate-conditions.ts
/assist/v1/options                  → src/routes/assist.v1.options.ts
/assist/v1/review                   → src/routes/assist.v1.review.ts
/assist/v1/sensitivity-coach        → src/routes/assist.v1.sensitivity-coach.ts
/assist/v1/suggest-edge-function    → src/routes/assist.v1.suggest-edge-function.ts
/assist/v1/suggest-utility-weights  → src/routes/assist.v1.suggest-utility-weights.ts
/assist/v1/team-perspectives        → src/routes/assist.v1.team-perspectives.ts
```
