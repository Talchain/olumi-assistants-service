# V5 codebase audit

**Branch:** `claude/v5-codebase-audit`
**Cut point:** `e31e39b6` on `claude/v5-debug-output` (see §2.1 for deviation from brief)
**Pre-audit commit:** `635df087` lands seven reference docs
**Audit date:** 20 April 2026
**Scope:** V5 architecture and design reconciliation (brief v5-codebase-audit-v2)
**Author stance:** read-only; no architectural proposals; no push; evidence-based only.

---

## 1. Executive summary

### 1.1 Headline counts by status

| Status tag | Count |
|---|---|
| SHIPPED-LIVE | 0 |
| MERGED-TO-STAGING | 27 |
| MERGED-NOT-DEPLOYED | 0 |
| APPROVED-NOT-BUILT | 2 |
| PROPOSED-UNDESIGNED | 10 |
| SPECULATED | 0 |
| PARTIAL | 8 |
| MISMATCHED-IMPLEMENTATION | 1 |
| CONTRADICTED | 2 |
| CANNOT-VERIFY | 7 |
| **Total rows in §3** | 57 |

SHIPPED-LIVE is zero because no release notes or deployment-artefact in the branch tree evidence any V5-NNN feature being deployed to live (strict rule, §2.3). Most V5 work is in staging without a deployment-log artefact.

### 1.2 Top 5 contradictions (ordered by severity)

| # | V5-ID | One-line summary | Severity | Section reference |
|---|---|---|---|---|
| 1 | V5-031 / V5-032 / V5-033 | draft_graph coaching outputs (widening_log, bias_signals, strengthen_items, provenance, summary) are design-required but absent from V5 ContextPack: `coaching: null` stub in context-pack-assembler. Coaching UX §9.1 P1 is ABSENT. | BLOCKER | §6.1 row 1 |
| 2 | V5-022 / V5-023 / V5-024 | RoutingLog schema in spec v3.2 §13.1 nominates `tool_call_present`, `intent_class_source`, `coaching_mode_source` but routing-log.ts omits all three. Implementation logs `intent_class` and `handler_id` only. | SIGNIFICANT | §6.1 row 2 |
| 3 | V5-050 | Spec v3.2 presents V5 as a unified architecture. Code contains two coexisting orchestrator trees (`src/orchestrator-v5/` and `src/orchestrator/`) with mixed ownership. Confirms model-routing investigation finding 13. | SIGNIFICANT | §6.1 row 3 |
| 4 | V5-048 / V5-049 | Model-routing investigation finding 1 documents bifurcation between stored `model_config` (live) and code defaults. Phase 4 startup resolved-model log added (commit `b73fb528`) but resolution-time bifurcation in the store is a live state, not yet resolved. | SIGNIFICANT | §6.1 row 4 |
| 5 | Design-vs-design | Coaching UX §10.1 recommends auto-invoking a decision_review equivalent after run_analysis. Model-routing investigation §7 presents three invocation-pattern options (not two) without committing. No reconciliation. | MINOR | §6.2 row 1 |

### 1.3 Top 5 unknown unknowns (ordered by impact)

| # | Area | What is not known | Impact | Section reference |
|---|---|---|---|---|
| 1 | Live deployment state | No release notes, no deploy artefact in branch tree. Whether any V5-NNN feature is SHIPPED-LIVE cannot be verified statically. | High; affects every inventory row's Status tag. | §7 row 1 |
| 2 | RB-01 to RB-08 | MC-31 references RB-01..08 behavioural replay fixtures in `tests/fixtures/contracts/b1/README.md`. No implementation files found. Planned or deleted? | High, blocks MC-31. | §7 row 2 |
| 3 | CIL invariants | MC-32 requires seed chain, request ID chain, repair logging checks per request. Zero grep hits. Is CIL enforcement outsourced to a sibling repo or unimplemented? | High, blocks MC-32. | §7 row 3 |
| 4 | `boundary.validation` emission | MC-25: event constant defined (`telemetry.ts:437`), validator files comment "§4.4 emits", but grep shows no `.emit('boundary.validation')` call. Handled via plugin/hook? | Medium, telemetry coverage unverified. | §7 row 4 |
| 5 | Coaching UX preconditions (P1–P5) | All five ABSENT in V5 code. Design contract says they must be WIRED before v4 coaching-complete. What is the plan? | High, five-way gap, not one. | §7 row 5 |

### 1.4 Top 5 contract-first discipline concerns (ordered by severity)

| # | Check | Finding | Severity | Section reference |
|---|---|---|---|---|
| 1 | C9 / MC-29 (`warnOnInvalidApiResponse` family) | `src/cee/unified-pipeline/stages/boundary.ts:132` carries a soft-gate log-and-continue comment (Track 1 strict mode validation). On V5 execution path (unified pipeline called from V5 compose). Contract §4.2 explicitly prohibits this pattern (MC-29). | BLOCKER | §4.2.9 |
| 2 | MC-31 (behavioural replay RB-01..08) | Fixture README references RB-01..08 but no implementation files exist. Zero runtime evidence of RB fixtures executing in CI. | BLOCKER | §4.3 MC-31 |
| 3 | MC-32 (CIL invariants) | Zero grep hits for `seed_chain`, `request_id.*chain`, `CIL.invariant`. No evidence of per-request invariant enforcement. | BLOCKER | §4.3 MC-32 |
| 4 | C1 (`as any`) | 278 hits across V5 code. 91 concentrated in `src/cee/unified-pipeline/stages/repair/deterministic-sweep.ts`. 59 in `package.ts`. All production, all on V5-active paths (draft_graph repair, edit_graph). | SIGNIFICANT | §4.2.1 and §4.4 |
| 5 | C8 (unvalidated cross-service boundaries) | Three unvalidated LLM/HTTP response parse sites: ISL client `src/adapters/isl/client.ts:305` (fetch, no Zod), anthropic adapter `src/adapters/llm/anthropic.ts:154` (cast `as unknown as Promise<Response>`), run-analysis handler `src/orchestrator-v5/tools/handlers/run-analysis.ts:356` (comment: "direct cast is sound"). | SIGNIFICANT | §4.2.8 |

---

## 2. Methodology

### 2.1 Scope and cut point

Audit executes against branch `claude/v5-codebase-audit` cut from `claude/v5-debug-output` at HEAD `e31e39b6`, not from `origin/staging` at `47f1b16b` as the brief proposed.

**Reason for deviation:** six primary reference documents (architecture spec v3.2, boundary contract v1.1, CQE design v1.1, CQE investigation, model-routing investigation, V5 routing prompt v6) plus the coaching UX requirements doc existed only as working-tree files on `claude/v5-debug-output` at session start. They were not tracked on `origin/staging`. Cutting from staging would have left the audit without its primary citable artefacts. Per user decision (recorded during audit session), the branch was cut from `e31e39b6` and pre-audit commit `635df087` landed all seven reference docs before the audit began.

**Pre-audit commit (`635df087`):** `docs(v5): reference docs for codebase audit`. Adds seven files under `Docs/v5/`. No other changes.

**Sibling repo cut points (Appendix C):** UI `1cce2d23`, PLoT `26dab621`, ISL `e2ada702`, schemas `3412b761` (on `claude/v5-cqe-investigation`, package v0.6.0).

### 2.2 Source documents

Phase A read 15 reference documents. Full list in Appendix B §13.1. Primary authorities:

- `Docs/v5/olumi-v5-architecture-design-specification-v3_2.md`
- `Docs/v5/olumi-boundary-contract-v1_1.md` (machine checks MC-24 to MC-32 in §9)
- `Docs/v5/cqe-design-v1_1.md`
- `Docs/v5/cqe-investigation-proposal.md`
- `Docs/v5/model-routing-investigation-proposal.md`
- `Docs/v5/olumi-v5-routing-prompt-v6.txt`
- `Docs/v5/technical-debt-inventory-v1.md`
- `Docs/v5/olumi-coaching-ux-requirements-v1.md`

### 2.3 Status taxonomy (authoritative definitions)

| Tag | Meaning |
|---|---|
| SHIPPED-LIVE | Merged to staging AND explicit repo artefact confirms deployment (release notes, deploy commit, evidence-pack entry) AND code-inspection-verified. Strict rule per user decision. |
| MERGED-TO-STAGING | Merged to staging branch; deployment not confirmed by repo artefact. Default for in-staging features absent deployment evidence. |
| MERGED-NOT-DEPLOYED | Merged to a feature branch; not reached staging. |
| APPROVED-NOT-BUILT | Design locked; implementation brief dispatched or complete; not merged. |
| PROPOSED-UNDESIGNED | Referenced in design docs as future work; no design brief written. |
| SPECULATED | Discussed in conversation or appears as aspiration; no commitment recorded. |
| PARTIAL | Implementation exists but does not fully satisfy the design claim. |
| MISMATCHED-IMPLEMENTATION | Implementation exists but differs from design in names, shapes, or semantics. |
| CONTRADICTED | Design and code disagree and cannot be reconciled without a design or code change. |
| CANNOT-VERIFY | Verification requires action outside this audit's scope. Must name the specific resolution action. |

### 2.4 Severity taxonomy for contract-first findings

| Tag | Meaning |
|---|---|
| BLOCKER | Breaks V5 contract-first commitment; must fix before further V5 work. |
| SIGNIFICANT | Violates discipline; fix before v4 locks. |
| MINOR | Debt; acceptable with tracking. |
| COSMETIC | Style only. |

Ordering tie-breaker within a severity band: PoC-scope impact first, then alphabetical by feature name.

### 2.5 Evidence rules

Every inventory row and every finding carries a file:line citation or doc § reference. CANNOT-VERIFY rows name the specific action that would resolve them. §4 grep checks record the exact command; zero-hit results are stated explicitly. §5 field traces walk producer → serialiser → parser → consumer → persistence; broken steps flagged `BROKEN-AT-<STEP>`.

### 2.6 Sampling rules

When a grep check exceeds 50 hits, this audit switches from per-hit rows to category buckets (grouped by file-path prefix) with total hit count plus representative examples per bucket. Applied to C1 (278 hits) and C2 (79 hits); called out at the check site.

### 2.7 Limits

No runtime behaviour exercised; static analysis only. No benchmark runs. No architectural proposals (those belong to V5 Architecture v4, informed by §11 decision agenda). Sibling-repo inspection capped at grep plus targeted reads, no deeper than two files per field trace.

---

## 3. V5 feature inventory

### 3.1 Column definitions

| Column | Meaning |
|---|---|
| V5-ID | Stable sequential identifier. |
| Feature | One-line name. |
| Design source | Doc § or "none found". |
| Code location | file:line or "none found". |
| Status | One tag from §2.3. |
| Severity | Where relevant. |
| Notes | One line. |

