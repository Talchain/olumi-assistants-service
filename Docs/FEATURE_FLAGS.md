# Feature Flag Inventory

**Generated:** 2026-03-07
**Source:** `src/config/index.ts` + full `src/` grep audit
**Total flags:** 53 declared (2026-07-19: six deleted under the no-dark-launch ruling — see note below)
> **NO-DARK-LAUNCH (Paul, 19 Jul).** Capabilities ship ON; rollback is a code
> revert. Flags deleted under this ruling in PR `a1/no-dark-launch`:
> `CEE_CLARIFY_V2_ENABLED`, `CEE_BIAS_STRUCTURAL_ENABLED`,
> `CEE_ENTITY_MEMORY_ENABLED`, `CEE_UI_DIRECTIVE_EMIT`,
> `CEE_DECISION_RECORD_CAPTURE`, `CEE_PRE_DECISION_CHECKS_ENABLED` (dead).
> Those capabilities are now unconditional — no env var controls them.

> **O-7 WAVE 2 DELETIONS (PR-B, 2026-07-20).** Thirteen more flags left the
> estate, adjudicated against LIVE Render values (never repo defaults):
> **Made unconditional (7, all live-true on cee-staging):**
> `ENABLE_V5_ORCHESTRATOR`, `CEE_ANSWER_TEXT_REQUIRED`,
> `CEE_DRAFT_STRUCTURAL_WARNINGS_ENABLED`,
> `CEE_ADD_RISK_REJECTION_GUIDANCE_ENABLED`,
> `CEE_PLOT_EGRESS_SCALE_NET_ENABLED`,
> `CEE_COACHING_CONTEXT_PROMPT_ENABLED`, `CEE_POST_ANALYSIS_LOOP_ENABLED`.
> **Config deleted as unbuilt/inert (6, zero behaviour consumers):**
> `PII_GUARD_ENABLED` (status-report field removed with it),
> `STRICT_TOPOLOGY_VALIDATION` (was never even env-mapped),
> `CEE_COACHING_TIER2_ENABLED` (cage keeps its caller-supplied input),
> `CEE_ACTION_POLICY_ENABLED`, `CEE_POST_FLIGHT_VALIDATOR_ENABLED`,
> `CEE_GUIDED_INTAKE_ENABLED`. Stale Render keys for these can be deleted.

> **STRICT BOOLEAN PARSING (O-7 wave 2, PR-A, 2026-07-20).** Every boolean
> env var is parsed with exact allowlists (case-insensitive, trimmed):
> `true|1|yes|on` → true · `false|0|no|off|disabled|""` → false · absent →
> the field default. **Any other value is a startup rejection**
> (`INVALID_BOOLEAN_ENV`, thrown as `Configuration validation failed:
> <field>: …`). Before this, every unrecognised non-empty string parsed as
> TRUE (`off`/`no`/`disabled`/typos silently enabled capabilities).
> Exception: `CEE_*_THINKING` accepts `enabled` (its own strict parser);
> `CEE_V5_GRAPH_CAS_MODE` is a three-state mode, not a boolean (see its row).


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
| `CLARIFIER_ENABLED` | `true` | feature-flags.ts, v1.status.ts | No | Gates the standalone `/assist/clarify-brief` route only (Stage-4 pipeline clarifier retired 2026-07-16) |
| `SHARE_REVIEW_ENABLED` | `false` | assist.share.ts, v1.status.ts | Commented | |
| `ENABLE_LEGACY_SSE` | `false` | assist.draft-graph.ts, auth.ts | No | Legacy SSE path |

## Orchestrator

| Env Var | Default | Consumed In | `.env.example` | Notes |
|---------|---------|-------------|----------------|-------|
| `CEE_ORCHESTRATOR_ENABLED` / `ENABLE_ORCHESTRATOR` | `false` | orchestrator/route.ts, server.ts | No | Deprecated alias: `ENABLE_ORCHESTRATOR` |
| `ENABLE_ORCHESTRATOR_V2` | `false` | orchestrator/route.ts | No | |
| `CEE_ORCHESTRATOR_CONTEXT_ENABLED` | `false` | orchestrator/context-fabric/renderer.ts | No | |
| `ENABLE_DSK_V0` | `false` | orchestrator/dsk-loader.ts, lookup/analysis-lookup.ts | No | |
| `DSK_ENABLED` | `false` | decision-review/science-claims.ts, shape-check.ts | No | |
| `CEE_MODEL_VERSIONS_ENABLED` | `false` | orchestrator-v5/model-management/service.ts | No | Model Management v1 (Layer 2) — DARK: gates every entry point of the isolated model-management module (save/list/get/restore/compare versions); flag-off is a fail-closed typed `disabled` no-op. Zero production call sites (nothing wired into routes/turn-executor). Env-enforced: locked `false` in prod; staging true requires explicit opt-in (audit-logged). The Paul-gated migration `20260705120000_v5_model_versions.sql` has been EXECUTED on staging (2026-07-08, build e122f16 — acceptance-evidence/gm-mm/03-mm-owned-scenario-proof.md); this flag's default stays `false` regardless, per its own Env-enforced posture above — see Docs/v5/model-management-v1-implementation-notes.md |

