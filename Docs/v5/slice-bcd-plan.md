# V5 Slices B + C + D1 + D2 — Execution Plan (rev 2, approved with revisions)

## Context

This plan restates the v3 execution brief for V5 Slices B (session state), C1+C2 (handler spine + `run_analysis`), D1 (graph-edit handlers), and D2 (analysis-explanation handlers), per brief §11 Step 1. Rev 2 incorporates 13 revisions from Paul's approval.

The value delivered is the **session + handler spine** that unblocks the E-series coaching work. After B+C+D1+D2 land on staging, the user-visible coaching experience will still resemble V4 (brief §1.1 is explicit about this) — this work is machinery, not polish.

## Current state (verified 2026-04-17)

- **Branch:** `staging`. A0/A1/A2 landed; most recent A2 commit `52a10ad3`.
- **CEE `src/orchestrator-v5/`:** 12 files + 9 tests. No `tools/`, `session/`, or `session-cache/` yet.
- **Schemas:** `@talchain/schemas@0.4.0` vendored (SHA `16cc078476…`). `HandlerFactSchema = z.never()`. `OlumiResponseSchema` has 6 required fields. 195/195 tests green. `V5ActionTypeSchema` and all handler block schemas do not exist yet.
- **Supabase:** Single migration `supabase/migrations/20260226010000_scenario_schema_v2_0_1_hardening.sql`. Existing tables: `scenarios` (with JSONB `events` column — audit must resolve reuse/shadow/replace, see §Tranche 1), `shared_briefs`, `cee_prompts`, `cee_prompt_versions`, `cee_prompt_observations`. RLS on `auth.uid()`. No `conversation_turn` or `handler_fact` tables.
- **V4 action_type source-of-truth** in `src/orchestrator/deterministic/llm-response-schema.ts` and `src/orchestrator/deterministic/actions/`. Seven V5-relevant names verbatim: `run_analysis`, `set_factor_value`, `add_constraint`, `adjust_edge_strength`, `explain_result`, `compare_options`, `what_would_flip`.
- **Fixtures:** `tests/fixtures/contracts/b1/slice-a1/` + `.../slice-a2/`. No b/c/d fixtures.
- **Validation scripts:** `validate-prepush.sh`, `validate-transport-invariants.sh`, `validate-tarball-sha.sh`, `validate-staging.sh`, `validate-v1.3.sh`. Tranche 1 adds `validate-data-responsibility.sh`; Tranche 2 adds `validate-state-write-invariant.sh`.
- **Test baseline:** 159 CEE + 55 UI (A2 staging evidence pack); drop below = §10.3 rollback.

## Tranche roadmap (rev 2 — Tranche 3 split into C1 + C2)

| Tranche | Scope | Owner | Hard-stop artefact | DoD |
|---|---|---|---|---|
| **1 — Phase 0** | Supabase audit (with REUSE/EXTEND/NEW_TABLES verdict), schemas 0.4.0→0.5.0, action-type mapping, task_id literals, tarball+vendoring | Single agent | `Docs/v5/slice-phase-0-supabase-audit.md` + mapping table + addendum | Contracts locked, audit concludes with verdict + migration SQL |
| **2 — Slice B** | SessionStore (Supabase write-through + LRU), invalidation, TurnContext/commit wiring, migration | Single agent | `Docs/v5/slice-b-implementation.md` + `slice-b-evidence-pack.md` | Session state survives restart; invalidation fires on correct scope |
| **3a — Slice C1** | Handler registry + interface, dispatcher `handler` branch, classifier routing extension, handler failure types, handler budget. **No run_analysis yet.** | Single agent | `Docs/v5/slice-c1-implementation.md` + `slice-c1-evidence-pack.md` | Handler spine operational; zero handlers registered; dispatch routes but nothing executes yet |
| **3b — Slice C2** | `run_analysis` handler E2E: PLoT call, enrichment threading, persistence via B | Single agent | `Docs/v5/slice-c2-implementation.md` + `slice-c2-evidence-pack.md` | Analysis runs E2E; PLoT enrichment threads with specific field values; next turn sees current (not stale) analysis state |
| **4 — D1 + D2** | D1 (set_factor_value, add_constraint, adjust_edge_strength) + D2 (explain_result, compare_options, what_would_flip). Parallel via worktrees iff §6.0 5-criterion gate passes | Two sub-agents via Agent tool, different worktrees | `Docs/v5/slice-d1-d2-implementation.md` + `slice-d1-d2-evidence-pack.md` | Graph edits apply + invalidate; NOOP suppression works; read handlers assert content, not shape |