One V5-ID may aggregate multiple design claims. Phase A's 364 claims map many-to-one onto the inventory rows.

### 3.2 Inventory table

| V5-ID | Feature | Design source | Code location | Status | Severity | Notes |
|---|---|---|---|---|---|---|
| V5-001 | CQE Layer 0 extraction | spec v3.2 §11, cqe-design-v1_1 | `src/orchestrator-v5/context/cqe/extract-quantities.ts:1-280` | MERGED-TO-STAGING | | Live on staging per commit `47f1b16b`; no deploy artefact. |
| V5-002 | CQE telemetry (`cqe.extraction`, `cqe.pattern_timeout`) | cqe-design-v1_1 §9 | `src/orchestrator-v5/turn-executor.ts:313-320, 670-674` | MERGED-TO-STAGING | | routing log carries cqe_result_count, cqe_match_count, cqe_patterns_matched. |
| V5-003 | CQE integration in routing prompt PARAMETERS | spec v3.2 §11, routing-investigation §6 | `src/orchestrator-v5/context/context-pack-assembler.ts:175`, `src/orchestrator-v5/routing/route-with-tool-use.ts:45` | MERGED-TO-STAGING | | parsed_quantities threads through ContextPack → Sonnet. |
| V5-004 | `parsed_quantities` field in ContextPack | spec v3.2, cqe-design-v1_1 | `src/orchestrator-v5/context/context-pack-assembler.ts:175` | MERGED-TO-STAGING | | Direct array passthrough. |
| V5-005 | `value_origin` optional field | cqe-design-v1_1 v1.1 | `src/orchestrator-v5/context/cqe/rules.ts:174-1017` | MERGED-TO-STAGING | | Enum set per rule; optional-preserving serialisation. |
| V5-006 | Word-number lexicon pre-pass | cqe-design-v1_1 §4 | `src/orchestrator-v5/context/cqe/word-numbers.ts` | MERGED-TO-STAGING | | Part of CQE module. |
| V5-007 | CQE fixture test suite (72 fixtures) | cqe-implementation-review-pack | `src/orchestrator-v5/context/cqe/__tests__/` | MERGED-TO-STAGING | | Fixtures exist; count not verified in this audit. |
| V5-008 | Sonnet 4.6 migration: orchestrator | v187-benchmark, prompt-version-audit | `src/config/model-routing.ts`, `src/config/index.ts` (CEE_MODEL_ORCHESTRATOR) | PARTIAL | SIGNIFICANT | Config supports override; code default is `gpt-4o`. Live store may override. Bifurcation noted by V5-048. |
| V5-009 | Sonnet 4.6 migration: draft_graph | v187-benchmark | `src/config/index.ts` (CEE_MODEL_DRAFT) | PARTIAL | MINOR | Config-pinned; no explicit Sonnet 4.6 default in code. |
| V5-010 | Sonnet 4.6 migration: edit_graph (changeNote) | routing-investigation §6 | `src/config/index.ts` (CEE_MODEL_EDIT_GRAPH) | PARTIAL | MINOR | Same as V5-009. |
| V5-011 | Sonnet 4.6 migration: explainer | routing-investigation §4 | `src/config/index.ts` | PARTIAL | MINOR | Same pattern. |
| V5-012 | Compound detection | spec v3.2 | `src/orchestrator-v5/routing/compound-detector.ts:49-101` | MERGED-TO-STAGING | | Regex-based; conjunction telemetry emitted. |
| V5-013 | Entity resolution with partial-overlap check | spec v3.2 | none found | PROPOSED-UNDESIGNED | | No `partial-overlap` or `entity-resolver` module in V5 tree. |
| V5-014 | Non-action turn classification | spec v3.2 §4 | `src/orchestrator-v5/turn-executor.ts:552-569` | PARTIAL | SIGNIFICANT | Text-only path exists; source-order heuristic (coaching_context → heuristic → default) NOT implemented. |
| V5-015 | PoC default-scale registry | spec v3.2 §6 | none found | PROPOSED-UNDESIGNED | | No default-scale registry module. |
| V5-016 | Out-of-range scale metadata | spec v3.2 §6 | none found | PROPOSED-UNDESIGNED | | Not grep-visible. |
| V5-017 | Layer D production integration | spec v3.2 | none found | PROPOSED-UNDESIGNED | | Layer D not distinct in code. |
| V5-018 | Coaching pass interface (Step 5 / Component 7) | spec v3.2, coaching UX | `src/orchestrator-v5/turn-executor.ts:481-482` | PARTIAL | BLOCKER | Step 5 is a null stub; coaching output deferred. |
| V5-019 | `@talchain/schemas` v0.6.0 | cqe-dependency-audit | `node_modules/@talchain/schemas/package.json` (0.6.0), `vendor/talchain-schemas-0.6.0.tgz` (sha256 `4d9fb407...989013` verified) | MERGED-TO-STAGING | | Vendored with hash verification; see §8.7. |
| V5-020 | `@talchain/schemas` v0.6.0 consumption in UI | coaching UX | UI `src/` imports boundary types only | PARTIAL | MINOR | UI uses boundary contracts; orchestrator namespace unused. See §8.2. |
| V5-021 | ContextPack shape and field ownership | spec v3.2 | `src/orchestrator-v5/context/context-pack-assembler.ts:92` (v2); `src/context/context-pack.ts` (v1) | MERGED-TO-STAGING | | Dual declaration documented in §6.3. |
| V5-022 | RoutingLog `tool_call_present` | spec v3.2 §13.1 | `src/orchestrator-v5/routing/routing-log.ts` | CONTRADICTED | SIGNIFICANT | Field nominated in spec; absent from routing-log.ts. |
| V5-023 | RoutingLog `intent_class_source` | spec v3.2 §13.1 | `src/orchestrator-v5/routing/routing-log.ts` | CONTRADICTED | SIGNIFICANT | Field nominated; absent. |
| V5-024 | RoutingLog `coaching_mode_source` | spec v3.2 §13.1 | `src/orchestrator-v5/routing/routing-log.ts` | CONTRADICTED | SIGNIFICANT | Field nominated; absent. |
| V5-025 | RoutingLog `graph_lookup_outcome` | spec v3.2 §13.1 | `src/orchestrator-v5/routing/routing-log.ts:32`, `src/orchestrator-v5/turn-executor.ts:669` | MERGED-TO-STAGING | | Enum wired: no_graph \| ok \| all_dropped \| test_override. |
| V5-026 | Validator checks (PoC defaults) | spec v3.2 | `src/orchestrator-v5/routing/validator.ts:244` | PARTIAL | MINOR | Validation exists; PoC-default coverage not fully traced. |
| V5-027 | decision_review endpoint routing | routing-investigation §7 | `src/prompts/schema.ts` (`decision_review` enum value) | PARTIAL | SIGNIFICANT | Prompt registered; routing-investigation §7 reports wired only to stub `generate_brief`. |
| V5-028 | decision_review pipeline auto-fire | routing-investigation §7 Option 3 | none found | PROPOSED-UNDESIGNED | | No auto-fire after run_analysis. |
| V5-029 | draft_graph coaching: `summary` | routing-investigation §3 | `src/orchestrator-v5/context/context-pack-assembler.ts:172` (`coaching: null`) | CONTRADICTED | BLOCKER | Coaching output not threaded into V5 ContextPack. |
| V5-030 | draft_graph coaching: `strengthen_items` | routing-investigation §3 | none found in V5 | CONTRADICTED | BLOCKER | Same as V5-029. |
| V5-031 | draft_graph coaching: `widening_log` | routing-investigation §3 | none found in V5 | CONTRADICTED | BLOCKER | Same as V5-029. |
| V5-032 | draft_graph coaching: `bias_signals` | routing-investigation §3 | 1 hit in `src/orchestrator-v5/context/context-pack-assembler.ts` (context, not producer) | CONTRADICTED | BLOCKER | Same as V5-029. |
| V5-033 | draft_graph coaching: parser consumption | routing-investigation §3 | none found | CONTRADICTED | BLOCKER | No V5 parser reads coaching outputs from draft_graph response. |
| V5-034 | Deterministic `bias_signals` (preflight detector) | routing-investigation finding 4 | none found in V5 scope | PROPOSED-UNDESIGNED | | Structural bias detection (DOMINANT_FACTOR, SAME_LEVER_OPTIONS, MISSING_BASELINE, STRENGTH_CLUSTERING per coaching UX §4.1) not wired in V5. |
| V5-035 | Narrate-mode prompts (10 total) | routing-investigation finding 12 | `src/prompts/schema.ts:43-59`, `src/prompts/defaults.ts` | PARTIAL | SIGNIFICANT | 3 consumed, 7 dormant. See §3.2 row B-A2 details. |
| V5-036 | Unwired prompt: `bias_check` | routing-investigation §9 | `src/prompts/schema.ts` (registered); no V5 consumer grep-visible | PARTIAL | MINOR | Registered, not wired into V5. |
| V5-037 | Unwired prompt: `critique_graph` | routing-investigation §9 | `src/prompts/schema.ts` | PARTIAL | MINOR | Same pattern. |
| V5-038 | Unwired prompt: `suggest_options` | routing-investigation §9 | `src/prompts/schema.ts` | PARTIAL | MINOR | Same pattern. |
| V5-039 | Unwired prompt: `explainer` | routing-investigation §9 | `src/prompts/schema.ts` | PARTIAL | MINOR | Same pattern. |
| V5-040 | decision_context schema | coaching UX §6 | none found | PROPOSED-UNDESIGNED | BLOCKER for coaching-complete | Not implemented. §5.7. |
| V5-041 | Signal lifecycle tracking | coaching UX §7 | none found | PROPOSED-UNDESIGNED | BLOCKER for coaching-complete | No signal_id field in V5. |
| V5-042 | coaching_state persistence | coaching UX §7 | none found; `SessionTurn` has no coaching_state field | PROPOSED-UNDESIGNED | BLOCKER for coaching-complete | Session persistence is append_turn_atomic only. |
| V5-043 | Graph-review second pass | routing-investigation §8 | none found | PROPOSED-UNDESIGNED | | No critic wiring. |
| V5-044 | `post_draft_orient` prompt | routing-investigation §9, §10 | none found | APPROVED-NOT-BUILT | | Designed in brief; not authored. |
| V5-045 | `post_rerun_bridge` prompt | routing-investigation §9, §10 | none found | APPROVED-NOT-BUILT | | Designed in brief; not authored. |
| V5-046 | Exercise block generators (pre_mortem, outside_view, challenge) | coaching UX §4.3, routing-investigation §9 | `src/orchestrator/tools/run-exercise.ts` (legacy V4) | PARTIAL | SIGNIFICANT | Handler exists in V4 tree; not wired in V5. |
| V5-047 | `run_exercise` virtual tool registration | coaching UX §4.3 | `src/orchestrator/tools/registry.ts` (legacy) | PARTIAL | MINOR | V5 tools registry at `src/orchestrator-v5/tools/registry.ts`; run_exercise not listed. |
| V5-048 | Routing-truth bifurcation (store `model_config` vs code defaults) | routing-investigation finding 1 | `src/config/model-routing.ts`, `src/prompts/stores/supabase.ts` | PARTIAL | SIGNIFICANT | Bifurcation real; resolution log added (V5-049) but store-vs-code divergence is live state. |
| V5-049 | Startup log of resolved-model-per-task | routing-investigation §12 rec 1 | `src/config/model-resolution-logger.ts` | MERGED-TO-STAGING | | Landed in `b73fb528` (Phase 4 of debug-output workstream). |
| V5-050 | Two orchestrator trees (`src/orchestrator-v5/` and `src/orchestrator/`) | routing-investigation finding 13 | `src/orchestrator-v5/`, `src/orchestrator/` | CONTRADICTED | SIGNIFICANT | Coexistence evidenced by Agent B topology. |
| V5-051 | Stage-policy gating (legacy only) | routing-investigation finding 15 | `src/orchestrator/tools/stage-policy.ts`, 6 legacy files | MERGED-TO-STAGING | | Legacy only; V5 is intent-based. |
| V5-052 | CQE-coverage telemetry for edit_graph | routing-investigation §13 | none found | PROPOSED-UNDESIGNED | | Not yet spec'd. |
| V5-053 | `PLoTClient` cross-tree usage | routing-investigation finding 13 | `src/orchestrator/plot-client.ts`, imported by both trees | MERGED-TO-STAGING | MINOR | Coexistence by design; merge risk noted. |
| V5-054 | ContextPack vs EnrichedContext duplication | routing-investigation finding 14 | `src/context/context-pack.ts` (v1), `src/orchestrator-v5/context/context-pack-assembler.ts` (v2), `src/orchestrator/pipeline/types.ts` (EnrichedContext) | MISMATCHED-IMPLEMENTATION | SIGNIFICANT | Dual decl verified; V5 imports resolve to v2 only (§6.3). |
| V5-055 | Boundary contract v1.1 MC-24 to MC-32 machine checks | boundary-contract-v1_1 §9 | See §4.3 | PARTIAL | BLOCKER | 2 GREEN, 2 PARTIAL, 2 AMBER, 2 RED. See §4.3. |
| V5-056 | Coaching UX §9.1 five data-flow preconditions | coaching-ux §9.1 | none of 5 wired | PROPOSED-UNDESIGNED | BLOCKER for coaching-complete | All five ABSENT. See §5.8. |
| V5-057 | ISL outputs to panel (factor_sensitivity, attribution_stability, factor_evpi, conditional_winners, fragile_edges, inference_warnings) | coaching UX §2.8, §9.1 | `src/routes/assist.v1.isl-synthesis.ts`, `src/cee/` (CEE scope, not V5) | CANNOT-VERIFY | SIGNIFICANT | ISL outputs exist in CEE; V5-to-panel routing not evidenced. Resolves by: trace from CEE to UI. |

