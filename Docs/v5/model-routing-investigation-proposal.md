# V5 prompt architecture and model routing investigation proposal

Date: 20 April 2026
Branch: `claude/v5-model-routing-investigation`
Author: Claude Code
Type: Investigation, no code changes
Status: For Paul review

This proposal audits the V5 prompt architecture and model routing as currently deployed on `cee-staging.onrender.com`. Findings are grounded in live Supabase store content fetched 2026-04-20, current code at HEAD, and prior benchmark and audit artefacts. Every recommendation cites concrete evidence.

Tags used throughout: **OBS** observed in code or live data, **INF** inferred from code patterns, **DES** design assumption from spec or prior docs, **PRIOR** evidence from earlier benchmark or investigation, **OPN** open question for Paul.

### Approved exceptions to the brief's scope

The original CC brief specified investigation only with no live staging fetches. During planning, Paul approved live Supabase reads against `cee-staging.onrender.com` to ground §3 (draft_graph dropped-output finding) and §6 (edit_graph deep-dive) in live prompt content rather than conditional language. Credentials provided: `X-Olumi-Assist-Key` and `X-Admin-Key`. Reads were strictly read-only, no store mutations performed. Full provenance in the appendix. This is the only deviation from the brief.

---

## 1. Executive summary

V5 routing has reached a point where the code defaults in [src/config/model-routing.ts](src/config/model-routing.ts) are no longer the source of truth. The Supabase prompt store carries a `model_config` field that overrides defaults at parse time, and runtime model selection bifurcates between the two sources without any operator visibility. Live evidence: orchestrator and draft_graph serve `claude-sonnet-4-6` from the store, edit_graph carries a "Sonnet 4.6 " changeNote but `model_config` is unset so it actually runs on `gpt-4o`, and decision_review's `model_config.production` is unset while `staging` is set (matching by coincidence with the code default).

