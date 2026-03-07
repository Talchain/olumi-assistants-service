# Feature Flag Inventory

**Generated:** 2026-03-07
**Source:** `src/config/index.ts` + full `src/` grep audit
**Total flags:** 58 declared, 6 undeclared consumption

---

## Summary

| Category | Count |
|----------|-------|
| Declared and active | 55 |
| Dead declaration (never consumed) | 1 |
| Undeclared consumption (bypasses config) | 6 |
| Documented in `.env.example` | 8 |
| Missing from `.env.example` | 50 |

---

## Core Features

| Env Var | Default | Consumed In | `.env.example` | Notes |
|---------|---------|-------------|----------------|-------|
| `GROUNDING_ENABLED` / `CEE_GROUNDING_ENABLED` | `false` | feature-flags.ts, v1.status.ts | No | Deprecated alias: `GROUNDING_ENABLED` |
| `CRITIQUE_ENABLED` | `true` | feature-flags.ts, v1.status.ts | No | |
| `CLARIFIER_ENABLED` | `true` | feature-flags.ts, v1.status.ts | No | Deprecated: forwards to `CEE_CLARIFIER_ENABLED` |
| `PII_GUARD_ENABLED` | `false` | v1.status.ts | No | |
| `SHARE_REVIEW_ENABLED` | `false` | assist.share.ts, v1.status.ts | Commented | |
| `ENABLE_LEGACY_SSE` | `false` | assist.draft-graph.ts, auth.ts | No | Legacy SSE path |
| `STRICT_TOPOLOGY_VALIDATION` | `false` | — | No | **DEAD DECLARATION** |

## Orchestrator

| Env Var | Default | Consumed In | `.env.example` | Notes |
|---------|---------|-------------|----------------|-------|
| `CEE_ORCHESTRATOR_ENABLED` / `ENABLE_ORCHESTRATOR` | `false` | orchestrator/route.ts, server.ts | No | Deprecated alias: `ENABLE_ORCHESTRATOR` |
| `ENABLE_ORCHESTRATOR_V2` | `false` | orchestrator/route.ts | No | |
| `CEE_ORCHESTRATOR_CONTEXT_ENABLED` | `false` | orchestrator/context-fabric/renderer.ts | No | |
| `ENABLE_DSK_V0` | `false` | orchestrator/dsk-loader.ts, lookup/analysis-lookup.ts | No | |
| `DSK_ENABLED` | `false` | decision-review/science-claims.ts, shape-check.ts | No | |

## CEE Pipeline

| Env Var | Default | Consumed In | `.env.example` | Notes |
|---------|---------|-------------|----------------|-------|
| `CEE_UNIFIED_PIPELINE_ENABLED` | `false` | assist.v1.draft-graph.ts | No | Main pipeline gate |
| `CEE_LEGACY_PIPELINE_ENABLED` | `false` | validation/pipeline.ts, assist.draft-graph.ts | No | |
| `CEE_DRAFT_ARCHETYPES_ENABLED` | `true` | unified-pipeline/stages/package.ts, validation/pipeline.ts | No | **Risky default: true** |
| `CEE_DRAFT_STRUCTURAL_WARNINGS_ENABLED` | `false` | unified-pipeline/stages/package.ts, validation/pipeline.ts | No | |
| `CEE_REFINEMENT_ENABLED` | `false` | assist.draft-graph.ts, unified-pipeline/stages/parse.ts | No | |
| `CEE_DRAFT_COMPLIANCE_REMINDER_ENABLED` | `true` | adapters/llm/anthropic.ts, adapters/llm/openai.ts | No | **Risky default: true** |
| `CEE_ENFORCE_SINGLE_GOAL` | `true` | unified-pipeline/stages/repair/goal-merge.ts, assist.draft-graph.ts | Yes | |
| `CEE_PIPELINE_CHECKPOINTS_ENABLED` | `false` | unified-pipeline/index.ts, assist.draft-graph.ts, server.ts | No | |
| `CEE_BOUNDARY_ALLOW_INVALID` | `false` | unified-pipeline/stages/boundary.ts | No | Dev-only, locked false in prod |
| `CEE_BRIEF_SIGNALS_HEADER_ENABLED` | `false` | assist.v1.draft-graph.ts, assist.v1.draft-graph-stream.ts | No | |