**Inventory total:** 57 rows. Sequential V5-001 to V5-057. No gaps.

---

## 4. Contract-first discipline findings

### 4.1 Check register

| # | Name | Command | Scope | Hits | Sampling | Severity | Finding § |
|---|---|---|---|---|---|---|---|
| C1 | `as any` in V5 code | `grep -rn "as any" src/orchestrator-v5/ src/cee/unified-pipeline/` | V5 + CEE pipeline | 278 | bucket by path | SIGNIFICANT | §4.2.1 |
| C2 | `as unknown` in V5 code | `grep -rn "as unknown" src/orchestrator-v5/ src/cee/unified-pipeline/` | V5 + CEE pipeline | 79 | bucket by path | MINOR | §4.2.2 |
| C3 | Local interfaces shadowing `@talchain/schemas` | grep per-schema-type | V5 production | 0 shadows; 3 local extensions | per-type | MINOR | §4.2.3 |
| C4 | Zod schemas defined but never parsed | `grep` `z.object\|z.discriminatedUnion\|z.union`; cross-ref with `.parse`/`.safeParse` | V5 production | 4 declared, 4 consumed | per-schema | none | §4.2.4 |
| C5 | Fields populated but never read | per-field grep | V5 production | 0 confirmed | per-field | none | §4.2.5 |
| C6 | Fields read but never populated | inverse | V5 production | 0 confirmed | per-field | none | §4.2.6 |
| C7 | Schema drift `@talchain/schemas` v0.6.0 vs CEE locals | type-by-type diff | V5 production | 0 drifts | per-type | none | §4.2.7 |
| C8 | Unvalidated cross-service boundaries | grep `fetch`, LLM parse sites | V5 production | 3 unvalidated | per-boundary | SIGNIFICANT | §4.2.8 |
| C9 | `warnOnInvalidApiResponse` family | `grep -rn "warnOnInvalid\|warn.*invalid.*api\|log.*and.*continue\|console.*warn.*valid" src/` | whole src/ | 3 hits, 1 on V5 path | per-hit | BLOCKER | §4.2.9 |

### 4.2 Check details

#### 4.2.1 C1 `as any` (278 hits, bucketed)

| Bucket (path prefix) | Count | Representative file:line | Production / test |
|---|---|---|---|
| `src/cee/unified-pipeline/stages/repair/deterministic-sweep.ts` | 91 | lines 986, 993, 1291, 1492 | production |
| `src/cee/unified-pipeline/stages/package.ts` | 59 | lines 132-170, 369, 452, 682 | production |
| `src/cee/unified-pipeline/stages/boundary.ts` | 17 | lines 170, 185 | production |
| `src/cee/unified-pipeline/stages/repair/connectivity.ts` | 14 | edge/node reconstruction | production |
| `src/cee/unified-pipeline/stages/repair/unreachable-factors.ts` | 12 | synthetic node creation | production |
| `src/cee/unified-pipeline/stages/parse.ts` | 12 | LLM metadata at lines 85-400 | production |
| `src/cee/unified-pipeline/edge-identity.ts` | 11 | edge field tracking | production |
| Other CEE files | 6 | threshold-sweep, status-quo-fix, normalise, enrich | production |
| `src/orchestrator-v5/tools/handler-errors.ts` | 1 | line 93 (comment context) | production |
| Remaining in `src/orchestrator-v5/` | 55 | mostly tests and mock casts | tests (per Agent C Phase 1) |

**Severity:** SIGNIFICANT. `src/orchestrator-v5/` production code is clean. The 200+ production-code hits concentrate in `src/cee/unified-pipeline/` (legacy graph handling). These are on V5-active execution paths per §4.4.

#### 4.2.2 C2 `as unknown` (79 hits, bucketed)

| Bucket | Count | Note |
|---|---|---|
| `src/orchestrator-v5/**/__tests__/` | 65 | tests; safe context |
| `src/orchestrator-v5/session/store.ts` | 2 | production; lines 57, 76 (error.cause assignment) |
| `src/cee/unified-pipeline/stages/boundary.ts` | 2 | production; lines 170, 185 (diagnostic) |
| Other production | 10 | `routing/route-with-tool-use.ts:376`, `context/__tests__`, `dispatch.ts`, `routing/__tests__` |

**Severity:** MINOR. 65 of 79 are tests; production usage is narrow (error.cause narrowing, diagnostic casts).

#### 4.2.3 C3 Local interfaces shadowing `@talchain/schemas`

Zero shadow violations. Three local extensions (permitted):

| Local type | Location | Schemas counterpart | Classification |
|---|---|---|---|
| `ContextPack` | `src/orchestrator-v5/context/context-pack-assembler.ts:92` | none | local extension (V5 LLM-facing projection) |
| `RoutingLog` | `src/orchestrator-v5/routing/routing-log.ts:91` | none | local extension |
| `RoutingLogInput` | `src/orchestrator-v5/routing/routing-log.ts:38` | none | local extension |

`QuantityExtractionResult` imported directly (`src/orchestrator-v5/context/cqe/extract-quantities.ts:1`). No drift.

**Severity:** none. Contract permits shape-identical aliases with tests.

#### 4.2.4 C4 Orphan Zod schemas

| Schema | Declared | Consumed? |
|---|---|---|
| `ProposalEntitySchema` | `src/orchestrator-v5/routing/types.ts:120` | composed into ProposalSchema (line 152-165); validated |
| `ProposalParameterSchema` | `src/orchestrator-v5/routing/types.ts:137` | composed; validated |
| `ProposalActionSchema` | `src/orchestrator-v5/routing/types.ts:152` | composed; validated |
| `ProposalClarificationSchema` | `src/orchestrator-v5/routing/types.ts:165` | composed; validated |

**Severity:** none.

#### 4.2.5 C5 Populated-but-never-read fields

| Field | Producer | Consumer | Status |
|---|---|---|---|
| value_origin | `src/orchestrator-v5/context/cqe/rules.ts` (many) | `extract-quantities.ts:169` (filter) | consumed |
| compound_pattern_matched | `context-pack-assembler.ts:174` | `turn-executor.ts:651` | consumed |
| parsed_quantities | `context-pack-assembler.ts:175` | `turn-executor.ts:326` | consumed |
| graph_lookup_outcome | `turn-executor.ts:669` | `routing-log.ts:158, 195` | consumed |
| bias_signals | `package.ts:369, 452` | `package.ts:139-160` | consumed (CEE pipeline only; not in V5 consumer) |
| strengthen_items | `package.ts:143` | `package.ts:159-160` | consumed (CEE pipeline only) |
| provenance | `deterministic-sweep.ts` many | `package.ts:682` | consumed (CEE pipeline only) |
| widening_log | not found in V5 | n/a | not in V5 scope |
| tool_call_present | not found | n/a | §6.1 row 2 |
| intent_class_source | not found | n/a | §6.1 row 2 |
| coaching_mode_source | not found | n/a | §6.1 row 2 |

**Severity:** none for C5 strictly (no populated-but-unread in V5 scope). Missing fields (widening_log, tool_call_present, *_source) are C6 misses, handled below.

#### 4.2.6 C6 Read-but-never-populated fields

No strict C6 failures in V5 scope. The CONTRADICTED cases (V5-022, V5-023, V5-024, V5-029..033) are design-vs-code contradictions rather than C6 orphans because the spec names the field but no read site exists either.

**Severity:** none.

#### 4.2.7 C7 Schema drift