Splitting C into C1+C2 reduces C2 blast radius: the spine ships behind an empty registry; the first handler lands against a stable surface.

## Execution flow

1. **Plan approved → commit `Docs/v5/slice-bcd-plan.md` as standalone commit** (revision 13). No Phase 0 code bundled.
2. **Tranche 1 (Phase 0).** Session preamble, `conversation_search` for prior Supabase work, enumerate tables via repo tooling, **reach explicit REUSE/EXTEND/NEW_TABLES verdict** + proposed migration SQL in audit doc (revision 9). Resolve `scenarios.events` JSONB → reuse/shadow/replace verdict (revision 11). Then `@talchain/schemas@0.5.0` additive bump → tarball+SHA → vendored into CEE + UI → typecheck clean. Commit. Stop.
3. **Tranche 2 (Slice B).** Session store + cache + invalidation + migration. Tier 3 gate + integration smoke + telemetry blocking gate. Commit. Stop.
4. **Tranche 3a (Slice C1).** Registry + dispatch extension + classifier routing + handler interface. Empty registry at end (no handlers). Tier 3 gate + telemetry gate. Commit. Stop.
5. **Tranche 3b (Slice C2).** `run_analysis` handler E2E, registered. Tier 3 gate + enrichment-threading test + **stale-state assertion** (revision 4) + telemetry gate. Commit. Stop.
6. **Tranche 4 (D1 + D2).** §6.0 go/no-go gate (5 criteria inc. C2 enrichment-threading with no manual waiver — revision 7, plus R13 session-conflict confirmation — revision 12). On pass: worktree setup + parallel sub-agent dispatch via Agent tool. On fail or ambiguity: sequential D1 then D2. Merge → full gate → cross-slice journey test. Stop.
7. **Deploy decision.** Per-tranche merges allowed on Paul approval. **V5 feature flag stays OFF on staging unless the tranche's user journey is fully testable end-to-end** (revision 10). No prod promotion until all tranches green.

## Tranche-specific locked decisions

### Tranche 2 §4.0 — locked decisions (4, not 3)

1. **Source of truth:** Supabase. Cache is derivative; on disagreement, Supabase wins.
2. **Write idempotency:** unique constraint `(scenario_id, turn_id)` + `ON CONFLICT DO NOTHING`.
3. **Read window:** default 20 turns, `SESSION_READ_WINDOW_TURNS` env-configurable.
4. **Handler-fact storage (revision 2):** separate `v5_handler_facts` table, NOT a JSONB column on `v5_conversation_turns`. Rationale: queryability (handler analytics, per-handler latency), RLS granularity (handler-specific policies possible), schema evolution (HandlerFact discriminated union will grow; JSONB blobs rot). (The `v5_` prefix was adopted on 2026-04-17 after an introspection collision finding — see audit §2.7.)

### Tranche 2 transaction semantics (revision 3)

`SessionStore.append(turn)` executes as a **single Supabase transaction** covering one `conversation_turn` row + N `handler_fact` rows. Implementation: Postgres transaction block via Supabase RPC (stored function, e.g. `append_turn_atomic`). Compensating-writes fallback is permitted ONLY if Supabase tooling genuinely cannot support transactions in our context — if so, **halt and flag to Paul** before implementing fallback. `validate-state-write-invariant.sh` grep-guards against non-transactional writes in session code.

### Tranche 3b (C2) user-journey — stale-state assertion (revision 4)