## CEE Validation & Preflight

| Env Var | Default | Consumed In | `.env.example` | Notes |
|---------|---------|-------------|----------------|-------|
| `CEE_PREFLIGHT_ENABLED` | `false` | assist.v1.draft-graph.ts, assist.v1.draft-graph-stream.ts | Yes | |
| `CEE_PREFLIGHT_STRICT` | `false` | assist.v1.draft-graph.ts, assist.v1.draft-graph-stream.ts | No | |
| `CEE_CLARIFICATION_ENFORCED` | `false` | assist.v1.draft-graph.ts, assist.v1.draft-graph-stream.ts, unified-pipeline/stages/package.ts | Commented | |
| `CEE_CLARIFIER_ENABLED` | `false` | validation/pipeline.ts, unified-pipeline/stages/repair/clarifier.ts | No | |
| `CEE_ORCHESTRATOR_VALIDATION_ENABLED` | `false` | unified-pipeline/stages/repair/orchestrator-validation.ts, assist.draft-graph.ts | No | |

## CEE Bias & Review

| Env Var | Default | Consumed In | `.env.example` | Notes |
|---------|---------|-------------|----------------|-------|
| `CEE_BIAS_STRUCTURAL_ENABLED` | `false` | bias/index.ts | No | |
| `CEE_BIAS_MITIGATION_PATCHES_ENABLED` | `false` | assist.v1.bias-check.ts | No | |
| `CEE_BIAS_LLM_DETECTION_ENABLED` | `false` | bias/hybrid-detector.ts | No | |
| `CEE_CAUSAL_VALIDATION_ENABLED` | `false` | adapters/isl/config.ts | Yes | |
| `CEE_DECISION_REVIEW_ENABLED` | `false` | assist.v1.decision-review.ts | No | |
| `CEE_REVIEW_ARCHETYPES_ENABLED` | `true` | assist.v1.review.ts | No | **Risky default: true** |
| `CEE_REVIEW_PLACEHOLDERS_ENABLED` | `false` | assist.v1.review.ts | No | |

## CEE Model Selection

| Env Var | Default | Consumed In | `.env.example` | Notes |
|---------|---------|-------------|----------------|-------|
| `CEE_MODEL_SELECTION_ENABLED` | `false` | services/model-selector.ts | No | |
| `CEE_MODEL_OVERRIDE_ALLOWED` | `true` | services/model-selector.ts | No | |
| `CEE_MODEL_FALLBACK_ENABLED` | `true` | services/model-selector.ts | No | |
| `CEE_MODEL_QUALITY_GATE_ENABLED` | `true` | services/model-selector.ts | No | |

## CEE Observability & Debug

| Env Var | Default | Consumed In | `.env.example` | Notes |
|---------|---------|-------------|----------------|-------|
| `CEE_OBSERVABILITY_ENABLED` | `false` | observability/index.ts | No | |
| `CEE_OBSERVABILITY_RAW_IO` | `false` | observability/index.ts, assist.v1.decision-review.ts | No | Env-enforced: locked false in prod |
| `CEE_DEBUG_CATEGORY_TRACE` | `false` | transforms/schema-v3.ts | No | |
| `CEE_DEBUG_LOGGING` | `false` | transforms/schema-v3.ts | No | |
| `CEE_CACHE_RESPONSE_ENABLED` | `false` | cache/index.ts | No | |
| `CEE_LLM_FIRST_EXTRACTION_ENABLED` | `false` | factor-extraction/index.ts, enricher.ts | No | |

## Prompt Cache & Redis

| Env Var | Default | Consumed In | `.env.example` | Notes |
|---------|---------|-------------|----------------|-------|
| `PROMPT_CACHE_ENABLED` | `false` | adapters/llm/caching.ts | No | |
| `ANTHROPIC_PROMPT_CACHE_ENABLED` | `true` | adapters/llm/caching.ts | No | |
| `REDIS_QUOTA_ENABLED` | `false` | utils/quota.ts | No | |
| `REDIS_HMAC_NONCE_ENABLED` | `false` | utils/hmac-auth.ts | No | |
| `REDIS_PROMPT_CACHE_ENABLED` | `false` | adapters/llm/caching.ts | No | |