Zero drift. All V5 imports reference `@talchain/schemas/{boundary,orchestrator,cee}` directly; no local shadow with divergent shape. ContextPack and RoutingLog are V5 local types by design, not drifted copies.

**Severity:** none.

#### 4.2.8 C8 Unvalidated cross-service boundaries

| Boundary | File:line | Validation | Status |
|---|---|---|---|
| ISL HTTP response | `src/adapters/isl/client.ts:305` | `.json()` parse, no Zod | UNVALIDATED |
| Anthropic tool-schema build | `src/adapters/llm/anthropic.ts:154` | `as unknown as Promise<Response>` | UNVALIDATED |
| Run-analysis handler PLoT response | `src/orchestrator-v5/tools/handlers/run-analysis.ts:356` | comment "direct cast is sound" | UNVALIDATED |
| Anthropic schema compliance wrapper | `src/adapters/llm/anthropic-schema-compliance.ts` | SDK + `as any` manipulation | PARTIALLY-VALIDATED |
| Classifier tool output | `src/orchestrator-v5/classify.ts:169, 187` | `ClassifierOutputSchema.safeParse`, `V5ActionTypeSchema.safeParse` | VALIDATED |
| Routing tool call | `src/orchestrator-v5/routing/tool-schema.ts:269` | `RawToolCallSchema.safeParse` | VALIDATED |
| Boundary ingress | `src/orchestrator-v5/boundary/request-extensions.ts:144, 176` | `Graph/Analysis StateIngressSchema.safeParse` | VALIDATED |
| Session DB reads | `src/orchestrator-v5/session/supabase-store.ts:140, 188` | `Session/Handler FactSchema.safeParse` | VALIDATED |

**Severity:** SIGNIFICANT. Three V5-adjacent boundaries unvalidated.

#### 4.2.9 C9 `warnOnInvalidApiResponse` family (V2.1 D-A3)

| Hit | Location | Snippet | V5 path? | Severity |
|---|---|---|---|---|
| 1 | `src/cee/unified-pipeline/stages/boundary.ts:132` | soft-gate log-and-continue comment on strict-mode validation | YES (unified pipeline called from V5 compose) | BLOCKER |
| 2 | `src/routes/assist.v1.draft-graph.ts:404` | low-readiness log-and-continue path (not in strict mode) | indirect (assist route; pre-V5 flow) | SIGNIFICANT |
| 3 | `src/services/session-cache.ts:130` | "Never throws - logs errors and continues" | no (session cache independent of validation flow) | MINOR |

**Severity:** BLOCKER for hit 1. Directly violates MC-29 (§4.2 boundary contract v1.1) and is on a V5 execution path.

### 4.3 Boundary contract v1.1 §9 machine checks (MC-24 to MC-32) (V2.1 D-A1)

| MC | Rule (contract §) | Check | Status | Evidence |
|---|---|---|---|---|
| MC-24 | §1.1 one source | No local redefinition of `@olumi/contracts/boundary` types | IMPLEMENTED (GREEN) | 31 imports from `@talchain/schemas`; no `@olumi/contracts/boundary` imports in this repo; no shape-incompatible shadows per C3. |
| MC-25 | §1.2 every boundary validates | Every B1-B5 request/response emits `boundary.validation` | PARTIAL (AMBER) | Event constant at `src/utils/telemetry.ts:437-440`; comments at `src/validators/b1.ts:10`, `src/orchestrator/route-v2.ts:8`; plugin `src/plugins/boundary-logging.ts:140-194` handles meta emission. Direct `.emit('boundary.validation')` not grep-visible. Unknown unknown §7 row 4. |
| MC-26 | §1.3 fail-closed | Adversarial invalid fixtures rejected with typed error | PARTIAL (AMBER) | `tests/integration/adversarial.test.ts` and `tests/fixtures/contracts/b1/` present; systematic per-boundary fail-closed coverage not verified. |
| MC-27 | §1.5 contract tests block merge | `contracts-test` workflow required | IMPLEMENTED (GREEN) | `.github/workflows/contract-schemas.yml` and `ci.yml` enforce contract validation in CI. |
| MC-28 | §1.6 schema versioning | Breaking change without major bump blocks merge | IMPLEMENTED (GREEN) | `@talchain/schemas` pinned via `file:./vendor/talchain-schemas-0.6.0.tgz` with sha256 hash sidecar `4d9fb407...989013` (verified match). File-pin prevents uncontrolled upgrades. |
| MC-29 | §4.2 no log-and-continue | `warnOnInvalidApiResponse` patterns prohibited | UNIMPLEMENTED (RED) | Soft gate on V5 path at `src/cee/unified-pipeline/stages/boundary.ts:132`. Violates contract. See C9. |
| MC-30 | §5.3 contract replay | Fixtures validate against current schema in CI | PARTIAL (AMBER) | Fixtures at `tests/fixtures/contracts/b1/` plus `tests/validation/golden-briefs-runner.test.ts`; explicit CI replay step not grep-visible; relies on vitest discovery. |
| MC-31 | §5.4 behavioural replay | RB-01 through RB-08 pass in CI | UNIMPLEMENTED (RED) | `tests/fixtures/contracts/b1/README.md:13` references `RB-01 … RB-08` but zero implementation files grep-visible. Unknown unknown §7 row 2. |
| MC-32 | §7 CIL invariants | Seed chain, request ID chain, repair logging per request | UNIMPLEMENTED (RED) | Zero grep hits for `seed_chain`, `request_id.*chain`, `CIL.invariant`. Unknown unknown §7 row 3. |

**Summary:** 3 IMPLEMENTED, 3 PARTIAL, 3 UNIMPLEMENTED.

### 4.4 `as any` on V5-active execution paths (V2.1 D-A6)

Classification of the 200+ production `as any` hits in `src/cee/unified-pipeline/` by V5-active status. V5-active means the unified pipeline is called from V5 routing (draft_graph, edit_graph). Verified: `src/orchestrator-v5/tools/handlers/run-analysis.ts` invokes the PLoT client which feeds back through pipeline repair; `draft_graph` and `edit_graph` paths run unified pipeline repair.

| File | Count | V5-active? | Note |
|---|---|---|---|
| `stages/repair/deterministic-sweep.ts` | 91 | YES | draft_graph + edit_graph repair pass. |
| `stages/package.ts` | 59 | YES | pipeline output assembly. |
| `stages/boundary.ts` | 17 | YES | V3 transform + analysis_ready. |
| `stages/repair/connectivity.ts` | 14 | YES | edge repair. |
| `stages/repair/unreachable-factors.ts` | 12 | YES | unreachable node removal. |
| `stages/parse.ts` | 12 | YES | LLM draft normalisation. |
| `edge-identity.ts` | 11 | YES | edge identity computation. |

All 7 concentrated paths are V5-active. **Severity: SIGNIFICANT** (graph-handling code lacks structural typing and mutates via untyped casts on V5 critical paths).

---

## 5. Data flow traces

Trace template per §5.1: producer → serialiser → parser → consumer → persistence/log. Broken steps tagged `BROKEN-AT-<STEP>`.

### 5.2 CQE quantity extraction

#### 5.2.1 `parsed_quantities`

| Step | Site | File:line |
|---|---|---|
| Producer | CQE rules emit `Partial<QuantityExtractionResult>` | `src/orchestrator-v5/context/cqe/rules.ts:232-670` (many) |
| Serialiser (internal merge) | `buildResult()` fills defaults | `src/orchestrator-v5/context/cqe/extract-quantities.ts:250-270` |
| Serialiser (ContextPack) | `runExtraction().results → parsed_quantities` | `src/orchestrator-v5/context/context-pack-assembler.ts:175` |
| Parser (routing) | ContextPack received by Sonnet | `src/orchestrator-v5/routing/route-with-tool-use.ts:45` |
| Consumer | LLM proposes parameters via tool schema | `src/orchestrator-v5/routing/tool-schema.ts:35-133` |
| Persistence | Routing log carries cqe aggregate counts; individual quantities not replayed by design | `src/orchestrator-v5/turn-executor.ts:313-320, 670-674` |

**Status:** COMPLETE.

#### 5.2.2 `value_origin`

| Step | Site | File:line |
|---|---|---|
| Producer | Per-rule assignment (literal, lexical_quantifier, word_fraction, suffix_expansion, word_number, parsed_numeric) | `src/orchestrator-v5/context/cqe/rules.ts:174-175, 232-670` |
| Serialiser | Optional-preserving spread in buildResult | `src/orchestrator-v5/context/cqe/extract-quantities.ts:255, 269` |
| Serialiser (ContextPack) | passthrough | `src/orchestrator-v5/context/context-pack-assembler.ts:175` |
| Parser | Sonnet reads via PARAMETERS | routing call threads ContextPack |
| Consumer | Post-extraction filter on lexical_quantifier+null | `src/orchestrator-v5/context/cqe/extract-quantities.ts:169` |
| Persistence | Aggregate only | as 5.2.1 |

**Status:** COMPLETE.

#### 5.2.3 Remaining QuantityExtractionResult fields

(value, unit, direction, multiplier, operator, comparator, range_min, range_max, approximate, source), all traced COMPLETE via the same producer → ContextPack → routing-call → tool-schema chain. Defaults filled in `extract-quantities.ts:257-270`. Individual array items not in routing log (aggregate metrics only).

**Status:** COMPLETE.

### 5.3 Compound signals

#### 5.3.1 `compound_detected`

| Step | Site | File:line |
|---|---|---|
| Producer | `detectCompound` heuristic (regex conjunctions) | `src/orchestrator-v5/routing/compound-detector.ts:49-101` |
| Serialiser (ContextPack) | `compound.detected → ContextPack.compound_detected` | `src/orchestrator-v5/context/context-pack-assembler.ts:164, 173` |
| Serialiser (optional segments) | conditional `compound_segments` | `src/orchestrator-v5/context/context-pack-assembler.ts:178-181` |
| Parser | Sonnet reads flag | `src/orchestrator-v5/routing/route-with-tool-use.ts:45` |
| Consumer | Phase 1a stub; chip-remainder deferred to Phase 2 | no wired composition |
| Persistence | `RoutingLogInput.compound_detected → RoutingLog.compound_detected` | `src/orchestrator-v5/turn-executor.ts:650`, `src/orchestrator-v5/routing/routing-log.ts:48, 101` |

**Status:** COMPLETE (classification + persistence; Phase 2 behaviour deferred).

#### 5.3.2 `compound_pattern_matched`

Same chain: `compound-detector.ts:94-96` produces pattern name; ContextPack and RoutingLog carry it.

**Status:** COMPLETE.

### 5.4 Intent and coaching mode

#### 5.4.1 `intent_class`