## CEE Pipeline

| Env Var | Default | Consumed In | `.env.example` | Notes |
|---------|---------|-------------|----------------|-------|
| `CEE_UNIFIED_PIPELINE_ENABLED` | `false` | assist.v1.draft-graph.ts | No | Main pipeline gate |
| `CEE_LEGACY_PIPELINE_ENABLED` | `false` | validation/pipeline.ts, assist.draft-graph.ts | No | |
| `CEE_DRAFT_ARCHETYPES_ENABLED` | `true` | unified-pipeline/stages/package.ts, validation/pipeline.ts | No | **Risky default: true** |
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
| `CEE_CLARIFIER_ENABLED` | — | (removed) | No | INERT since 2026-07-16 — Stage-4 clarifier retired (ROADMAP 1.94 Option A); safe to delete from deployment dashboards (now listed in `DEAD_ENV_VARS` alongside the other `CEE_CLARIFIER_*` settings) |
| `CEE_ORCHESTRATOR_VALIDATION_ENABLED` | `false` | unified-pipeline/stages/repair/orchestrator-validation.ts, assist.draft-graph.ts | No | |

## CEE Bias & Review

| Env Var | Default | Consumed In | `.env.example` | Notes |
|---------|---------|-------------|----------------|-------|
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

## V5 Graph CAS (A3 observe-mode)

| Env Var | Default | Consumed In | `.env.example` | Notes |
|---------|---------|-------------|----------------|-------|
| `CEE_V5_GRAPH_CAS_MODE` | `off` | orchestrator-v5/session/supabase-store.ts (hook), turn-executor.ts + handlers/edit-graph-dispatch.ts (expected-base threading), session/index.ts (factory) | No | Three-state mode, NOT a boolean: `off` \| `observe` \| `enforce` (lowercased/trimmed; invalid/empty → `off` with a console warn, never a boot failure) |

**What it does.** App-side stale-write **observation** at the single live
`scenarios.graph` write chokepoint (`commitDirectAnswer` →
`SupabaseSessionStore.append()` → `append_turn_atomic_v2`). When not `off`,
each graph-bearing write performs one pre-RPC PK SELECT of the current
`scenarios.graph`, categorises the write against the server-read expected base
captured at turn start (`src/orchestrator-v5/context/graph-cas-conflict.ts`),
and emits `v5.graph_cas.evaluated`. This is **not atomic CAS and not complete
write safety** — the SELECT and the RPC are separate round-trips (a
SELECT-then-write TOCTOU window). True atomicity is the `append_turn_atomic_v3`
design artifact (`Docs/v5/proposals/append-turn-atomic-v3-graph-cas.md`), not
built.

**Modes.**
- `off` (default): zero SELECTs, byte-identical write path (test-pinned).
- `observe`: evaluate + telemetry; the commit ALWAYS proceeds — no code path
  from the hook to a thrown error, changed response, or skipped RPC.
- `enforce` (provisional): blocks ONLY `analysis_affecting_conflict` writes
  pre-RPC via `GraphStaleWriteError` (extends `StateCommitFailedError`, so it
  rides the existing typed failure envelope — no wire-shape change).
  `self_noop` (idempotent replays / duplicate submissions),
  `cosmetic_concurrent_edit`, `no_expected`, `first_write`, `match` and every
  `unavailable` reason always proceed. **In prod, `enforce` auto-downgrades to
  `observe`** with an `[AUDIT]` warning + a `production_lockdown`
  config-override event.

**Coverage caveat (do not over-claim from this telemetry).** A3 instruments
only the live app write chokepoint through `append_turn_atomic_v2`. It does
NOT prove system-wide absence of stale writes. Not covered: service-role
manual writes, direct database writes, any direct UI writes if they exist,
and dormant/legacy functions that still exist but are now grant-closed to
`authenticated` (`store_draft_graph`, legacy `append_turn_atomic` — A4 closed
that authenticated exposure at the grant layer; it is not an open
`authenticated` surface). Low conflict volume = low conflict volume on the
instrumented path only. RPC v3 remains the path to true atomic write safety.

**Post-merge staging rollout step (requires Paul's approval — env flip, not
code):** set `CEE_V5_GRAPH_CAS_MODE=observe` on the cee-staging Render
environment to start collecting conflict-rate telemetry. Do NOT set `enforce`
anywhere without a separate decision backed by observe-mode evidence; prod
stays `off` (and downgrades `enforce` regardless).

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
