# CEE Comprehensive Codebase Review

**Date:** 2026-03-15
**Branch:** staging
**Repo:** olumi-assistants-service
**Type:** Investigation only — no code changes made

---

## Table of Contents

1. [Request Entry Points](#section-1-request-entry-points)
2. [Unified Pipeline — Stage-by-Stage Trace](#section-2-unified-pipeline--stage-by-stage-trace)
3. [Orchestrator Pipeline Trace](#section-3-orchestrator-pipeline-trace)
4. [Feature Flag Audit](#section-4-feature-flag-audit)
5. [LLM Call Inventory](#section-5-llm-call-inventory)
6. [Prompt Management](#section-6-prompt-management)
7. [Data Flow to External Services](#section-7-data-flow-to-external-services)
8. [Security Review](#section-8-security-review)
9. [Test Coverage Assessment](#section-9-test-coverage-assessment)
10. [Dead Code and Technical Debt](#section-10-dead-code-and-technical-debt)
11. [Risks, Issues, and Opportunities](#section-11-risks-issues-and-opportunities)

---

## Section 1: Request Entry Points

### 1.1 Authentication Modes

The service implements a layered authentication system defined in `src/plugins/auth.ts`. Three authentication modes exist:

1. **API Key** (`X-Olumi-Assist-Key` header or `Authorization: Bearer <key>`) -- validated against `ASSIST_API_KEY` / `ASSIST_API_KEYS` (`src/plugins/auth.ts:64-79`)
2. **HMAC-SHA256 Signature** (`X-Olumi-Signature` header) -- uses `HMAC_SECRET` with timestamp + nonce replay protection (`src/utils/hmac-auth.ts:103-185`)
3. **Admin Key** (`X-Admin-Key` header) -- separate admin auth middleware with read/write permission levels and optional IP allowlist (`src/middleware/admin-auth.ts:99-171`)

Public routes (no auth required) are defined at `src/plugins/auth.ts:44-59`:
- `/healthz`, `/health`, `/`, `/v1/status`
- `/admin` and `/admin/*` (admin UI has its own auth via X-Admin-Key)
- `GET /assist/share/*` and `DELETE /assist/share/*` (token-based auth)

### 1.2 Route Table

| Route | Method | Auth | Handler file:line | Purpose | Called by |
|---|---|---|---|---|---|
| `/healthz` | GET | Public | `src/server.ts:528` | Comprehensive health check with provider, ISL, prompt store status | Infra/UI |
| `/health` | GET | Public | (alias, matched by public route list) | Health check alias | Infra |
| `/v1/status` | GET | Public | `src/routes/v1.status.ts:118` | Detailed runtime diagnostics, metrics, uptime | UI/Monitoring |
| `/v1/limits` | GET | API Key | `src/routes/v1.limits.ts:34` | Per-key quota usage and rate limit status | UI |
| `/diagnostics` | GET | API Key + allowlist | `src/server.ts:735` | Detailed diagnostics (gated by `CEE_DIAGNOSTICS_ENABLED` + `CEE_DIAGNOSTICS_KEY_IDS`) | Internal |
| `/assist/draft-graph` | POST | API Key/HMAC | `src/routes/assist.draft-graph.ts:2701` | Legacy draft graph endpoint | UI (legacy) |
| `/assist/draft-graph/stream` | POST | API Key/HMAC | `src/routes/assist.draft-graph.ts:2341` | Legacy SSE streaming draft | UI (legacy) |
| `/assist/draft-graph/resume` | POST | API Key/HMAC | `src/routes/assist.draft-graph.ts:2396` | Resume interrupted SSE stream | UI (legacy) |
| `/assist/suggest-options` | POST | API Key/HMAC | `src/routes/assist.suggest-options.ts:26` | Suggest decision options | UI (legacy) |
| `/assist/clarify-brief` | POST | API Key/HMAC | `src/routes/assist.clarify-brief.ts:18` | Clarify a brief | UI (legacy) |
| `/assist/critique-graph` | POST | API Key/HMAC | `src/routes/assist.critique-graph.ts:29` | Critique a graph | UI (legacy) |
| `/assist/explain-diff` | POST | API Key/HMAC | `src/routes/assist.explain-diff.ts:16` | Explain graph diff | UI (legacy) |
| `/assist/evidence-pack` | POST | API Key/HMAC | `src/routes/assist.evidence-pack.ts:40` | Generate evidence pack | UI (legacy) |
| `/assist/share` | POST | API Key/HMAC | `src/routes/assist.share.ts:65` | Create shared graph link | UI |
| `/assist/share/*` | GET | Public (token-based) | `src/routes/assist.share.ts:203` | Retrieve shared graph | Public |
| `/assist/share/*` | DELETE | Public (token-based) | `src/routes/assist.share.ts:265` | Revoke shared graph | UI |
| `/assist/v1/draft-graph` | POST | API Key/HMAC | `src/routes/assist.v1.draft-graph.ts:174` | V1 draft graph (primary CEE pipeline) | PLoT/UI |
| `/assist/v1/draft-graph/stream` | POST | API Key/HMAC | `src/routes/assist.v1.draft-graph-stream.ts:137` | V1 SSE streaming draft | PLoT/UI |
| `/assist/v1/options` | POST | API Key/HMAC | `src/routes/assist.v1.options.ts:84` | V1 suggest options | PLoT/UI |
| `/assist/v1/bias-check` | POST | API Key/HMAC | `src/routes/assist.v1.bias-check.ts:86` | V1 bias check | PLoT/UI |
| `/assist/v1/explain-graph` | POST | API Key/HMAC | `src/routes/assist.v1.explain-graph.ts:82` | V1 explain graph | PLoT/UI |
| `/assist/v1/evidence-helper` | POST | API Key/HMAC | `src/routes/assist.v1.evidence-helper.ts:86` | V1 evidence helper | PLoT/UI |
| `/assist/v1/sensitivity-coach` | POST | API Key/HMAC | `src/routes/assist.v1.sensitivity-coach.ts:86` | V1 sensitivity coaching | PLoT/UI |
| `/assist/v1/team-perspectives` | POST | API Key/HMAC | `src/routes/assist.v1.team-perspectives.ts:85` | V1 team perspectives | PLoT/UI |
| `/assist/v1/graph-readiness` | POST | API Key/HMAC | `src/routes/assist.v1.graph-readiness.ts:308` | V1 graph readiness assessment | PLoT/UI |
| `/assist/v1/key-insight` | POST | API Key/HMAC | `src/routes/assist.v1.key-insight.ts:80` | V1 key insight extraction | PLoT/UI |
| `/assist/v1/elicit-belief` | POST | API Key/HMAC | `src/routes/assist.v1.elicit-belief.ts:78` | V1 belief elicitation | PLoT/UI |
| `/assist/v1/suggest-utility-weights` | POST | API Key/HMAC | `src/routes/assist.v1.suggest-utility-weights.ts:79` | V1 suggest utility weights | PLoT/UI |
| `/assist/v1/elicit-risk-tolerance` | POST | API Key/HMAC | `src/routes/assist.v1.elicit-risk-tolerance.ts:80` | V1 risk tolerance elicitation | PLoT/UI |
| `/assist/v1/suggest-edge-function` | POST | API Key/HMAC | `src/routes/assist.v1.suggest-edge-function.ts:92` | V1 suggest edge function | PLoT/UI |
| `/assist/v1/generate-recommendation` | POST | API Key/HMAC | `src/routes/assist.v1.generate-recommendation.ts:27` | V1 generate recommendation | PLoT/UI |
| `/assist/v1/narrate-conditions` | POST | API Key/HMAC | `src/routes/assist.v1.narrate-conditions.ts:27` | V1 narrate conditions | PLoT/UI |
| `/assist/v1/explain-policy` | POST | API Key/HMAC | `src/routes/assist.v1.explain-policy.ts:27` | V1 explain policy | PLoT/UI |
| `/assist/v1/elicit/preferences` | POST | API Key/HMAC | `src/routes/assist.v1.elicit-preferences.ts:85` | V1 preference elicitation | PLoT/UI |
| `/assist/v1/elicit/preferences/answer` | POST | API Key/HMAC | `src/routes/assist.v1.elicit-preferences-answer.ts:105` | V1 preference answer integration | PLoT/UI |
| `/assist/v1/explain/tradeoff` | POST | API Key/HMAC | `src/routes/assist.v1.explain-tradeoff.ts:78` | V1 tradeoff explanation | PLoT/UI |
| `/assist/v1/isl-synthesis` | POST | API Key/HMAC | `src/routes/assist.v1.isl-synthesis.ts:28` | V1 ISL synthesis | PLoT/UI |
| `/assist/v1/health` | GET | API Key/HMAC | `src/routes/assist.v1.health.ts:12` | V1 CEE health check | PLoT/UI |
| `/assist/v1/ask` | POST | API Key/HMAC | `src/routes/assist.v1.ask.ts:182` | V1 ask (general Q&A on graph) | PLoT/UI |
| `/assist/v1/review` | POST | API Key/HMAC | `src/routes/assist.v1.review.ts:135` | V1 review endpoint | PLoT/UI |
| `/assist/v1/decision-review` | POST | API Key/HMAC | `src/routes/assist.v1.decision-review.ts:274` | V1 decision review | PLoT/UI |
| `/assist/v1/decision-review/example` | GET | API Key/HMAC | `src/routes/assist.v1.decision-review-example.ts:6` | Decision review example (gated: `CEE_DECISION_REVIEW_EXAMPLE_ENABLED`) | Internal |
| `/assist/v1/edit-graph` | POST | API Key/HMAC | `src/routes/assist.v1.edit-graph.ts:39` | V1 edit graph (orchestrator-gated) | PLoT/UI |
| `/orchestrate/v1/turn` | POST | API Key/HMAC + orchestrator rate limit | `src/orchestrator/route.ts:85` | Conversational orchestrator turn (gated: `CEE_ORCHESTRATOR_ENABLED`) | UI |
| `/v1/prompts/warm` | POST | Public | `src/routes/v1.prompts.ts:52` | Warm prompt cache from Supabase | UI |
| `/v1/prompts/status` | GET | Public | `src/routes/v1.prompts.ts:161` | Prompt cache status | UI/Monitoring |
| `/admin` | GET | IP allowlist | `src/routes/admin.ui.ts:3814` | Admin UI HTML page | Admin |
| `/admin/dashboard` | GET | IP allowlist | `src/routes/admin.ui.ts:3834` | Admin dashboard HTML page | Admin |
| `/admin/dashboard/env` | GET | Admin Key (read) | `src/routes/admin.ui.ts:3854` | Dashboard environment info | Admin |
| `/admin/prompts/*` | CRUD | Admin Key (read/write) | `src/routes/admin.prompts.ts:273+` | Prompt CRUD, versioning, rollback, approval, experiments | Admin |
| `/admin/v1/test-prompt-llm` | POST | Admin Key | `src/routes/admin.testing.ts:907` | Test prompt against LLM | Admin |
| `/admin/v1/test-prompt-llm/models` | GET | Admin Key (read) | `src/routes/admin.testing.ts:1274` | List available test models | Admin |
| `/admin/v1/available-models/:provider` | GET | Admin Key (read) | `src/routes/admin.testing.ts:1414` | Available models per provider | Admin |
| `/admin/v1/model-errors` | GET | Admin Key (read) | `src/routes/admin.testing.ts:1451` | Recent model error diagnostics | Admin |
| `/admin/models/routing` | GET | Admin Key (read) | `src/routes/admin.models.ts:129` | Model routing configuration | Admin |
| `/admin/v1/draft-failures` | GET | Admin Key (read) | `src/routes/admin.v1.draft-failures.ts:32` | List draft failures | Admin |
| `/admin/v1/draft-failures/:id` | GET | Admin Key (read) | `src/routes/admin.v1.draft-failures.ts:75` | Get specific draft failure detail | Admin |
| `/admin/v1/llm-output/:request_id` | GET | Admin Key (read) | `src/routes/admin.v1.llm-output.ts:34` | Raw LLM output by request ID | Admin |
| `/admin/v1/llm-output-stats` | GET | Admin Key (read) | `src/routes/admin.v1.llm-output.ts:71` | LLM output statistics | Admin |

### 1.3 Feature-Gated Routes

- `/orchestrate/v1/turn` and `/assist/v1/edit-graph`: Only registered when `config.features.orchestrator === true` (`src/server.ts:825-829`)
- `/assist/v1/decision-review/example`: Only registered when `CEE_DECISION_REVIEW_EXAMPLE_ENABLED === "true"` (`src/server.ts:820-822`)
- All `/admin/*` routes: Only registered when prompt system is enabled AND `ADMIN_ROUTES_ENABLED !== false` (`src/server.ts:872-882`)
- `/diagnostics`: Only registered when `CEE_DIAGNOSTICS_ENABLED === "true"` (`src/server.ts:724`)

### 1.4 Notable Observations

- **Public routes expose significant detail**: `/healthz` returns provider name, model, feature flags, auth configuration, ISL status, prompt store metadata, and cache warming diagnostics (`src/server.ts:528-722`). This is more information than typical health endpoints expose and could aid reconnaissance.
- **`/v1/status` is unauthenticated**: Returns performance metrics, request counts, error counts, storage stats, and model configuration (`src/routes/v1.status.ts:118`).
- **`/v1/prompts/warm` and `/v1/prompts/status` are public**: Registered unconditionally (`src/server.ts:833`). While not sensitive, the warm endpoint triggers Supabase queries.
- **Legacy routes co-exist with V1 routes**: The `/assist/draft-graph`, `/assist/suggest-options`, etc. routes remain active alongside their `/assist/v1/*` counterparts. No deprecation enforcement is in place beyond a 426 response for SSE on the legacy path when `ENABLE_LEGACY_SSE` is disabled.

---

## Section 2: Unified Pipeline — Stage-by-Stage Trace

### 2.1 Entry Point

A `POST /assist/v1/draft-graph` request enters through the route handler at `src/routes/assist.v1.draft-graph.ts:174`. When `config.cee.unifiedPipelineEnabled` is true (line 494), the handler delegates to `runUnifiedPipeline()` after:

1. **Zod validation** of `DraftGraphInput` (line 233)
2. **Input sanitization** via `sanitizeDraftGraphInput()` (line 265)
3. **Preflight evaluation** if `config.cee.preflightEnabled` (line 286) — can reject (400), clarify (200), or proceed
4. **Clarification enforcement** if `config.cee.clarificationEnforced` (line 412) — can require rounds before allowing draft
5. **BriefSignals injection** into `baseInput` (lines 484-491)
6. **Schema version + strict mode** parsing from query params (lines 495-496)
7. **Client disconnect detection** via socket close listener (lines 502-508)
8. **Raw output gating** — only allowed in non-production or with admin auth (lines 511-515)

The pipeline is invoked at line 518 with opts including `schemaVersion`, `strictMode`, `includeDebug`, `rawOutput`, `refreshPrompts`, `forceDefault`, `signal`, and `requestStartMs`.

### 2.2 Pipeline Orchestration

`src/cee/unified-pipeline/index.ts:308` — `runUnifiedPipeline()` creates a `StageContext` via `buildInitialContext()` (line 37) which initializes all mutable fields to empty/undefined defaults:

- `graph: undefined`, `rationales: []`, `draftCost: 0`, `confidence: undefined`
- `strpResult: undefined`, `riskCoefficientCorrections: []`, `transforms: []`
- `nodeRenames: new Map()`, `collector: createCorrectionCollector()`
- `checkpointsEnabled` from `config.cee.pipelineCheckpointsEnabled` (line 100)

Stage execution order: Parse (1) → Normalise (2) → Enrich (3) → Repair (4) → ThresholdSweep (4b) → Package (5) → Boundary (6).

After each stage a `captureStageSnapshot()` records goal node state for forensic tracking (line 108). After Stage 3, a `capturePlanAnnotation()` creates a deterministic hash of the graph state (line 141).

### 2.3 Stage-by-Stage Table

| # | Stage name | File:function | What it reads | What it mutates | LLM calls | Feature flags that affect it | Can it fail silently? |
|---|-----------|---------------|--------------|----------------|-----------|----------------------------|-----------------------|
| 1 | Parse | `stages/parse.ts:49` `runStageParse()` | `ctx.input` (brief, flags, previous_graph), raw body, adapter config | `ctx.graph`, `ctx.rationales`, `ctx.llmMeta`, `ctx.confidence`, `ctx.clarifierStatus`, `ctx.effectiveBrief`, `ctx.edgeFieldStash`, `ctx.draftCost`, `ctx.draftDurationMs`, `ctx.skipRepairDueToBudget`, `ctx.repairTimeoutMs`, `ctx.coaching`, `ctx.causalClaims` | 1 (draft_graph, up to 2 attempts) | `config.cee.refinementEnabled` (step 3), prompt store model config, `shouldUseStagingPrompts()` | No — sets `ctx.earlyReturn` on failure |
| 2 | Normalise | `stages/normalise.ts:20` `runStageNormalise()` | `ctx.graph` (nodes, edges) | `ctx.graph` (STRP mutations, risk coefficient flips), `ctx.strpResult`, `ctx.riskCoefficientCorrections` | 0 | None | Edge count invariant violation logged at error but **does not fail** (line 72-86) |
| 3 | Enrich | `stages/enrich.ts:27` `runStageEnrich()` | `ctx.graph`, `ctx.effectiveBrief`, `ctx.collector` | `ctx.graph` (enriched + stabilised + repaired + re-stabilised), `ctx.enrichmentResult`, `ctx.hadCycles`, `ctx.enrichmentTrace` | 1 (`enrichGraphWithFactorsAsync`) | `ctx.input.enrichment_model` override | Post-enrich invariant (controllable factors without value) **logs warning but continues** (line 63-76) |
| 4 | Repair | `stages/repair/index.ts:55` `runStageRepair()` | `ctx.graph`, `ctx.edgeFieldStash`, `ctx.collector`, config flags | `ctx.graph` (10 substeps), `ctx.nodeRenames`, `ctx.goalConstraints`, `ctx.constraintStrpResult`, `ctx.repairCost`, `ctx.clarifierResult`, `ctx.structuralMeta`, `ctx.validationSummary`, `ctx.deterministicRepairs`, `ctx.remainingViolations`, `ctx.llmRepairNeeded`, `ctx.repairTrace` | 0-2 (orchestrator validation + PLoT validation, both gated) | `config.cee.orchestratorValidationEnabled`, `config.cee.clarifierEnabled`, `ctx.skipRepairDueToBudget` | Several substeps silently continue on failure (e.g., connectivity always runs) |
| 4b | Threshold Sweep | `stages/threshold-sweep.ts:46` `runStageThresholdSweep()` | `ctx.graph` (goal nodes) | Goal node fields (`goal_threshold`, `goal_threshold_raw`, `goal_threshold_unit`, `goal_threshold_cap`), `ctx.deterministicRepairs`, `ctx.thresholdSweepTrace`, `ctx.repairTrace.deterministic_sweep` | 0 | None | **Yes** — entire stage is try/catch wrapped in `index.ts:378-387`; failure logs warning and continues |
| 5 | Package | `stages/package.ts:60` `runStagePackage()` | `ctx.graph` (read-only, snapshot enforced), `ctx.strpResult`, `ctx.constraintStrpResult`, quality/archetype config | `ctx.quality`, `ctx.archetype`, `ctx.draftWarnings`, `ctx.ceeResponse`, `ctx.pipelineTrace`, `ctx.coaching` (status_quo injection), `ctx.contextPack` | 0 | `config.cee.draftArchetypesEnabled`, `config.cee.draftStructuralWarningsEnabled`, `config.cee.pipelineCheckpointsEnabled` | Graph frozen invariant throws in non-production if graph mutated (line 647). Verification pipeline failure sets `ctx.earlyReturn` |
| 6 | Boundary | `stages/boundary.ts:22` `runStageBoundary()` | `ctx.ceeResponse`, `ctx.deterministicRepairs`, `ctx.repairTrace`, config flags | `ctx.finalResponse` | 0 | `ctx.opts.schemaVersion`, `ctx.opts.strictMode`, `config.cee.boundaryAllowInvalid` | V3 validation failure returns blocked response (not silent — explicit 200 with `status:"blocked"`) |

### 2.4 Default Value Injection Points

**Stage 1 (Parse):**

- `ctx.confidence` = `calcConfidence({ goal: brief })` — `src/cee/unified-pipeline/stages/parse.ts:69`. A numeric score derived from brief length; no explicit default but always a number.
- `seed: 17` hardcoded in the LLM call at `parse.ts:158`.

**Stage 2 (Normalise):**

- **Risk coefficient sign flip**: `src/cee/transforms/risk-normalisation.ts:37` — if a risk→goal or risk→outcome edge has `strength_mean > 0`, it is negated to `-Math.abs(original)`. This is logged (normalise.ts:56-59) but the original positive value is silently replaced.

**Stage 4 — Deterministic Sweep (`repair/deterministic-sweep.ts`):**

| Field | Default Value | Trigger Condition | File:Line |
|-------|--------------|-------------------|-----------|
| `edge.strength_mean` | `0.5` | NaN or non-finite value | `deterministic-sweep.ts:97` |
| `edge.strength_std` | `0.1` (NAN_FIX_SIGNATURE_STD) | NaN or non-finite value | `deterministic-sweep.ts:102` |
| `edge.belief_exists` | `0.8` | NaN or non-finite value | `deterministic-sweep.ts:108` |
| `factor.data.value` | `0.5` | NaN or non-finite factor data.value | `deterministic-sweep.ts:119` |
| `factor.category` | `"controllable"` or `"external"` | CATEGORY_MISMATCH — inferred from edge topology | `deterministic-sweep.ts:324-327` |
| `controllable.data.value` | `0.5` | CONTROLLABLE_MISSING_DATA | `deterministic-sweep.ts:357` |
| `controllable.data.extractionType` | `"inferred"` | CONTROLLABLE_MISSING_DATA | `deterministic-sweep.ts:362` |
| `controllable.data.factor_type` | `"other"` | CONTROLLABLE_MISSING_DATA | `deterministic-sweep.ts:366` |
| `controllable.data.uncertainty_drivers` | `["Not provided"]` | CONTROLLABLE_MISSING_DATA | `deterministic-sweep.ts:370` |
| `observable.observed_state.value` | `0.5` | OBSERVABLE_MISSING_DATA | `deterministic-sweep.ts:403-406` |
| `observable.data.extractionType` | `"observed"` | OBSERVABLE_MISSING_DATA (only if data.value present) | `deterministic-sweep.ts:415` |
| Structural edge (option→factor) | `mean=1, std=0.01, existence=1.0` | STRUCTURAL_EDGE_NOT_CANONICAL_ERROR | `deterministic-sweep.ts:195-199` |
| Synthetic outcome node | `kind="outcome"`, `label="${factorLabel} Impact"` | factor→goal edge detected | `deterministic-sweep.ts:655-661` |
| Synthetic factor→outcome edge | `mean=origMean, std=origStd, exist=origExist` | factor→goal edge split | `deterministic-sweep.ts:668-672` |
| Synthetic outcome→goal edge | `mean=0.5, std=0.15, existence=0.9` | factor→goal edge split | `deterministic-sweep.ts:675-679` |

**Stage 4b (Threshold Sweep):**

- **goal_threshold stripping**: Four fields (`goal_threshold`, `goal_threshold_raw`, `goal_threshold_unit`, `goal_threshold_cap`) are atomically deleted from goal nodes when `goal_threshold_raw` is absent (threshold-sweep.ts:69-81) or when `goal_threshold_raw` is a round number and the label has no digits (threshold-sweep.ts:91-111).

**Stage 6 (Boundary) — V3 Transform (`src/cee/transforms/schema-v3.ts`):**

| Field | Default Value | Trigger Condition | File:Line |
|-------|--------------|-------------------|-----------|
| `strength_mean` | `DEFAULT_STRENGTH_MEAN` (from `@talchain/schemas`) | LLM omitted both `strength_mean` and `weight` | `schema-v3.ts:319-322` |
| `exists_probability` (structural) | `1.0` | LLM omitted `belief_exists` and `belief` on structural edge | `schema-v3.ts:332-337` |
| `exists_probability` (causal) | `0.8` | LLM omitted `belief_exists` and `belief` on causal edge | `schema-v3.ts:332-337` |
| `strength_std` | Derived via `deriveStrengthStd(|mean|, belief, provenance)` | LLM omitted `strength_std` | `schema-v3.ts:370-373` |
| `effect_direction` | Derived from sign of `strength_mean` | Always derived (not from LLM) | `schema-v3.ts:379` |
| `origin` | `"ai"` | LLM omitted `origin` | `schema-v3.ts:393` |
| Node `kind` | `"factor"` | Unknown node kind | `schema-v3.ts:117` |
| Node `kind` | `"risk"` (mapped from `"constraint"`) | Node kind is `"constraint"` | `schema-v3.ts:109-110` |

**Stage 6 (Boundary) — Graph Data Integrity (`src/cee/transforms/graph-data-integrity.ts`):**

| Field | Default Value | Trigger Condition | File:Line |
|-------|--------------|-------------------|-----------|
| `exists_probability` (structural) | `1.0` | Missing or below 1.0 on structural edges | `graph-data-integrity.ts:307-342` |
| `exists_probability` (causal) | `0.8` | Missing on causal edges | `graph-data-integrity.ts:307-320` |
| `effect_direction` (structural) | `"positive"` | Missing on structural edges | `graph-data-integrity.ts:358-359` |
| `effect_direction` (causal) | Inferred from `strength.mean` sign | Missing on causal edges | `graph-data-integrity.ts:362-363` |
| `observed_state.value` | Recomputed as `raw_value/cap` (or `raw_value/100` for %) | Scale inconsistency > 5% tolerance | `graph-data-integrity.ts:183-196` |

### 2.5 Nodes/Edges Added, Removed, or Reclassified

**Added:**
- Stage 4 substep 4c: Synthetic outcome nodes and edges for every factor→goal edge (`deterministic-sweep.ts:629-698`). Each split creates 1 outcome node + 2 edges (replacing 1 edge).
- Stage 4 substep 5: Compound goals substep can generate constraint nodes/edges (`repair/compound-goals.ts`).
- Stage 4 substep 8: Connectivity substep wires orphan nodes to goal (`repair/connectivity.ts`).
- Stage 3: `enrichGraphWithFactorsAsync` may add factor nodes and edges (`enrich.ts:33`).

**Removed:**
- Stage 2: STRP can remove edges (`reconcileStructuralTruth` — `normalise.ts:28-32`).
- Stage 3: `ensureDagAndPrune` removes cycle-causing edges (`enrich.ts:84, 98`). `simpleRepair` may also remove nodes/edges (`enrich.ts:95`).
- Stage 4 substep 1: `fixInvalidEdgeRefs` removes edges with non-existent node references (`deterministic-sweep.ts:219-233`). `fixGoalHasOutgoing` removes outgoing edges from goal nodes (`deterministic-sweep.ts:249-262`). `fixDecisionHasIncoming` removes incoming edges to decision nodes (`deterministic-sweep.ts:279-291`). `fixDisconnectedObservables` removes disconnected observable/external factor nodes (`deterministic-sweep.ts:711-751`).

**Reclassified:**
- Stage 4 substep 1: `fixCategoryMismatch` changes factor `category` based on edge topology (`deterministic-sweep.ts:322-336`). `handleUnreachableFactors` reclassifies unreachable factors (`deterministic-sweep.ts:908`).
- Stage 4 substep 1: `fixObservableExtraData` strips `factor_type` and `uncertainty_drivers` from observable nodes (`deterministic-sweep.ts:450-453`). `fixExternalHasData` strips `value`, `factor_type`, `uncertainty_drivers` from external nodes (`deterministic-sweep.ts:492-511`).

### 2.6 Silent Mutations

1. **Risk coefficient sign flip** (Stage 2): `normaliseRiskCoefficients` flips positive risk→goal/outcome edge strength_mean to negative. Logged at info level but no trace entry on the individual edge. The correction is recorded in `ctx.riskCoefficientCorrections` and surfaces in `trace.pipeline.repair_summary.risk_coefficient_corrections` — so not fully silent, but the per-edge log is only at info level (`normalise.ts:56-59`).

2. **Enrichment factor defaults** (Stage 3): The `enrichGraphWithFactorsAsync` call may inject default factor metadata. The enrichment result tracks counts (`factorsAdded`, `factorsEnhanced`, `factorsSkipped`) but individual field-level defaults are not itemized in the trace.

3. **strength_std derivation** (Stage 6 V3 transform): When `strength_std` is missing, it is derived via `deriveStrengthStd()` rather than set to a fixed constant. The derivation parameters (mean, belief, provenance) influence the result but the derived value is not explicitly logged per-edge — it appears in the `transform_defaults` array on `trace.transform_defaults.defaults`.

4. **Goal threshold stripping** (Stage 4b): When thresholds are stripped, the original values are not preserved in the response. They appear only in the `thresholdSweepTrace` and `deterministicRepairs` arrays on the trace object.

5. **STATUS_QUO_ABSENT coaching injection** (Stage 5): When no option has a status-quo label, a coaching `strengthen_item` (`str_status_quo`) is pushed into `ctx.coaching` (`package.ts:128-136`). This mutates coaching content with no dedicated telemetry event.

---

## Section 3: Orchestrator Pipeline Trace

### 3.1 Entry Point

`POST /orchestrate/v1/turn` enters at `src/orchestrator/route.ts:85`. The route handler:

1. **Validates** the request body via `TurnRequestSchema.safeParse()` (line 90). On failure, returns a 400 with `INVALID_REQUEST` error envelope containing Zod details plus optional contract diagnostics in non-production (lines 102-125).
2. **Normalizes** context and system events via `normalizeContext()` and `normalizeSystemEvent()` (lines 131-132).
3. **Message length guard**: Rejects messages > `MAX_MESSAGE_LENGTH` (4,000 chars) with a friendly 400 (lines 140-157).
4. **Pipeline selection** (lines 171-241):
   - If `generate_model` is set AND V2 is disabled: `handleParallelGenerate()` (line 176)
   - If `config.features.orchestratorV2` is true: `handleTurnV2()` (line 203)
   - Otherwise: V1 `handleTurn()` (line 224)

All paths run `logAnalysisReadyDiagnostics()` on the response envelope for full_draft graph_patch blocks.

The V2 pipeline delegates to `executePipeline()` in `src/orchestrator/pipeline/pipeline.ts:52`.

### 3.2 Five-Phase Pipeline

`src/orchestrator/pipeline/pipeline.ts:52` — `executePipeline()` orchestrates five phases sequentially:

```
Phase 1 (Enrichment) → System Event Check → Phase 2 (Specialists) → Analysis Lookup →
Phase 3 (LLM/Deterministic) → Phase 4 (Tool Execution) → Conversational Retry → Phase 5 (Validation)
```

Between Phase 2 and Phase 3, two short-circuits can fire:
- **System event routing** (lines 69-210): If `request.system_event` is present, `routeSystemEvent()` handles `patch_accepted`, `direct_graph_edit`, and `direct_analysis_run` events. These bypass phases 3-5 entirely, returning a direct ack envelope or delegating to `runAnalysisViaPipeline()`.
- **Analysis lookup** (lines 221-234): After the intent gate but before LLM, `tryAnalysisLookup()` checks if the message matches a factual analysis query pattern. If matched, returns a minimal envelope and skips the LLM call.

### 3.3 Phase 1: Enrichment

`src/orchestrator/pipeline/phase1-enrichment/index.ts:57` — `phase1Enrich()` is fully deterministic (no LLM calls, target <50ms). It:

1. **Generates turn_id** via `randomUUID()` (line 63)
2. **Infers stage** via `inferStage(context, systemEvent)` (line 66)
3. **Classifies intent** via `classifyUserIntent(message)` (line 69)
4. **Detects archetype** via `detectArchetype(message, framing)` (line 72)
5. **Tracks progress** from last 5 turns (line 75)
6. **Detects stuck** state from conversation history (line 78)
7. **Builds conversational state** including pending_clarification and pending_proposal (line 81)
8. **Loads DSK** (stub — returns empty bundle) (line 84)
9. **Loads user profile** (stub) (line 87)

Context management (A.4) steps:
10. **Compact graph** via `compactGraph()` — sorted, deterministic (line 92-94)
11. **Compact analysis** via `compactAnalysis()` with node label map (lines 97-102)
12. **Trim messages** to last 5 turns (`MAX_CONVERSATION_TURNS = 5`, line 105)
13. **Event log summary** — currently passes empty array (line 110)
14. **Normalize selected_elements** into `selected_node_ids` / `selected_edge_ids` (lines 117-118)
15. **Enforce context budget** via `enforceContextBudget()` — generic, never throws, uses `graph_compact` field (line 160-162)
16. **Build decision continuity** via `buildDecisionContinuity()` (lines 165-177)
17. **Match referenced entities** against compact graph nodes (line 180)
18. **Cross-turn entity memory** if `config.cee.entityMemoryEnabled` (lines 183-185)
19. **Compute context hash** via SHA-256, excludes timestamps/scenario_id (lines 188-193)

### 3.4 Phase 2: Specialist Routing (Stub)

`src/orchestrator/pipeline/phase2-specialists/index.ts:15` — `phase2Route()` returns an empty specialist result with no advice, no candidates, no triggers. The first specialist (Behavioural Science Analyst) is planned for post-pilot.

### 3.5 Phase 3: LLM Call / Deterministic Routing

`src/orchestrator/pipeline/phase3-llm/index.ts:81` — `phase3Generate()` implements multi-layer routing:

**Step 1 — Intent Gate** (`src/orchestrator/intent-gate.ts:226`):
- Pure function with strict whole-message equality matching against a frozen pattern table of ~50 patterns.
- Normalizes message: lowercase, trim, strip punctuation, collapse spaces.
- Returns `{ tool, routing: 'deterministic', confidence: 'exact' }` on match, or `{ tool: null, routing: 'llm' }` for LLM fallback.
- Seven tool targets: `run_analysis`, `draft_graph`, `generate_brief`, `explain_results`, `edit_graph`, `run_exercise`, `research_topic`.
- `run_exercise` is gate-only (not in LLM tool definitions).
- `research_topic` uses verb-prefix matching (e.g., "research {topic}").

**Step 2 — Pre-LLM Overrides** (phase3-llm/index.ts:93-156):
- **Pending proposal followup**: dismiss/stale/confirm actions bypass LLM (lines 134-178)
- **Explicit generate route**: checks if `generate_model` flag or message implies draft_graph (line 107)
- **Results explanation redirect**: redirects explain_results/edit_graph to explain_results when analysis is current and explainable (lines 116-124)
- **Stable model redraft blocking**: blocks draft_graph if model is stable and not a clear regenerate request (lines 109-111)
- **Edit resolution mode**: determines if edit_graph should be answered conversationally instead (lines 112-115)

**Step 3 — Deterministic Prerequisites** (phase3-llm/index.ts:48-68):
Each tool has prerequisites:
- `run_analysis`: `isAnalysisRunnable(ctx)` (graph present + options configured)
- `explain_results`: `isAnalysisExplainable(ctx.analysis_response)`
- `edit_graph`: `ctx.graph != null`
- `generate_brief`: `ctx.graph != null && isAnalysisCurrent(...)`
- `run_exercise`: `isAnalysisCurrent(...)`
- `draft_graph`: requires goal or options or constraints in framing

If intent gate matched a tool but prerequisites are not met, the request falls through to the LLM.

**Step 4 — LLM Call** (when no deterministic match):
- System prompt assembled via `assembleV2SystemPrompt()` in two zones
- Tool definitions assembled from the registry
- LLM called with `ORCHESTRATOR_TIMEOUT_MS` timeout
- Response parsed by `parseV2Response()` to extract tool invocations, assistant text, science annotations

### 3.6 System Prompt Assembly

`src/orchestrator/pipeline/phase3-llm/prompt-assembler.ts:1` — `assembleV2SystemPrompt()`:

**Zone 1** (static): The orchestrator system prompt from the prompt store (`getSystemPrompt('orchestrator')`). This is the stable instruction set. Prompt caching splits this into a separate `SystemCacheBlock` with `cache_control: { type: 'ephemeral' }`.

**Zone 2** (dynamic): Enriched context blocks, each capped at `SECTION_CHAR_CAP = 2000` chars (line 36). Total Zone 2 budget is `ZONE2_CHAR_BUDGET = 8000` chars (~2000 tokens). Includes:
- Stage indicator and intent classification
- Compact graph (serialized as structured text, one node/edge per line)
- Compact analysis summary
- Decision continuity
- Referenced entities from user message
- Entity state map (cross-turn memory)
- Event log summary
- Trimmed conversation history
- Framing context (goal, options, constraints)
- Selected elements

Low-priority blocks (entity_memory, event_log_summary) are trimmed first when budget exceeded.

### 3.7 Phase 4: Tool Execution

`src/orchestrator/pipeline/phase4-tools/index.ts:65` — `phase4Execute()`:

1. **No invocations**: Returns empty result with LLM assistant_text preserved (line 72-82).
2. **Reordering**: Long-running tools (`draft_graph`, `run_analysis`) execute first; only one long-running tool per turn (lines 86-94).
3. **Stage policy guard**: Each tool is checked against `isToolAllowedAtStage()` before execution (lines 133-152). Suppressed tools emit telemetry.
4. **Dispatch**: Calls `toolDispatcher.dispatch()` which wraps `dispatchToolHandler()` from `src/orchestrator/tools/dispatch.ts:123`.
5. **Context carry-forward**: After each tool, analysis_response and graph are updated so follow-up tools see fresh state (lines 175-179).
6. **Fallback injection**: When all tools are suppressed and no LLM text exists, a stage+tool-aware fallback message is injected via `getStageAwareFallbackEntry()` (lines 242-252).
7. **Conversational retry signal**: When `run_analysis` is suppressed but user intent is not explicit action (`act`), signals `needs_conversational_retry` (lines 229-240). The pipeline (pipeline.ts:291-333) then retries with a plain chat LLM call.

### 3.8 Tool Dispatch

`src/orchestrator/tools/dispatch.ts:123` — `dispatchToolHandler()` routes to:

| Tool | Handler | LLM call? | Key behavior |
|------|---------|-----------|-------------|
| `run_analysis` | `handleRunAnalysis()` | No (PLoT client call) | Auto-chains `explain_results` when intent is `explain` or `recommend` (line 154). Post-analysis guidance generated. |
| `draft_graph` | `handleDraftGraph()` | Yes (via `/assist/v1/draft-graph` internal call) | Requires FastifyRequest. Post-draft guidance generated. |
| `generate_brief` | `handleGenerateBrief()` | No (deterministic) | Generates brief from conversation context. |
| `edit_graph` | `handleEditGraph()` | Yes (via edit_graph adapter) | Supports clarification, proposal, and apply branches. Post-edit guidance generated only on successful apply. |
| `explain_results` | `handleExplainResults()` | Yes (via orchestrator adapter) | Three-tier resolution: cached (tier 1), review data (tier 2), LLM (tier 3). |
| `undo_patch` | `handleUndoPatch()` | No | Latent stub only. |
| `run_exercise` | `handleRunExercise()` | Yes (via orchestrator adapter) | Gate-only tool. Pre-mortem, devil's advocate, disconfirmation exercises. |
| `research_topic` | `handleResearchTopic()` | Yes (internal adapter) | Uses extracted query from intent gate. |

### 3.9 Pending Proposal Confirmation Flow

1. **Proposal creation**: `edit_graph` handler returns `pendingProposal` containing `proposed_changes` and `candidate_labels` when it generates a structural edit that requires user confirmation.
2. **Confirmation**: On the next turn, if the user's message is affirmative (e.g., "yes", "apply it"), the `proposalFollowUp.action === 'confirm'` branch routes to `edit_graph` with the stored changes.
3. **Dismissal**: If the user says "no" or similar, `proposalFollowUp.action === 'dismiss'` returns a deterministic "I won't apply that change" message (pipeline.ts:134-156).
4. **Stale detection**: If the graph has changed since the proposal, `proposalFollowUp.action === 'stale'` returns a deterministic message saying the proposal is out of date (pipeline.ts:157-179).

### 3.10 System Event Handling

System events bypass the intent gate and most of the pipeline:

- **`patch_accepted`**: Acknowledges graph patch acceptance. Returns direct ack envelope. No LLM call.
- **`direct_graph_edit`**: Acknowledges direct graph edit from UI. Returns direct ack envelope. No LLM call.
- **`direct_analysis_run`**: Two paths (pipeline.ts:103-108):
  - **Path A** (has analysis response): Returns ack envelope. If message length > 5 chars and analysis is explainable, chains `explain_results` for narration (pipeline.ts:118-159).
  - **Path B** (needs analysis run): Delegates to `runAnalysisViaPipeline()` which creates a synthetic deterministic LLM result routing to `run_analysis`, then executes Phase 4 and Phase 5 normally (pipeline.ts:536-632).

### 3.11 Conversation History Management

- Conversation history is trimmed to `MAX_CONVERSATION_TURNS = 5` in Phase 1 (phase1-enrichment/index.ts:105).
- Messages are further trimmed by `enforceContextBudget()` which operates on the `messages` field.
- System event entries are appended via `appendSystemMessages()` (pipeline.ts:397).
- In the prompt assembler, serialised conversation history is capped at `SECTION_CHAR_CAP = 2000` chars per section.

### 3.12 Phase 5: Validation + Envelope Assembly

`src/orchestrator/pipeline/phase5-validation/index.ts:33` — `phase5Validate()`:

1. **Classify progress**: Maps tool side_effects to ProgressKind.
2. **Evaluate stage transition**: Determines if the tool execution moved the scenario to a new stage.
3. **Science validation**: Stub — returns empty ledger.
4. **Claims ledger**: Stub.
5. **Observation write**: Stub — logs only ("A.14 not yet implemented").
6. **Assemble envelope**: `assembleV2Envelope()` at `src/orchestrator/pipeline/phase5-validation/envelope-assembler.ts:69` composes the full `OrchestratorResponseEnvelopeV2`.
7. **Response contract validation**: `validateV2EnvelopeContract()` drops malformed chips/blocks and injects fallback if needed.

The `context_hash` in `lineage` follows a three-tier resolution rule (envelope-assembler.ts:44-50):
1. Use pre-computed `enrichedContext.context_hash` from Phase 1
2. If missing, compute via `computeContextHash(toHashableContext(enrichedContext))`
3. If enrichment didn't complete, use empty string

### 3.13 Pipeline Stages Exercised Per Tool

| Tool | Phase 1 | Phase 2 | Phase 3 | Phase 4 | Phase 5 |
|------|---------|---------|---------|---------|---------|
| `run_analysis` (deterministic gate) | Full | Stub | Deterministic skip | PLoT client call + optional explain_results chain | Full |
| `draft_graph` (deterministic gate) | Full | Stub | Deterministic skip | Internal `/assist/v1/draft-graph` call | Full |
| `edit_graph` (deterministic gate) | Full | Stub | Deterministic skip | LLM call via edit_graph adapter | Full |
| `explain_results` (deterministic gate) | Full | Stub | Deterministic skip | LLM/cached/review data | Full |
| Any tool (LLM selected) | Full | Stub | Full LLM call | Tool dispatch | Full |
| System event (patch_accepted, direct_graph_edit) | Partial | Skipped | Skipped | Skipped | Skipped (direct ack) |
| System event (direct_analysis_run Path B) | Full | Stub | Synthetic deterministic | run_analysis dispatch | Full |
| No tool (conversational) | Full | Stub | Full LLM call | Empty result | Full |

---

## Section 4: Feature Flag Audit

### 4.1 Master Feature Flag Table

| Flag (Env Var) | Default | What It Controls | Fully Implemented? | Test Coverage | Risk If Enabled But Broken |
|---|---|---|---|---|---|
| `CEE_GROUNDING_ENABLED` | `false` | Attachment processing (PDF/CSV parsing) for draft-graph and critique-graph | Yes | Yes | Low — additive context |
| `CRITIQUE_ENABLED` | `true` | Gates `/assist/v1/critique-graph` endpoint | Yes | Yes | Medium — disabling removes endpoint |
| `CLARIFIER_ENABLED` | `true` | Per-request override for clarifier | Yes | Yes | Low — per-request only |
| `CEE_ORCHESTRATOR_ENABLED` | `false` | Registers `/orchestrate/v1/turn` route | Yes | Yes | Medium — exposes orchestrator |
| `ENABLE_ORCHESTRATOR_V2` | `false` | V2 five-phase pipeline | Yes | Yes | Medium — changes execution path |
| `CEE_ORCHESTRATOR_CONTEXT_ENABLED` | `false` | Context Fabric 3-zone prompt assembly | Partial | Yes | **High** — replaces prompt assembly |
| `ENABLE_DSK_V0` | `false` | Loads DSK bundle from `data/dsk/v1.json` | Yes | Yes | Low — fail-fast on missing file |
| `DSK_ENABLED` | `false` | Alias for `dskV0`, gates typed accessors | Yes | Yes | Low |
| `BIL_ENABLED` | `false` | Brief Intelligence Layer extraction + injection | Yes | Yes (37+ test files) | Medium — feeds Zone 2 and DSK |
| `DSK_COACHING_ENABLED` | `false` | Deterministic DSK coaching items on envelope | Yes | Yes | Low — additive field |
| `CEE_ZONE2_REGISTRY_ENABLED` | `false` | Zone 2 block registry for prompt assembly | Yes | Yes | **High** — changes prompt construction |
| `MOE_SPIKE_ENABLED` | `false` | Shadow-mode brief quality specialist (never surfaces to users) | Yes | Yes | Low — shadow-mode; but adds latency + cost |
| `ENABLE_ORCHESTRATOR_STREAMING` | `false` | SSE streaming for orchestrator | Yes | Yes | Medium — streaming failure modes differ |
| `CEE_STRICT_PROMPT_VALIDATION` | `false` | Throw on error-severity prompt-zone violations | Yes | Yes | **High** — could crash requests |
| `CEE_ENTITY_MEMORY_ENABLED` | `false` | Cross-turn entity memory in Zone 2 | Yes | Yes | Low — additive context, empty data |
| `CEE_DRAFT_ARCHETYPES_ENABLED` | `true` | Archetype inference in package stage | Yes | Yes | Low |
| `CEE_REFINEMENT_ENABLED` | `false` | Draft refinement with `previous_graph` | Yes | Yes | Low — no-op without previous_graph |
| `CEE_CAUSAL_VALIDATION_ENABLED` | `false` | ISL-based causal validation | Yes | Yes | Medium — requires ISL service |
| `CEE_BIAS_STRUCTURAL_ENABLED` | `false` | Structural (rule-based) bias detection | Yes | Yes | Low — additive findings |
| `CEE_BIAS_LLM_DETECTION_ENABLED` | `false` | LLM-based bias detection | **No — STUB** | Partial | Low — **always returns `[]`** |
| `CEE_BIAS_MITIGATION_PATCHES_ENABLED` | `false` | Mitigation patches in bias-check response | Yes | Yes | Low — additive field |
| `CEE_PREFLIGHT_ENABLED` | `false` | Preflight validation (gibberish, readiness) | Yes | Yes (32 calibration tests) | Medium — can reject briefs |
| `CEE_PREFLIGHT_STRICT` | `false` | Strict mode guidance for thin briefs | Yes | Yes | Low — 200 with guidance, not 400 |
| `CEE_CLARIFIER_ENABLED` | `false` | In-pipeline Stage 4 multi-turn clarifier | Yes | Yes | Medium — adds LLM calls |
| `CEE_CLARIFICATION_ENFORCED` | `false` | Mandatory clarification based on readiness | Yes | Yes | Medium — blocks pipeline |
| `CEE_PATCH_BUDGET_ENABLED` | `true` | Complexity budget on edit_graph patches | Yes | Yes | Low |
| `CEE_PATCH_PRE_VALIDATION_ENABLED` | `true` | Structural validation on edit patches | Yes | Yes | Low |
| `CEE_UNIFIED_PIPELINE_ENABLED` | `false` | Unified 6-stage pipeline | Yes | Yes | **High** — replaces entire draft pipeline |
| `CEE_LEGACY_PIPELINE_ENABLED` | `false` | Allow legacy Pipeline B | Yes | Yes | Medium — throws if disabled |
| `CEE_ORCHESTRATOR_VALIDATION_ENABLED` | `false` | Deterministic graph validator in draft pipeline | Yes | Yes | Low — additive validation |
| `CEE_DECISION_REVIEW_ENABLED` | `false` | M2 Decision Review endpoint | Yes | Yes | Medium |
| `CEE_BOUNDARY_ALLOW_INVALID` | `false` | Allow invalid V3 graphs through boundary | Yes | Yes | **Critical** — env-enforced false in prod/staging |
| `CEE_OBSERVABILITY_RAW_IO` | `false` | Include raw prompts/responses in response | Yes | Yes | **Critical** — env-enforced false in prod |
| `RESEARCH_ENABLED` | `false` | Web search evidence gathering | Yes | Yes | Medium — external API |
| `CEE_BRIEF_SIGNALS_HEADER_ENABLED` | `false` | BriefSignals context header | Yes | Yes | Low |
| `CEE_DRAFT_COMPLIANCE_REMINDER_ENABLED` | `true` | Compliance reminder for initial drafts | Yes | Yes | Low |
| `CAUSAL_CLAIMS_ENABLED` | N/A | Causal claims extraction | Always enabled (no flag gate) | Yes | N/A |

### 4.2 Key Findings

**CEE_BIAS_LLM_DETECTION_ENABLED — STUB ONLY**: At `src/cee/bias/hybrid-detector.ts:564-587`, the `detectBiasesWithLlm()` function always returns `[]`. No actual LLM call is made. Enabling this flag has no effect.

**CEE_CLARIFIER_ENABLED vs CLARIFIER_ENABLED — Deprecation Bridge**: At `src/config/index.ts:649-667`, a complex deprecation bridge forwards the old name to the new. Meanwhile, `src/utils/feature-flags.ts:38-42` defines a separate `clarifier` flag. These are two different flags: `features.clarifier` gates per-request override, while `cee.clarifierEnabled` gates in-pipeline Stage 4. They do not conflict, but naming is confusing.

**CEE_BOUNDARY_ALLOW_INVALID — Environment-Enforced**: Defined via `createEnvEnforcedBoolean(false, "CEE_BOUNDARY_ALLOW_INVALID", false)` at `src/config/index.ts:427`. Forcibly `false` in both production AND staging. Only local/test can enable.

**MOE_SPIKE_ENABLED — Shadow Cost**: Fires a parallel LLM call to `gpt-4.1-mini` (`src/orchestrator/moe-spike/call-specialist.ts:91`) for every `generate_model` turn. Results persisted to disk but never shown to users.

**Context Fabric — Dual Read Pattern**: The flag is read from config at `src/config/index.ts:260,573` but the turn-handler reads it directly from `process.env` at `src/orchestrator/turn-handler.ts:470-471`. Potential inconsistency.

---

## Section 5: LLM Call Inventory

### 5.1 Direct LLM Call Sites

| # | File:function:line | Model Used | Prompt Source | Purpose | Max Retries | Timeout | Can Be Skipped? | Feature Flag |
|---|---|---|---|---|---|---|---|---|
| 1 | `src/routes/assist.draft-graph.ts:861` | `getAdapter('draft_graph')` | `getSystemPrompt('draft_graph')` | Initial graph draft from brief | 1 retry | `DRAFT_LLM_TIMEOUT_MS` | No (core) | None |
| 2 | `src/routes/assist.draft-graph.ts:1389` | `getAdapter('repair_graph')` | `getSystemPrompt('repair_graph')` | Repair graph after validation failure | 0 | `repairTimeoutMs` | Yes (on validation failure) | None |
| 3 | `src/routes/assist.draft-graph.ts:1151` | `getAdapter('repair_graph')` | `getSystemPrompt('repair_graph')` | Orchestrator-validation repair | 0 | `repairTimeoutMs` | Yes | `CEE_ORCHESTRATOR_VALIDATION_ENABLED` |
| 4 | `src/cee/unified-pipeline/stages/parse.ts:154` | `getAdapter('draft_graph')` | `getSystemPrompt('draft_graph')` | Unified pipeline draft | 1 retry | `DRAFT_LLM_TIMEOUT_MS` | No (core) | `CEE_UNIFIED_PIPELINE_ENABLED` |
| 5 | `src/cee/unified-pipeline/stages/repair/plot-validation.ts:180` | `getAdapter('repair_graph')` | `getSystemPrompt('repair_graph')` | Unified pipeline repair | 0 | `ctx.repairTimeoutMs` | Yes | `CEE_UNIFIED_PIPELINE_ENABLED` |
| 6 | `src/cee/unified-pipeline/stages/repair/orchestrator-validation.ts:29` | `getAdapter('repair_graph')` | `getSystemPrompt('repair_graph')` | Unified pipeline orchestrator repair | 0 | `repairTimeoutMs` | Yes | Both flags |
| 7 | `src/routes/assist.clarify-brief.ts:64` | `getAdapter('clarify_brief')` | `getSystemPrompt('clarify_brief')` | Generate clarifying questions | 0 | Default | Yes | `CLARIFIER_ENABLED` |
| 8 | `src/routes/assist.suggest-options.ts:68` | `getAdapter('suggest_options')` | `getSystemPrompt('suggest_options')` | Suggest decision options | 0 | Default | No (core) | None |
| 9 | `src/routes/assist.critique-graph.ts:143` | `getAdapter('critique_graph')` | `getSystemPrompt('critique_graph')` | Critique an existing graph | 0 | Default | Yes | `CRITIQUE_ENABLED` |
| 10 | `src/routes/assist.explain-diff.ts:50` | `getAdapter('explain_diff')` | Inline prompt | Explain graph diff | 0 | Default | No (core) | None |
| 11 | `src/routes/assist.v1.decision-review.ts:466` | `getAdapter('decision_review')` | `getSystemPrompt('decision_review')` | M2 Decision Review | 1 retry | `HTTP_CLIENT_TIMEOUT_MS` | Yes | `CEE_DECISION_REVIEW_ENABLED` |
| 12 | `src/routes/assist.v1.edit-graph.ts:71` | `getAdapter('edit_graph')` | `getSystemPrompt('edit_graph')` | V1 edit graph endpoint | 0 | Default | No (core) | None |
| 13 | `src/orchestrator/turn-handler.ts:571-596` | `getAdapter('orchestrator')` | Zone 1+2 prompt assembly | V1 orchestrator turn | 0 | `ORCHESTRATOR_TIMEOUT_MS` | No (core) | `CEE_ORCHESTRATOR_ENABLED` |
| 14 | `src/orchestrator/parallel-generate.ts:312-366` | `getAdapter('orchestrator')` | `buildCoachingPrompt()` | Parallel coaching call | 0 | `ORCHESTRATOR_TIMEOUT_MS` | No (core of generate_model) | `CEE_ORCHESTRATOR_ENABLED` |
| 15 | `src/orchestrator/pipeline/phase3-llm/index.ts:542` | `llmClient.chatWithTools` | Zone 1+2 + Context Fabric | V2 pipeline LLM call | 0 | `ORCHESTRATOR_TIMEOUT_MS` | No (core) | `ENABLE_ORCHESTRATOR_V2` |
| 16 | `src/orchestrator/pipeline/pipeline.ts:128-302` | `getAdapter('orchestrator')` | Direct prompt | V2 conversational fallback | 0 | `ORCHESTRATOR_TIMEOUT_MS` | Yes (fallback) | `ENABLE_ORCHESTRATOR_V2` |
| 17 | `src/orchestrator/tools/edit-graph.ts:1095` | `getAdapter('edit_graph')` | `getSystemPrompt('edit_graph')` | Edit graph tool handler | 0 | `ORCHESTRATOR_TIMEOUT_MS` | No (tool dispatch) | None |
| 18 | `src/orchestrator/tools/edit-graph.ts:1093` | `getAdapter('edit_graph')` | `getSystemPrompt('repair_edit_graph')` | Repair failed edit | 0 | `ORCHESTRATOR_TIMEOUT_MS` | Yes (repair only) | None |
| 19 | `src/orchestrator/tools/explain-results.ts:459` | `getAdapter('orchestrator')` | `buildExplanationPrompt()` | Explain analysis results (Tier 3) | 0 | `ORCHESTRATOR_TIMEOUT_MS` | Yes (Tier 1/2 skip LLM) | None |
| 20 | `src/orchestrator/tools/run-exercise.ts:319` | `getAdapter('orchestrator')` | Exercise-specific prompt builders | Decision exercises | 0 | `ORCHESTRATOR_TIMEOUT_MS` | Yes (gate-only) | None |
| 21 | `src/orchestrator/moe-spike/call-specialist.ts:94` | `gpt-4.1-mini` (hardcoded) | `MOE_SPIKE_SYSTEM_PROMPT` | Shadow brief quality assessment | 0 | 5000ms | Yes | `MOE_SPIKE_ENABLED` |
| 22 | `src/cee/clarifier/question-generator.ts:179` | `getAdapter('clarify_brief')` | `buildQuestionGenerationPrompt()` | Clarifier question generation | 0 | `CLARIFIER_QUESTION_TIMEOUT_MS` | Yes | `CEE_CLARIFIER_ENABLED` |
| 23 | `src/cee/clarifier/question-generator.ts:211` | `getAdapter('clarify_brief')` | Same (fallback via draftGraph) | Clarifier fallback | 0 | `CLARIFIER_QUESTION_TIMEOUT_MS` | Yes (fallback) | `CEE_CLARIFIER_ENABLED` |
| 24 | `src/cee/clarifier/answer-processor.ts:180` | `getAdapter('draft_graph')` | `buildAnswerIncorporationPrompt()` | Incorporate clarifier answer | 0 | `CLARIFIER_ANSWER_TIMEOUT_MS` | Yes | `CEE_CLARIFIER_ENABLED` |
| 25 | `src/cee/graph-orchestrator.ts:243` | Via adapter passed in | `getSystemPrompt('repair_graph')` | Legacy graph orchestrator repair | Up to `maxRepairRetries` | Default | Yes (retry loop) | None |
| 26 | `src/cee/graph-orchestrator.ts:252` | Via adapter passed in | `getSystemPrompt('draft_graph')` | Legacy graph orchestrator draft | 0 | Default | No (core) | None |
| 27 | `src/orchestrator/tools/research-client.ts:71` | OpenAI Responses API (`gpt-4o`) | `RESEARCH_SYSTEM` (inline) | Web search for evidence | 0 | 15s | Yes | `RESEARCH_ENABLED` |
| 28 | `src/server.ts:529` | `getAdapter()` (default) | N/A | Healthcheck adapter test | 0 | N/A | N/A | None |

### 5.2 Theoretical Maximum LLM Calls Per Request

| Entry Point | Max LLM Calls | Breakdown |
|-------------|--------------|-----------|
| `/assist/v1/draft-graph` (unified) | **4** | 1 draft + 1 retry + 1 PLoT repair + 1 orchestrator repair |
| `/assist/v1/draft-graph` (legacy) | **4** | 1 draft + 1 retry + 1 repair + 1 orchestrator repair |
| `/orchestrate/v1/turn` (draft_graph tool) | **7** | 1 chatWithTools + 1 coaching + 1 MOE spike + 4 draft pipeline |
| `/orchestrate/v1/turn` (edit_graph tool) | **5** | 1 chatWithTools + 1 coaching + 1 MOE spike + 1 edit LLM + 1 edit repair |
| `/orchestrate/v1/turn` (explain) | **4** | 1 chatWithTools + 1 coaching + 1 MOE spike + 1 explain LLM |
| `/assist/v1/decision-review` | **2** | 1 LLM + 1 retry |
| `/assist/v1/clarify-brief` | **1** | 1 clarifyBrief |

---

## Section 6: Prompt Management

### 6.1 Architecture

Three-layer system:
1. **Hardcoded defaults** (`src/prompts/defaults.ts`): Registered at startup via `registerAllDefaultPrompts()` (line 2022), called from `src/server.ts:207`.
2. **Prompt store** (Supabase/Postgres/file): Managed backend with versioning, staging/production variants, and model configuration per prompt.
3. **Adapter-level cache** (`src/adapters/llm/prompt-loader.ts`): In-memory cache with 5-minute TTL, 10-minute stale grace period, proactive background refresh at 80% TTL.

### 6.2 Registered Prompts

12 prompts registered at `src/prompts/defaults.ts:2068-2079`:

| Task ID | Prompt Source | Notes |
|---|---|---|
| `draft_graph` | Version-selectable (v6/v8/v12/v15/v19/v22) | Default v19, env-selectable via `PROMPT_VERSION` |
| `suggest_options` | `SUGGEST_OPTIONS_PROMPT` | Static |
| `repair_graph` | `REPAIR_GRAPH_PROMPT` | v6 minimal-diff |
| `clarify_brief` | `CLARIFY_BRIEF_PROMPT` | Static |
| `critique_graph` | `CRITIQUE_GRAPH_PROMPT` | Static |
| `explainer` | `EXPLAINER_PROMPT` | Static |
| `bias_check` | `BIAS_CHECK_PROMPT` | Static |
| `enrich_factors` | `getEnrichFactorsPrompt()` | Dynamic function |
| `decision_review` | `DECISION_REVIEW_PROMPT` | Version-tracked |
| `edit_graph` | `EDIT_GRAPH_PROMPT` | Static |
| `repair_edit_graph` | `REPAIR_EDIT_GRAPH_PROMPT` | Static |
| `orchestrator` | `getOrchestratorPromptV13()` | Dynamic (cf-v13) |

### 6.3 Resolution Order

1. If `forceDefault` set → return hardcoded default immediately
2. Check in-memory cache. Fresh (< 5 min) → return. Aged past 80% TTL → trigger background refresh
3. Stale but within grace period (< 15 min) → return stale, trigger refresh
4. Cache miss → synchronous store fetch with `PROMPT_STORE_FETCH_TIMEOUT_MS` (5s) timeout
5. Store returns prompt → update cache, return
6. Fall back to hardcoded default

### 6.4 Store Unavailability

- **At startup**: `warmPromptCacheFromStore()` catches failures per-task. Server still starts.
- **At request time**: `Promise.race` timeout ensures store latency never blocks. On timeout, defaults returned **without caching** so next request retries.
- **Background refresh failure**: Logged at warn, cache retains previous value.

### 6.5 Hash Verification

Prompt hashes are computed (SHA-256) at cache time. **Hashes are NOT verified against an expected value.** They serve as observability identifiers only — exposed via `getSystemPromptMeta()` as `prompt_hash` for response metadata and via admin verify endpoint.

### 6.6 A/B Experiment Support

Complete framework exists (`src/adapters/llm/prompt-loader.ts:807-1043`) with `registerExperiment()`, hash-based bucket assignment, and experiment-aware loading. However, `getSystemPromptAsync()` (the experiment-aware loader) is **not called anywhere** in the codebase. All production code uses `getSystemPrompt()`. The infrastructure is fully built but not wired.

### 6.7 Notable Issue

The `enrich_factors` task is registered as a default but is **not** in `OPERATION_TO_TASK_ID`. This means `getSystemPrompt('enrich_factors')` would throw. The prompt is likely consumed directly via `loadPromptSync('enrich_factors')` bypassing the adapter cache.

---

## Section 7: Data Flow to External Services

### 7.1 External Service Connections

| Caller file:line | Target | Endpoint | Data Sent | Data Received | Error Handling | Timeout |
|---|---|---|---|---|---|---|
| `src/adapters/llm/openai.ts:616` | OpenAI API | `POST /chat/completions` | System prompt + user brief (with `[BEGIN_UNTRUSTED_USER_CONTENT]` tags), model params | Graph JSON, token usage, finish reason | `withRetry()`, `UpstreamTimeoutError`, `UpstreamHTTPError` | `HTTP_CLIENT_TIMEOUT_MS` (110s) / `REASONING_MODEL_TIMEOUT_MS` (180s) |
| `src/adapters/llm/anthropic.ts` | Anthropic API | `POST /messages` | Same boundaries, model params | Graph JSON, token usage | Same pattern | Same |
| `src/orchestrator/plot-client.ts:407` | PLoT | `POST /v2/run` | Graph, options, goal_node_id (JSON) | `V2RunResponseEnvelope` (analysis results) | `PLoTError`/`PLoTTimeoutError`, 1 retry for 5xx | `PLOT_RUN_TIMEOUT_MS` (30s) |
| `src/orchestrator/plot-client.ts:502` | PLoT | `POST /v1/validate-patch` | Graph + patch operations | Validation result | 422 as structured rejection | `PLOT_VALIDATE_TIMEOUT_MS` (5s) |
| `src/adapters/isl/client.ts:49` | ISL | `POST /isl/v1/bias-validate` | Graph + bias findings, `X-ISL-API-Key` | Validated bias findings | `ISLValidationError`/`ISLTimeoutError`, exponential backoff | 5s default |
| `src/adapters/isl/client.ts:98` | ISL | `POST /isl/v1/sensitivity` | Graph + sensitivity request | Sensitivity scores | Same | Same |
| `src/adapters/isl/client.ts:148` | ISL | `POST /isl/v1/contrastive` | Graph + contrastive request | Contrast points | Same | Same |
| `src/adapters/isl/client.ts:198` | ISL | `POST /isl/v1/conformal` | Conformal prediction request | Prediction intervals | Same | Same |
| `src/adapters/isl/client.ts:248` | ISL | `POST /isl/v1/validation-strategies` | Graph + validation request | Validation strategies | Same | Same |
| `src/prompts/stores/supabase.ts:146` | Supabase | REST API | Prompt CRUD queries | Prompt definitions/versions | Throws on error | No explicit timeout |
| `src/cee/draft-failures/store.ts:49` | Supabase | REST API | Draft failure bundles | Insert confirmation | `withTimeout()`, non-fatal | Explicit timeout |
| `src/platform/redis.ts:93` | Redis | TCP | Nonce dedup, share data, session cache, quotas | Key existence, values | Graceful fallback to in-memory | connect 10s, command 5s |

### 7.2 Key Observations

- **PLoT auth**: Uses `PLOT_AUTH_TOKEN` as Bearer token (`plot-client.ts:601-604`). If not configured but `PLOT_BASE_URL` is set, a warning is logged but client proceeds without auth.
- **ISL auth**: Sends `X-ISL-API-Key` header when configured (`isl/client.ts:62`).
- **Supabase auth**: Service role key validated at init (`supabase.ts:148-153`).
- **Timeout chain**: `DRAFT_LLM_TIMEOUT_MS (105s) < DRAFT_REQUEST_BUDGET_MS (120s) < ROUTE_TIMEOUT_MS (135s) < Gateway (~150s)`. Validated at startup by `validateTimeoutRelationships()` (`config/timeouts.ts:261-314`).

---

## Section 8: Security Review

### 8.1 Authentication

**API Key**: Keys validated via `validKeys.has(extractedKey)` at `src/plugins/auth.ts:203`. Not constant-time.

**HMAC-SHA256**: Constant-time comparison via `verifyHmacSha256` (`src/utils/hash.ts:117-131`). Clock skew tolerance: 5 minutes. Nonce replay protection: Redis + in-memory LRU fallback (10,000 entries). Legacy mode accepts signatures without timestamp/nonce.

**Admin**: Two key tiers (`ADMIN_API_KEY` read/write, `ADMIN_API_KEY_READ` read-only) with optional IP allowlist. Key comparison uses `===` (not constant-time) at `src/middleware/admin-auth.ts:138,143`.

**Production safeguard**: At least one API key or HMAC secret required or startup fails (`src/server.ts:181-185`).

### 8.2 Rate Limiting

- **Global**: 120 RPM per IP (`src/server.ts:281-322`), env-configurable.
- **Orchestrator**: 30 RPM authenticated / 10 RPM unauthenticated. In-memory store. **Fails open on error** (`src/middleware/rate-limit.ts:174-183`).
- **Per-key quota**: Token bucket via `tryConsumeToken()` with Redis + memory fallback.

### 8.3 Input Validation

- `DraftGraphInput.brief`: `z.string().min(30).max(5000)` (`src/schemas/assist.ts:16`)
- Body limit: 1 MB (`src/server.ts:213`)
- Orchestrator message: 4,000 chars (`src/orchestrator/route.ts:137-138`)
- Model selection: no allowlist at schema level, enforced at runtime via `MODEL_REGISTRY` and `CLIENT_BLOCKED_MODELS`

### 8.4 `raw_output` Security Gate

Gated at two locations:
1. **V1 route** (`src/routes/assist.v1.draft-graph.ts:510-515`): Only allowed in non-production or with admin auth.
2. **Pipeline** (`src/cee/validation/pipeline.ts:1144-1149`): Same check.

In production, `raw_output=true` is silently suppressed without admin auth.

### 8.5 Prompt Injection Boundaries

User text delimited with explicit markers:
```
[BEGIN_UNTRUSTED_USER_CONTENT]
${brief}
[END_UNTRUSTED_USER_CONTENT]
```

These are text markers, not structural API boundaries. Effectiveness depends on LLM instruction-following.

### 8.6 CORS

Strict origin allowlist (`src/server.ts:108-125`). Wildcard `*` blocked in production with fatal error.

### 8.7 Findings

| # | Severity | Finding | Location |
|---|---|---|---|
| S-1 | Low | Admin key comparison uses `===` (timing side channel) | `src/middleware/admin-auth.ts:138,143` |
| S-2 | Low | Orchestrator rate limiter fails open on error | `src/middleware/rate-limit.ts:174-183` |
| S-3 | Info | Legacy HMAC mode lacks replay protection | `src/utils/hmac-auth.ts:182-184` |
| S-4 | Info | `/healthz` exposes detailed service topology | `src/server.ts:528-722` |
| S-5 | Info | In-memory nonce store doesn't survive restart | `src/utils/hmac-auth.ts:47` |
| S-6 | Info | Prompt injection boundaries are text markers | `src/adapters/llm/openai.ts:552-564` |
| S-7 | Info | `POST /v1/prompts/warm` is unauthenticated | `src/routes/v1.prompts.ts:52` |
| S-8 | Info | Orchestrator rate limit store is in-memory only | `src/middleware/rate-limit.ts:41` |

---

## Section 9: Test Coverage Assessment

### 9.1 Overall Test Health

| Metric | Count |
|--------|-------|
| Test files passed | 496 |
| Test files skipped | 3 |
| Test files total | 499 |
| Individual tests passed | 8,498 |
| Individual tests skipped | 69 |
| Individual tests todo | 1 |
| Individual tests total | 8,568 |
| Duration | 37.09s |
| Failures | **0** |

### 9.2 Skipped Test Files

**1. `tests/unit/anthropic.prompt-cache.test.ts` (5 tests)**
Skipped via `describe.skip` — `TEST-001 QUARANTINED - buildDraftPrompt API changes broke these tests` (line 6). Tests reference `__test_only.buildDraftPrompt` and `__test_only.buildSuggestPrompt` which have changed signature. Coverage gap for prompt caching on Anthropic adapter.

**2. `tests/unit/sse-state.test.ts` (22 tests)**
Skipped via `describe.skipIf(() => !redisAvailable)` — `TODO-1010: Re-enable SSE state tests without conditional skip once Redis test infra is stable` (line 39). Requires running Redis instance. Infrastructure gap.

**3. `tests/integration/response-hash.test.ts` (8 tests)**
Skipped via `describe.skip` — `TEST-002 QUARANTINED - /healthz response has variable data (timestamp, latency)` (line 9). Hash determinism assertions fail due to timestamps. The underlying `computeResponseHash` utility is still tested elsewhere.

### 9.3 Todo Test

One test at `tests/unit/orchestrator/pipeline/phase1-enrichment.test.ts:131`:
```
it.todo("V2 pipeline: BIL should be injected during FRAME enrichment (tracked: A.4/F.2)");
```

### 9.4 Coverage Gaps

**Critical — no test files:**

| Source File | Risk |
|-------------|------|
| `src/plugins/performance-monitoring.ts` | Untested monitoring plugin |
| `src/services/model-availability.ts` | Untested model availability checks |
| `src/middleware/sentry.ts` | Error reporting integration untested |
| `src/plugins/boundary-logging.ts` | Boundary telemetry untested |
| `src/middleware/admin-auth.ts` | Admin auth middleware untested |
| `src/middleware/token-budget.ts` | Token budget enforcement weakly tested |
| `src/utils/sse-state.ts` | SSE state management effectively untested (skipped file) |

Pipeline stages, orchestrator phases, and adapters are well-covered.

### 9.5 Dead/Stale Tests

The 3 quarantined test suites (TEST-001, TEST-002, TODO-1010) exercise API surfaces that have changed. They should either be updated or deleted.

---

## Section 10: Dead Code and Technical Debt

### 10.1 Legacy Pipeline Code

Legacy "Pipeline B" is architecturally dead but physically present (~5,700 lines):

- `src/cee/validation/pipeline.ts:578-579` — `runPipeline()` opens with guard that throws `"Pipeline B is archived"`.
- `src/routes/assist.draft-graph.ts:680-681` — `runDraftGraphPipeline()` has identical guard.
- Together: ~5,700 lines of effectively dead code.

### 10.2 TODO Comments

| File:Line | Comment |
|-----------|---------|
| `src/orchestrator/context-fabric/renderer.ts:165` | `TODO: Add patch counts when DecisionState gains` |
| `src/orchestrator/context-fabric/types.ts:70` | `TODO: import string length limits from Platform Contract` |
| `src/orchestrator/dsk-loader.ts:43` | `TODO: Deprecate ENABLE_DSK_V0 once DSK v1 bundle` |
| `src/orchestrator/pipeline/phase1-enrichment/index.ts:53` | `TODO: events will be populated when UI sends events` |
| `src/schemas/assist.ts:6` | `TODO: Consider reducing min(30) for short valid questions` |

### 10.3 Top 20 Most Concerning `as any` Casts

| # | File:Line | Expression | Severity Assessment |
|---|-----------|-----------|---------------------|
| 1 | `src/cee/validation/pipeline.ts:1241` | `payload.graph = graph as any` | **Critical** — assigns transformed graph without type verification |
| 2 | `src/cee/validation/pipeline.ts:1235` | `normaliseRiskCoefficients(graph.nodes as any[], graph.edges as any[])` | **Critical** — both nodes and edges cast before coefficient normalization |
| 3 | `src/cee/validation/pipeline.ts:2221` | `} as any` on entire trace object | **Critical** — full trace object cast masks schema drift |
| 4 | `src/cee/validation/pipeline.ts:1465` | `validateResponse(graph as any, cost_usd, getCostMaxUsd())` | **High** — validation gate receives cast graph |
| 5 | `src/cee/transforms/schema-v3.ts:174` | `(v3Node as any).factor_type = node.data.factor_type` | **High** — injects undeclared field on V3 node type |
| 6 | `src/cee/transforms/schema-v3.ts:771` | `(v3Response as any).causal_claims = v1CausalClaims` | **High** — attaches causal claims outside type definition |
| 7 | `src/cee/transforms/analysis-ready.ts:490` | `(payload as any)._fallback_meta = { ... }` | **High** — undeclared metadata creating shadow contract |
| 8 | `src/validators/structural-reconciliation.ts:168` | `(node as any).category = inferred` | **High** — mutates undeclared property during reconciliation |
| 9 | `src/validators/structural-reconciliation.ts:344` | `(edge as any).effect_direction = "positive"` | **High** — sets default via cast mutation |
| 10 | `src/cee/sensitivity/index.ts:49` | `(suggestion as any).direction = "increase"` | **High** — field injected outside declared type |
| 11 | `src/adapters/llm/openai.ts:594` | `(modelParams as any).temperature as number` | **Medium** — discriminated union extraction without narrowing |
| 12 | `src/adapters/llm/openai.ts:625` | `signal: abortController.signal as any` | **Medium** — AbortSignal cast for SDK compat (5 locations) |
| 13 | `src/prompts/stores/postgres.ts:721` | `(v as any).requires_approval` etc. | **Medium** — DB columns outpacing TypeScript types |
| 14 | `src/config/index.ts:856` | `return (_cachedConfig as any)[prop]` | **Medium** — Proxy pattern makes config untyped |
| 15 | `src/plugins/auth.ts:260` | `(request as any).keyId = keyId` | **Medium** — Fastify request decoration without augmentation |
| 16 | `src/cee/validation/pipeline.ts:935` | `} as any }` on error trace | **Medium** — error response trace cast |
| 17 | `src/routes/assist.draft-graph.ts:345` | `(n as any).id`, `(n as any).kind` | **Medium** — node type mismatch in route |
| 18 | `src/cee/transforms/schema-v3.ts:681` | `seed: (v1Response as any).seed ?? "42"` | **Medium** — magic default through cast |
| 19 | `src/cee/transforms/structure-checks.ts:52` | `(graph as any).edges`, `(node as any).id` | **Medium** — structure check on loose input type |
| 20 | `src/server.ts:389` | `(request as any).perfTrace` (4 locations) | **Low** — observability-only decoration |

### 10.4 Duplicated Logic

- **Cycle detection**: Implemented in `src/utils/graphGuards.ts:74` (full, handles bidirected edges) and `src/services/review/blockBuilders.ts:126` (simplified, would incorrectly flag bidirected confounders as cycles).
- **Pipeline entry duplication**: Both `src/cee/validation/pipeline.ts` and `src/routes/assist.draft-graph.ts` contain Pipeline B orchestration with identical guard clauses.

### 10.5 Env Vars Outside Config

| Env Var | File:Line | Risk |
|---------|-----------|------|
| `CEE_DAILY_TOKEN_BUDGET` | `src/middleware/token-budget.ts:24` | Bypasses config validation |
| `CEE_TOKEN_BUDGET_ENABLED` | `src/middleware/token-budget.ts:25` | Not in config |
| `CEE_ORCHESTRATOR_RATE_LIMIT_MAX` | `src/middleware/rate-limit.ts:27` | Not in config |
| `CEE_GRAPH_MAX_NODES` | `src/orchestrator/graph-structure-validator.ts:58` | Duplicates `GRAPH_MAX_NODES` from graphCaps |
| `CEE_GRAPH_MAX_EDGES` | `src/orchestrator/graph-structure-validator.ts:59` | Duplicates `GRAPH_MAX_EDGES` from graphCaps |
| `ORCHESTRATOR_DEBUG_BUNDLE` | `src/orchestrator/pipeline/pipeline.ts:989` | Not in config |
| `CEE_DRAFT_FAILURE_RETENTION_ENABLED` | `src/cee/draft-failures/store.ts:213` | Not in config |
| `PROMPT_VERSION` | `src/prompts/defaults.ts:52` | Not in config |

### 10.6 Debt Summary

| Category | Severity | Scope |
|----------|----------|-------|
| Pipeline B dead code | High | ~5,700 lines across 2 files |
| `as any` casts in `pipeline.ts` | High | 62 casts in one file |
| `as any` casts total in `src/` | Medium | ~200+ casts |
| Legacy prompt versions | Low | ~3,000 lines |
| Env vars outside config | Medium | 8 variables |
| Duplicated cycle detection | Medium | Latent correctness risk |
| Quarantined test suites | Medium | 35 tests not executing |

---

## Section 11: Risks, Issues, and Opportunities

### 11.1 Risks

Ranked by severity.

| # | Severity | Risk | Location | Recommended Action |
|---|----------|------|----------|-------------------|
| R-1 | **High** | Admin key comparison uses `===` (timing side channel) | `src/middleware/admin-auth.ts:138,143` | Replace with `crypto.timingSafeEqual` |
| R-2 | **High** | Orchestrator rate limiter fails open on error | `src/middleware/rate-limit.ts:174-183` | Add alert counter; consider deny-by-default after N consecutive failures |
| R-3 | **High** | In-memory rate-limit store grows without bound | `src/middleware/rate-limit.ts:41` | Add periodic cleanup interval or use `LruTtlCache` |
| R-4 | **High** | In-memory quota store grows without bound | `src/utils/quota.ts:122` | Add LRU cap or periodic GC sweep |
| R-5 | **Medium** | API key auth uses `Set.has()` (not constant-time) | `src/plugins/auth.ts:203` | Iterate set with `crypto.timingSafeEqual` |
| R-6 | **Medium** | Legacy HMAC mode accepts signatures without replay protection | `src/utils/hmac-auth.ts:182-184` | Set deprecation deadline; enforce timestamp+nonce |
| R-7 | **Medium** | `/healthz` exposes internal topology without auth | `src/server.ts:528-722` | Split into minimal `/healthz` + protected `/healthz/detail` |
| R-8 | **Medium** | Prompt injection boundaries are text markers only | `src/orchestrator/pipeline/phase3-llm/prompt-assembler.ts:285` | Sanitise user content by escaping XML-like tag patterns |
| R-9 | **Low** | `process.exit(1)` on startup failure with no graceful shutdown | `src/server.ts:934` | Implement graceful shutdown sequence |
| R-10 | **Low** | No `unhandledRejection` / `uncaughtException` handlers | N/A | Register top-level handlers |

### 11.2 Issues

Ranked by impact.

| # | Impact | Issue | Location | Recommended Action |
|---|--------|-------|----------|-------------------|
| I-1 | **High** | 807 `as any` casts in source code (62 in pipeline.ts alone) | Multiple files | Prioritise removing from LLM adapters and validators |
| I-2 | **High** | `CEE_BIAS_LLM_DETECTION_ENABLED` is a permanent stub returning `[]` | `src/cee/bias/hybrid-detector.ts:564-587` | Implement or remove the flag |
| I-3 | **Medium** | Context Fabric flag read from both config and `process.env` | `src/orchestrator/context-fabric/renderer.ts:473` | Read from config for consistency |
| I-4 | **Medium** | `MOE_SPIKE_ENABLED` adds shadow LLM cost with no user benefit | `src/orchestrator/parallel-generate.ts:186` | Remove if experiment complete |
| I-5 | **Medium** | `CLARIFIER_ENABLED` vs `CEE_CLARIFIER_ENABLED` three-way naming confusion | `src/config/index.ts:646-664` | Complete deprecation; remove `CLARIFIER_ENABLED` |
| I-6 | **Medium** | `CEE_ENTITY_MEMORY_ENABLED` loads empty data | `src/orchestrator/pipeline/phase1-enrichment/index.ts:182` | Keep default-off until event source wired |
| I-7 | **Low** | 37 `console.*` calls bypass structured logging | Multiple files | Replace with `log.*` equivalents |
| I-8 | **Low** | 20+ silent `catch {}` blocks swallow errors | `src/adapters/llm/openai.ts:1725` et al. | Add `log.debug` to empty catch blocks |
| I-9 | **Low** | A/B experiment infrastructure built but not wired | `src/adapters/llm/prompt-loader.ts:807-1043` | Wire or remove |
| I-10 | **Low** | Duplicate admin auth logic in three locations | `admin-auth.ts`, `pipeline.ts`, `draft-graph.ts` | Consolidate to single `verifyAdminKey()` |

### 11.3 Opportunities

Ranked by value.

| # | Value | Opportunity | Location | Recommended Action |
|---|-------|-------------|----------|-------------------|
| O-1 | **High** | Remove ~5,700 lines of dead Pipeline B code | `src/cee/validation/pipeline.ts`, `src/routes/assist.draft-graph.ts` | Delete or extract; guard clause prevents activation |
| O-2 | **High** | Introduce graph type guards to eliminate `as any` casts | Multiple files | Create `src/utils/graph-type-guards.ts` |
| O-3 | **High** | Consolidate 5 independent in-memory caches under `LruTtlCache` | `rate-limit.ts`, `quota.ts`, `idempotency.ts`, `session-cache.ts`, `hmac-auth.ts` | Migrate to existing `LruTtlCache` utility |
| O-4 | **Medium** | Remove 3 dead feature flags and ~500 lines of stub code | `hybrid-detector.ts`, `moe-spike/`, `braintrust.ts` | Archive data, remove code |
| O-5 | **Medium** | Unify clarifier flags into one | `config/index.ts`, `feature-flags.ts` | Remove `CLARIFIER_ENABLED`, consolidate to `CEE_CLARIFIER_ENABLED` |
| O-6 | **Medium** | Add distributed cache invalidation for prompt store | `src/adapters/llm/prompt-loader.ts` | Redis pub/sub on prompt update |
| O-7 | **Medium** | Split `/healthz` into liveness + diagnostics | `src/server.ts:528-722` | Minimal `/healthz` + protected detail endpoint |
| O-8 | **Low** | Replace `console.warn` with structured logging | `config/index.ts`, `renderer.ts` | Global replacement |

---

*Report generated 2026-03-15. All findings based on code at staging branch HEAD (`f5825118`). No source files were modified during this review.*