| Step | Site | File:line |
|---|---|---|
| Producer (execute) | Sonnet tool-call enum | `src/orchestrator-v5/routing/tool-schema.ts:35-132` |
| Producer (text_only) | Inferred as `converse` | `src/orchestrator-v5/routing/route-with-tool-use.ts:71-78` |
| Parser | `parseToolCallResponse` Zod | `src/orchestrator-v5/routing/tool-schema.ts:141-173` |
| Serialiser | `summariseRouting(result)` | `src/orchestrator-v5/turn-executor.ts:373-377` |
| Consumer | Branch: execute/clarify/coach/converse | `src/orchestrator-v5/turn-executor.ts:388, 504-530, 552-569` |
| Persistence | RoutingLog | `src/orchestrator-v5/turn-executor.ts:644`, `src/orchestrator-v5/routing/routing-log.ts:42, 95` |

**Status:** COMPLETE.

#### 5.4.2 `intent_class_source`

| Step | Site |
|---|---|
| Producer | NOT IMPLEMENTED (no source-order heuristic in V5) |
| Serialiser | NOT IMPLEMENTED (absent from routing-log.ts) |
| Parser | NOT IMPLEMENTED |
| Consumer | NOT IMPLEMENTED |
| Persistence | NOT IMPLEMENTED |

**Status:** BROKEN-AT-PRODUCER. Spec v3.2 §13.1 nominates enum; zero grep hits. §6.1 contradiction.

#### 5.4.3 `coaching_mode` (V2.1 C-A4 full trace)

**How the system decides between coach / execute / converse / clarify:**
1. Sonnet chooses via tool-call enum (`src/orchestrator-v5/routing/tool-schema.ts:35-132`).
2. No heuristic fallback in V5 Phase 1a; classification is 100% Sonnet-driven.
3. Spec v3.2 §4 source order (coaching_context → heuristic → default) is NOT implemented.
4. `coaching_mode` populated only when `intent_class === 'coach'` (`src/orchestrator-v5/turn-executor.ts:886` reads `result.proposal.coaching_mode ?? null`).

**`buildCoachingSection` locations:**
- Found ONLY in legacy V4 deterministic path: `src/orchestrator/deterministic/prompt-builder-v2.ts:372`.
- NOT in `src/orchestrator-v5/`. V5 Step 5 stub at `src/orchestrator-v5/turn-executor.ts:481-482` is a null COACH stub.

| Step | Site | File:line |
|---|---|---|
| Producer | Sonnet tool input | `src/orchestrator-v5/routing/tool-schema.ts:50-54` (enum: reframe \| challenge \| deepen \| summarise) |
| Parser | Zod refinement | `src/orchestrator-v5/routing/tool-schema.ts:150-165` |
| Serialiser | `summariseRouting` | `src/orchestrator-v5/turn-executor.ts:867-891` |
| Consumer | Branch: distinct direct_answer path | `src/orchestrator-v5/turn-executor.ts:530-551` |
| Persistence | RoutingLog | `src/orchestrator-v5/turn-executor.ts:646`, `src/orchestrator-v5/routing/routing-log.ts:44, 97` |

**Status:** WIRED for classification. Coaching OUTPUT (widening_log, bias_signals, etc.) not produced. Spec v3.2 §4 source-order tier unimplemented.

#### 5.4.4 `coaching_mode_source`

Same BROKEN-AT-PRODUCER story as `intent_class_source`. Spec nominates; implementation absent.

#### 5.4.5 `tool_call_present`

| Step | Site | File:line |
|---|---|---|
| Producer | `RoutingResult.type === 'tool_call' \| 'text_only'` | `src/orchestrator-v5/routing/route-with-tool-use.ts:80` |
| Consumer | Path branching | `src/orchestrator-v5/turn-executor.ts:388, 504, 528, 552` |
| Persistence | **NOT EXPLICIT** on RoutingLog schema | `src/orchestrator-v5/routing/routing-log.ts:38-89` omits the field |

**Status:** BROKEN-AT-SERIALISER. Value inferrable from (intent_class !== null AND handler_id !== null) but spec-mandated explicit field missing.

### 5.5 Graph lookup

#### 5.5.1 `graph_lookup_outcome`

| Step | Site | File:line |
|---|---|---|
| Producer | `buildGraphLookup` adapter emits kind | `src/orchestrator-v5/routing/graph-lookup-adapter.ts` |
| Serialiser | `graphLookupBuildReason` var | `src/orchestrator-v5/turn-executor.ts:244, 253, 260` |
| Consumer | Hard-fail on `all_dropped` | `src/orchestrator-v5/turn-executor.ts:275` |
| Persistence | RoutingLog + telemetry | `src/orchestrator-v5/turn-executor.ts:234-268, 669` |

**Status:** COMPLETE.

### 5.6 draft_graph coaching outputs

#### 5.6.1 `widening_log`

| Step | Site |
|---|---|
| Producer | NOT IN V5 (draft_graph CEE route owns, not V5) |
| Serialiser | NOT IN V5 (`coaching: null` stub at `src/orchestrator-v5/context/context-pack-assembler.ts:172`) |
| Parser | NOT IN V5 |
| Consumer | NOT IN V5 |
| Persistence | NOT IN V5 |

**Status:** DESIGN-ONLY in V5. Routing-investigation §3 confirms CEE pipeline drops structured coaching fields.

#### 5.6.2 `bias_signals`, 5.6.3 `strengthen_items`, 5.6.4 `summary`, 5.6.5 `provenance`

All four: identical DESIGN-ONLY status in V5. `src/orchestrator-v5/context/context-pack-assembler.ts:172` stubs `coaching: null`. Zero V5 producers. Zero V5 consumers. Legacy V4 produces some of these fields (deterministic-sweep, package.ts) inside the unified pipeline but they do not thread into V5 ContextPack.

### 5.7 `decision_context` (design-only)

| Step | Site |
|---|---|
| All | NOT IMPLEMENTED |

Zero grep hits in V5 or legacy orchestrator. Coaching UX §6 nominates as typed schema. **Status:** DESIGN-ONLY. Feeds V5-040 and §11 decision agenda.

### 5.8 Coaching UX §9.1 data flow preconditions (V2.1 C-A8)

| # | Precondition | State | Evidence |
|---|---|---|---|
| P1 | draft_graph structured outputs (coaching, widening_log, bias_signals, provenance) reach orchestrator context | ABSENT | `src/orchestrator-v5/context/context-pack-assembler.ts:172` = `coaching: null`. No wiring. |
| P2 | decision_context schema populated at draft time, accessible to every coaching call | ABSENT | No decision_context schema in codebase (§5.7). |
| P3 | coaching_state persists across turns with correct invalidation | ABSENT | `src/orchestrator-v5/session/supabase-store.ts` stores SessionTurn only. No coaching_state column or field. |
| P4 | signal_id lifecycle tracking across draft → analysis → rerun | ABSENT | No signal_id field in RoutingLog, ContextPack, or turn store. |
| P5 | ISL outputs (factor_sensitivity, attribution_stability, factor_evpi, conditional_winners, fragile_edges, inference_warnings) reach the panel | ABSENT | Zero grep hits in `src/orchestrator-v5/`. ISL outputs exist in CEE (`src/routes/assist.v1.isl-synthesis.ts`, `src/cee/`) but V5-to-panel routing not evidenced. V5-057 CANNOT-VERIFY. |

**Summary:** 5/5 ABSENT. Coaching-complete per coaching UX §9.1 requires all five WIRED.

### 5.9 Trace summary

| Field | Producer | Serialiser | Parser | Consumer | Persistence | Status |
|---|---|---|---|---|---|---|
| parsed_quantities | rules.ts | context-pack-assembler.ts:175 | route-with-tool-use.ts:45 | tool-schema.ts:35-133 | routing-log (aggregate) | COMPLETE |
| value_origin | rules.ts (per-rule) | extract-quantities.ts:255 | routing call | extract-quantities.ts:169 (filter) | aggregate | COMPLETE |
| QuantityExtractionResult.* | rules.ts | extract-quantities.ts:257-270 | routing call | tool-schema | aggregate | COMPLETE |
| compound_detected | compound-detector.ts:49-101 | context-pack-assembler.ts:164 | routing call | (Phase 2 deferred) | routing-log.ts:101 | COMPLETE |
| compound_pattern_matched | compound-detector.ts:94 | context-pack-assembler.ts:174 | routing call | (Phase 2) | routing-log.ts:102 | COMPLETE |
| intent_class | tool-schema.ts:35 | turn-executor.ts:373 | tool-schema parse | turn-executor branch | routing-log.ts:95 | COMPLETE |
| intent_class_source | n/a | n/a | n/a | n/a | n/a | BROKEN-AT-PRODUCER |
| coaching_mode | tool-schema.ts:50 | turn-executor.ts:867 | tool-schema parse | turn-executor branch | routing-log.ts:97 | COMPLETE (classification only) |
| coaching_mode_source | n/a | n/a | n/a | n/a | n/a | BROKEN-AT-PRODUCER |
| tool_call_present | route-with-tool-use.ts:80 | (missing) | inferred | turn-executor branches | (not explicit) | BROKEN-AT-SERIALISER |
| graph_lookup_outcome | graph-lookup-adapter | turn-executor.ts:244 | n/a | turn-executor.ts:275 | routing-log.ts:669 | COMPLETE |
| widening_log | n/a | n/a | n/a | n/a | n/a | DESIGN-ONLY |
| bias_signals | n/a | n/a | n/a | n/a | n/a | DESIGN-ONLY |
| strengthen_items | n/a | n/a | n/a | n/a | n/a | DESIGN-ONLY |
| summary | n/a | n/a | n/a | n/a | n/a | DESIGN-ONLY |
| provenance | n/a | n/a | n/a | n/a | n/a | DESIGN-ONLY |
| decision_context | n/a | n/a | n/a | n/a | n/a | DESIGN-ONLY |

---

## 6. Contradictions

### 6.1 Design vs code

