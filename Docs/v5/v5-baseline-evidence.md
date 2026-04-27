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

Hiring (pre-fix baseline, staging `38106bd`): 6/6 structural pass; 2 chain-blocking findings (4.1, 5.1); 4 non-blocking.
Hiring (post-fix replay, staging `f588320`): **6/6 structural pass — no regression**; **Findings 4.1 (analysis_ready on Step 4 wire) and 5.2 (chip without action_type) closed**; **Finding 5.1 (Step 5 stall) NOT closed** — wire fix did not propagate analysis content into Sonnet's Step 5 reasoning, root cause refined from "Composition cascade" to **independent State/Prompt**; Findings 4.2 (ceeTrace leak) and 4.3 (em dashes) unchanged.

See **Delta — `claude/v5-chip-click-analysis-ready` (post staging deploy)** below for the per-finding acceptance table and revised binding constraint.

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

## Delta — `claude/v5-chip-click-analysis-ready` (post staging deploy)

Date: 2026-04-27 (replay run 22:23 UTC)
Branch: `claude/v5-chip-click-analysis-ready` merged into `staging` as `f588320f`.
Status: **deploy verified** — staging build hash `f588320` (= commit `f588320fd285703ee77dda382172a4cab248b1e2`) matches `--expected-build f588320`. Two findings closed, three still open. **Binding constraint shifted downstream: the wire fix did not resolve the user-visible Step 5 stall.**

Replay scenarios run:
- Harness: scenario id `28f0325b-d3b1-4ec6-b864-82ed4da52f1d`, full 6-step chain.
- Independent curl, full chain: scenario id `ecf702c0-eb33-44b2-8f47-e11bda370231`, 6 steps mirroring `tools/v5-journey-replay/steps.ts` payloads exactly. Step 5 in this run **hit the denial phrase "results aren't available… haven't come through yet"** — see Finding 5.1 below.

Pass counts:
- **Hiring 6/6** at HTTP/structural level (no regression vs pre-fix baseline). All steps return 200; harness's per-row `failing_contract` column is empty for every row.
- The harness's Step 5 reported `text_len=1497` and structurally passed; the independent curl session's Step 5 returned `text_len=282` and contained a denial-phrase match. Whether the harness's longer Step 5 contained denial wording in different prose cannot be verified from the harness's evidence pack (text content is not persisted, only `text_len`). The curl session is therefore authoritative for content-level Step 5 attribution.

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

### Staging replay results

Command run:
```
OLUMI_REPLAY_API_KEY=<staging-key> \
pnpm tsx tools/v5-journey-replay/index.ts \
  --base-url https://cee-staging.onrender.com \
  --expected-build f588320 \
  --out Docs/v5/v5-golden-path-evidence-cee.md \
  --scenario-prefix staging-post-chip-click-fix
```

Result: harness exit code 0; deploy gate passed (`/healthz.build f588320` matches `--expected-build`); `[PASS]` on all six rows (see [Docs/v5/v5-golden-path-evidence-cee.md](../../Docs/v5/v5-golden-path-evidence-cee.md) for the regenerated harness pack). `[PASS] 4_run_analysis: status=200 chip_count=0 analysis_ready=ready options=4 elapsed=5187ms` ← the new harness signal explicitly proves wire-level `analysis_ready` shipped on Step 4.

Per-finding status against acceptance criteria:

| Finding | Acceptance | Observed (post-fix) | Status |
|---|---|---|---|
| 4.1 — `analysis_ready` missing on Step 4 wire | wire carries `analysis_ready` with status, options, goal_node_id, ISO-8601 `computed_at` | Step 4 envelope: `analysis_ready={status:"ready", options:[4 entries with option_id+label+status+interventions+impact_proxy], goal_node_id:"goal_q3_delivery", computed_at:"2026-04-27T22:27:38.938Z"}` ✓ | **CLOSED** ✓ |
| 4.2 — `ceeTrace.reason` "CEE" leak | no `ceeTrace` on wire (defensive scrub) | Step 4 envelope still contains `blocks[0].enrichment.ceeTrace.reason: "Legacy CEE calls skipped (M2 decision-review enabled)"`. Banned-term scan: 1 hit (unchanged from pre-fix). | **NOT CLOSED** — scrub at [response-finaliser.ts:197-199](../../src/orchestrator-v5/response-finaliser.ts#L197-L199) only deletes `response.ceeTrace` (top-level on `OlumiResponse`); the actual leak path is `response.blocks[0].enrichment.ceeTrace`, which the scrub does not traverse. Either deepen the scrub to walk `blocks[*].enrichment.ceeTrace` or strip at the producer (decision-review enricher). |
| 4.3 — em dashes in `review_cards` | not in branch scope; no acceptance change | 4 hits in `blocks[0].enrichment.review_cards[0].why` and `items[*].suggested_evidence` (unchanged from pre-fix) | **NOT CLOSED** (not in scope for this branch — Prompt-layer follow-up) |
| 5.1 — Step 5 stalls with "results aren't back yet" | `assistant_text` > 200 chars, contains an option label, no denial phrase | Independent curl Step 5 (full chain, scenario `ecf702c0-…`): 282 chars, **contains denial phrase** `"Analysis results aren't available in the current context , the simulation was run but the results haven't come through yet."`. No option label referenced. Harness Step 5 was 1497 chars — content not in evidence pack to verify denial-phrase status. | **NOT CLOSED** — the wire-level fix (4.1) did NOT propagate analysis content into Sonnet's reasoning on Step 5. Root cause is downstream of the wire: either (a) handler facts are not surfaced to the Sonnet prompt's working context in a usable form, or (b) the v38.2 routing prompt has no instruction to ground "explain leader" responses on `prior_facts[].run_analysis` content even when present. The pre-fix evidence's "two findings causally linked" hypothesis was wrong: 4.1 and 5.1 are **independent**. |
| 5.2 — chip with `action_type: null` | no chips with literal `action_type: null` | Step 5 chip is now `{id: "chip_prompt_summarise_decision", label: "Summarise the decision", message: "Summarise the decision and the key trade-offs."}` — no `action_type` field at all (prompt-shape chip per the suppression rule's allow list). | **CLOSED** ✓ |

### Revised binding constraint (post-fix)

**Step 5's "explain leader" turn does not ground in the run_analysis handler fact even when `analysis_ready={status:"ready"}` is present on the same envelope.** Two-stage triage required:

1. **State-layer probe (cheap, do first):** confirm whether `prior_facts` on Step 5's `EnrichedTurnContext` includes the run_analysis fact committed at Step 4. Add a single `log.info({event:"v5_turn_context_facts", request_id, scenario_id, fact_count, fact_kinds: prior_facts.map(f => f.kind)})` line at [src/orchestrator-v5/build-turn-context.ts](../../src/orchestrator-v5/build-turn-context.ts) just after `readFactsFor`, push to staging, replay, read Render logs. If `fact_count===0` on Step 5 → State-layer fix (Supabase commit-vs-read race / RLS / row visibility on `v5_handler_facts`). If `fact_count>=1` and includes a `run_analysis` fact → State path is fine.

2. **Prompt-layer fix (gated on probe):** if State path is fine, the v38.2 routing prompt does not surface `prior_facts[run_analysis].outcome` to Sonnet in a way it can use to answer "explain leader". Audit `Prompts/v38.2.txt` for whether `prior_facts` contents are rendered into the Sonnet system/user message, and whether the prompt instructs Sonnet to ground analysis-explanation responses on those facts rather than denying when the current envelope's `analysis_ready` lacks per-option result data.

**Downstream steps unblocked:** Step 5 (`explain_leader`) becomes substantively answerable — leading option, win probability, drivers, caveats — instead of stalling. Step 6 (`edit_budget`) is independent and already passes substantively (grounded in graph state, not analysis).

Secondary follow-ups out of this binding-constraint scope:
- Finding 4.2 (ceeTrace leak): one-line fix at the finaliser scrub to walk `blocks[*].enrichment.ceeTrace`, or strip at the decision-review enricher producer. Cheap and orthogonal.
- Finding 4.3 (em dashes): prompt edit on `decision_review_default` (store_version 11). Out of scope for orchestrator brief; belongs in a prompt-curation pass.

### Ratchet status

Pre-fix baseline (staging `38106bd`): 6/6 structural pass; 2 chain-blocking findings (4.1, 5.1); 4 non-blocking (1.1, 4.2, 4.3, 5.2).
Post-fix replay (staging `f588320`): **6/6 structural pass — no regression**; 1 chain-blocking finding remains (5.1, root cause shifted from Composition to State/Prompt); 2 non-blocking remain (4.2, 4.3); 2 closed (4.1, 5.2); 1 was a Step 1 prompt observation never claimed for fix in this branch (1.1).

The ratchet rule is upheld: every step that previously passed still passes; pass count is equal-or-better; the closed findings (4.1, 5.2) cannot regress without a new failure being recorded. **The wire fix (4.1) is permanent.** The shifted Step 5 attribution (5.1 from "Composition cascade" to "independent State/Prompt") is a refinement of the diagnostic, not a regression.

### Out of scope — Discoveries (deferred to separate brief)

- **Frame-stage edit intents fall to coaching.** Steps 3 ("Add another option") and 6 ("Increase the budget factor") arrive at `stage='frame'`; the `dispatchEditGraph` gate at [route-v2.ts:594-598](../../src/orchestrator/route-v2.ts#L594-L598) requires `stage ∈ {analyse, decide}` so these messages fall through to TurnExecutor. Sonnet's `olumi_action.handler_id` enum at [routing/tool-schema.ts:62-77](../../src/orchestrator-v5/routing/tool-schema.ts#L62-L77) only exposes `run_analysis`; the registry at [tools/registry.ts:165-173](../../src/orchestrator-v5/tools/registry.ts#L165-L173) only registers `run_analysis`. Result: structural edit intents at frame stage produce coaching responses (~131–193 chars) with stage echoed. **Recommended follow-up brief:** either (a) lower the `dispatchEditGraph` stage gate to allow `frame`, (b) register `add_option`/`edit_factor` handlers and expose them in the tool schema, or (c) hybrid. Each deserves its own scope.

---

## Delta — `claude/v5-step5-grounding-probe` (wiring landed, pre-replay)

Date: 2026-04-28
Branch: `claude/v5-step5-grounding-probe` off staging `f588320`. **Not yet pushed; pending Paul's authorisation.**

This delta wires up a State→Composition→Prompt triage probe for the residual Step 5 stall (Finding 5.1, post `claude/v5-chip-click-analysis-ready`). The actual Task 4 fix is gated on the probe's read against a staging replay — explicitly NOT applied here. Two adjacent hardening tasks rode along: a nested-scope ceeTrace scrub gap (Finding 4.2) and replay-harness gaps that let the original Step 5 stall pass at the structural level despite shipping a denial phrase.

### What changed (this branch)

| # | Change | File(s) |
|---|---|---|
| 1 | **State-layer probe — facts log.** Added `event:"v5_turn_context_facts"` info-level log at `readFactsFor` return inside `fetchPriorFacts`. Carries `request_id`, `scenario_id`, `prior_turn_count`, `handler_row_id_count`, `fact_count`, `fact_types[]`, `has_run_analysis_fact`. | [src/orchestrator-v5/build-turn-context.ts](../../src/orchestrator-v5/build-turn-context.ts) |
| 2 | **Composition/render probe — projection log.** Added `event:"v5_turn_context_analysis_projection"` info-level log after `assembleContextPackWithSummary` returns. Derived `analysis_projection_status` enum collapses the triage into one grep-friendly value: `facts_absent` \| `projection_empty` \| `projection_populated`. Constituent flags (`has_run_analysis_fact`, `leading_option_populated`, `analysis_section_chars`, `top_drivers_count`, etc.) remain on the same line for forensic detail. | [src/orchestrator-v5/turn-executor.ts](../../src/orchestrator-v5/turn-executor.ts) |
| 3 | **Nested ceeTrace scrub.** `stripCeeTrace` extended to walk `response.blocks[*].enrichment` and strip `ceeTrace` from each block in addition to top-level. Same opt-out via `CEE_TURN_DEBUG_ENABLED=true`. Closes Finding 4.2 from the post-fix delta — staging f588320 still showed `blocks[0].enrichment.ceeTrace.reason: "Legacy CEE calls skipped"` because the original strip only touched top-level. | [src/orchestrator-v5/response-finaliser.ts](../../src/orchestrator-v5/response-finaliser.ts) |
| 4 | **Replay harness — assistant_text persisted.** `EvidenceRow` extended with optional `assistant_text` field; harness captures it (redacted via `redactString`) on every passing/failing row that received a response body. Evidence-writer renders per-step text inside fenced blocks under the table. Pre-fix baseline showed harness Step 5 passed (`text_len=1497`) while curl on the same staging build returned a denial phrase — text persistence closes that blind spot. | [tools/v5-journey-replay/types.ts](../../tools/v5-journey-replay/types.ts), [tools/v5-journey-replay/index.ts](../../tools/v5-journey-replay/index.ts), [tools/v5-journey-replay/evidence-writer.ts](../../tools/v5-journey-replay/evidence-writer.ts) |
| 5 | **Replay harness — denial-phrase regex extended.** Two new `STEP5_DENIAL_PHRASES` patterns close the gap that staging f588320 caught: (a) `aren't available <preposition> <context>` (displaced "yet" anchor), (b) `haven't come through` (separate idiom). The original 8 patterns required "yet" immediately after "available", which missed the production text "aren't available in the current context… haven't come through yet". Verbatim staging text now hard-fails. `STEP5_DENIAL_PHRASES` is now exported (was internal). | [tools/v5-journey-replay/assertions.ts](../../tools/v5-journey-replay/assertions.ts) |
| 6 | **Replay harness — Step 5 substance gate.** `assertExplainLeader` now hard-fails with `step_5_text_too_short` when `text.length <= 200`. The 200-char threshold is tuned to the staging f588320 baseline (failing curl: 282 chars; legitimate passes: ≥800 chars). | [tools/v5-journey-replay/assertions.ts](../../tools/v5-journey-replay/assertions.ts) |
| 7 | **Replay harness — Step 1 → Step 5 option label threading.** `JourneyContext` and harness loop now parse `draft_graph.nodes` of kind `option` after Step 1 passes; `step1OptionLabels` is threaded into `assertExplainLeader`. Step 5 hard-fails with `step_5_no_option_label_referenced` when labels are present but none referenced (case-insensitive). Empty labels (Step 1 parse miss or out-of-journey invocation) degrade gracefully — substance check still applies, label gate is skipped. | [tools/v5-journey-replay/index.ts](../../tools/v5-journey-replay/index.ts), [tools/v5-journey-replay/assertions.ts](../../tools/v5-journey-replay/assertions.ts) |

### Tests added / extended (all green locally — 12,643 pass / 0 regressions)

| Test | Coverage |
|---|---|
| [response-finaliser.test.ts](../../src/orchestrator-v5/__tests__/response-finaliser.test.ts) | +4 cases: nested scrub when debug disabled (sibling enrichment fields preserved); top-level + nested combined; preserved when `CEE_TURN_DEBUG_ENABLED=true`; no-op when blocks have enrichment without ceeTrace. |
| [step5-denial-phrases.test.ts](../../tests/unit/v5-journey-replay/step5-denial-phrases.test.ts) | Rewritten. **15 must-trip phrases** (was 15) + **4 new must-trip cases** for the staging-shape patterns + **3 new whitelist cases** for legitimate "available to" / "came through" phrases + **1 verbatim staging-shape case** + **3 new gate cases** for substance + label gates (3c). Existing fixtures padded with neutral filler so each isolates the regex behaviour from the substance gate. |
| Shared fixture in [_test-helpers.ts](../../tests/unit/v5-journey-replay/_test-helpers.ts) | New `REPLAY_FIXTURE_ASSISTANT_TEXT` constant (≥ 200 chars, references "Option A") used by [deploy-gate.test.ts](../../tests/unit/v5-journey-replay/deploy-gate.test.ts) and [run-integration.test.ts](../../tests/unit/v5-journey-replay/run-integration.test.ts) so existing harness-loop tests still pass under the new Step 5 substance + label gates without invented branching. |

### Local verification (this branch, all green)

- `pnpm exec tsc -p tsconfig.build.json --noEmit` — clean.
- `pnpm exec vitest run tests/unit/v5-journey-replay/` — 204 / 204 pass.
- `pnpm exec vitest run src/orchestrator-v5/__tests__/response-finaliser.test.ts` — 34 / 34 pass (was 30; +4 nested scrub).
- `pnpm exec vitest run --changed --bail=1` — **719 test files, 12,643 tests passed; 32 skipped (network-gated); 1 todo; 0 regressions.**
- `bash scripts/check-no-direct-analysis-ready.sh` — clean.

The probe is a no-op behaviourally — it adds two info-level log lines per turn and zero changes to user-facing output. The harness changes are pure tightening: replay rows that previously passed structurally on Step 5 must now also clear the substance gate, the denial-phrase regex set, and (when journey context is provided) the option-label gate. The mock fixtures used in unit tests have been adjusted to clear these gates so existing coverage is preserved without inventing scenario branching.

### Pending — Task 4 fix (gated on probe)

The Task 4 grounding fix is **explicitly not applied in this branch**. Per the brief's hard scope cap:

| Probe outcome on Step 5 turn | Layer attribution | Fix scope |
|---|---|---|
| `analysis_projection_status: "facts_absent"` | **State** — fact didn't propagate from Step 4's commit to Step 5's read | Trace `run_analysis` handler → `commitDirectAnswer` → Supabase `v5_handler_facts` insert; then `priorTurns` query → `handlerRowIds` → `readFactsFor`. Likely culprits: `turn_class !== 'handler'` filtering at [build-turn-context.ts:192-194](../../src/orchestrator-v5/build-turn-context.ts#L192-L194); commit-vs-read race; RLS policy. Surgical small-fix in this branch. |
| `analysis_projection_status: "projection_empty"` | **Composition** — fact loaded, projection empty | Bug in `buildAnalysisFromPriorFacts` at [analysis-fallback.ts](../../src/orchestrator-v5/context/analysis-fallback.ts) (payload-shape mismatch) or `projectAnalysis` in [context-pack-assembler.ts](../../src/orchestrator-v5/context/context-pack-assembler.ts) (sort/label resolution). Add fixture-level unit test reproducing the staging shape; fix the mismatch. |
| `analysis_projection_status: "projection_populated"` | **Prompt** — Sonnet sees the data and ignores it | **STOP.** Document layer attribution and report. Out of scope: prompt iteration on `Prompts/v38.2.txt` and/or registering an `explain_results` handler — both are separate briefs. |

### Replay (deferred to staging deploy)

The probe is a server-side change; it cannot be exercised against localhost (no Supabase locally — Supabase credentials are staging-only). The triage data lands once Paul authorises a push and the harness runs against staging:

```bash
OLUMI_REPLAY_API_KEY=<staging-key> \
pnpm tsx tools/v5-journey-replay/index.ts \
  --base-url https://cee-staging.onrender.com \
  --expected-build <new-build-hash> \
  --out Docs/v5/v5-golden-path-evidence-cee.md \
  --scenario-prefix staging-step5-probe
```

Render-side filter on the Step 5 turn's `request_id` for `event:"v5_turn_context_facts"` and `event:"v5_turn_context_analysis_projection"`. The single derived `analysis_projection_status` enum identifies the layer; constituent flags on the same log line provide forensic detail. **A post-replay update to this section will record the probe values, layer attribution, and binding-constraint refinement.**

### Updated binding constraint (provisional, awaiting probe)

The wire fix (Finding 4.1) is permanent. Step 5's "explain leader" turn still does not ground in `run_analysis` handler facts even with `analysis_ready={status:"ready"}` on the same envelope — but **the failure point** (State / Composition / Prompt) is unknown until the probe runs. The previous post-fix doc's "Two-stage triage required" framing is now operationalised: the probe is the triage, and only once it speaks should a code fix be authored.

### Ratchet status (post-probe-wiring)

Pre-fix baseline (staging `38106bd`): 6/6 structural pass; 2 chain-blocking findings (4.1, 5.1); 4 non-blocking (1.1, 4.2, 4.3, 5.2).
Post-fix replay (staging `f588320`): 6/6 structural pass; 1 chain-blocking (5.1); 2 non-blocking (4.2, 4.3); 2 closed (4.1, 5.2).
This branch (probe wiring, pre-staging-replay): no behavioural delta on the wire (probe is observability only); harness assertions tightened so a future Step 5 denial-phrase regression cannot mascarade as a structural pass; nested ceeTrace scrub closes Finding 4.2. **Pending probe data, the chain-blocking count remains 1 (5.1) — but the next replay will determine whether it stays open as a code-fix item or migrates to a separate prompt-layer brief.**
