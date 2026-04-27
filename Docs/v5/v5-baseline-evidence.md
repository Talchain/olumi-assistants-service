# V5 baseline evidence

**Ratchet rule:** this baseline is the gate. Subsequent staging deploys must equal or exceed pass count and must not regress on any previously-passing step.

Date: 2026-04-27
Staging commit: `38106bd7f71c879685b1bcc500d55ccc7b7278d1` — "Merge branch 'claude/v5-response-finaliser' into staging" (2026-04-27 16:01 +0100)
Staging build vs finaliser: **finaliser-included** — all six finaliser commits (`399ff4fc`, `fe6f4b33`, `723da1f0`, `4b3656a9`, `1e664c90`, `c5d820d3`) are ancestors of staging HEAD. Verified via `git merge-base --is-ancestor`.

Prompt loaded:
- Source: `/admin/prompts/verify` (auth: `X-Admin-Key`). Environment: `staging`. Snapshot timestamp: 2026-04-27T15:05:44Z. Loaded into runtime at 2026-04-27T15:04:16Z (matches deploy).
- V1 pipeline prompts (store-backed) — relevant subset:
  - `orchestrator_default` store_version=106 hash=`5172c32ae405bb69`
  - `draft_graph_default` store_version=189 hash=`519eeef80fb4c3e6`
  - `decision_review_default` store_version=11 hash=`9477d3b854696a23`
  - `edit_graph_default` store_version=8 hash=`6920a6f8b55e464b`
  - 18 narrate-* prompts present at version 1.
- V5 routing prompt (`Prompts/v38.2.txt`, expected hash `2e25001a025e288c`): **not capturable from staging** — loaded at boot from filesystem (`src/orchestrator-v5/routing/prompt-loader.ts:62-86`), not from the prompt store. Expected hash sourced from harness header; cannot be independently verified against the running staging instance without log access. Treat hash match as unverified.

Prompt behaviour observations (against v38.2 expectations: sentence case, no em dashes, banned-term-free user-facing text, stage classification visible):
- Sentence case: ✓ across all six steps.
- Em dashes: **4 hits** — all in step 4 `blocks[0].enrichment.review_cards[*].why` and `items[*].suggested_evidence`. See Hiring Step 4 below. None in `assistant_text`.
- Banned-term-free user-facing text: **1 hit** in step 4 `blocks[0].enrichment.ceeTrace.reason`: "Legacy CEE calls skipped (M2 decision-review enabled)". See Hiring Step 4. No hits in `assistant_text` on any step.
- Stage classification visible: ✓ — `stage_indicator` populated on all six steps (`analyse`, `analyse`, `frame`, `analyse`, `review`, `frame`).