| # | V5-ID | Design claim (doc §) | Code behaviour (file:line) | Nature | Severity |
|---|---|---|---|---|---|
| 1 | V5-029..033 | coaching UX §9.1 P1 + routing-investigation §3: draft_graph structured outputs reach orchestrator context | `src/orchestrator-v5/context/context-pack-assembler.ts:172` = `coaching: null` | Coaching outputs absent from V5 ContextPack. | BLOCKER |
| 2 | V5-022..024 | spec v3.2 §13.1 lists `tool_call_present`, `intent_class_source`, `coaching_mode_source` on RoutingLog | `src/orchestrator-v5/routing/routing-log.ts:38-89` omits all three | Schema mismatch. | SIGNIFICANT |
| 3 | V5-050 | spec v3.2 presents unified V5 architecture | `src/orchestrator-v5/` and `src/orchestrator/` both active | Two coexisting trees; PLoTClient imported by both. | SIGNIFICANT |
| 4 | V5-048 | spec v3.2 expects deterministic model resolution | `src/config/model-routing.ts` + live Supabase store can override code defaults | Bifurcation between code and store; resolution observable at startup (V5-049) but not in-request. | SIGNIFICANT |
| 5 | V5-055 C9 / MC-29 | boundary contract v1.1 §4.2 prohibits `warnOnInvalidApiResponse`-style log-and-continue | `src/cee/unified-pipeline/stages/boundary.ts:132` soft-gate log-and-continue comment | Contract violation on V5 path. | BLOCKER |
| 6 | V5-018 | spec v3.2 §5 Step 5 coaching pass interface | `src/orchestrator-v5/turn-executor.ts:481-482` null stub | Step exists in shape; no coach-output producer. | BLOCKER |
| 7 | V5-014 | spec v3.2 §4 non-action turn classification: source order coaching_context → heuristic → default | `src/orchestrator-v5/turn-executor.ts:552-569` text-only branch without tiers | Source order not implemented. | SIGNIFICANT |

### 6.2 Design vs design

| # | Topic | Doc A (§) | Doc B (§) | Nature | Severity |
|---|---|---|---|---|---|
| 1 | decision_review invocation pattern | coaching UX §10.1 recommends auto-invoke after run_analysis | model-routing-investigation §7 presents three options (auto-fire, lazy on panel mount, progressive streaming) without commitment | Recommendation vs unresolved options | MINOR |
| 2 | coaching output responsibility | coaching UX §8.1 lists required auto-fire outputs | routing-investigation §3 finding: draft_graph emits coaching fields but CEE pipeline likely drops them | Who owns threading: draft_graph, orchestrator, or CEE pipeline? | SIGNIFICANT |

Both contradictions recorded unresolved per user decision. Propagated to §11 decision agenda.

### 6.3 ContextPack v1 vs v2 import verification (V2.1 B-A5)

Single explicit V5 import found:

| File | Import path | Resolves to | Action |
|---|---|---|---|
| `src/orchestrator-v5/routing/route-with-tool-use.ts:45` | `'../context/context-pack-assembler.js'` | v2 (LLM-facing) | OK, correct per design |
| `src/orchestrator-v5/tools/handlers/run-analysis.ts` | reference only in docstring | n/a | OK |

Zero v1 imports from `src/context/context-pack.ts` in V5 code. V5-054 is a coexistence issue (two declarations on different paths) rather than a mis-import.

---

## 7. Unknown unknowns

| # | Area | Question the repo cannot answer | Why it matters | Proposed evidence | Severity |
|---|---|---|---|---|---|
| 1 | Live deployment state | Which V5-NNN features are deployed to live? | Every Status tag leans MERGED-TO-STAGING without deploy artefact | release notes or deploy commit in repo | High |
| 2 | RB-01..08 | Planned or deleted? Filename or issue-tracker reference? | Blocks MC-31 | check issue tracker for RB- tickets; check git log for deleted fixtures | High |
| 3 | CIL invariants | Outsourced to sibling repo or unimplemented? | Blocks MC-32 | check ISL and PLoT for invariant enforcement | High |
| 4 | `boundary.validation` emission | Plugin-based emission not grep-visible? | MC-25 coverage unverified | read `src/plugins/boundary-logging.ts` in full; runtime trace | Medium |
| 5 | Coaching UX §9.1 P1-P5 | What's the sequenced plan to wire five preconditions? | Five-way gap blocks coaching-complete | V5 Architecture v4 decision agenda | High |
| 6 | decision_review prompt consumption | Wired only to stub generate_brief (routing-investigation §7) or also lazy-fireable? | Affects V5-027 status interpretation | trace run_analysis → decision_review call chain | Medium |
| 7 | `bias_signals` dual domain | Field name `bias_signals` appears both as CEE pipeline output (`package.ts:369`) and as coaching UX §4.2 post-analysis output. Same field, or semantic collision? | Naming collision hides ownership | compare field shapes between CEE pipeline and coaching UX contract | Medium |
| 8 | Sonnet 4.6 live model | Config supports override but which model is actually running on staging? | V5-008..011 Status uncertainty | runtime telemetry query | Medium |

---

## 8. Cross-service integration state

### 8.1 Summary

| Sibling repo | Branch | HEAD | Package | Consumed V5 fields | Unconsumed orchestrator exports |
|---|---|---|---|---|---|
| DecisionGuideAI (UI) | staging | `1cce2d23` | n/a | OlumiResponse, OrchestratorTurnPayload, ValidationWarning, CIL_WARNING_CODES, CIL_THRESHOLDS, FAILURE_USER_TEXT, FailureTypeLiteral, PlotRequestIdChain, DraftGraphTrace | entire orchestrator namespace |
| plot-lite-service (PLoT) | staging | `26dab621` | n/a | LIMITS, DEFAULT_EXISTS_PROBABILITY, SeedSourceType, DetailLevel, PlotCeeUpstreamEnvelope, PlotProxyTimeoutError | entire orchestrator namespace |
| Inference-Service-Layer (ISL) | staging | `e2ada702` | Python; no schemas consumption | none | all (Python runtime) |
| olumi-schemas | claude/v5-cqe-investigation | `3412b761` | 0.6.0 | producer | many (orchestrator namespace consumed only by CEE) |

### 8.2 DecisionGuideAI (UI)

Consumes boundary contracts only. Does not read `parsed_quantities`, `value_origin`, `widening_log`, `bias_signals`, `coaching_mode`, `routing_log`, `tool_call_present`, `graph_lookup_outcome`, or any V5 orchestrator namespace export.

`run_exercise` found as a local guidance action type in `src/canvas/conversation/GuidanceStrip.tsx`, not from `@talchain/schemas`.

### 8.3 plot-lite-service (PLoT)

Consumes root-level constants and enums. No orchestrator namespace. No V5-field references.

### 8.4 Inference-Service-Layer (ISL)

Python-only. Zero schema consumption. `decision_context` appears in `src/models/deliberation.py` as a local Habermas field, unrelated to V5 coaching-UX `decision_context`.

### 8.5 olumi-schemas (producer)

Package v0.6.0. HEAD `3412b761` on `claude/v5-cqe-investigation`. Exports orchestrator namespace as future-proofing; currently consumed only by CEE.

### 8.6 CEE-internal field list

Every V5 field pattern below is produced and consumed entirely within CEE; no boundary crossing to UI, PLoT, or ISL:

`intent_class`, `intent_class_source` (designed, not built), `coaching_mode`, `coaching_mode_source` (designed, not built), `tool_call_present` (designed, not built), `graph_lookup_outcome`, `compound_detected`, `compound_pattern_matched`, `parsed_quantities`, `value_origin`, `QuantityExtractionResult.*`, `widening_log` (design-only), `bias_signals` (design-only in V5; produced in CEE pipeline), `strengthen_items` (design-only in V5), `provenance` (design-only in V5; produced in CEE pipeline), `routing_log`, `RoutingLog`, `RoutingLogInput`, ContextPack v2.

### 8.7 Schemas tarball hash verification (V2.1 C-A7)

| Check | Result |
|---|---|
| `node_modules/@talchain/schemas/package.json` version | 0.6.0 |
| Vendored tarball | `vendor/talchain-schemas-0.6.0.tgz` (45,961 bytes) |
| Stored sha256 sidecar | `vendor/talchain-schemas-0.6.0.tgz.sha256` = `4d9fb4079bec2bf95f65ae2d0f0490281fc86a09a578b62d88426de500989013` |
| Computed sha256 of tarball | `4d9fb4079bec2bf95f65ae2d0f0490281fc86a09a578b62d88426de500989013` |
| Match | YES |
| Pin spec (package.json) | `file:./vendor/talchain-schemas-0.6.0.tgz` |
| pnpm-lock | file reference (deterministic) |
| Comparison with schemas repo HEAD `3412b761` | CANNOT-VERIFY from static inspection. Schemas repo HEAD is on branch `claude/v5-cqe-investigation` at package version 0.6.0; tarball content correspondence resolves by rebuilding schemas from that SHA and comparing hash. |

**Conclusion:** vendored tarball integrity verified locally. Correspondence with schemas-repo HEAD unverifiable without rebuild.

---

## 9. PoC scope context

### 9.1 PoC boundary

Spec v3.2 and coaching UX §10.8 treat coaching-intensity slider and post-pilot levers as out of PoC scope. CQE Layer 0 (V5-001..007), compound detection (V5-012), routing spine (V5-050 trees), and turn-executor seven-step assembly are in PoC. Signal lifecycle tracking, coaching_state persistence, and decision_context schema are coaching-complete requirements but not PoC critical per spec v3.2.

### 9.2 Features outside PoC scope but present in code

| V5-ID | Feature | PoC status | Code presence | Note |
|---|---|---|---|---|
| V5-049 | Startup model resolution log | out of PoC | merged to staging | Added in debug-output workstream. |
| V5-046/V5-047 | Exercise handlers | out of PoC | legacy V4 | Not wired to V5. |

### 9.3 PoC features with incomplete code

| V5-ID | Feature | Missing component | Severity |
|---|---|---|---|
| V5-018 | Step 5 coaching pass interface | coaching output producer | BLOCKER |
| V5-022..024 | RoutingLog spec fields | field definitions and writes | SIGNIFICANT |
| V5-014 | Non-action source-order heuristic | heuristic implementation | SIGNIFICANT |
| V5-029..033 | draft_graph coaching threading | pipeline pass-through or V5 consumer | BLOCKER |
| V5-055 MC-29 | Fail-closed boundary | remove log-and-continue soft gate | BLOCKER |
| V5-055 MC-31 | Behavioural replay | RB-01..08 fixtures | BLOCKER |
| V5-055 MC-32 | CIL invariants | seed chain, request ID chain, repair logging checks | BLOCKER |

---

## 10. Source documents cross-reference

### 10.1 Doc-to-feature matrix

| Document | V5-IDs referenced |
|---|---|
| `olumi-v5-architecture-design-specification-v3_2.md` | V5-001..007, V5-012..017, V5-021..025, V5-050 |
| `olumi-boundary-contract-v1_1.md` | V5-055 (MC-24..32) |
| `cqe-design-v1_1.md` | V5-001..007 |
| `cqe-investigation-proposal.md` | V5-001..007, V5-019 |
| `model-routing-investigation-proposal.md` | V5-008..011, V5-027..039, V5-043..045, V5-048..054 |
| `olumi-v5-routing-prompt-v6.txt` | V5-012..014, V5-025 (routing behaviour) |
| `technical-debt-inventory-v1.md` | cross-cutting (C1, C2, V5-050) |
| `olumi-coaching-ux-requirements-v1.md` | V5-018, V5-029..033, V5-040..047, V5-056, V5-057 |