The draft_graph LLM at v189 produces four coaching outputs but the parser at [src/orchestrator/tools/draft-graph.ts:487-515](src/orchestrator/tools/draft-graph.ts#L487-L515) consumes only two. `widening_log` and `bias_signals` are produced and silently dropped, paid output tokens, no consumer.

CQE Layer 0 (committed 2026-04-20) extracts numeric quantities deterministically but is wired only into the routing prompt's PARAMETERS section. It is not plumbed into edit_graph, so the deterministic-vs-LLM split for graph edits is unmeasured.

### Top three recommendations

1. **Fix the routing-truth bifurcation as a production-risk priority.** Document precedence in [src/config/model-routing.ts](src/config/model-routing.ts) and emit a startup log per task showing the resolved model and its source.
2. **Wire or delete `widening_log` and `bias_signals` from draft_graph coaching output.** The LLM is paying tokens to produce them; either consume them in the parser or strip the schema from the prompt.
3. **Add CQE-coverage telemetry to edit_graph invocations.** Same instrumentation captures the error-and-retry rate, so two §6 preconditions are measured from one event.

### Top three risks

1. Silent model fallback. Any task whose Supabase entry has `model_config` unset (eight of twelve at present) defaults to whatever code says, with no audit trail.
2. Dropped LLM coaching outputs. Cost paid, value not delivered. Affects every draft_graph call.
3. Two orchestrator trees. `src/orchestrator-v5/` and `src/orchestrator/` coexist; type-authoritative legacy means v5 evolution is gated on legacy stability, and stage-policy lives only in legacy.

---

## 2. Prior work inventory

This section lists every artefact found in the repo that informs routing or prompt-architecture decisions. The investigation reuses these rather than duplicating.

### Benchmark reports

- [Docs/v187-benchmark-summary-2026-03-19.md](Docs/v187-benchmark-summary-2026-03-19.md): KEY. Multi-model comparison establishing Claude Sonnet 4.6 superiority for draft_graph (92% vs 50% validity). Triggered the store `model_config` flip to claude-sonnet-4-6.
- [Docs/v187-benchmark-analysis-pack-2026-03-19.md](Docs/v187-benchmark-analysis-pack-2026-03-19.md): per-brief breakdown supporting v187 summary.
- [Docs/draft-graph-benchmark-report-2026-03-16.md](Docs/draft-graph-benchmark-report-2026-03-16.md), [v183c](Docs/draft-graph-benchmark-v183c-report-2026-03-16.md), [v184](Docs/draft-graph-v184-benchmark-report-2026-03-16.md), [v185 o4-mini](Docs/draft-graph-v185-o4-mini-benchmark-2026-03-17.md), [v188](Docs/draft-graph-v188-benchmark-report-2026-03-22.md), full historical chain.
- [Docs/decision-review-benchmark-report-2026-03-16.md](Docs/decision-review-benchmark-report-2026-03-16.md), [v12](Docs/decision-review-v12-benchmark-report-2026-03-22.md).
- [Docs/edit-graph-v6-benchmark-report-2026-03-19.md](Docs/edit-graph-v6-benchmark-report-2026-03-19.md).
- [Docs/orchestrator-v26-benchmark-report-2026-03-21.md](Docs/orchestrator-v26-benchmark-report-2026-03-21.md), [v28](Docs/orchestrator-v28-benchmark-report-2026-03-22.md).
- [Docs/o4-mini-vs-gpt41-head-to-head-v185-2026-03-17.md](Docs/o4-mini-vs-gpt41-head-to-head-v185-2026-03-17.md).
- [Docs/reasoning-model-benchmark-report-2026-03-16.md](Docs/reasoning-model-benchmark-report-2026-03-16.md).
- [Docs/fine-tuned-orchestrator-benchmark-2026-03-16.md](Docs/fine-tuned-orchestrator-benchmark-2026-03-16.md), [Docs/sft-v5-vs-v2-benchmark-2026-03-16.md](Docs/sft-v5-vs-v2-benchmark-2026-03-16.md).

### Decision records and audits

- [Docs/draft-graph-model-switch-2026-03-16.md](Docs/draft-graph-model-switch-2026-03-16.md): formal record of gpt-4o to gpt-4.1 switch on 2026-03-18.
- [Docs/prompt-version-audit-2026-03-26.md](Docs/prompt-version-audit-2026-03-26.md): store snapshot. Now partly stale: draft_graph was at store v186 then; live is store v189 (changeNote "v192b") today.

### V5 architecture and CQE

- [Docs/v5/olumi-v5-architecture-design-specification-v3_2.md](Docs/v5/olumi-v5-architecture-design-specification-v3_2.md), [Docs/v5/olumi-boundary-contract-v1_1.md](Docs/v5/olumi-boundary-contract-v1_1.md), [Docs/v5/olumi-v5-routing-prompt-v6.txt](Docs/v5/olumi-v5-routing-prompt-v6.txt).
- [Docs/v5/cqe-design-v1_1.md](Docs/v5/cqe-design-v1_1.md), [cqe-investigation-proposal](Docs/v5/cqe-investigation-proposal.md), [cqe-implementation-review-pack](Docs/v5/cqe-implementation-review-pack.md), [cqe-dependency-audit](Docs/v5/cqe-dependency-audit.md), [cqe-test-baseline](Docs/v5/cqe-test-baseline.md).
- [Docs/v5/technical-debt-inventory-v1.md](Docs/v5/technical-debt-inventory-v1.md).

### Investigation reports relevant to routing

- [Docs/investigation-findings-compression-and-gating-v1.md](Docs/investigation-findings-compression-and-gating-v1.md).
- [Docs/investigation-findings-edge-field-mapping-v1.md](Docs/investigation-findings-edge-field-mapping-v1.md).
- [Docs/cee-response-quality-investigation-v1.md](Docs/cee-response-quality-investigation-v1.md).
- [Docs/compare-options-misroute-investigation-2026-04-11.md](Docs/compare-options-misroute-investigation-2026-04-11.md).

### Evaluator infrastructure

- [tools/graph-evaluator/README.md](tools/graph-evaluator/README.md): five-dimension scoring methodology, brief and model matrices, results output structure.
- [tools/graph-evaluator/models/](tools/graph-evaluator/models/): model configs for gpt-4o, gpt-4.1, gpt-5, gpt-5.2, claude variants. Reasoning_effort params for o-series.
- [tools/graph-evaluator/golden-responses/](tools/graph-evaluator/golden-responses/): cached results for edit-graph task.

### Project instructions

- [Docs/CLAUDE.md](Docs/CLAUDE.md): schema/type safety rules, cross-boundary tracing, pre-commit/pre-push protocols.

### Gaps in prior work

- No explicit steady-state routing heuristics doc. All decisions are empirical and benchmark-driven.
- No benchmark for edit_graph since the Sonnet 4.6 migration on 2026-03-19.
- No benchmark of CQE-routed-vs-LLM-routed edits (CQE Layer 0 is too new and not wired to edit_graph).
- No benchmark of decomposed decision_review.
- The 2026-03-26 audit predates the latest draft_graph version (v189 in store today vs v186 then).

---

## 3. Current prompt-firing map

Live data fetched from `cee-staging.onrender.com` on 2026-04-20 via `/v1/prompts/status` and `/admin/prompts/{id}`. All twelve registered tasks load from the store (zero fallbacks).

### Pipeline phase by phase

Pipeline implementation in [src/orchestrator/pipeline/pipeline.ts](src/orchestrator/pipeline/pipeline.ts).

| Phase | Stage | Prompt fired | LLM call | Output |
|---|---|---|---|---|
| 1 | Enrichment | none | no | EnrichedContext (deterministic) |
| 2 | Specialist routing | none | no | SpecialistResult (stub for pilot) |
| 3 | LLM routing | `orchestrator_default` | yes (skipped if deterministic intent gate matches) | LLMResult: tool selection plus optional text |
| 4 | Tool execution | per tool, see below | yes | ToolResult: blocks plus side effects |
| 5 | Validation | none | no | V2ResponseEnvelope |

### Per-task firing details

Sources for invocation site: parser code, route handlers, registry.

| Prompt | Live store version | Active changeNote | Invocation site | Auto-fire | Output consumed |
|---|---|---|---|---|---|
| draft_graph_default | 189 | "v192b" | tool handler ([src/orchestrator/tools/draft-graph.ts](src/orchestrator/tools/draft-graph.ts)) via Phase 4 | no, explicit tool dispatch | partial, see below |
| edit_graph_default | 8 | "Sonnet 4.6 " | tool handler ([src/orchestrator/tools/edit-graph.ts](src/orchestrator/tools/edit-graph.ts)) via Phase 4 | no | yes |
| repair_graph_default | 6 | "v9" | unified pipeline stage 4 | no, gated on validation failure | yes |
| repair_edit_graph_default | 1 | seed | edit-recovery path | no, gated on edit failure | yes |
| orchestrator_default | 29 | "v28 (again)" | Phase 3 system prompt | yes, every turn unless intent gate matches | yes |
| decision_review_default | 11 | "v14" | route handler [src/routes/assist.v1.decision-review.ts:50-194](src/routes/assist.v1.decision-review.ts#L50-L194) | no, external client invocation only, NOT pipeline | yes |
| validate_graph_default | 4 | "v3" | unified pipeline stage 5 (package) | no, gated on draft completion | yes |
| clarify_brief_default | 1 | seed | unified pipeline stage 4 | no, gated on ambiguity detection | yes |
| critique_graph_default | 1 | seed | none found | n/a, designed but unwired | n/a |
| suggest_options_default | 2 | none | none found | n/a, designed but unwired | n/a |
| explainer_default | 1 | seed | none found | n/a, designed but unwired | n/a |
| bias_check_default | 1 | seed | none found in pipeline | n/a, designed but unwired (Hybrid Detector handles bias internally) | n/a |
| (10 narrate-mode prompts) | all 1 | "Initial seed from defaults.ts" | per-tool narration hint | conditional on tool completion | yes |

### draft_graph v189 coaching field map (the dropped-output finding)

The live v189 prompt produces a `coaching` block with four fields. The parser at [src/orchestrator/tools/draft-graph.ts:487-515](src/orchestrator/tools/draft-graph.ts#L487-L515) consumes only two.

| Field | Produced by LLM | Consumer | Verdict |
|---|---|---|---|
| `coaching.summary` | yes, verified at offset 32448 in live prompt | [draft-graph.ts:487](src/orchestrator/tools/draft-graph.ts#L487) → `narrationHint` | OBS consumed |
| `coaching.strengthen_items` | yes, schema at offset 32448, example at 49545 | [draft-graph.ts:492, 515](src/orchestrator/tools/draft-graph.ts#L492-L515) → `DraftGraphResult.strengthenItems` | OBS consumed |
| `coaching.widening_log` | yes, schema at offset 32930, example at 50005. Contains `elements_added: [...]`, `brief_completeness: "complete" \| "partial" \| "thin"` | none, grep across `src/` returns no consumer | **OBS DROPPED** |
| `coaching.bias_signals` | yes, schema at offset 33132, example at 50296. Contains `[{type: "anchoring" \| "narrow_framing" \| ..., detail: "..."}]` | none, see name-collision warning below | **OBS DROPPED** |

`provenance` is mentioned in the live prompt 19 times but as per-edge and per-node metadata, not as a coaching-block field. Example at offset 28714: `"category": "controllable", "provenance": "brief_explicit"`. The orchestrator uses provenance to coach the user on which parts of the model are "brief_explicit" versus "inferred" (offset 26095 of the prompt). This IS consumed via the node and edge schemas; the brief's grouping of provenance as a "coaching field" is a terminology mismatch, not a dropped output. **OBS terminology mismatch, not a dropped output.**

#### `bias_signals` name collision

A separate `bias_signals` field flows from [src/cee/signals/brief-signals.ts:749](src/cee/signals/brief-signals.ts#L749) (deterministic preflight detector) and IS consumed downstream via [src/cee/unified-pipeline/types.ts:61](src/cee/unified-pipeline/types.ts#L61) and [src/cee/unified-pipeline/stages/package.ts:369, 452](src/cee/unified-pipeline/stages/package.ts#L369-L452). It is also consumed by the moe-spike subsystem ([src/orchestrator/moe-spike/](src/orchestrator/moe-spike/)). Two `bias_signals` flows with the same name and different shapes is an investigation hazard. **OBS hazard, recommend renaming one of them.**

---

## 4. Model routing state, code defaults vs live store overrides

### At-a-glance source-of-truth table

One row per task. One glance shows the bifurcation: where code default and effective runtime diverge, the store override is doing the work. Where the right column says STALE, the routing decision predates the live prompt by more than one substantive version (see recommendation 9).

| Task | Code default | Store `model_config` (staging) | Effective runtime | Benchmark freshness |
|---|---|---|---|---|
| draft_graph | gpt-4.1 | `claude-sonnet-4-6` | claude-sonnet-4-6 | STALE (v187 benchmarked, v189 live) |
| orchestrator | gpt-4o | `claude-sonnet-4-6` | claude-sonnet-4-6 | current (v28 benchmarked, v28 live) |
| edit_graph | gpt-4o | _(unset)_ | gpt-4o | STALE (v6 benchmarked, v8 live) |
| repair_graph | gpt-4.1 | _(unset)_ | gpt-4.1 | NEVER BENCHMARKED at v9 |
| decision_review | gpt-4.1 | `gpt-4.1-2025-04-14` | gpt-4.1 | STALE (v12 benchmarked, v14 live) |
| explainer | gpt-4.1 (as `clarification` group) | `claude-sonnet-4-6` | claude-sonnet-4-6 | NEVER BENCHMARKED |
| validate_graph | (not in defaults) | _(unset)_ | LLM_MODEL fallback | NEVER BENCHMARKED |
| repair_edit_graph | (not in defaults) | _(unset)_ | LLM_MODEL fallback | NEVER BENCHMARKED |
| clarify_brief | gpt-4.1 | _(unset)_ | gpt-4.1 | NEVER BENCHMARKED |
| bias_check | claude-sonnet-4 | _(unset)_ | claude-sonnet-4 | unwired |
| critique_graph | gpt-5.2 | _(unset)_ | gpt-5.2 | unwired |
| suggest_options | gpt-5.2 | _(unset)_ | gpt-5.2 | unwired |

Detail tables follow.

### Resolved precedence chain (effective at runtime)

Verified by reading [src/cee/unified-pipeline/stages/parse.ts:92-100](src/cee/unified-pipeline/stages/parse.ts#L92-L100) and [src/adapters/llm/router.ts:69-742](src/adapters/llm/router.ts#L69-L742):

1. Per-call explicit `model` parameter (highest precedence)
2. **Store `model_config.staging` or `.production`**, set on the prompt entry in Supabase, applied in `parse.ts:92-100` before the router is called. This is the bifurcation source; the brief did not anticipate it.
3. `CEE_MODEL_*` environment variables, applied in router at line 725
4. `TASK_MODEL_DEFAULTS` from [src/config/model-routing.ts:43-63](src/config/model-routing.ts#L43-L63)
5. `providers.json` failover entries
6. `LLM_MODEL` environment variable (lowest precedence)

There is no startup log of the resolved model per task. Operators cannot see which step in the precedence chain delivered the model in production. **OBS opaque resolution.**

### Code defaults table

| Task | TASK_MODEL_DEFAULTS | Source |
|---|---|---|
| clarification | `gpt-4.1-2025-04-14` | [model-routing.ts:46](src/config/model-routing.ts#L46) |
| preflight | `gpt-4.1-2025-04-14` | [model-routing.ts:47](src/config/model-routing.ts#L47) |
| explainer | `gpt-4.1-2025-04-14` | [model-routing.ts:48](src/config/model-routing.ts#L48) |
| evidence_helper | `gpt-4.1-2025-04-14` | [model-routing.ts:49](src/config/model-routing.ts#L49) |
| sensitivity_coach | `gpt-4.1-2025-04-14` | [model-routing.ts:50](src/config/model-routing.ts#L50) |
| draft_graph | `gpt-4.1-2025-04-14` | [model-routing.ts:53](src/config/model-routing.ts#L53) |
| edit_graph | `gpt-4o` | [model-routing.ts:54](src/config/model-routing.ts#L54) |
| bias_check | `claude-sonnet-4-20250514` | [model-routing.ts:55](src/config/model-routing.ts#L55) |
| orchestrator | `gpt-4o` | [model-routing.ts:56](src/config/model-routing.ts#L56) |
| repair_graph | `gpt-4.1-2025-04-14` | [model-routing.ts:57](src/config/model-routing.ts#L57) |
| options / suggest_options | `gpt-5.2` | [model-routing.ts:59-60](src/config/model-routing.ts#L59-L60) |
| critique_graph | `gpt-5.2` | [model-routing.ts:61](src/config/model-routing.ts#L61) |
| decision_review | `gpt-4.1-2025-04-14` | [model-routing.ts:62](src/config/model-routing.ts#L62) |

`research_topic` and `validation` do not appear in `TASK_MODEL_DEFAULTS`. **OPN are these tasks live or removed?**

### Live store table, fetched 2026-04-20 from `cee-staging.onrender.com`

| Task | Store version | changeNote | model_config.staging | model_config.production | Effective runtime model |
|---|---|---|---|---|---|
| draft_graph | 189 | "v192b" | `claude-sonnet-4-6` | `claude-sonnet-4-6` | claude-sonnet-4-6 (store override) |
| orchestrator | 29 | "v28 (again)" | `claude-sonnet-4-6` | `claude-sonnet-4-6` | claude-sonnet-4-6 (store override) |
| edit_graph | 8 | "Sonnet 4.6 " | _(unset)_ | _(unset)_ | gpt-4o (code default) |
| repair_graph | 6 | "v9" | _(unset)_ | _(unset)_ | gpt-4.1-2025-04-14 (code default) |
| decision_review | 11 | "v14" | `gpt-4.1-2025-04-14` | _(unset)_ | gpt-4.1-2025-04-14 (staging: store; production: code default coincidentally matches) |
| explainer | 1 | seed | `claude-sonnet-4-6` | `claude-sonnet-4-6` | claude-sonnet-4-6 (store override) |
| validate_graph | 4 | "v3" | _(unset)_ | _(unset)_ | (no entry in TASK_MODEL_DEFAULTS, uses LLM_MODEL fallback) |
| repair_edit_graph | 1 | seed | _(unset)_ | _(unset)_ | (no entry in TASK_MODEL_DEFAULTS) |
| suggest_options | 2 | none | _(unset)_ | _(unset)_ | gpt-5.2 (code default), but unwired |
| critique_graph | 1 | seed | _(unset)_ | _(unset)_ | gpt-5.2 (code default), but unwired |
| clarify_brief | 1 | seed | _(unset)_ | _(unset)_ | gpt-4.1-2025-04-14 (code default for `clarification`) |
| bias_check | 1 | seed | _(unset)_ | _(unset)_ | claude-sonnet-4-20250514 (code default), but unwired |

### Verification against the brief's "believed routing"

| Task | Brief believed | Effective runtime | Verdict |
|---|---|---|---|
| orchestrator | claude-sonnet-4-6 | claude-sonnet-4-6 | **YES** (via store override; NOT via code default) |
| draft_graph | claude-sonnet-4-6 | claude-sonnet-4-6 | **YES** (via store override; NOT via code default) |
| edit_graph | claude-sonnet-4-6 | gpt-4o | **DIFFERENT**, prompt was authored for Sonnet but model_config never set |
| repair_graph | gpt-4.1 | gpt-4.1-2025-04-14 | YES |
| decision_review | gpt-4.1 | gpt-4.1-2025-04-14 | YES (staging via store; production by coincidence) |
| research_topic | gpt-4.1-mini | not in TASK_MODEL_DEFAULTS | DIFFERENT, task missing from registry |
| clarification | gpt-5-mini | gpt-4.1-2025-04-14 | DIFFERENT, gpt-5-mini deprecated 2026-02-06 |
| validation | o4-mini | not in TASK_MODEL_DEFAULTS | DIFFERENT, config key only, not in defaults |
| bias_check | unknown | claude-sonnet-4-20250514 | confirmed |
| preflight | unknown | gpt-4.1-2025-04-14 | confirmed |

### The silent-fallback risk

Eight of twelve store entries have NO `model_config` set: edit_graph, repair_graph, validate_graph, repair_edit_graph, suggest_options, critique_graph, clarify_brief, bias_check. Four have `model_config` set: draft_graph, orchestrator, decision_review (staging only), explainer. Each of the eight unset entries resolves to whatever `TASK_MODEL_DEFAULTS` says. If anyone changes the code default, those tasks shift silently with no store-side audit trail. **OBS production-risk priority.**

---

## 5. Benchmark evidence summary

| Prompt | Last benchmark | Models tested | Winner | Score gap | Prompt version at benchmark | Prompt version live now | Validity |
|---|---|---|---|---|---|---|---|
| draft_graph | [v187 summary 2026-03-19](Docs/v187-benchmark-summary-2026-03-19.md) | gpt-4o v185, gpt-4o v187, claude-sonnet-4-6, claude-sonnet-4-6 + thinking | claude-sonnet-4-6 + thinking | 92% vs 50% validity | v187 | **v189 (changeNote v192b)** | **STALE**, v189 not benchmarked |
| edit_graph | [v6 2026-03-19](Docs/edit-graph-v6-benchmark-report-2026-03-19.md) | gpt-4o, gpt-4.1, claude-sonnet-4-6 | (see report) | (see report) | v6 | v8 | STALE, v8 is "Sonnet 4.6 " rewrite, never benchmarked |
| repair_graph | none recent | n/a | n/a | n/a | n/a | v9 | **NEVER BENCHMARKED at v9** |
| orchestrator | [v26 2026-03-21](Docs/orchestrator-v26-benchmark-report-2026-03-21.md), [v28 2026-03-22](Docs/orchestrator-v28-benchmark-report-2026-03-22.md) | gpt-4o, claude-sonnet-4-6 | (see report) | (see report) | v28 | v28 (matches) | current |
| decision_review | [v12 2026-03-22](Docs/decision-review-v12-benchmark-report-2026-03-22.md) | gpt-4.1 | (see report) | n/a | v12 | **v14** | STALE, v14 never benchmarked |
| validate_graph | none | n/a | n/a | n/a | n/a | v3 | NEVER BENCHMARKED |
| clarify_brief | none | n/a | n/a | n/a | n/a | v1 (seed) | NEVER BENCHMARKED |
| critique_graph | none, unwired | n/a | n/a | n/a | n/a | v1 (seed) | unwired |
| suggest_options | none, unwired | n/a | n/a | n/a | n/a | v2 | unwired |
| explainer | none, unwired | n/a | n/a | n/a | n/a | v1 (seed) | unwired |
| bias_check | none, unwired | n/a | n/a | n/a | n/a | v1 (seed) | unwired |

### Specific gaps to call out

- **draft_graph v189 has no benchmark.** It is two conceptual versions ahead of the v187 benchmark (v189 in store, changeNote "v192b"). Content is 60,811 chars vs 41,907 at the audit doc snapshot, 45% growth. The Sonnet 4.6 win established at v187 may not hold at v189 if the prompt has drifted.
- **edit_graph v8 has no benchmark.** It is a "Sonnet 4.6" rewrite (17,695 chars, much shorter than v5/v6 at 24-25k). Currently runs on gpt-4o because `model_config` is unset.
- **CQE-routed edit_graph has never been benchmarked.** CQE Layer 0 doesn't reach edit_graph yet (see §6 deep-dive).
- **Decomposed decision_review has never been benchmarked.** Monolithic v14 is the only data point.
- **Orchestrator v28 was benchmarked but the auto-migration loop has overwritten admin-ui uploads six times** ([prompt-version-audit-2026-03-26.md §5](Docs/prompt-version-audit-2026-03-26.md)). Live v29 ("v28 (again)") may be re-overwritten on next deployment.

---

## 6. Per-task routing assessment with edit_graph deep-dive

### Per-task assessment summary

| Task | Cognitive demand | Deterministic alternative | Latency budget | Cost band | Current routing |
|---|---|---|---|---|---|
| orchestrator | routing, fast tool selection | partial via deterministic intent gate | tight (auto-fire every turn) | medium-high | claude-sonnet-4-6 (store) |
| draft_graph | structured graph synthesis from NL | none | user-waited, can be slow | high (large prompt + thinking) | claude-sonnet-4-6 (store) |
| edit_graph | NL to JSON patch | partial via CQE Layer 0 (NOT WIRED) | user-waited but should be quick | medium | gpt-4o (silent fallback) |
| repair_graph | structural repair on validation failure | partial, some repairs are deterministic | conditional invocation | low (gated) | gpt-4.1 |
| decision_review | narrative synthesis from ISL | none | external endpoint, client-waited | high (28k input, 16+ output fields) | gpt-4.1 |
| validate_graph | structural validation | mostly deterministic; LLM is reviewer | conditional | low | not in TASK_MODEL_DEFAULTS, falls back to LLM_MODEL |
| clarify_brief | one short clarifying question | none | conditional | low | gpt-4.1 |
| bias_check | bias detection | already done deterministically by Hybrid Detector | n/a, unwired | n/a | unwired |

### edit_graph deep-dive

Live evidence:
- Prompt content fetched from store: store v8, hash `6920a6f8b55e464b`, 17,695 chars, changeNote "Sonnet 4.6 ", `model_config` UNSET.
- First 400 chars of prompt confirm: "You receive the current graph and a natural-language edit instruction. You produce a JSON object containing patch operations..."
- Token frequency in prompt: "PARAMETERS" 3, "quantities" 1, "patch" 7, "intent" 1, "JSON" 3.
- The prompt does NOT expect CQE-style structured input. It expects natural-language and produces JSON patches.
- CQE Layer 0 ([src/orchestrator-v5/context/cqe/](src/orchestrator-v5/context/cqe/)) populates `parsed_quantities` in [src/orchestrator-v5/context/context-pack-assembler.ts:114, 180](src/orchestrator-v5/context/context-pack-assembler.ts#L114). This is consumed by the routing prompt's PARAMETERS section. It does NOT flow into the edit_graph LLM call.
- Runtime model: `model_config` unset → router uses TASK_MODEL_DEFAULTS at [model-routing.ts:54](src/config/model-routing.ts#L54), which is `gpt-4o`. The "Sonnet 4.6 " changeNote on store v8 reflects the prompt author's intent, not the runtime model.

#### Operator action box, immediate operational fix, outside investigation scope

> **ACTION (operational, not strategic)**
>
> In the admin UI, set `model_config.staging = "claude-sonnet-4-6"` on `edit_graph_default` v8.
>
> This closes a silent-fallback bifurcation: the prompt was authored for Sonnet 4.6 semantics, but `model_config` was never set, so runtime resolves to gpt-4o via TASK_MODEL_DEFAULTS. Five-minute change. No code touched.
>
> This action is NOT evidence the routing strategy is settled. It is purely a bookkeeping fix to make runtime model match prompt-author intent. The routing decision below remains conditional on the preconditions.

#### Routing decision, strictly conditional on three preconditions

The current factual position is: edit_graph runs on gpt-4o, with a prompt authored for Sonnet 4.6. Whether the runtime should change requires data not yet collected. Three preconditions before any routing decision:

1. **CQE-coverage telemetry.** Percentage of edit_graph calls whose input message contains a single-target single-op CQE-extractable quantity. If high (>40%), a deterministic handler is worth considering. Spec in §13.
2. **edit_graph error and retry rate.** If the current model (whichever it ends up being after the operator fix) is failing >5% of calls or retrying often, that is independent justification to benchmark alternatives, regardless of CQE coverage. Spec in §13 (same telemetry event).
3. **Benchmark on the live prompt.** Run gpt-4.1 vs claude-sonnet-4-6 on edit_graph v8 once preconditions 1 and 2 have produced enough volume to interpret. The prompt is generic NL-to-JSON with no thinking-mode dependency, so gpt-4.1 is a credible candidate.

#### What this proposal explicitly does NOT recommend for edit_graph

- It does NOT recommend routing edit_graph away from Sonnet 4.6.
- It does NOT recommend building a deterministic CQE handler.
- It does NOT pre-commit to gpt-4.1 as the winner.

All three are downstream of measurement. The investigation surfaces the measurement gap; it does not pre-empt the data.

---

## 7. Decision_review decomposition analysis

### Reframed context

Verified: decision_review is invoked only via the route handler at [src/routes/assist.v1.decision-review.ts:50-194](src/routes/assist.v1.decision-review.ts#L50-L194). It is NOT part of the orchestrator pipeline. External clients (PLoT, web UI) call it directly with a deterministic PLoT package as input.

### Field count correction

The brief states monolithic v11 produces 11 fields. Live decision_review v14 (store v11) produces at least 16 distinct top-level keys, extracted by JSON-key regex from the prompt content:

`narrative_summary`, `story_headlines`, `robustness_explanation`, `summary`, `primary_risk`, `stability_factors`, `fragility_factors`, `readiness_rationale`, `evidence_enhancements`, `scenario_contexts`, `flip_thresholds`, `bias_findings`, `key_assumptions`, `decision_quality_prompts`, `pre_mortem`, `framing_check`.

Decomposition analysis must use 16 fields, not 11.

### Three invocation-pattern options (not two)

1. **Status quo.** Keep `/assist/v1/decision-review` isolated. External clients call it directly. No V5 coaching layer integration. Architecturally orphaned.
2. **Full migration.** Move decision_review into the unified pipeline as a tool that auto-fires on `decide` stage. V5 coaching wraps the output. External endpoint deprecated. Breaks any external integrations.
3. **Both, recommended for evaluation.** Keep `/assist/v1/decision-review` AND auto-fire it from the unified pipeline post-analysis. Endpoint stays available for external use; pipeline benefits from auto-fire and V5 coaching wrap. Same prompt, two invocation paths, one shared handler. Best-of-both at the cost of some routing complexity.

### Decomposition candidates

Two-way split:
- `narrative_block`: `summary` + `narrative_summary` + `story_headlines` + `primary_risk`.
- `analysis_block`: everything else (12 fields).

Three-way split:
- `narrative_block`: `summary` + `narrative_summary` + `story_headlines` + `primary_risk`.
- `risk_block`: `primary_risk` + `bias_findings` + `flip_thresholds` + `scenario_contexts`.
- `evidence_block`: `evidence_enhancements` + `key_assumptions` + `readiness_rationale` + `decision_quality_prompts` + `pre_mortem` + `framing_check` + `robustness_explanation` + `stability_factors` + `fragility_factors`.

### Trade-off matrix

**ESTIMATES, not measurements.** The only observed data is the prompt size: live decision_review v14 is 28,006 chars (~7k input tokens by rule-of-thumb 4 chars per token). All wall-clock, cost-multiplier, cache-hit, coherence-risk, and failure-mode entries below are directional modelling based on standard LLM cost shapes and Anthropic ephemeral cache TTL behaviour. Real numbers require benchmark B3 in §13.

| Dimension | Monolithic | 2-way parallel | 3-way parallel |
|---|---|---|---|
| Wall clock (estimate) | ~12s (one call, all 16 fields) | ~8s (max of two parallel calls) | ~6s (max of three) |
| Cost in input tokens (estimate) | 1.0× | ~1.7× (most input duplicated; cache mitigates) | ~2.4× (cache mitigates) |
| Cache hit rate (qualitative) | one shared cache key | two independent cache keys | three independent cache keys |
| Coherence risk (qualitative) | none (all generated together) | low (narrative knows about risk only via shared input) | medium (cross-section drift on `primary_risk`) |
| Failure mode (qualitative) | one failure = no output | one block fails = partial output | partial output more likely |

### Recommendation

Benchmark **2-way decomposition first**. Coherence risk is lower than 3-way, latency win is still material (~33%), and partial-output failure mode is a feature for the route handler (it can serve narrative even if analysis fails). 3-way only if 2-way wins and the additional latency cut justifies the coherence-drift risk.

---

## 8. Graph-review second pass

No prior design found in `Docs/` or recent commits. This is net-new.

### Two candidate designs

**Candidate A, ranges in draft_graph.** Extend the draft_graph prompt to emit `min`, `max`, and `confidence` fields per parameter. No new LLM call. Costs more output tokens per draft. Forces the draft model to estimate uncertainty itself.

**Candidate B, separate critic pass.** After draft_graph completes, fire a second LLM call (the critic) on the drafted graph. Critic outputs uncertainty ranges and structural critique. Adds a second call's worth of latency (cacheable input).

### Model candidates for the critic

- **gpt-4.1**: faster, cheaper, deterministic structured output. Right for ranges and structural review.
- **claude-sonnet-4-6 with thinking**: better reasoning, higher cost. Right for critique that needs causal reasoning.
- **gpt-5.2**: premium reasoning. Likely too expensive per draft.

### Benchmark proposal

Compare A vs B on:
- Quality of uncertainty ranges (calibration against held-out simulation).
- Wall-clock latency end-to-end.
- Cost per draft.

Use existing graph-evaluator harness ([tools/graph-evaluator/README.md](tools/graph-evaluator/README.md)) extended with a calibration metric.

---

## 9. Missing prompts

### Designed and intentionally dormant (await consumer)

These prompts are scaffolding for known-future features. Keep in store, do not delete.

- `critique_graph_default` v1, schema exists; no current consumer. Maps directly onto §8 graph-review second-pass critic candidate B. **Recommendation:** wire as the §8 critic when that benchmark runs, do not delete in the meantime.
- `explainer_default` v1, schema exists; explanation currently goes via the hardcoded [src/orchestrator/tools/explain-results.ts:1000](src/orchestrator/tools/explain-results.ts#L1000) `buildExplanationPrompt()`. The store entry is the migration target if the hardcoded prompt is ever moved to store-managed. **Recommendation:** keep as the migration landing pad; decide separately whether to migrate.

### Dead weight with no plausible near-term consumer

These prompts have a designed substitute already in production. Carrying them adds maintenance cost without payoff.

- `bias_check_default` v1, schema exists; Hybrid Detector ([src/cee/signals/brief-signals.ts:749](src/cee/signals/brief-signals.ts#L749)) handles bias detection deterministically and is the canonical source. **Recommendation:** delete from store and `defaults.ts`.
- `suggest_options_default` v2, schema exists; option generation happens via edit_graph and the orchestrator routing prompt. No roadmap item routes through this prompt. **Recommendation:** delete unless option generation is explicitly decoupled in a future architecture decision.

### Brief's named candidates

- **post_draft_orient (short auto-fire orientation after draft completes)**, DES from brief. Not in store, not wired. Would land in Phase 4 as a tool-completion narration, similar to existing narrate-mode prompts. **Status:** designed in brief, not authored.
- **post_rerun_bridge (narrates delta between prior analysis and current)**, DES from brief. Not in store. **Status:** designed in brief, not authored.
- **Structured exercise block generators (pre_mortem, outside_view, challenge)**, DES from brief. The `run_exercise` virtual tool is registered in the gate-only registry per memory note `project_v5_phase1_routing.md`, but no exercise-generator prompts exist in the store. **Status:** infrastructure exists for invocation; prompt content unwritten.

---

## 10. Prompt-firing timing assessment

### Auto-fire is absent across the orchestrator pipeline

Verified by searching for `auto-fire`, `autoFire`, `auto_fire` patterns: no matches. All tool invocations are explicit. The only "auto-fire" prompt is `orchestrator_default` itself, which fires on every turn unless the deterministic intent gate matches.

### Stage-policy gating

[src/orchestrator/tools/stage-policy.ts:23-29](src/orchestrator/tools/stage-policy.ts#L23-L29) is the canonical gate. Stage to allowed-tools mapping:

| Stage | Allowed tools |
|---|---|
| frame | draft_graph, research_topic |
| ideate | edit_graph, research_topic, draft_graph (with rebuild intent only) |
| evaluate | run_analysis, explain_results, generate_brief, edit_graph |
| decide | generate_brief, explain_results |
| optimise | edit_graph, run_analysis, explain_results, generate_brief |

Gate-only tools (`run_exercise`, `undo_patch`) bypass policy entirely.

### Trigger map

| Prompt | Trigger | Notes |
|---|---|---|
| orchestrator_default | every turn | unless deterministic intent gate matches |
| draft_graph_default | tool dispatch from orchestrator | gated by stage-policy (frame, ideate with rebuild intent) |
| edit_graph_default | tool dispatch | gated by stage-policy (ideate, evaluate, optimise) |
| repair_graph_default | validation failure in unified pipeline | conditional, internal to pipeline |
| validate_graph_default | unified pipeline stage 5 | unconditional within draft_graph call |
| clarify_brief_default | ambiguity detected in pipeline stage 4 | conditional |
| 10 narrate-mode prompts | tool completion | conditional on the corresponding tool firing |
| decision_review_default | external HTTP call to `/assist/v1/decision-review` | external client only |
| 4 unwired prompts | none | n/a |

### Gaps identified

- No "post-draft orient" auto-fire. The brief flagged this. After draft_graph completes, the user sees a graph but no orientation narration unless they take an action.
- No "post-rerun bridge" auto-fire. Same pattern.
- Decision_review is not auto-fired anywhere. If the user gets to the `decide` stage, the orchestrator picks `generate_brief` or `explain_results` per stage-policy. Decision_review only happens if an external client calls the endpoint.

---

## 11. Ground truth vs design assumption table

Minimum 20 findings was the target; this section delivers 25.

| # | Finding | Tag | Citation |
|---|---|---|---|
| 1 | Routing-truth bifurcation: code defaults vs store overrides resolve via different precedence steps with no operator visibility | OBS | [parse.ts:92-100](src/cee/unified-pipeline/stages/parse.ts#L92-L100), [router.ts:69-742](src/adapters/llm/router.ts#L69-L742) |
| 2 | draft_graph v189 produces `widening_log` but the parser drops it | OBS | live prompt offset 32930; [draft-graph.ts:487-515](src/orchestrator/tools/draft-graph.ts#L487-L515) |
| 3 | draft_graph v189 produces coaching-block `bias_signals` but the parser drops it | OBS | live prompt offset 33132; [draft-graph.ts:487-515](src/orchestrator/tools/draft-graph.ts#L487-L515) |
| 4 | Name collision: coaching `bias_signals` vs deterministic `bias_signals` from preflight detector | OBS | [brief-signals.ts:749](src/cee/signals/brief-signals.ts#L749), [unified-pipeline/types.ts:61](src/cee/unified-pipeline/types.ts#L61) |
| 5 | decision_review fires only via `/assist/v1/decision-review` endpoint, not the orchestrator pipeline | OBS | [assist.v1.decision-review.ts:50-194](src/routes/assist.v1.decision-review.ts#L50-L194) |
| 6 | CQE Layer 0 lives in `src/orchestrator-v5/`, NOT wired to edit_graph | OBS | [context-pack-assembler.ts:114, 180](src/orchestrator-v5/context/context-pack-assembler.ts#L114) |
| 7 | CQE telemetry has no deterministic-vs-LLM split measurement | OBS | [turn-executor.ts](src/orchestrator-v5/turn-executor.ts) `CqeExtraction` event lacks routing-decision fields |
| 8 | Eight of twelve store entries have NO model_config → silent fallback to TASK_MODEL_DEFAULTS | OBS | live `/v1/prompts/status` |
| 9 | Orchestrator system-migration auto-overwrite loop has fired six times overwriting admin-ui uploads | OBS, PRIOR | [prompt-version-audit-2026-03-26.md §5](Docs/prompt-version-audit-2026-03-26.md) |
| 10 | draft_graph store v177 is corrupted (21 chars only), rollback hazard | OBS, PRIOR | [prompt-version-audit-2026-03-26.md §4](Docs/prompt-version-audit-2026-03-26.md) |
| 11 | edit_graph store v8 is "Sonnet 4.6" rewrite but model_config is unset → runs on gpt-4o | OBS | live store + [model-routing.ts:54](src/config/model-routing.ts#L54) |
| 12 | All 10 narrate-mode prompts in production are still v1 system-seed defaults (~330-450 chars each) | OBS | live admin verify, all 10 prompts queried 2026-04-20 |
| 13 | Two orchestrator trees with state crossings (`src/orchestrator-v5/` and `src/orchestrator/`) | OBS | see §6 deep-dive table |
| 14 | ContextPack (v5) and EnrichedContext (legacy) are separate context-assembly implementations sharing only utilities | OBS | [context-pack-assembler.ts](src/orchestrator-v5/context/context-pack-assembler.ts), `src/orchestrator/context/` |
| 15 | Stage-policy lives only in legacy tree; v5 has no equivalent | OBS | [stage-policy.ts](src/orchestrator/tools/stage-policy.ts) only |
| 16 | Four unwired prompts split into two categories: dead weight (bias_check, suggest_options, deletion candidates) and dormant scaffolding (critique_graph, explainer, keep for future consumers, see §9) | OBS | grep across `src/` returns no consumers; §9 split |
| 17 | Auto-fire is absent across the orchestrator pipeline (orchestrator routing prompt aside) | OBS | grep search returns no matches |
| 18 | Brief's "11 fields" claim for decision_review is wrong; actual is 16+ | OBS | live prompt JSON-key extraction |
| 19 | `model_config.production` is unset for decision_review while staging is set; they match by coincidence with the code default | OBS | live `/v1/prompts/status` |
| 20 | No startup log of resolved-model-per-task, operator has no visibility into which precedence step delivered the model | INF | grep for startup logging in [config/index.ts](src/config/index.ts) and [router.ts](src/adapters/llm/router.ts) |
| 21 | CQE wired to routing prompt PARAMETERS section only, not to edit_graph or any tool LLM | OBS | [context-pack-assembler.ts:114, 180](src/orchestrator-v5/context/context-pack-assembler.ts#L114) |
| 22 | `provenance` is per-edge metadata, not a coaching field, brief conflated terminology | OBS | live prompt offset 28714 |
| 23 | draft_graph prompt has grown ~45% in 4 weeks (41,907 → 60,811 chars) | OBS | [prompt-version-audit-2026-03-26.md](Docs/prompt-version-audit-2026-03-26.md) vs live v189 |
| 24 | Prompt-token-growth risk: no per-task token budget ceiling, no growth budget, no cache-hit-rate tracking against growth | OBS | grep for token-budget logic returns config-time limits, no growth alarms |
| 25 | research_topic and validation tasks are absent from TASK_MODEL_DEFAULTS but referenced in brief, tasks may be removed or never added | OPN | [model-routing.ts:43-63](src/config/model-routing.ts#L43-L63) |

---

## 12. Recommendations, ranked

1. **Fix the routing-truth bifurcation (production-risk priority).** Add a documented precedence comment block in [src/config/model-routing.ts](src/config/model-routing.ts), and add a startup log emitting actual resolved model per task. Concrete acceptance: `pnpm dev` startup log includes one line per CeeTask showing `task=draft_graph, source=store_override|code_default, model=claude-sonnet-4-6`. Cites finding 1.
2. **Wire or delete `widening_log` and `bias_signals` from draft_graph coaching output.** The LLM is paying input AND output tokens to produce two structured fields per call that get silently discarded. Cost impact: estimated 5-10% of draft_graph output tokens. UX impact: coaching outputs the prompt was designed to deliver are missing from the user experience. Either consume them in the parser at [draft-graph.ts:487-515](src/orchestrator/tools/draft-graph.ts#L487-L515) or strip the schema from the prompt. **Two gating checks before deleting:** (a) Search the UI/PLoT/web client repos for any reference to `widening_log` or `bias_signals` field names, a future consumer may already be partially built and the prompt is the upstream half. (b) Estimate whether stripping the coaching schema sections would harm draft quality on benchmark briefs (the schema may shape the LLM's reasoning even where the output is dropped). Wire is the safer default if either check is uncertain. Cites findings 2 and 3.
3. **Add CQE-coverage and edit_graph error-rate telemetry.** Spec in §13. Single event covers both §6 preconditions. Cites findings 6 and 7.
4. **Resolve the `bias_signals` name collision.** Two distinct payloads share one field name: the LLM coaching output (currently dropped) and the deterministic preflight detector output (consumed downstream). When future code touches either, conflation is likely and bugs will be subtle. Rename one of them, document both shapes, add a Zod-distinguished union if both must coexist on the same envelope. This is debugging-and-comprehension risk, not cleanliness. Cites finding 4.
5. **Resolve `model_config not set` for the eight store entries.** Includes the urgent edit_graph store-config fix from §6 (set `model_config.staging = "claude-sonnet-4-6"` for `edit_graph_default` immediately, via admin UI, no code change). Cites findings 8 and 11.
6. **Fix the orchestrator system-migration overwrite loop.** Either align `defaults.ts` with the desired prompt so migration is a no-op, or disable auto-migration for orchestrator_default. The next deployment will overwrite v29 again. Cites finding 9.
7. **Add a per-task prompt token budget ceiling and alert.** Without it, every prompt edit silently drives cost up. Cites findings 23 and 24.
8. **Adopt a benchmark freshness policy.** Any prompt-routing or model-routing decision is non-authoritative once the live prompt is more than one substantive version newer than the prompt the benchmark used. Concretely: if benchmark used v187 and live is v189, that benchmark cannot be cited as evidence for routing decisions until rerun. The §4 "benchmark freshness" column shows the current STALE inventory. Acceptance: every benchmark report front-page lists "valid until prompt vN+1" and the routing-decision review process treats stale benchmarks as missing evidence. Cites findings in §4 freshness column.
9. **Audit narrate-mode prompts.** Decide whether system-seed v1 is the intended production content or whether richer prompts should ship. Cites finding 12.
10. **Decide on the four unwired prompts per §9 split.** Two are dead weight (bias_check, suggest_options) and should be deleted. Two are dormant scaffolding (critique_graph, explainer) and should be kept. Cites finding 16.
11. **Benchmark 2-way decomposed decision_review.** Per §7. Cites finding 18.
12. **Benchmark edit_graph on the live v8 prompt** with whichever model results from recommendation 5. After §6 preconditions are met. Strictly conditional on telemetry data, no pre-committed direction. Cites finding 11.
13. **Two-tree consolidation, name the decision.** The proposal does not recommend a direction. Paul must choose between: (a) tolerate dual-tree coexistence as permanent, accepting the migration tax of one-way coupling and parallel context-assembly implementations as the cost of pilot-to-V5 transition; or (b) author a consolidation plan with a target end state (collapse v5 into legacy, or vice versa) and a migration sequence. Either is defensible; ambiguity is not. Cites findings 13, 14, 15.

---

## 13. Benchmark plan and telemetry specs

### Benchmarks to run (gaps from §5)

| # | Target | Models | Brief set | Success criteria |
|---|---|---|---|---|
| B1 | draft_graph v189 (changeNote v192b) | gpt-4o, gpt-4.1, claude-sonnet-4-6, claude-sonnet-4-6 + thinking | existing 11-brief evaluator set | claude-sonnet-4-6 + thinking ≥85% validity (matches v187 baseline within 7pp) |
| B2 | edit_graph v8 | gpt-4o (current), gpt-4.1, claude-sonnet-4-6 | existing edit-graph golden set | quality parity at lower latency for the winner |
| B3 | decision_review 2-way decomposition | gpt-4.1 monolithic vs gpt-4.1 2-way parallel | (need new fixture set) | latency reduction ≥25% AND coherence within human-eval threshold |
| B4 | Graph-review second pass (§8) | gpt-4.1 critic vs claude-sonnet-4-6 + thinking critic vs ranges-in-draft | held-out simulation calibration | calibrated uncertainty ranges (Brier score against simulation) |
| B5 | repair_graph v9 | current model vs candidates | unified-pipeline failed-validation cases | quality parity |
| B6 | validate_graph v3 | current model (LLM_MODEL fallback) vs candidates | structural-validation cases | quality parity |

Use existing harness at [tools/graph-evaluator/](tools/graph-evaluator/). Model configs in [tools/graph-evaluator/models/](tools/graph-evaluator/models/). Brief sets in `tools/graph-evaluator/briefs/`.

### CQE-coverage and edit_graph error-rate telemetry concrete spec

Single event covers both §6 preconditions (CQE coverage, edit_graph error rate).

- **Event name:** `cqe.coverage.edit_graph` (matches existing `cqe.extraction` naming convention).
- **Emit point:** [src/orchestrator-v5/turn-executor.ts](src/orchestrator-v5/turn-executor.ts) immediately before edit_graph tool dispatch (pre-dispatch fields), and one paired emit on completion (post-dispatch fields). Both emits share the same `request_id`.

#### Pre-dispatch fields

| Field | Type | Description |
|---|---|---|
| `request_id` | string | Correlates with the post-dispatch emit |
| `session_id` | string | Session context |
| `cqe_match_count` | number | From the existing `CqeExtraction` event for this turn |
| `single_target` | bool | True if exactly one target field is referenced |
| `single_op` | bool | True if exactly one set/increment/decrement operation |
| `would_be_deterministic` | bool | True iff `single_target && single_op && cqe_match_count > 0` |
| `tool_dispatched` | string | Always `"edit_graph"` |
| `model_used` | string | The resolved runtime model (e.g., `gpt-4o`) |

#### Post-dispatch fields

| Field | Type | Description |
|---|---|---|
| `request_id` | string | Joins back to pre-dispatch event |
| `previous_attempt_error` | string \| null | Error code from the prior attempt in this session if this is a retry |
| `retry_count` | number | 0 for first attempt, 1+ for retries |
| `outcome` | string | One of `"success"`, `"validation_failed"`, `"llm_error"`, `"timeout"` |
| `latency_ms` | number | Tool-to-tool wall clock |

#### Aggregations

- **Weekly query 1:** `would_be_deterministic = true` / total → `% deterministic-eligible`. Threshold for CQE routing decision: if >40% eligible, deterministic handler is worth building.
- **Weekly query 2:** `outcome != "success"` / total → `edit_graph error rate`. Threshold for routing-away-from-Sonnet decision: if >5% on the current model, that's independent justification to benchmark gpt-4.1 regardless of CQE coverage.
- **Weekly query 3:** `retry_count > 0` / total → `retry rate`. High retry rate signals prompt clarity issues, not just model issues.

---

## 14. Open questions for Paul

1. **Finding 25:** are `research_topic` and `validation` live tasks that should be in `TASK_MODEL_DEFAULTS`, or have they been removed or renamed? The brief's "verification" column references them but the registry doesn't.
2. **Finding 12:** are the v1 system-seed narrate-mode prompts the intended production content, or is richer authored content pending? If the latter, where is it?
3. **§7 Option 3:** is the dual invocation pattern for decision_review (endpoint + pipeline auto-fire) acceptable architecturally, or should we commit to one?
4. **§9 unwired prompts:** are the four unwired prompts (bias_check, critique_graph, suggest_options, explainer) candidates for deletion, or pending wiring?
5. **§5 draft_graph v189:** the v187 benchmark is the most recent. Should we re-benchmark before any further prompt changes land?
6. **§10 missing prompts:** the brief named post_draft_orient, post_rerun_bridge, and exercise generators. Are these on a roadmap, or aspirational for the proposal to flag?
7. **§12 recommendation 5:** the system-migration overwrite loop has been ongoing for weeks. Is the desired end state to keep store-managed prompts and delete `defaults.ts` for orchestrator_default, or to keep `defaults.ts` authoritative and disable admin-ui uploads?

---

## 15. Unknown unknowns

Three items. These are findings the brief did not anticipate AND that produced genuine surprise during the investigation. (The two-orchestrator-trees state crossings and decision_review architectural orphan are documented risks, recorded as findings 13-15 and 5 in §11. They are not unknown unknowns; they are known-undocumented. They have been moved out of this section to keep §15 honest.)

### Routing-truth bifurcation (most material)

Code defaults in [model-routing.ts](src/config/model-routing.ts) are not the runtime truth. Store `model_config` overrides them via [parse.ts:92-100](src/cee/unified-pipeline/stages/parse.ts#L92-L100). There is no startup log, no operator visibility, and no precedence comment in either file. Anyone adding a new task to TASK_MODEL_DEFAULTS may serve from store override or code default depending on whether someone uploaded a prompt with `model_config` set, with no way to know without inspecting Supabase. The brief's "verify believed routing" was the right instinct, but the verification mechanism it implied (read code defaults) does not produce the runtime answer. This is the proposal's #1 recommendation for a reason.

### Narrate-mode prompts are still system-seed v1 in production

Verified during this investigation by querying admin endpoint for all 10 narrate prompts. All 10 are v1, all by `system-seed`, all changeNote "Initial seed from defaults.ts", all 330-450 chars. Functional coaches with anti-em-dash and anti-XML guardrails, but no domain examples, no DSK references, no scenario-specific scaffolding. The surprise is that V5's narrate-mode infrastructure shipped wired to placeholder content with no apparent rollout of authored content. Whether this is intentional minimalism or unfinished authoring is the genuine unknown (open question 2).

### draft_graph token cost growth

Prompt has grown ~45% in 4 weeks (41,907 → 60,811 chars). Per-call input tokens correspondingly higher. No alarm threshold or growth budget in place. The surprise is the absence of any cost-trajectory governance for prompt edits, given that draft_graph fires on every full-draft user request and Sonnet 4.6 is not cheap. Tracked as finding 24 with recommendation 7.

---

## Appendix, investigation provenance

### Live data fetched 2026-04-20

- `https://cee-staging.onrender.com/v1/prompts/status` (with `X-Olumi-Assist-Key`) → `/tmp/prompts_status.json`
- `https://cee-staging.onrender.com/admin/prompts/verify` (with `X-Admin-Key`) → `/tmp/admin_verify.json`
- `https://cee-staging.onrender.com/admin/prompts/draft_graph_default` → `/tmp/draft_graph_full.json` (5MB, all 189 versions; active content saved at `/tmp/draft_graph_v189.txt`)
- `https://cee-staging.onrender.com/admin/prompts/edit_graph_default` → `/tmp/edit_graph_full.json` (active content at `/tmp/edit_graph_active.txt`)
- `https://cee-staging.onrender.com/admin/prompts/decision_review_default` → `/tmp/decision_review_full.json` (active content at `/tmp/decision_review_active.txt`)
- All 10 narrate-mode prompts queried individually for finding 12.

### Files read

[src/config/model-routing.ts](src/config/model-routing.ts), [src/cee/unified-pipeline/stages/parse.ts](src/cee/unified-pipeline/stages/parse.ts), [src/prompts/loader.ts](src/prompts/loader.ts), [src/prompts/store.ts](src/prompts/store.ts), [src/orchestrator/tools/draft-graph.ts](src/orchestrator/tools/draft-graph.ts), [src/cee/signals/brief-signals.ts](src/cee/signals/brief-signals.ts), [src/routes/assist.v1.decision-review.ts](src/routes/assist.v1.decision-review.ts), [src/orchestrator-v5/context/cqe/extract-quantities.ts](src/orchestrator-v5/context/cqe/extract-quantities.ts), [src/orchestrator-v5/context/context-pack-assembler.ts](src/orchestrator-v5/context/context-pack-assembler.ts), [src/orchestrator-v5/turn-executor.ts](src/orchestrator-v5/turn-executor.ts), [src/orchestrator/tools/stage-policy.ts](src/orchestrator/tools/stage-policy.ts), [src/orchestrator/route-v2.ts](src/orchestrator/route-v2.ts), [src/adapters/llm/router.ts](src/adapters/llm/router.ts), [data/prompts.json](data/prompts.json), [Docs/prompt-version-audit-2026-03-26.md](Docs/prompt-version-audit-2026-03-26.md), [Docs/v187-benchmark-summary-2026-03-19.md](Docs/v187-benchmark-summary-2026-03-19.md), [Docs/v5/cqe-implementation-review-pack.md](Docs/v5/cqe-implementation-review-pack.md), [tools/graph-evaluator/README.md](tools/graph-evaluator/README.md).

### What this proposal does NOT do

- No code changes.
- No prompt content authored or changed.
- No benchmark runs (proposed in §13, not executed).
- No store config changes (recommendation in §6 is a recommended next-step action for Paul, not executed in this investigation).
- No scope expansion to UI / PLoT / ISL repos.