## SSE & Streaming

| Env Var | Default | Consumed In | `.env.example` | Notes |
|---------|---------|-------------|----------------|-------|
| `SSE_RESUME_LIVE_ENABLED` | `true` | assist.draft-graph.ts | No | |

## Prompts & Admin

| Env Var | Default | Consumed In | `.env.example` | Notes |
|---------|---------|-------------|----------------|-------|
| `PROMPTS_ENABLED` | `false` | prompts/loader.ts, admin.prompts.ts | Commented | |
| `PROMPTS_BACKUP_ENABLED` | `true` | prompts/store.ts | No | |
| `PROMPTS_BRAINTRUST_ENABLED` | `false` | prompts/braintrust.ts | Commented | |
| `ADMIN_ROUTES_ENABLED` | `true` | admin.prompts.ts, admin.testing.ts | No | |

## Infrastructure

| Env Var | Default | Consumed In | `.env.example` | Notes |
|---------|---------|-------------|----------------|-------|
| `VALIDATION_CACHE_ENABLED` | `false` | services/validateClientWithCache.ts | No | |
| `PERF_METRICS_ENABLED` | `true` | plugins/performance-monitoring.ts | No | |
| `SHARE_STORAGE_INMEMORY` | `false` | utils/share-storage.ts | No | |
| `RESEARCH_ENABLED` | `false` | orchestrator/tools/research-topic.ts | No | |

---

## Undeclared Consumption

These flags are read via `process.env` directly, bypassing `src/config/index.ts`:

| Env Var | Location | Notes |
|---------|----------|-------|
| `CEE_DRAFT_FAILURE_RETENTION_ENABLED` | cee/draft-failures/store.ts:213 | Should be in config schema |
| `PROMPT_VERSION` | prompts/defaults.ts:49 | Testing override |
| `CEE_DRAFT_MODEL` | cee/pipeline-checkpoints.ts, assist.draft-graph.ts | Telemetry only |
| `CEE_DRAFT_PROMPT_VERSION` | cee/pipeline-checkpoints.ts | Telemetry only |
| `BRAINTRUST_API_KEY` | prompts/braintrust.ts:116 | Intentional: security bypass per comment |
| `CEE_CONTEXT_DIR` | context/resolver.ts:37-39 | Directory path, not a flag |

## Dead Declaration

| Env Var | Declared In | Notes |
|---------|-------------|-------|
| `STRICT_TOPOLOGY_VALIDATION` | config/index.ts (features.strictTopologyValidation) | Never consumed in any source file |

## Risky Defaults

Flags that default to `true` but gate features that may not be stable:

| Env Var | Default | Risk |
|---------|---------|------|
| `CEE_DRAFT_ARCHETYPES_ENABLED` | `true` | Adds archetype metadata to all drafts |
| `CEE_DRAFT_COMPLIANCE_REMINDER_ENABLED` | `true` | Injects compliance text into LLM prompts |
| `CEE_REVIEW_ARCHETYPES_ENABLED` | `true` | Adds archetype analysis to reviews |
| `ADMIN_ROUTES_ENABLED` | `true` | Admin endpoints active by default |
| `ANTHROPIC_PROMPT_CACHE_ENABLED` | `true` | Anthropic cache headers always sent |

## Deprecated Aliases

| Current Env Var | Deprecated Alias | Behavior |
|-----------------|------------------|----------|
| `CEE_GROUNDING_ENABLED` | `GROUNDING_ENABLED` | Falls back to deprecated if current not set |
| `CEE_ORCHESTRATOR_ENABLED` | `ENABLE_ORCHESTRATOR` | Falls back to deprecated if current not set |
| `CEE_CLARIFIER_ENABLED` | `CLARIFIER_ENABLED` | Falls back with runtime deprecation warning |