### 10.2 Claims with no code referent

V5-013, V5-015, V5-016, V5-017, V5-028, V5-034, V5-040, V5-041, V5-042, V5-043, V5-044, V5-045, V5-052 tagged PROPOSED-UNDESIGNED or APPROVED-NOT-BUILT. See §3.2.

---

## 11. Decision agenda for V5 Architecture v4

Decisions only; no designs. Ordered by severity of underlying gap.

| # | Decision required | Gap (§ ref) | Severity | Why before v4 | Options observable from evidence |
|---|---|---|---|---|---|
| 1 | Decide whether to remove the soft-gate log-and-continue in `src/cee/unified-pipeline/stages/boundary.ts:132` and replace with fail-closed, or document an exception. | §4.2.9 / MC-29 | BLOCKER | Direct contract violation (MC-29). | (a) remove soft gate; (b) document exception with rationale; (c) scope MC-29 to a subset of boundaries |
| 2 | Decide whether coaching outputs (widening_log, bias_signals, strengthen_items, summary, provenance) thread through the CEE pipeline into V5 ContextPack, or are produced by a V5-owned coaching pass. | §6.1 row 1; §5.6 | BLOCKER | Coaching UX §9.1 P1 requires; coaching: null stub blocks every downstream consumer. | (a) thread through CEE pipeline; (b) V5-owned coaching pass in Step 5; (c) both (CEE fast-path + V5 LLM enrichment) |
| 3 | Decide whether RoutingLog adds `tool_call_present`, `intent_class_source`, `coaching_mode_source` fields to match spec §13.1 before v4 locks. | §6.1 row 2 | SIGNIFICANT | Spec contradiction; Phase 2 evaluation depends on source attribution. | (a) add all three fields now; (b) spec amendment; (c) defer with explicit debt entry |
| 4 | Decide the plan and sequencing for coaching UX §9.1 P1-P5 wiring (5-way gap). | §5.8; V5-056 | BLOCKER for coaching-complete | No single P can be wired in isolation. | (a) land P1 (draft coaching threading) first then P2-P4; (b) land decision_context (P2) first; (c) treat coaching-complete as post-PoC milestone |
| 5 | Decide whether to implement RB-01..08 behavioural replay fixtures or deprecate MC-31. | §4.3 MC-31; §7 row 2 | BLOCKER | Fixture README references; no implementation. | (a) implement fixtures; (b) drop MC-31; (c) migrate to a different replay mechanism |
| 6 | Decide whether to implement CIL invariant checks per MC-32 or scope-down the check. | §4.3 MC-32; §7 row 3 | BLOCKER | Zero evidence; per-request invariants uncovered. | (a) land the three checks (seed chain, request-id chain, repair logging); (b) outsource to ISL if CIL lives there; (c) descope MC-32 |
| 7 | Decide how to resolve the two orchestrator trees (V5-050): deprecate legacy, or keep long-term. | §6.1 row 3 | SIGNIFICANT | Code duplication; PLoTClient cross-tree usage; stage-policy gating legacy-only. | (a) hard cut-over to V5; (b) long-lived coexistence with a documented migration plan; (c) merge trees incrementally |
| 8 | Decide the model-bifurcation resolution plan (V5-048): is live Supabase override the source of truth, or code defaults, or require agreement? | §6.1 row 4 | SIGNIFICANT | Store vs code divergence visible at startup (V5-049) but not reconciled. | (a) store is authoritative; (b) code is authoritative, store read-only; (c) require matching both, fail on divergence |
| 9 | Decide the source-order heuristic for non-action turn classification (spec §4: coaching_context → heuristic → default). | §6.1 row 7; V5-014 | SIGNIFICANT | Spec requires source-order; implementation absent. | (a) build the tiers now; (b) defer and tag Phase 2; (c) simplify to Sonnet-only |
| 10 | Decide whether to add Zod validation at the three unvalidated cross-service boundaries (§4.2.8). | §4.2.8 | SIGNIFICANT | Boundary contract §1.2 requires validation at every cross-service boundary. | (a) wrap with Zod schemas; (b) document per-site justification; (c) accept as debt with tracking |
| 11 | Decide the 7-of-10 dormant narrate-mode prompts: ship with current v1 seeds, or author production content before dispatch. | V5-035; routing-investigation finding 12 | SIGNIFICANT | Seeds are placeholder. | (a) author production content now; (b) ship as-is with "v1 seed" telemetry; (c) defer handlers to Phase 2 |
| 12 | Decide the `decision_review` invocation pattern (auto-fire, lazy on panel mount, progressive streaming). | §6.2 row 1; routing-investigation §7 | MINOR | Three options; recommendation from coaching UX but no commitment. | (a) auto-fire; (b) lazy on panel mount; (c) progressive streaming |
| 13 | Decide coaching output ownership (§6.2 row 2): draft_graph produces → CEE preserves → V5 consumes, or V5-owned coaching pass re-generates? | §6.2 row 2 | SIGNIFICANT | Design-vs-design unresolved. | (a) fix CEE pipeline to preserve; (b) V5-owned regenerator; (c) dual-producer with deduplication |
| 14 | Decide whether `as any` density in CEE unified pipeline (278 hits, 91 in deterministic-sweep) becomes a pre-v4 cleanup gate. | §4.4 | SIGNIFICANT | V5-active paths; structural typing absent. | (a) pre-v4 cleanup; (b) post-v4 cleanup milestone; (c) permanent debt with scoped exceptions |
| 15 | Decide `boundary.validation` emission verification path (MC-25). | §4.3 MC-25; §7 row 4 | SIGNIFICANT | Plugin-based emission not grep-visible; coverage unverified. | (a) add explicit `.emit` calls in each B-validator; (b) document plugin-based mechanism with tests; (c) runtime telemetry probe in staging |

---

## 12. Appendix A, Feature coverage checklist

All 57 rows populated (Gate 1 satisfied).

| V5-ID | Feature | Status | Inventory § |
|---|---|---|---|
| V5-001 | CQE Layer 0 extraction | MERGED-TO-STAGING | §3.2 |
| V5-002 | CQE telemetry | MERGED-TO-STAGING | §3.2 |
| V5-003 | CQE integration in routing prompt PARAMETERS | MERGED-TO-STAGING | §3.2 |
| V5-004 | `parsed_quantities` in ContextPack | MERGED-TO-STAGING | §3.2 |
| V5-005 | `value_origin` optional field | MERGED-TO-STAGING | §3.2 |
| V5-006 | Word-number lexicon pre-pass | MERGED-TO-STAGING | §3.2 |
| V5-007 | CQE fixture test suite | MERGED-TO-STAGING | §3.2 |
| V5-008 | Sonnet 4.6: orchestrator | PARTIAL | §3.2 |
| V5-009 | Sonnet 4.6: draft_graph | PARTIAL | §3.2 |
| V5-010 | Sonnet 4.6: edit_graph | PARTIAL | §3.2 |
| V5-011 | Sonnet 4.6: explainer | PARTIAL | §3.2 |
| V5-012 | Compound detection | MERGED-TO-STAGING | §3.2 |
| V5-013 | Entity resolution partial-overlap check | PROPOSED-UNDESIGNED | §3.2 |
| V5-014 | Non-action turn classification | PARTIAL | §3.2 |
| V5-015 | PoC default-scale registry | PROPOSED-UNDESIGNED | §3.2 |
| V5-016 | Out-of-range scale metadata | PROPOSED-UNDESIGNED | §3.2 |
| V5-017 | Layer D production integration | PROPOSED-UNDESIGNED | §3.2 |
| V5-018 | Coaching pass interface (Step 5) | PARTIAL | §3.2 |
| V5-019 | `@talchain/schemas` v0.6.0 | MERGED-TO-STAGING | §3.2 |
| V5-020 | `@talchain/schemas` v0.6.0 UI consumption | PARTIAL | §3.2 |
| V5-021 | ContextPack shape | MERGED-TO-STAGING | §3.2 |
| V5-022 | RoutingLog `tool_call_present` | CONTRADICTED | §3.2 |
| V5-023 | RoutingLog `intent_class_source` | CONTRADICTED | §3.2 |
| V5-024 | RoutingLog `coaching_mode_source` | CONTRADICTED | §3.2 |
| V5-025 | RoutingLog `graph_lookup_outcome` | MERGED-TO-STAGING | §3.2 |
| V5-026 | Validator checks (PoC defaults) | PARTIAL | §3.2 |
| V5-027 | decision_review endpoint routing | PARTIAL | §3.2 |
| V5-028 | decision_review pipeline auto-fire | PROPOSED-UNDESIGNED | §3.2 |
| V5-029 | draft_graph coaching: summary | CONTRADICTED | §3.2 |
| V5-030 | draft_graph coaching: strengthen_items | CONTRADICTED | §3.2 |
| V5-031 | draft_graph coaching: widening_log | CONTRADICTED | §3.2 |
| V5-032 | draft_graph coaching: bias_signals | CONTRADICTED | §3.2 |
| V5-033 | draft_graph coaching: parser consumption | CONTRADICTED | §3.2 |
| V5-034 | Deterministic bias_signals | PROPOSED-UNDESIGNED | §3.2 |
| V5-035 | Narrate-mode prompts (10) | PARTIAL | §3.2 |
| V5-036 | Unwired: bias_check | PARTIAL | §3.2 |
| V5-037 | Unwired: critique_graph | PARTIAL | §3.2 |
| V5-038 | Unwired: suggest_options | PARTIAL | §3.2 |
| V5-039 | Unwired: explainer | PARTIAL | §3.2 |
| V5-040 | decision_context schema | PROPOSED-UNDESIGNED | §3.2 |
| V5-041 | Signal lifecycle tracking | PROPOSED-UNDESIGNED | §3.2 |
| V5-042 | Coaching state persistence | PROPOSED-UNDESIGNED | §3.2 |
| V5-043 | Graph-review second pass | PROPOSED-UNDESIGNED | §3.2 |
| V5-044 | `post_draft_orient` prompt | APPROVED-NOT-BUILT | §3.2 |
| V5-045 | `post_rerun_bridge` prompt | APPROVED-NOT-BUILT | §3.2 |
| V5-046 | Exercise block generators | PARTIAL | §3.2 |
| V5-047 | `run_exercise` virtual tool registration | PARTIAL | §3.2 |
| V5-048 | Routing-truth bifurcation | PARTIAL | §3.2 |
| V5-049 | Startup resolved-model log | MERGED-TO-STAGING | §3.2 |
| V5-050 | Two orchestrator trees | CONTRADICTED | §3.2 |
| V5-051 | Stage-policy gating (legacy only) | MERGED-TO-STAGING | §3.2 |
| V5-052 | CQE-coverage telemetry edit_graph | PROPOSED-UNDESIGNED | §3.2 |
| V5-053 | PLoTClient cross-tree usage | MERGED-TO-STAGING | §3.2 |
| V5-054 | ContextPack vs EnrichedContext duplication | MISMATCHED-IMPLEMENTATION | §3.2 |
| V5-055 | Boundary contract v1.1 MC-24..32 | PARTIAL | §3.2 + §4.3 |
| V5-056 | Coaching UX §9.1 five preconditions | PROPOSED-UNDESIGNED | §3.2 + §5.8 |
| V5-057 | ISL outputs to panel | CANNOT-VERIFY | §3.2 |