Feature flags (defaults from [src/config/index.ts](../../src/config/index.ts); staging env values not directly readable):
- `ENABLE_V5_ORCHESTRATOR` ([src/config/index.ts:318](../../src/config/index.ts#L318)) — default `false`. Staging value inferred `true` (the `/orchestrate/v2/turn` endpoint responded with V5 envelope shape including `analysis_ready`/`stage_indicator`).
- `CEE_TURN_DEBUG_ENABLED` ([src/config/index.ts:491](../../src/config/index.ts#L491)) — default `false`. Staging value not inferable.
- `CEE_OBSERVABILITY_RAW_IO` ([src/config/index.ts:489](../../src/config/index.ts#L489)) — locked `false` in production.
- `CQE_VERBOSE_TRACE` ([src/config/index.ts:493](../../src/config/index.ts#L493)) — default `false`.

PLoT health: not probed (per scope decision). `PLOT_BASE_URL` not present in local `.env`; staging Render env value unknown.
ISL health: not probed (per scope decision).

Harness commit: `9f036a1f` (latest commit touching `tools/v5-journey-replay/`). The brief's stated last-known-good `66d1adb7` is **6 commits behind**: `9f036a1f`, `cc7a65d5`, `0f51f261`, `0c761843`, `cb9e8b70`, `d92174c4`. Harness ran in its current form; no rebase performed. No harness modifications made for this baseline.

Harness config:
- Base URL: `https://cee-staging.onrender.com`
- Scenario prefix: `staging-hiring`
- Scenario id (harness-generated): `5ba22a71-c5f7-436e-8d4d-820c52f95292`
- Output: [Docs/v5/v5-golden-path-evidence-cee.md](../../Docs/v5/v5-golden-path-evidence-cee.md)
- Auth: `X-Olumi-Assist-Key` from `OLUMI_REPLAY_API_KEY` (= local `ASSIST_API_KEY` value, accepted by staging).
- Step count: 6 canonical (1_draft_graph, 2_weakest_option, 3_add_option, 4_run_analysis, 5_explain_leader, 6_edit_budget) — see [tools/v5-journey-replay/steps.ts:47](../../tools/v5-journey-replay/steps.ts#L47).
- Per-step timeout: 90,000 ms ([client.ts:73](../../tools/v5-journey-replay/client.ts#L73)).

This baseline supplements the harness output with **independently-captured per-step request/response payloads** via direct curl using a separate scenario id (`5b6a7d2b-7d3d-4c08-b1d4-6f4193456558`) since the harness's evidence writer captures structural metadata only, not full payloads. The chained one-shot curls and harness run targeted the same staging build and produced the same structural pass pattern.

## Summary

Hiring: steps passed **6/6** (HTTP-200 + harness assertion contract). First chain-blocking failure: **none at the structural level**. **Behavioural degradation observed at Step 5** (response acknowledges Step 4's analysis was queued but claims results "aren't back yet" — see classification below).

Marketing: **not run**. Recovery from `.tmp/diagnostic/olumi-debug-d90cfe97-20260426.json` was attempted; the bundle exists but contains a follow-up turn (`cee_request.message: "Proceed."`) plus the resulting graph — the original 297-character framing brief is not in the bundle (`user_actions[0].detail.message_length: 297` confirms a brief was sent but its text was not captured). Per scope decision, fell back to Hiring-only without inventing a brief.

## Hiring scenario

### Step 1: 1_draft_graph
Status: **pass**
Latency: 33,839 ms (harness) / 31,678 ms (independent curl)
Outcome class: v5-runtime
HTTP: 200
Response keys: `response_version`, `assistant_text`, `blocks` (empty), `suggested_actions` (1), `insights` (empty), `stage_indicator`, `draft_graph`, `analysis_ready`.

`assistant_text`: `"Drafted a decision graph with 15 nodes and 30 edges."`
`stage_indicator`: `"analyse"` (matches the V5 expectation that frame turns transition to analyse once a graph exists)
`suggested_actions[0]`: `{label: "Run analysis", action_type: "run_analysis"}` ✓

Banned-term scan (user-facing): clean.
Em-dash scan: clean.

**Independent finding (not a structural failure):** the `assistant_text` exposes implementation nomenclature ("decision graph", "15 nodes", "30 edges") rather than product framing (e.g. "Three options across X factors are now on the canvas"). This is mechanical and underplays the framing achievement.
- Failure layer: **Prompt**
- Likely fix owner: prompt edit (`draft_graph_default`, store_version 189)
- Owning prompt id: `draft_graph_default` per `/admin/prompts/verify` (file-side default at [src/prompts/defaults-v187.ts](../../src/prompts/defaults-v187.ts) has been superseded by store)
- Chain-blocking: no — does not affect downstream steps.

### Step 2: 2_weakest_option
Status: **pass**
Latency: 16,569 ms (harness) / 7,505 ms (independent curl)
Outcome class: v5-runtime
HTTP: 200
Response includes: `assistant_text`, `analysis_ready` (carried forward from session), 1 chip ("Run analysis").

`assistant_text` (excerpt): `"Looking at the model structure, **Maintain Current Team (Status Quo)** is the weakest option against your goal of meeting Q3 roadmap commitments. ... Status Quo leaves Engineering Capacity unchanged, and that factor has the strongest drive on Q3 Roadmap Delivery (strength 0.55) and the largest dampening effect on Q3 Delivery Slip (strength -0.45). ... Worth noting: this is a structural reading from the model, not a simulation result."`

Quality: **good** — references real graph state (option labels, factor labels, edge strengths) and distinguishes structural vs simulated reasoning. No banned terms in user-facing text. No em dashes in `assistant_text`.

Note (not classified as failure): the response references "all four options" while the brief listed three; the draft step appears to have synthesised a fourth option implicitly. Worth confirming the draft prompt's option-count behaviour separately.

### Step 3: 3_add_option
Status: **pass**
Latency: 4,545 ms (harness) / 8,196 ms (independent curl)
Outcome class: v5-runtime
HTTP: 200
`assistant_text`: clarifying question — `"To add the right option, I need a bit more detail. What scaling path did you have in mind?"` with three suggestion bullets (contract/freelance, internal transfer, something else). Routes to clarify per the canonical brief's expected behaviour.
`stage_indicator`: `"frame"` (regressed from `analyse` — expected on a frame-add turn).
Banned-term scan: clean. Em-dash scan: clean.

### Step 4: 4_run_analysis
Status: **pass (structural)** — but with content findings:
Latency: 4,902 ms (harness) / 4,217 ms (independent curl)
Outcome class: v5-runtime
HTTP: 200
Response keys: `response_version`, `assistant_text`, `blocks` (1), `suggested_actions` (0), `insights` (0), `stage_indicator`. **`analysis_ready` is absent.**

`assistant_text`: `"Ran analysis on your current scenario."`
`blocks[0]`: type `analysis_result` with `summary`, `leading_option_id`, `win_probabilities`, `enrichment` (review_cards, factor_sensitivity, edge_sensitivity, m1_coaching, ceeTrace).

**Finding 4.1 — `analysis_ready` not stamped on the wire for chip_click run_analysis path:**
- Field/behaviour: top-level `analysis_ready` is missing on this turn while present on every other turn (1, 2, 3, 5, 6) of the same scenario.
- Failure layer: **Composition**
- Likely fix owner: CEE response-finaliser caller (chip-click dispatch path)
- Owning code: [src/orchestrator-v5/handlers/chip-click-dispatch.ts:219-225](../../src/orchestrator-v5/handlers/chip-click-dispatch.ts#L219-L225) calls `composeToolCallResponse({orientation, confirmation, coaching, stage, handlerFacts})` — no `analysisReady` parameter — and the subsequent commit at [chip-click-dispatch.ts:228-237](../../src/orchestrator-v5/handlers/chip-click-dispatch.ts#L228-L237) via [commitDirectAnswer](../../src/orchestrator-v5/commit.ts#L77) likewise carries no analysis_ready field. The finaliser at [src/orchestrator-v5/response-finaliser.ts:177-178](../../src/orchestrator-v5/response-finaliser.ts#L177-L178) only stamps `analysis_ready` when `ctx.analysisReady` is supplied; absent ⇒ no field. The run-analysis handler itself ([src/orchestrator-v5/tools/handlers/run-analysis.ts](../../src/orchestrator-v5/tools/handlers/run-analysis.ts)) does not emit `analysisReady` either (grep confirms zero references to `analysisReady`/`analysis_ready` in that file). The structural readiness helper [src/orchestrator/tools/analysis-ready-helper.ts](../../src/orchestrator/tools/analysis-ready-helper.ts) is wired in `buildTurnContext`'s graph hydration path but not in the chip-click composition path.
- Chain-blocking: yes — Step 5 then has no fresh `analysis_ready` to surface (consistent with Step 5's degraded behaviour below).

**Finding 4.2 — banned term "CEE" leaks into user-renderable enrichment field:**
- Field/behaviour: `blocks[0].enrichment.ceeTrace.reason` contains the literal `"Legacy CEE calls skipped (M2 decision-review enabled)"`.
- Failure layer: **Schema/contract** (the field is composed upstream of CEE — likely PLoT or ISL decision-review pipeline — and surfaces unfiltered through CEE's enrichment passthrough into a `blocks[]` field that the UI may render).
- Likely fix owner: cross-service — strip or rename the `ceeTrace.reason` in the producer (decision-review enricher), or filter in CEE before stamping into `blocks[].enrichment`.
- Owning code: producer not in CEE (`grep -rn "Legacy CEE\|ceeTrace" src/` returns no runtime emitter — only test fixtures and observability checks). CEE-side passthrough touches enrichment in [src/orchestrator-v5/coaching/decision-review-enricher.ts](../../src/orchestrator-v5/coaching/decision-review-enricher.ts) (file confirmed exists). The full ceeTrace shape captured: `{requestId, degraded:false, timestamp, source:"orchestrator", reason:"Legacy CEE calls skipped (M2 decision-review enabled)"}`.
- Chain-blocking: no — observed only on analysis turns; user impact is leaked terminology if the UI renders this field.

**Finding 4.3 — four em dashes in user-renderable review_cards content:**
- Field/behaviour: `blocks[0].enrichment.review_cards[0].why` contains `"... low confidence — better data would most improve decision quality."` and three `items[*].suggested_evidence` strings each contain `"... affects the goal —"`.
- Failure layer: **Prompt**
- Likely fix owner: decision-review enricher prompt (`decision_review_default` store_version 11, hash `9477d3b854696a23`).
- Owning prompt: `decision_review_default` per `/admin/prompts/verify`. Repo-side reference: review_card prompt context in [src/prompts/orchestrator-cf-v26.ts:778](../../src/prompts/orchestrator-cf-v26.ts#L778) (older variant; the staging-loaded version is the store-backed v11 of `decision_review_default`).
- Chain-blocking: no.

### Step 5: 5_explain_leader
Status: **pass (structural) — but behaviourally degraded.**
Latency: 4,902 ms (harness column shows missing latency on harness row) / 5,357 ms (independent curl)
Outcome class: v5-runtime
HTTP: 200
Response includes: `assistant_text`, `analysis_ready` (re-present after Step 4 dropped it), 1 chip (`label: "Summarise the decision"`, `action_type: null`).

`assistant_text`: `"Analysis was just queued but results aren't back yet, so I can't tell you which option leads or why from computed data. Once the simulation completes, I'll be able to walk you through the leading option, the top drivers behind it, and what assumption is most likely to change the result. Refresh or send another message and the findings should be ready."`

**Finding 5.1 — Step 4's analysis result not surfaced to Step 5's reasoning:**
- Field/behaviour: assistant_text claims results are not back, despite Step 4 having returned a complete analysis envelope (75,413 bytes — leading_option_id, win_probabilities, factor_sensitivity, m1_coaching all populated). The Sonnet model on Step 5 either (a) did not see the run_analysis HandlerFact in its context pack, or (b) saw it but the v38.2 routing prompt does not surface fact contents in a way it can ground "explain leader" on, or (c) the fact-read on Step 5 happened before Step 4's commit was visible (race / RLS / read-replica lag).
- Failure layer: **State** (primary suspect — handler facts not propagating into the next turn's context); **Prompt** (secondary suspect if facts were loaded but prompt did not reference them).
- Likely fix owner: CEE state pipeline (`buildTurnContext`'s `readFactsFor` path) and/or v38.2 routing prompt's fact-surfacing instructions.
- Owning code: fact load at [src/orchestrator-v5/build-turn-context.ts:181-197](../../src/orchestrator-v5/build-turn-context.ts#L181-L197) (`readFactsFor(handlerRowIds)` against Supabase `v5_handler_facts`); session store at [src/orchestrator-v5/session/store.ts](../../src/orchestrator-v5/session/store.ts); commit path at [src/orchestrator-v5/commit.ts:77](../../src/orchestrator-v5/commit.ts#L77) (`commitDirectAnswer`). The chain-blocking precondition (Finding 4.1) is upstream — even if facts load fine, the Sonnet prompt only sees `analysis_ready` on the current envelope, which Step 4 did not emit.
- Chain-blocking: yes — the canonical journey's Step 5 ("Why does the leading option win?") cannot be answered with computed data; user gets a stall message.
- Diagnosis-needs-server-logs: confirming whether (a)/(b)/(c) is dominant requires Render logs for `session.read_degraded` and the actual prompt context Sonnet received. The harness's existing finding ("Step 5 does not require leading option, probability, driver, or caveat to be present" in [Docs/v5/v5-golden-path-evidence-cee.md:81](../../Docs/v5/v5-golden-path-evidence-cee.md#L81)) means the harness-level assertion does not catch this — it passed despite the substantive failure.

**Finding 5.2 — chip without action_type:**
- Field/behaviour: `suggested_actions[0]` has `label: "Summarise the decision"` but `action_type: null`. Schema permits this (action_type is optional), but downstream consumers that gate on `action_type` will treat it as decorative.
- Failure layer: **Schema/contract** (or **Handler** — depends on which compose path emitted this chip).
- Likely fix owner: CEE chip generator.
- Owning code: [src/orchestrator-v5/compose/chip-generator.ts:54](../../src/orchestrator-v5/compose/chip-generator.ts#L54) (file exists; emits chips with optional action_type per schema).
- Chain-blocking: no.

### Step 6: 6_edit_budget
Status: **pass**
Latency: 6,450 ms (harness) / 7,753 ms (independent curl)
Outcome class: v5-runtime
HTTP: 200
`assistant_text`: clarifying question referencing real factor — `"Which budget figure would you like to increase, and by how much? The model has **Hiring and Staffing Cost** at £200,000. Do you mean: ..."` with three concrete options (specific amount, delta, cap).
`stage_indicator`: `"frame"`. Banned-term scan: clean. Em-dash scan: clean. analysis_ready: present.

Quality: **good** — grounded in actual graph state (correct factor name + value). Routes to clarify rather than committing an edit (consistent with v5 recoverable-validation pattern when factor reference is ambiguous).

## Marketing scenario

**Not run.** Bundle `.tmp/diagnostic/olumi-debug-d90cfe97-20260426.json` exists (36,924 bytes) but its `payloads.cee_request.message` is `"Proceed."` (a follow-up turn) and the original 297-char framing brief is not in the bundle. The bundle's `full_graph` reveals the decision shape (decision label `"Marketing Approach for Product Feature Launch"`; option labels `"Use AI Tool + Increase Ad Spend"`, `"Hire Marketing Manager"`, `"Self-Manage Campaign (Status Quo)"`) but reconstructing a verbatim brief from labels would constitute an invented fixture, which scope forbids. Per scope decision (§Decisions confirmed, plan), fell back to Hiring-only.

To restore Marketing coverage in a future baseline, either (a) capture a fresh debug bundle that retains `cee_request.message` from the framing turn, or (b) add a second canonical brief to [tools/v5-journey-replay/steps.ts](../../tools/v5-journey-replay/steps.ts) (out of scope here).

## Failure summary (ordered by chain position)

| Scenario | Step | Failure layer | Likely fix owner | Root cause | Chain-blocking | Owning file |
|---|---|---|---|---|---|---|
| Hiring | 1 | Prompt | `draft_graph_default` prompt edit | assistant_text exposes graph internals (nodes/edges count) instead of product framing — minor prompt-style finding | no | [src/prompts/defaults-v187.ts](../../src/prompts/defaults-v187.ts) (store-backed at staging, store_version 189) |
| Hiring | 4 | Composition | CEE chip-click dispatch | run_analysis chip-click path composes response without passing `analysisReady` to the finaliser, so `analysis_ready` is absent on the wire (only run_analysis turn missing it across the journey) | yes | [src/orchestrator-v5/handlers/chip-click-dispatch.ts:219-225](../../src/orchestrator-v5/handlers/chip-click-dispatch.ts#L219-L225); finaliser contract at [src/orchestrator-v5/response-finaliser.ts:177-178](../../src/orchestrator-v5/response-finaliser.ts#L177-L178) |
| Hiring | 4 | Schema/contract | upstream service (PLoT/ISL decision-review) + CEE passthrough | `blocks[0].enrichment.ceeTrace.reason` ships `"Legacy CEE calls skipped (M2 decision-review enabled)"` to user-renderable enrichment field — internal terminology leak | no | producer not in CEE; CEE-side passthrough at [src/orchestrator-v5/coaching/decision-review-enricher.ts](../../src/orchestrator-v5/coaching/decision-review-enricher.ts) |
| Hiring | 4 | Prompt | `decision_review_default` prompt edit | review_cards `why`/`suggested_evidence` strings contain em dashes (4 hits) — diverges from v38.2 style expectation | no | `decision_review_default` prompt store_version 11 (hash 9477d3b854696a23); repo reference [src/prompts/orchestrator-cf-v26.ts:778](../../src/prompts/orchestrator-cf-v26.ts#L778) |
| Hiring | 5 | State | CEE state pipeline + possibly v38.2 prompt | "explain leader" turn returns "results aren't back yet" despite Step 4 returning a complete analysis envelope — handler facts either not propagating to next turn's context or not surfaced to Sonnet by the prompt | yes | [src/orchestrator-v5/build-turn-context.ts:181-197](../../src/orchestrator-v5/build-turn-context.ts#L181-L197); [src/orchestrator-v5/session/store.ts](../../src/orchestrator-v5/session/store.ts); [src/orchestrator-v5/commit.ts:77](../../src/orchestrator-v5/commit.ts#L77) |
| Hiring | 5 | Schema/contract | CEE chip generator | chip emitted with `action_type: null` — schema-permitted but consumers gating on action_type treat as decorative | no | [src/orchestrator-v5/compose/chip-generator.ts:54](../../src/orchestrator-v5/compose/chip-generator.ts#L54) |

## Binding constraint

The two chain-blocking failures are **causally linked**: Step 4 omitting `analysis_ready` from the wire (Composition, Hiring Step 4, Finding 4.1) plausibly causes Step 5's "results aren't back yet" stall (State, Hiring Step 5, Finding 5.1) — a v38.2 prompt that gates "explain leader" responses on `analysis_ready` being present in the current envelope (rather than reading the prior_facts list directly) would behave exactly this way.

**Single binding constraint:** stamp `analysis_ready` on the wire from the chip-click `run_analysis` path so subsequent Sonnet turns can ground "explain leader" / "compare options" / "summarise" responses on the just-completed analysis without re-reading handler-fact tables.

Downstream steps unblocked: Step 5 (`explain_leader`) becomes substantively answerable — leading option, win probability, driver, caveat — instead of stalling. Step 6 (`edit_budget`) is unaffected (already grounds in graph state, not analysis).

If further investigation in Render logs reveals Step 5 fails for an independent State-layer reason (handler-fact read failing despite analysis_ready being present), the secondary fix is at [src/orchestrator-v5/build-turn-context.ts:181-197](../../src/orchestrator-v5/build-turn-context.ts#L181-L197). The earliest-chain-blocker rule still keeps the Composition fix (Step 4) at the top.

## Diagnostic limitations

- **PLoT health: not probed.** `PLOT_BASE_URL` is not in local `.env`; staging Render env value unknown. Step 4's response carries enrichment fields (`request_schema_version`, `endpoint_version`, `preflight_version`, `analysis_status`, `m1_coaching`, `factor_sensitivity` etc.) that came from PLoT, so PLoT was reachable from staging at run time, but no separate `/healthz` confirmation was captured.
- **ISL health: not probed.** ISL URL not discoverable from local env. Step 4's `isl_analysis_status` field in `blocks[0].enrichment` confirms ISL was invoked from PLoT.
- **Staging build vs finaliser: included.** All six finaliser commits are ancestors of staging HEAD `38106bd7`. No "pre-finaliser" caveat applies.
- **Marketing scenario availability: bundle present, brief absent — Hiring only.** Per `Docs/v5/v5-readiness-diagnostic.md:9-13`, the diagnostic bundles were captured in `meta.environment: "development"` with `client_build: "dev1234"`; the framing brief that produced the bundle's graph is not stored in the bundle structure.
- **Feature flags reported are local defaults from `src/config/index.ts`.** Staging-side env values cannot be read directly from any `/healthz` or `/admin/*` endpoint exposed today; presence of V5 envelope shape implies `ENABLE_V5_ORCHESTRATOR=true` on staging but other flags are unverifiable.
- **Prompt behaviour observation method:** v38.2 sentence-case / em-dash / banned-term checks are not enforced in code. Observations are based on (a) the harness's internal forbidden-term scan ([tools/v5-journey-replay/forbidden-terms.ts](../../tools/v5-journey-replay/forbidden-terms.ts)) — which uses a deliberately loose pattern (`handler[ _](id|failed|error|registered)`, not plain `handler`) — and (b) an independently-coded scan against the brief's broader 11-term list (`analysis_ready`, `handler`, `validator`, `node kind`, `CEE`, `PLoT`, `stack trace`, `error code`, `dispatch`, `compose`, `finaliser`) over user-facing fields (`assistant_text`, `blocks`, `insights`, `suggested_actions`, `stage_indicator`).
- **V5 routing prompt hash on staging is unverified.** The expected hash `2e25001a025e288c` for `Prompts/v38.2.txt` was sourced from the harness header; staging does not surface the loaded V5 prompt hash via any admin endpoint (only V1 store-backed prompts appear in `/admin/prompts/verify`).
- **Step 5's State-vs-Prompt root-cause split needs server logs.** Without `session.read_degraded` telemetry events and the actual prompt context Sonnet received on Step 5, attribution between (a) handler-fact read failure, (b) prompt not surfacing facts, and (c) commit/read race remains a triage choice. The Composition-layer fix at Step 4 (the binding constraint) plausibly resolves the user-visible symptom regardless of which sub-cause dominates.
- **Independent curl session and harness session used different scenario ids.** The harness session (`5ba22a71-…`) and the curl session (`5b6a7d2b-…`) are two separate scenarios that were run within ~3 minutes of each other against the same staging build. Findings replicate across both runs (both produced 6/6 structural pass with the same content findings on Step 4 and Step 5), so the conclusions are robust to single-run noise.

---

## Delta — `claude/v5-chip-click-analysis-ready` (pending staging deploy)

Date: 2026-04-27
Branch: `claude/v5-chip-click-analysis-ready` (off `claude/v5-response-finaliser` HEAD)
Status: **awaiting staging deploy** — pass/fail counts and binding-constraint claims will be updated after a staging replay runs with `--expected-build` matching the deployed SHA.

### What changed

Targeted at the binding constraint (Hiring Step 4 / Finding 4.1) plus Paul's defensive-scrub scope expansion on Tasks 5 and 6 of the brief.

| # | Change | File(s) |
|---|---|---|
| 1 | **Wire `analysisReady` from chip-click dispatch — single-source-of-truth snapshot wiring.** The dispatcher pre-loads the scenario snapshot ONCE via `loadScenarioSnapshotForRunAnalysis(scenario_id)` and injects a one-shot `ScenarioReader` returning that exact cached snapshot into the per-call registry (`createRegistry({ scenarioReader })`). After commit, `computeStructuralReadiness(snapshot.graph)` derives readiness from the same `GraphV3T` reference the handler operated on. **No second persistence read, no TOCTOU window** — a concurrent edit-graph dispatch from another session cannot drift readiness from what the handler saw. Snapshot-load failure paths log `analysis_ready_missing_reason` ("snapshot_load_failed" or "no_goal_node") so the original baseline regression cannot recur as an unobservable false negative. `route-v2.ts:481-483` already forwards `cc.analysisReady` to `sendFinalised200`; the chain is now intact. | [src/orchestrator-v5/handlers/chip-click-dispatch.ts](../../src/orchestrator-v5/handlers/chip-click-dispatch.ts), [src/orchestrator-v5/tools/registry.ts](../../src/orchestrator-v5/tools/registry.ts) (re-exports `ScenarioReader` + `RunAnalysisScenarioSnapshot` to satisfy the handler-ownership invariant) |
| 2 | **Defensive `ceeTrace` scrub on egress.** When `CEE_TURN_DEBUG_ENABLED=false` the finaliser strips any `ceeTrace` field from the response before stamping `analysis_ready`. No V5 source on this branch writes `ceeTrace` (verified by exhaustive grep), but the baseline observed it from an upstream layer; this is a permanent guard. | [src/orchestrator-v5/response-finaliser.ts](../../src/orchestrator-v5/response-finaliser.ts) |
| 3 | **Defensive chip-suppression validation.** `validateAndFilterChips` drops any chip whose `action_type` is literally `null` or points at an unregistered handler. Prompt chips (no `action_type` field) pass through unchanged. No fallback action_type is invented. | [src/orchestrator-v5/compose/chip-generator.ts](../../src/orchestrator-v5/compose/chip-generator.ts) |

### Tests added (all green locally)

| Test | Coverage |
|---|---|
| [chip-click-dispatch-analysis-ready.test.ts](../../src/orchestrator-v5/handlers/__tests__/chip-click-dispatch-analysis-ready.test.ts) | 4 cases — uses a REAL schema-valid GraphV3T fixture and the REAL `computeStructuralReadiness` (no GraphV3 / helper mocks): (a) `analysisReady` surfaces on dispatch result; (b) snapshot loaded EXACTLY ONCE and the same object identity is shared with handler reader and readiness derivation (`expect(readerOutput).toBe(snapshot)` — TOCTOU regression guard); (c) **race/regression**: a divergent post-edit graph queued during handler execution is NEVER consumed because there is no second read; (d) graceful failure when persisted graph is missing. |
| Schema sweep + negative-then-positive contract in [response-finaliser.test.ts](../../src/orchestrator-v5/__tests__/response-finaliser.test.ts) | `composeToolCallResponse` omits `analysis_ready` (negative); `finaliseV5Response` stamps it on the same envelope (positive); ceeTrace scrub: stripped when debug disabled (3 cases) AND **preserved when `CEE_TURN_DEBUG_ENABLED=true`** (proves opt-out behaviour, not always-on). |
| New cases in [route-v2-chip-click.test.ts](../../tests/integration/orchestrator/route-v2-chip-click.test.ts) | Full-path: chip-click → dispatch → finaliser → wire. Asserts `analysis_ready` present with ISO-8601 `computed_at` when supplied; absent when not. |
| [chip-suppression.test.ts](../../src/orchestrator-v5/compose/__tests__/chip-suppression.test.ts) | 7 cases — null suppressed, unregistered suppressed, prompt chip kept, registered chip kept, no fallback fabrication. |
| [step5-denial-phrases.test.ts](../../tests/unit/v5-journey-replay/step5-denial-phrases.test.ts) | Replay-harness `assertExplainLeader` hard-fails on 15 specific denial shapes (`results aren't back yet`, `haven't run the analysis`, `analysis is not ready`, `simulation hasn't completed`, etc.), with **8 whitelisted false-positive shapes** ("no further analysis required", "I haven't run a sensitivity analysis on that specific factor, but the leading option is X", etc.) ensuring legitimate analysis-state discussion does not trip the guard. |
| `assertAnalysisRun` in [tools/v5-journey-replay/assertions.ts](../../tools/v5-journey-replay/assertions.ts) (extended) | **Step 4 wire `analysis_ready` is now a hard assertion**: replay row fails with `step_4_analysis_ready_missing` / `_unexpected_status` / `_options_too_few` / `_goal_node_id_missing` / `_computed_at_missing` if the field is absent or malformed. Closes the gap where Step 4 quietly passed at the structural level while shipping no readiness signal. |

### Local replay attempted

```
pnpm tsx tools/v5-journey-replay/index.ts \
  --base-url http://localhost:3101 \
  --out /tmp/v5-replay-local.md \
  --scenario-prefix local-post-fix
```

Result: **environmentally blocked.** Step 1 (`1_draft_graph`) returned HTTP 500 with `reason: draft_graph_commit_failed` because local `.env` has LLM keys but no `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` (Supabase credentials are staging-only per the project's session note). Steps 2–6 skipped on chain dependency. The local server itself is healthy (`/healthz` 200, V5 enabled, route registered, auth working) — the failure is at the persistence layer, not in the wire fix.

The wire fix is verified via the route-level integration test (Task 3c above) which directly proves chip-click → dispatch → finaliser → wire emits `analysis_ready` on the response body.

### Verification gauntlet (local, all green)

- `pnpm exec tsc -p tsconfig.build.json --noEmit` — clean
- `bash scripts/check-no-direct-analysis-ready.sh` — clean (D1 + D2 mechanisms both pass)
- `pnpm vitest run` — **719 test files, 12,608 tests passed; 32 skipped (network/integration gated); 0 regressions**
- `bash scripts/validate-prepush.sh` — all 15 stages pass

### Pending — staging replay

After staging deploy, run:

```
OLUMI_REPLAY_API_KEY=<staging-key> \
pnpm tsx tools/v5-journey-replay/index.ts \
  --base-url https://cee-staging.onrender.com \
  --expected-build <staging-build-hash-after-deploy> \
  --out Docs/v5/v5-golden-path-evidence-cee.md \
  --scenario-prefix staging-post-fix
```

Acceptance criteria:
- 6/6 pass
- Step 4 wire response carries `analysis_ready` (Finding 4.1 closed)
- Step 5 `assistant_text` length > 200 chars, contains at least one option label drafted in Step 1, AND no denial phrase per the new harness assertion (Finding 5.1 closed)
- No `ceeTrace` on wire (Finding 4.2 confirmed clean by defensive scrub)
- No chips with literal `action_type: null` (Finding 5.2 confirmed clean by suppression pass)
- `--expected-build` matches the deployed SHA

If staging replay goes green, this evidence file will be updated with revised pass/fail counts, the binding constraint marked **closed**, and the failure-summary table re-derived from the new replay.

### Out of scope — Discoveries (deferred to separate brief)

- **Frame-stage edit intents fall to coaching.** Steps 3 ("Add another option") and 6 ("Increase the budget factor") arrive at `stage='frame'`; the `dispatchEditGraph` gate at [route-v2.ts:594-598](../../src/orchestrator/route-v2.ts#L594-L598) requires `stage ∈ {analyse, decide}` so these messages fall through to TurnExecutor. Sonnet's `olumi_action.handler_id` enum at [routing/tool-schema.ts:62-77](../../src/orchestrator-v5/routing/tool-schema.ts#L62-L77) only exposes `run_analysis`; the registry at [tools/registry.ts:165-173](../../src/orchestrator-v5/tools/registry.ts#L165-L173) only registers `run_analysis`. Result: structural edit intents at frame stage produce coaching responses (~131–193 chars) with stage echoed. **Recommended follow-up brief:** either (a) lower the `dispatchEditGraph` stage gate to allow `frame`, (b) register `add_option`/`edit_factor` handlers and expose them in the tool schema, or (c) hybrid. Each deserves its own scope.