After `run_analysis` executes, a second turn MUST see the analysis state as current, not stale. Test pattern: run_analysis → persist → invalidate nothing → next turn reads TurnContext → assert analysis state is present, hash-matches the just-completed run, and no `analysis_stale: true` flag. This catches invalidation-timing bugs where post-analysis state is incorrectly marked stale (or where pre-analysis state wasn't invalidated).

### Tranche 4 handler test requirements

**D1 NOOP suppression (revision 5) — required per handler:**
- `set_factor_value`: attempting to set to the already-current value → no write, no invalidation, HandlerFact has `noop: true`.
- `add_constraint`: attempting to add an already-present constraint → no write, no invalidation, HandlerFact has `noop: true`.
- `adjust_edge_strength`: attempting to set edge strength to current value → no write, no invalidation, HandlerFact has `noop: true`.

One unit test per handler for NOOP suppression, one integration test across all three asserting invalidation fires on real change but not NOOP.

**D2 content assertions (revision 6) — no "shape valid, content empty" passes:**
- `compare_options`: when analysis has ≥2 options, response MUST name ≥2 distinct option labels/ids in comparison block content.
- `what_would_flip`: when analysis has fragile edges or thresholds, response MUST reference at least one actual threshold value or fragile edge identifier.
- `explain_result`: when analysis has a leading option, response MUST name that option (or its label) in the explanation text.

Assertions are content-based (specific strings, IDs, or numeric values from fixtures). Structural tests ("response has X field") are NOT sufficient on their own — they're the R1 empty-passthrough trap.

### Tranche 4 §6.0 go/no-go — 5 criteria (revision 7 adds #5)

Parallel dispatch ONLY if ALL pass:
1. Tranche 2 evidence pack — zero mandatory-pass failures.
2. Tranche 3a (C1) evidence pack — zero mandatory-pass failures.
3. Tranche 3b (C2) evidence pack — zero mandatory-pass failures.
4. No pending schema-addendum requests from B/C1/C2.
5. **Tranche 3b (C2) enrichment-threading test green with no manual waiver** — PLoT fields verified end-to-end against specific values, no "known intermittent" marker, no skipped assertion.

**Plus (revision 12):** R13 session-conflict interpretation confirmed with Paul before launching parallel. If interpretation ambiguous → default to sequential D1-then-D2.

Any fail → sequential execution, not parallel. Decision recorded in `Docs/v5/slice-d1-d2-implementation.md` preamble.

## Risk register (A0/A1/A2 precedent + brief §10 + rev-2 tightening)

| # | Pitfall | Source | Mitigation |
|---|---|---|---|
| R1 | Empty-passthrough tests pass for months. | A1 impl, brief §8.2 | Content assertions required (Tranche 4 D2 §revision 6). Enrichment-threading tests assert specific values (Tranche 3b). |
| R2 | PLoT enrichment silent-drop. | Brief §5.2 | C2 + D2 tests assert specific field values E2E. `validate-data-responsibility.sh` grep-guards cross-service leaks. |
| R3 | Classifier structural-vs-semantic collision. | A2 deviation | C1 classifier extension uses `z.string()` + explicit `isHandlerId` check, not `z.enum()`. |
| R4 | Budget vs upstream-timeout precedence. | A1 constraint 7 | C1/C2 handler path preserves A1 precedence via `turnAbort.signal.aborted` check before mapping inner error — dedicated test. |
| R5 | BI-01 violation (started without completed). | Addendum §2.1.2 | Every tranche replays fixtures + asserts matched pairs via missing-owner detector. |
| R6 | Post-Phase-0 schema drift. | Brief §3.6 | Schema freeze + mini-addendum workflow. Sub-agents halt, never work around. |
| R7 | Action-type name drift V4→V5. | Brief §3.3 | Phase 0 mapping table is single source of truth; subsequent tranches cite only. |
| R8 | `llm_calls_used` accounting drift. | A2 deviation | Telemetry gate (below) asserts per-tranche event counts match expected replay count. |
| R9 | Non-idempotent / destructive migration DDL. | Brief §10.3 | Additive-only DDL (new tables + indexes). No `DROP`, no `ALTER … DROP COLUMN`. Audit verdict + Paul review. |
| R10 | Mid-turn partial writes. | Brief §4.4 + §2.1.7 | Single-transaction append (revision 3). `validate-state-write-invariant.sh`. |
| R11 | Duplicate rows on retry. | Brief §4.0(2) | `ON CONFLICT DO NOTHING` + dedicated duplicate-write unit test. |
| R12 | A0/A1/A2 regression. | Carried tests | Tranche gate re-runs all A0/A1/A2 tests. File-scope table prevents sub-agent drift. |
| R13 | **Simultaneous-session conflict.** Docs/CLAUDE.md forbids parallel sessions; brief §2.2 dispatches parallel sub-agents. | Docs/CLAUDE.md vs brief | **Interpretation:** parallel D1/D2 runs via Agent tool invocations inside this one Claude session; worktrees are file-isolation only. **Revision 12 requirement:** confirm interpretation with Paul before launching Tranche 4 parallel phase. If ambiguous → sequential D1-then-D2. |
| R14 | Pre-existing tsc errors mistaken for regressions. | Memory + A1/A2 impl docs | Every typecheck uses `tsc -p tsconfig.build.json --noEmit`; `generated/openapi.d.ts` baseline errors flagged as out-of-scope. |
| R15 | Sub-agent edits V4 code. | Brief §10.2 | File-scope table enforced; scope-violation stop condition. Main agent grep-checks every sub-agent commit for V4-path writes. |
| R16 | NOOP not suppressed — `set_factor_value X=5` when X is already 5 writes handler_fact + triggers invalidation. | New, rev 2 | Revision 5: per-handler NOOP test (D1 × 3). |
| R17 | Stale-state invalidation bug — run_analysis result flagged stale on the next read. | New, rev 2 | Revision 4: C2 stale-state user-journey assertion. |
| R18 | `scenarios.events` JSONB lifecycle ambiguity. | Rev 2 | Revision 11: Phase 0 audit must resolve reuse/shadow/replace with explicit verdict. |
| R19 | Half-live feature flag on staging. | Rev 2 | Revision 10: V5 feature flag OFF on staging unless tranche's user journey fully E2E-testable. |

## Safety rails

- **Stop conditions (brief §10.1):** scope violation, schema modification request, out-of-scope regression, invariant-script fail, data-responsibility violation, budget exhaustion. Halt = commit WIP + report.
- **No-go actions (brief §10.2):** no push/merge without Paul approval, no A0/A1/A2 or V4 edits outside integration points, no prompt content, no schema major bump, no test-skipping, no `eslint-disable`, no typecheck-ignored commits.
- **Rollback triggers (brief §10.3):** test count <159 CEE / <55 UI; BI-01–BI-08 failure; destructive migration; scope violation.
- **Docs/CLAUDE.md:** Tier 1 smoke after every code change (`tsc --noEmit` + `vitest run --changed`); Tier 2 pre-commit (`tsc --noEmit` + `pnpm lint`); Tier 3 only before push. Never `pnpm test` (full suite) after every change. Session preamble mandatory. Pre-commit `git status && git diff --staged`. Never `git checkout <file>` on uncommitted work.
- **Plan commit:** `Docs/v5/slice-bcd-plan.md` commits as standalone, not bundled with Phase 0 code (revision 13).

## Telemetry review — blocking gate per tranche (revision 8)

Upgraded from evidence-pack content to **blocking review gate**. Before Paul review, each tranche evidence pack telemetry snapshot must show:

1. **No runaway durations.** Handler / phase p95 inside stated budgets; no individual event exceeding 2× budget.
2. **Event counts match expected test replay count.** If N fixtures × M replays, then `turn_executor.started` count = N×M exactly; `turn_executor.completed` count = N×M exactly; `response_emitted=true` count = N×M.
3. **No unexpected fallback events.** Zero `ui.v5.incomplete_block`, zero `ui.v5.unknown_block_type`, zero `turn_executor.contamination_narrate` outside contamination fixtures, zero other fallback/degraded events outside their intended fixtures.

Gate fail = halt + fix + rerun, NOT document-and-defer. Paul reviews only after gate passes.

## Critical files + directories

### Tranche 1 (Phase 0)
- Create in `~/Documents/GitHub/olumi-schemas/src/orchestrator/`: handler-fact discriminated union, session types, action-type enum, per-handler arg+result schemas, block schemas, `decision_context` placeholder.
- Create: `Docs/v5/slice-phase-0-supabase-audit.md` (with REUSE/EXTEND/NEW_TABLES verdict + `scenarios.events` disposition), `Docs/v5/slice-bcd-plan.md` (standalone commit).
- Modify: `src/prompts/schema.ts`, `src/prompts/defaults.ts`, `src/adapters/llm/prompt-loader.ts`.
- Replace: `vendor/talchain-schemas-0.4.0.tgz` → `vendor/talchain-schemas-0.5.0.tgz` + new `.sha256`. Update `package.json` pin.
- Create: `scripts/validate-data-responsibility.sh`.

### Tranche 2 (Slice B)
- Create: `src/orchestrator-v5/session/session-store.ts` (interface), `session/supabase-store.ts`, `session-cache/lru-cache.ts`, `session/invalidation.ts`.
- Modify: `src/orchestrator-v5/build-turn-context.ts` (read recent), `src/orchestrator-v5/commit.ts` (stop being no-op, write-through).
- Create: `supabase/migrations/2026XXXX_v5_session_store.sql` — additive: `v5_conversation_turns` table, `v5_handler_facts` table, unique `(scenario_id, turn_id)`, RLS, `append_turn_atomic` RPC (revision 3).
- Create: `scripts/validate-state-write-invariant.sh`.

### Tranche 3a (C1)
- Create: `src/orchestrator-v5/tools/registry.ts` (empty registry), handler interface types.
- Modify: `src/orchestrator-v5/dispatch.ts` (add `handler` turn class returning UNHANDLED for now since no handlers), `src/orchestrator-v5/classify.ts` (handler-id detection), `src/orchestrator-v5/turn-executor.ts` (handler route wired to registry), `src/orchestrator-v5/types.ts` (`HANDLER_INVOCATION_FAILED`, `HANDLER_RESULT_INVALID`, `LLM_BUDGET_HANDLER_MS`).

### Tranche 3b (C2)
- Create: `src/orchestrator-v5/tools/run-analysis.ts`.
- Register in: `src/orchestrator-v5/tools/registry.ts`.
- Reuse: PLoT adapter seam at existing V4 bridge (verify path; do NOT reimplement analysis).

### Tranche 4 (D1 + D2)
- D1 worktree: `src/orchestrator-v5/tools/{set-factor-value,add-constraint,adjust-edge-strength}.ts`.
- D2 worktree: `src/orchestrator-v5/tools/{explain-result,compare-options,what-would-flip}.ts`.
- Main agent post-merge: UI block renderers in `~/Documents/GitHub/DecisionGuideAI/` with unknown-block + incomplete-block telemetry fallbacks.

## Verification strategy

### Per-tranche gate
```bash
# Schemas
pnpm -C ~/Documents/GitHub/olumi-schemas test

# CEE
pnpm exec tsc -p tsconfig.build.json --noEmit
pnpm exec vitest run
pnpm exec eslint src/orchestrator-v5/
bash scripts/validate-transport-invariants.sh
bash scripts/validate-tarball-sha.sh
bash scripts/validate-state-write-invariant.sh    # Tranche 2+
bash scripts/validate-data-responsibility.sh      # Tranche 1+

# UI
pnpm -C ~/Documents/GitHub/DecisionGuideAI exec tsc --noEmit
pnpm -C ~/Documents/GitHub/DecisionGuideAI exec vitest run
```

Plus **telemetry blocking gate** (§revision 8) on evidence-pack telemetry snapshot.

### Cross-slice user journeys
- **After Tranche 2:** two-turn conversation persists across simulated restart; turn 2 reads turn 1 state from cold cache.
- **After Tranche 3a (C1):** routing goes to `handler` branch for handler-class inputs + returns UNHANDLED cleanly (no handlers registered yet); non-handler classes unaffected.
- **After Tranche 3b (C2):** user runs analysis → full PLoT enrichment present with specific field values → **next turn sees analysis as current, not stale** (revision 4).
- **After Tranche 4:** user updates factor (D1) → invalidation fires → asks "what would flip" (D2) → receives flip thresholds against post-edit analysis with content assertions met (revision 6).

### Self-review passes (brief §9.1 mandatory)
Contract compliance, data responsibility, state management, error paths, regression + telemetry snapshot passing the blocking gate.

## Staging merge rule (revision 10)

Per-tranche merges to `staging` allowed on explicit Paul approval. BUT: the V5 feature flag stays **OFF** on staging unless the tranche's user journey is fully testable end-to-end. Examples:
- Tranche 2 alone: flag OFF (no user surface — session state is plumbing).
- Tranche 3a (C1) alone: flag OFF (empty registry; no user-visible behaviour).
- Tranche 3b (C2): flag may go ON if run_analysis is fully testable E2E — Paul decides.
- Tranche 4: flag may go ON for tested handlers only — decided per-handler.

This prevents half-live confusion on a shared staging environment.

## Immediate next action

1. Commit this plan as `Docs/v5/slice-bcd-plan.md` — **standalone commit, no Phase 0 code bundled** (revision 13).
2. Session preamble: `git branch --show-current`, stale-.js scan under `src/`, `git stash list`. Report + flag anything unexpected.
3. Start Tranche 1 Phase 0:
   - `conversation_search` for prior Supabase schema work.
   - Enumerate Supabase tables via repo tooling.
   - Audit `scenarios.events` JSONB lifecycle — produce reuse/shadow/replace verdict.
   - Write `Docs/v5/slice-phase-0-supabase-audit.md` concluding with REUSE / EXTEND / NEW_TABLES verdict + proposed migration SQL (revision 9).
   - Hand to Paul for audit review before schemas proceed.