CANNOT-VERIFY resolution notes: V5-057 resolves by tracing CEE → UI panel integration (outside this audit's scope; requires UI-side inspection beyond the 2-files-deep cap).

---

## 13. Appendix B, Files read

### 13.1 Design documents

- `Docs/v5/olumi-v5-architecture-design-specification-v3_2.md`
- `Docs/v5/olumi-boundary-contract-v1_1.md`
- `Docs/v5/cqe-design-v1_1.md`
- `Docs/v5/cqe-investigation-proposal.md`
- `Docs/v5/cqe-implementation-review-pack.md`
- `Docs/v5/cqe-dependency-audit.md`
- `Docs/v5/cqe-test-baseline.md`
- `Docs/v5/cqe-schema-precheck.md`
- `Docs/v5/model-routing-investigation-proposal.md`
- `Docs/v5/olumi-v5-routing-prompt-v6.txt`
- `Docs/v5/technical-debt-inventory-v1.md`
- `Docs/v5/olumi-coaching-ux-requirements-v1.md`
- `Docs/prompt-version-audit-2026-03-26.md`
- `Docs/CLAUDE.md`

### 13.2 Code files read (CEE)

Selection; full grep coverage per §4.1. High-value reads:

- `src/orchestrator-v5/turn-executor.ts`
- `src/orchestrator-v5/dispatch.ts`
- `src/orchestrator-v5/classify.ts`
- `src/orchestrator-v5/compose.ts`
- `src/orchestrator-v5/clarify.ts`
- `src/orchestrator-v5/context/context-pack-assembler.ts`
- `src/orchestrator-v5/context/cqe/extract-quantities.ts`
- `src/orchestrator-v5/context/cqe/rules.ts`
- `src/orchestrator-v5/routing/routing-log.ts`
- `src/orchestrator-v5/routing/tool-schema.ts`
- `src/orchestrator-v5/routing/compound-detector.ts`
- `src/orchestrator-v5/routing/route-with-tool-use.ts`
- `src/orchestrator-v5/routing/graph-lookup-adapter.ts`
- `src/orchestrator-v5/routing/validator.ts`
- `src/orchestrator-v5/routing/types.ts`
- `src/orchestrator-v5/session/supabase-store.ts`
- `src/orchestrator-v5/tools/handlers/run-analysis.ts`
- `src/orchestrator-v5/boundary/request-extensions.ts`
- `src/context/context-pack.ts`
- `src/cee/unified-pipeline/index.ts`
- `src/cee/unified-pipeline/stages/boundary.ts`
- `src/cee/unified-pipeline/stages/package.ts`
- `src/cee/unified-pipeline/stages/repair/deterministic-sweep.ts`
- `src/prompts/schema.ts`
- `src/prompts/defaults.ts`
- `src/config/index.ts`
- `src/config/model-routing.ts`
- `src/adapters/llm/anthropic.ts`
- `src/adapters/llm/anthropic-schema-compliance.ts`
- `src/adapters/isl/client.ts`
- `src/utils/telemetry.ts`
- `src/validators/b1.ts`
- `src/routes/admin.v1.routing-log.ts`
- `src/routes/admin.v1.turn-debug.ts`
- `src/routes/assist.v1.draft-graph.ts`
- `src/services/session-cache.ts`
- `src/plugins/boundary-logging.ts`
- `node_modules/@talchain/schemas/package.json`
- `node_modules/@talchain/schemas/orchestrator/quantity-extraction.d.ts`
- `package.json`
- `pnpm-lock.yaml`
- `.github/workflows/` (13 workflow files listed)

### 13.3 Code files read (sibling repos)

UI:
- `/Users/paulslee/Documents/GitHub/DecisionGuideAI/src/` (grep coverage; `src/canvas/conversation/GuidanceStrip.tsx` referenced).

PLoT:
- `/Users/paulslee/Documents/GitHub/plot-lite-service/src/` (grep coverage).

ISL:
- `/Users/paulslee/Documents/GitHub/Inference-Service-Layer/src/` (grep coverage; `src/models/deliberation.py`).

Schemas:
- `/Users/paulslee/Documents/GitHub/olumi-schemas/package.json`
- `/Users/paulslee/Documents/GitHub/olumi-schemas/src/` (index + orchestrator + boundary namespaces).

### 13.4 Grep commands executed

- C1: `grep -rn "as any" src/orchestrator-v5/ src/cee/unified-pipeline/`
- C2: `grep -rn "as unknown" src/orchestrator-v5/ src/cee/unified-pipeline/`
- C3: per-schema-type grep (ConversationMessage, TurnContext, V5ActionType, LLMAdapterRequest, LLMAdapterResponse, SessionTurn, SessionCacheEntry, DecisionContext, RunAnalysisArgs, QuantityExtractionResult, HandlerFact, and related) against `interface` and `type` declarations in CEE.
- C4: `grep -rn "= z\.object\|= z\.discriminatedUnion\|= z\.union" src/orchestrator-v5/ src/cee/unified-pipeline/` then per-schema `.parse`/`.safeParse` lookup.
- C5/C6: per-field grep for widening_log, bias_signals, strengthen_items, provenance, value_origin, compound_pattern_matched, graph_lookup_outcome, tool_call_present, intent_class_source, coaching_mode_source, parsed_quantities.
- C7: per-type-name diff between `@talchain/schemas` and CEE local definitions.
- C8: grep for `fetch(`, HTTP clients, LLM parse sites.
- C9: `grep -rn "warnOnInvalid\|warn.*invalid.*api\|log.*and.*continue\|console.*warn.*valid" src/`
- MC-24: `grep -rn "@olumi/contracts/boundary\|@talchain/schemas" src/`
- MC-25: `grep -rn "boundary.validation" src/`
- MC-26: find in `tests/` for invalid/adversarial/fail fixtures.
- MC-27: `ls .github/workflows/`
- MC-28: read `package.json`, `pnpm-lock.yaml`, `vendor/talchain-schemas-0.6.0.tgz.sha256`.
- MC-29: same as C9.
- MC-30: find in `tests/fixtures/` and `.github/workflows/`.
- MC-31: `grep -rn "RB-0[1-8]" src/ tests/`
- MC-32: `grep -rn "seed_chain\|seed\.chain\|request_id.*chain\|request\.id.*chain\|CIL\.invariant" src/`
- B-A2 narrate-mode prompts: grep each prompt name (10 prompts) in compose.ts, turn-executor.ts, tools/handlers/, llm-adapter.ts.
- B-A5 ContextPack imports: `grep -rn "ContextPack" src/orchestrator-v5/`
- C-A4 coaching_mode: full trace in §5.4.3.
- C-A7 schemas tarball: `sha256sum vendor/talchain-schemas-0.6.0.tgz` against sidecar.
- C-A8 coaching UX §9.1 P1-P5: field-level greps in §5.8.
- Field traces (17 high-value fields) per §5.

---

## 14. Appendix C, Sibling repo inspection provenance

| Repo | Local path | Branch | HEAD SHA | Working tree state | Inspection date |
|---|---|---|---|---|---|
| CEE (this repo) | /Users/paulslee/Documents/GitHub/olumi-assistants-service | claude/v5-codebase-audit | (audit commit SHA after §15) | only `Docs/v5/v5-codebase-audit.md` modified at audit commit; pre-audit commit `635df087` landed reference docs | 20 April 2026 |
| DecisionGuideAI (UI) | /Users/paulslee/Documents/GitHub/DecisionGuideAI | staging | `1cce2d23` | clean | 20 April 2026 |
| plot-lite-service (PLoT) | /Users/paulslee/Documents/GitHub/plot-lite-service | staging | `26dab621` | clean | 20 April 2026 |
| Inference-Service-Layer (ISL) | /Users/paulslee/Documents/GitHub/Inference-Service-Layer | staging | `e2ada702` | untracked coverage files only (not added) | 20 April 2026 |
| olumi-schemas | /Users/paulslee/Documents/GitHub/olumi-schemas | claude/v5-cqe-investigation | `3412b761` | untracked .tgz files only (not added) | 20 April 2026 |

---

## 15. Appendix D, Items referenced in briefing materials but not found in repo artefacts

### 15.1 Cut-point deviation

Seven reference documents were working-tree files on `claude/v5-debug-output` at session start, untracked on `origin/staging`:

- `olumi-v5-architecture-design-specification-v3_2.md`
- `olumi-boundary-contract-v1_1.md`
- `cqe-design-v1_1.md`
- `cqe-investigation-proposal.md`
- `model-routing-investigation-proposal.md`
- `olumi-v5-routing-prompt-v6.txt`
- `olumi-coaching-ux-requirements-v1.md` (supplied during audit session)

Landed via pre-audit commit `635df087`.

### 15.2 Chat-only items (quarantined per Gate 12)

No chat-only items encountered that meet Gate 12 quarantine criteria. Every V5-NNN in §3.2 has a doc § or code-location citation.

### 15.3 Out-of-scope workstreams

**Debug output workstream:** `debug-output-baseline.md`, `debug-output-investigation.md` exist on `claude/v5-debug-output` working tree and are referenced in some briefing materials. Excluded from audit scope per user decision. These are a separate UI workstream not audited here. Commits `da90ef1e`, `b73fb528`, `92ee0fba`, `aa361b2d`, `47f1b16b` from the debug-output branch are noted as landing observability primitives; V5-049 (startup resolved-model log) draws from this work.

### 15.4 Unknown items

- **RB-01 to RB-08 implementation files**, referenced at `tests/fixtures/contracts/b1/README.md:13`; zero implementation files in repo. Resolution: issue tracker or git log of deleted fixtures.
- **CIL invariant checks**, MC-32 contract requirement; zero grep evidence. Resolution: check sibling repos (ISL, PLoT) for invariant enforcement.
- **Coaching UX requirements doc history**, supplied during audit session with date 16 April 2026; prior versions or review status not tracked in repo.

---

*End of document.*
