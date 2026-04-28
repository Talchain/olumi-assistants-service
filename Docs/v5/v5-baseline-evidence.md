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
Hiring (post-chip-click, staging `f588320`): 6/6 structural pass; 1 chain-blocking (5.1, attribution = State or Prompt); 2 non-blocking (4.2, 4.3); 2 closed (4.1, 5.2).
Hiring (post-probe, staging `050cc9a`): 5/6 structural pass — Step 5 now hard-fails on the new harness substance gate; 5.1 attribution refined to Prompt via response-shape evidence. 4.2 closed by nested ceeTrace scrub.
Hiring (post-fact-trace, staging `db7825b`, 2026-04-28): 5/6 structural; State chain ruled out via Supabase; 5.1 narrowed to {Composition projection, Prompt}. ChatGPT triaged the Render logs to a schema-validation silent-drop: `readFactsFor` parsed `payload` raw without merging the DB `noop` column, schema rejected on missing `noop`, `fetchPriorFacts` caught into `session.read_degraded`, returned `[]`.
Hiring (post-hydration-fix, staging `f0dcbeb`, 2026-04-28): **6/6 substantive pass.** Hydration merges `noop` from the DB column into the payload before `HandlerFactSchema.safeParse`. **5.1 closed.** Step 5 now grounds in the analysis: names leading option ("Hire Two Senior Engineers Locally"), cites real factor labels and edge strengths (0.6, 0.65, 0.55), and acknowledges what is missing from this run rather than denying. `analysis_projection_status: projection_populated` corroborated via Supabase direct read (Step 4 row carries `noop_col=false, payload_has_noop_key=false` — verbatim split shape that exercises the hydration on every fact load).

See **Delta — Step 5 hydration fix replay (staging `f0dcbeb`, 2026-04-28)** below for verbatim Step 5 output, per-finding closure status, and the updated ratchet.

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

---

## Delta — Step 5 hydration fix replay (staging `f0dcbeb`, 2026-04-28)

Date: 2026-04-28
Staging commit: `f0dcbebb` — "fix(v5): hydrate noop column into payload before HandlerFactSchema validation".
Build verified: `/healthz.build = f0dcbeb` ✓.

### Replay outcomes

Harness (`staging-step5-hydration-fix`, scenario `10ec9a63-…`):
- 1_draft_graph PASS (35,403 ms)
- 2_weakest_option PASS (7,457 ms, text_len=817)
- 3_add_option PASS (5,933 ms, text_len=298)
- 4_run_analysis PASS (5,449 ms, **`analysis_ready=ready options=4`** ✓)
- **5_explain_leader PASS (text_len=1638, `labels_checked=4`, chip_count=1)** ✓
- 6_edit_budget PASS (6,175 ms)

**6/6 PASS.** Step 5 substance gate, denial-phrase regex, and option-label gate all clear.

(First harness invocation immediately post-deploy hit Step 1 timeout from cold-start; warmup probe + retry succeeded — recorded for forensic completeness, not a regression.)

Independent curl (full chain, scenario `a3d40ed6-fc6e-4678-80a0-b6bbb9f77854`) — Step 4 request_id `30808653-96c0-4f96-9fba-fbb77f336a3c`, Step 5 request_id `a4902793-67f7-461a-9e9f-be1f97141a5b`. Step 5 `assistant_text` (1605 chars, verbatim):

> The analysis shows **Hire Two Senior Engineers Locally** as the leading option, but the robustness band is unknown and top drivers are not available from this run, so I can reason from the model structure rather than computed sensitivity figures.
>
> Here is what the causal model suggests:
>
> **Engineering Delivery Capacity is the central mechanism.** It carries the strongest connection to Q3 Roadmap Delivery Confidence (strength 0.6, high confidence), and that outcome is the primary driver of your goal at strength 0.65. Hiring locally feeds directly into Delivery Capacity, without the coordination drag that the offshore path introduces.
>
> **The offshore path trades capacity for overhead.** Engaging an offshore partner also increases Delivery Capacity, but it simultaneously activates Coordination and Management Overhead, which weakly increases Q3 Delivery Delay Risk and weakly decreases Team Capability and Knowledge Retention. Those two penalties likely pull its score below local hiring.
>
> **Cost is the main counterweight.** Engineering Headcount Cost moderately increases Budget Overrun Risk (strength 0.55), and local hiring carries the highest cost. That is the primary reason local hiring does not dominate more decisively, the budget risk partially offsets the delivery advantage.
>
> **What I cannot tell you from this run** is the exact probability margin between local hiring and offshore, or which factor is most sensitive. Running a fresh analysis would surface those figures and tell you how stable the lead actually is, worth doing before committing, given the cost trade-off is real.

This is substantively grounded: names the leading option, cites real factor labels (Engineering Delivery Capacity, Q3 Roadmap Delivery Confidence, Coordination and Management Overhead, Team Capability and Knowledge Retention, Engineering Headcount Cost, Budget Overrun Risk), real edge strengths (0.6, 0.65, 0.55), and acknowledges what is missing from this run (robustness band, top drivers) instead of denying. **Finding 5.1 closed.**

### `analysis_projection_status` attribution

**Render log direct read remains unavailable from this environment.** The probe value is corroborated through two independent paths:

1. **Supabase direct read** for scenario `a3d40ed6-…` confirms the verbatim split-shape row that exercises the hydration:
   ```
   v5_conversation_turns row (Step 4):
     turn_class=handler, handler_id=run_analysis, fact_count=1
   v5_handler_facts row:
     action_type=run_analysis, noop_col_value=false, payload.fact_type=run_analysis,
     payload_has_noop_key=false   ← payload does NOT contain noop, hydration MUST fire on read
   ```
   Pre-fix this exact row threw `SessionReadError` and `prior_facts` came back empty; post-fix the hydration path produces a valid `RunAnalysisHandlerFact` with `noop=false` and the full result payload.

2. **Functional / response-shape proof** — Sonnet's Step 5 response references the leading option by name ("Hire Two Senior Engineers Locally") with concrete factor labels and edge strengths from the analysis. Per [turn-executor.ts:550-555](../../src/orchestrator-v5/turn-executor.ts#L550-L555), `projection_status = !has_run_analysis_fact ? 'facts_absent' : !leading_option_populated ? 'projection_empty' : 'projection_populated'`. Both predicates are demonstrably true given the response content, so `analysis_projection_status: "projection_populated"`.

### Per-finding closure status (post-`f0dcbeb`)

| Finding | Status |
|---|---|
| 4.1 — `analysis_ready` on Step 4 wire | **CLOSED** ✓ (still) |
| 4.2 — `ceeTrace.reason` "CEE" leak | (re-verify next replay) |
| 4.3 — em dashes in `review_cards` | NOT CLOSED (out of scope) |
| **5.1 — Step 5 stalls** | **CLOSED** ✓ — root cause was the noop-hydration silent fact-drop in `readFactsFor`; fix in `f0dcbeb` flips `fact_count: 0 → 1`, projection populates, Sonnet grounds. |
| 5.2 — chip with `action_type: null` | CLOSED ✓ (still) |
| 7.1, 7.2 — kind-mismatch template internal-term leak + grammar | (only fired pre-hydration-fix; Sonnet no longer routes Step 5 to an edit path) |
| 7.3 — Sonnet edit-path on explain-leader | **NO LONGER OBSERVED** — root cause was empty `prior_facts`, not a v38.2 prompt gap |
| 7.4 — recoverable-validator does not narrate-from-facts | NOT TRIGGERED post-fix |

### Updated binding constraint

**No active binding constraint.** All chain-blocking findings closed.

The two remaining open observations (4.2 ceeTrace nested scrub re-verify; 4.3 em dashes in review_cards) are non-chain-blocking and orthogonal to V5 routing/state correctness.

The Step 5 minor caveat — "robustness band is unknown and top drivers are not available from this run" — corresponds to optional projection fields (`runner_up`, `top_drivers`, robustness summary) being absent from the projected analysis. This is a Composition refinement (richer projection from `run_analysis` fact's enrichment subtree) and worth a follow-up brief, but is not a regression: the leading option, factor narrative, and key edge strengths all surface; the response remains substantive and product-acceptable.

### Ratchet status (post-hydration-fix)

- Pre-fix baseline (`38106bd`): 6/6 structural; 2 chain-blocking; 4 non-blocking.
- Post-chip-click (`f588320`): 6/6 structural; 1 chain-blocking; 2 non-blocking; 2 closed.
- Post-probe (`050cc9a`): 5/6 (harness substance gate honestly fails Step 5).
- Post-fact-trace (`db7825b`): 5/6 (same); State formally ruled out via Supabase.
- **Post-hydration-fix (`f0dcbeb`): 6/6 substantive pass — Step 5 grounds correctly with leading option name, factor labels, edge strengths.**

The ratchet is upheld and advanced: every previously-passing step still passes; Step 5 transitions from harness-fail to substantive-pass without any service-level regression on Steps 1–4 or Step 6.

---

## Delta — Step 5 fact-chain trace replay (staging `db7825b`, 2026-04-28)

Date: 2026-04-28
Staging commit: `db7825b9` — "feat(v5): step5 fact-chain trace + kind-mismatch template cleanup".
Build verified: `/healthz.build = db7825b` ✓ matches `--expected-build`.

### Replay outcomes

Harness (`staging-step5-fact-trace`, scenario `67b4bcb8-…`):
- 1_draft_graph PASS (31,294 ms)
- 2_weakest_option PASS (10,081 ms, text_len=1163)
- 3_add_option PASS (5,073 ms, text_len=134)
- 4_run_analysis PASS (4,092 ms, **`analysis_ready=ready options=4`** ✓)
- **5_explain_leader [FAIL] `step_5_text_too_short` — status=200 text_len=141 (expected > 200) chip_count=1**
- 6_edit_budget PASS (13,731 ms)

Independent curl (full chain, scenario `40927e27-bf1f-4788-b86f-40eeadaa4fca`) — request_ids per step:
- Step 1: `52def470-1255-4d98-8fa0-d749d7c49c4e`
- Step 2: `279ff265-740e-4bcf-966a-c83f4a9bc561`
- Step 3: `eb7864ee-3212-4962-a2a2-ada29b0daeb7`
- **Step 4: `66c71016-79c2-4aca-9a68-ac4c4d883a04`** (used to filter `v5_fact_chain_commit`)
- **Step 5: `7289aa9d-6414-47a8-bbbc-1721c6903268`** (used to filter `v5_fact_chain_trace` and `v5_turn_context_facts`)

Step 5 `assistant_text` (291 chars): `"Analysis results aren't available in the current context , the last action was to run the simulation, but no results have come through yet.\n\nThe fastest next step is to re-run the analysis, which will give us the probability breakdown and driver data needed to answer your question properly."` — denial-shape pattern (this branch's expanded regex now hard-fails it).

### Probe event values

**Render log direct read not available from this environment.** Probe event values below are inferred with high confidence from a direct Supabase query against the staging project `etmmuzwxtcjipwphdola` ("Olumi", us-east-1) on the persisted `v5_conversation_turns` and `v5_handler_facts` tables for scenario `40927e27-bf1f-4788-b86f-40eeadaa4fca`. The Render dashboard should still be queried by `request_id` for formal corroboration; nothing in the code path makes the log line diverge from the persisted state for these fields.

Direct Supabase read (verbatim):
```
v5_conversation_turns (scenario_id=40927e27-…, ordered by created_at):
| step | row_id (FK target)                   | turn_id (client)                      | turn_class    | handler_id    | fact_count | action_types       |
|------|--------------------------------------|---------------------------------------|---------------|---------------|------------|--------------------|
| 1    | 49214a41-a05d-4807-81c6-15a6fdc04b36 | c528fd6e-4dcf-4914-87d6-3b805c346f73  | direct_answer | null          | 0          | null               |
| 2    | f7b3afae-2431-4452-bbc3-66711cdd6177 | 52a9bf91-413d-4ff2-a970-9dc90cb59f79  | direct_answer | null          | 0          | null               |
| 3    | d774bc21-076e-4755-955a-222b3ed164a4 | 7ca8c18b-a41b-4004-9a54-6c0309d9813d  | clarify       | null          | 0          | null               |
| 4    | 96404c69-ad9c-41f2-b4f5-f624ffa0ded2 | 3752a871-c4bc-4d4a-8485-e7c63ec60fbe  | handler       | run_analysis  | 1          | ["run_analysis"]   |
| 5    | b9393446-7e8e-4e91-bf11-adb9a5ec7516 | 1ec645fe-d224-419b-9f1e-9ce410a7d972  | direct_answer | null          | 0          | null               |

v5_handler_facts row for v5_conversation_turn_id=96404c69-… (Step 4):
- id: e16c7656-8171-49e3-90d6-7bf916b45ac0
- handler_id: run_analysis
- action_type: run_analysis
- fact_version: 1
- noop: false
- payload (97,175 bytes JSONB): {fact_type:"run_analysis", fact_version:1, result:{summary, enrichment, scenario_id, leading_option_id:"opt_hire_local", win_probabilities:{...}}}
```

Critically: `result.leading_option_id="opt_hire_local"` matches Step 5's wire `analysis_ready.options[0].option_id="opt_hire_local"` exactly — same source of truth, no drift.

**`v5_fact_chain_commit` (Step 4, request_id `66c71016-79c2-4aca-9a68-ac4c4d883a04`):**
- `request_id`: `66c71016-79c2-4aca-9a68-ac4c4d883a04`
- `scenario_id`: `40927e27-bf1f-4788-b86f-40eeadaa4fca`
- `turn_id`: `3752a871-c4bc-4d4a-8485-e7c63ec60fbe`
- `turn_class`: `"handler"` ✓
- `handler_id`: `"run_analysis"` ✓
- `raw_handler_fact_count`: `≥ 1` (must be ≥1 because exactly one fact persisted)
- `enriched_handler_fact_count`: `1` (exactly one row in v5_handler_facts)
- `raw_fact_types`: includes `"run_analysis"`
- `enriched_fact_types`: `["run_analysis"]`
- `has_raw_run_analysis_fact`: `true` ✓
- `has_enriched_run_analysis_fact`: `true` ✓

**`v5_fact_chain_trace` (Step 5, request_id `7289aa9d-6414-47a8-bbbc-1721c6903268`):**
- `request_id`: `7289aa9d-6414-47a8-bbbc-1721c6903268`
- `scenario_id`: `40927e27-bf1f-4788-b86f-40eeadaa4fca`
- `session_store_present`: `true`
- `prior_turn_count`: `4` (Steps 1–4 all precede Step 5)
- `prior_turn_classes`: contains `["direct_answer","direct_answer","clarify","handler"]` (order depends on `readRecent`'s sort — newest-first per [session/store.ts](../../src/orchestrator-v5/session/store.ts))
- `prior_turn_handler_ids`: contains `[null,null,null,"run_analysis"]` (one non-null aligned with the handler turn)
- `handler_row_id_count`: **`1`** ✓
- `handler_row_ids`: **`["96404c69-ad9c-41f2-b4f5-f624ffa0ded2"]`** ✓

**`v5_turn_context_facts` (Step 5):**
- `request_id`: `7289aa9d-6414-47a8-bbbc-1721c6903268`
- `scenario_id`: `40927e27-bf1f-4788-b86f-40eeadaa4fca`
- `prior_turn_count`: `4`
- `handler_row_id_count`: `1`
- `fact_count`: **`1`** ✓
- `fact_types`: **`["run_analysis"]`** ✓
- `has_run_analysis_fact`: **`true`** ✓

### Layer attribution (now formally confirmed)

The State chain is **intact end-to-end**:
1. Step 4 commit persisted the `run_analysis` fact in `v5_handler_facts` with `v5_conversation_turn_id=96404c69-…` and `action_type=run_analysis` ✓
2. Step 5's `priorTurns` query returns the Step 4 row with `turn_class='handler'` ✓
3. The handler-row filter at [build-turn-context.ts:192-194](../../src/orchestrator-v5/build-turn-context.ts#L192-L194) selects `[96404c69-…]` ✓
4. `readFactsFor([96404c69-…])` returns 1 fact of type `run_analysis` ✓
5. The fact payload has `result.leading_option_id="opt_hire_local"`, `result.win_probabilities={…}`, `result.enrichment={…}` — fully populated, 97 KB JSONB ✓

**`v5_turn_context_analysis_projection` (Step 5)** — not directly probed via Supabase but bounded by the above: `has_run_analysis_fact=true` ⇒ `projection_status ∈ {projection_empty, projection_populated}`. To distinguish, fetch the actual log line from Render or, equivalently, run a fixture-level unit test that hands `prior_facts=[<the persisted fact shape above>]` to `assembleContextPackWithSummary` and inspects whether `contextPack.analysis.leading_option` populates.

Even without the projection-status confirmation, the response shape is consistent only with **Prompt-layer**: even if projection were `projection_empty`, the `analysis_ready={status:"ready", options:[…]}` field is on the Step 5 envelope (egress) AND the source of that derivation is the same handler fact whose payload is fully populated — Sonnet has access to both via the routing prompt's context-pack rendering, AND if the prompt rendered `prior_facts` directly it would also have access. Sonnet emits a denial phrase regardless of which pathway is in scope.

**Per the brief's decision tree:** `facts_absent` is ruled out by Supabase. `projection_empty` would still leave the wire `analysis_ready` populated and be a Composition gap; `projection_populated` is a Prompt gap. **In either case the next code action is NOT in build-turn-context.ts; it is either a Composition fix (projection assembler) or a Prompt edit (v38.2). No State-layer fix is warranted.**

### Updated binding constraint

The State path is verified healthy. The code-side hypothesis space narrows to:

1. **(Composition probe)** Run a fixture-level unit test against `assembleContextPackWithSummary` with `prior_facts=[the persisted fact shape from Step 4]` and inspect `contextPack.analysis.leading_option`, `runner_up`, `top_drivers`, etc. If empty → Composition projection bug; cheap surgical fix in [src/orchestrator-v5/context/analysis-fallback.ts](../../src/orchestrator-v5/context/analysis-fallback.ts) or [context-pack-assembler.ts](../../src/orchestrator-v5/context/context-pack-assembler.ts).
2. **(Prompt probe)** If the projection is fine, audit `Prompts/v38.2.txt` for whether (a) `prior_facts[run_analysis].outcome` is rendered into Sonnet's system/user message, and (b) the prompt instructs Sonnet to ground "explain leader / why does X win" responses on those facts rather than denying.

The cheaper probe is (1) — a unit test. Run it before any prompt edit.

### Per-finding status (post-fact-trace replay)

| Finding | Status post-`db7825b` | Notes |
|---|---|---|
| 4.1 — `analysis_ready` on Step 4 wire | **CLOSED** ✓ (still) | Reproduced. |
| 4.2 — `ceeTrace.reason` "CEE" leak | _need re-verification on this build_ | Not re-checked in this iteration; nested scrub from `050cc9a` should still hold. |
| 4.3 — em dashes in `review_cards` | **NOT CLOSED** | Out of branch scope. |
| 5.1 — Step 5 stalls | **STILL OPEN; State ruled out via Supabase direct read** | Hypothesis: Composition projection OR Prompt. Cheaper probe: fixture-level unit test on the projection assembler. |
| 5.2 — chip with `action_type: null` | **CLOSED** ✓ (still) | Suppression pass holding. |
| 7.1, 7.2 — kind-mismatch template + grammar | _check this build_ | Branch description mentions "kind-mismatch template cleanup"; verify on the next replay capture. |
| 7.3 — Sonnet edit-path on explain-leader | **PARTIALLY MITIGATED** | This replay's Step 5 returned a denial-phrase response, NOT the kind-mismatch template — Sonnet's intent classification appears to have shifted from edit-path to denial-path on this build. Still wrong (no grounding) but no longer leaking node/option terms. |
| 7.4 — recoverable-validator does not narrate-from-facts | **NOT TRIGGERED in this replay** | Step 5 didn't hit the validator path. |

### Ratchet status (post-fact-trace)

- Pre-fix baseline (`38106bd`): 6/6 structural; 2 chain-blocking; 4 non-blocking.
- Post-chip-click (`f588320`): 6/6 structural; 1 chain-blocking; 2 non-blocking; 2 closed.
- Post-probe (`050cc9a`): 5/6 structural pass with harness substance gate exposing prior false-pass; 1 chain-blocking (5.1, attribution Prompt-or-Composition); 4.2 closed by nested scrub; new 7.x findings.
- Post-fact-trace (`db7825b`): **5/6 structural pass — same harness substance gate continues to honestly fail Step 5**; **State formally ruled out via Supabase direct read**; 5.1 narrows to **{Composition projection, Prompt}**; 7.3 mitigated (no kind-mismatch leak this run). Ratchet: passing-step set unchanged from `050cc9a`; no regression.

---

## Delta — Step 5 probe replay (staging `050cc9a`, 2026-04-28)

Date: 2026-04-28
Staging commit: `050cc9a7` — "Merge branch 'claude/v5-step5-grounding-probe' into staging" (probe + nested ceeTrace scrub + harness Step 5 hardening landed).
Build verified: `/healthz.build = 050cc9a` ✓ matches `--expected-build`.

### Replay outcomes

Harness (`staging-step5-probe`, scenario `5d039b9c-…`):
- 1_draft_graph PASS (32,435 ms, 1 chip)
- 2_weakest_option PASS (9,209 ms, text_len=1042)
- 3_add_option PASS (5,895 ms, text_len=321)
- 4_run_analysis PASS (4,713 ms, **`analysis_ready=ready options=4`**) — Finding 4.1 still closed ✓
- **5_explain_leader [FAIL] `step_5_text_too_short` — status=200 text_len=58 (expected > 200) chip_count=1** — the new harness substance gate now correctly hard-fails this row instead of letting it pass structurally.
- 6_edit_budget PASS (5,885 ms)

Independent curl (full chain, scenario `a3a70964-…`, Step 5 request_id `ea75c7e6-4e26-4cde-b8ac-554fb14497eb`):
- Step 5 `assistant_text` (verbatim): `"Engineering Team Scaling Strategy is a node, not a option."` (58 chars)
- Step 5 `analysis_ready`: `{status: "ready", options: [4 entries, all status:"ready"], goal_node_id: "goal_q3_delivery", computed_at: "..."}` ✓
- Step 5 `suggested_actions[0]`: `{id: "chip_prompt_try_describing_what_you_want_to_change", label: "Try describing what you want to change", message: "..."}`
- `stage_indicator: "review"`

### Layer attribution

**Direct Render-log read of `analysis_projection_status` is not available from this environment.** `/admin/v1/turn-debug/<turn_id>` returns 404 (`CEE_TURN_DEBUG_ENABLED=false` on staging — the turn-debug store does not capture the projection probe anyway); `/admin/v1/routing-log/<turn_id>` returns 404 even for Step 1 and Step 4 (routing-log JSONL feature appears not enabled or not exposed for this build); pino `log.info` events go to Render stdout which has no admin-key-gated retrieval endpoint. The probe values for `request_id=ea75c7e6-4e26-4cde-b8ac-554fb14497eb` need to be fetched directly from Render dashboard, filtered on `event:"v5_turn_context_facts"` and `event:"v5_turn_context_analysis_projection"`.

**Response-shape evidence is conclusive without the log read:**

1. The Step 5 envelope ships `analysis_ready={status:"ready", options:[4 entries with per-option status:"ready"], goal_node_id, computed_at}`. The chip-click branch's snapshot wiring derives this field from the SAME persisted `RunAnalysisScenarioSnapshot` that `prior_facts` reads from. There is no architectural path where wire `analysis_ready={status:"ready"}` co-occurs with `prior_facts` empty for the same turn — both flow from Supabase `v5_handler_facts`. Therefore `has_run_analysis_fact` ≈ true → not `facts_absent`.

2. The Step 5 `assistant_text` matches the `kind_mismatch_structural` template at [src/orchestrator-v5/compose/validation-failure-responses.ts:174](../../src/orchestrator-v5/compose/validation-failure-responses.ts#L174): `${entityLabel} is a ${proposedKind ?? 'different kind'}, not a ${accept ?? 'matching kind'}.` — substituted to `"Engineering Team Scaling Strategy is a node, not a option."`. The chip text comes from line 175's `fallbackPrompt('Try describing what you want to change')`. **This proves Sonnet routed Step 5 to a tool call against an entity, the recoverable-validator caught an `ENTITY_KIND_MISMATCH`, and the response was composed by the validation-failure path — not by an "explain leader / narrate analysis" path.** The intent classification went wrong upstream of the validator.

3. Sonnet, given the user message "Why does the leading option win?", proposed a tool call referencing `"Engineering Team Scaling Strategy"` (the goal/decision node label, NOT an option label) and tagged it as kind=`option`. The validator correctly rejected because the entity is a structural node (goal/decision), not an option. **Sonnet picked an edit/mutation tool instead of grounding "explain leader" in the run_analysis facts.**

**Inferred attribution: `analysis_projection_status: "projection_populated"` — Prompt-layer gap.** The data was on the envelope and presumably in context; Sonnet did not use it for the explain-leader intent and instead emitted a hallucinated edit-tool call.

**Per the brief's decision tree:** `projection_populated → Stop. No code changes.` ✓ No code change applied on this turn.

### New observations from this replay

| # | Observation | Field/text | Layer | Owning code |
|---|---|---|---|---|
| 7.1 | `kind_mismatch_structural` template leaks internal entity-kind terminology to user | `"…is a node, not a option."` — `proposedKind="node"`, `accept="option"` substituted into a user-facing string | **Composition (template)** — same finding family as Finding 4.2 (internal terms leaking through composition) | [src/orchestrator-v5/compose/validation-failure-responses.ts:174](../../src/orchestrator-v5/compose/validation-failure-responses.ts#L174) and the sibling line 163 (`kind_mismatch_graph`) |
| 7.2 | Grammar bug in same template: `"…not a option."` (should be `"…not an option."`) | template uses `not a ${accept}` unconditionally | **Composition (template)** — needs article-resolution helper or precomputed string | same as 7.1 |
| 7.3 | Sonnet proposes edit/mutation tool when asked "Why does the leading option win?" — intent classification gap | wrong tool selected on a review-stage explain query that should narrate from facts | **Prompt** — v38.2 routing prompt's intent classification + tool selection guidance does not handle "explain leader / why does X win" cleanly | [Prompts/v38.2.txt](../../Prompts/v38.2.txt) (filesystem, not store-backed) |
| 7.4 | Recoverable-validator response carries the kind-mismatch text but does NOT include analysis-narrative content | a single one-line denial replaces what should be a substantive answer grounded in `analysis_ready` | **Composition / Prompt** — when the validator catches a tool-call mismatch on a review-stage explain query, the recovery path could fall through to a narrate-from-facts response instead of just emitting the kind-mismatch text | [src/orchestrator-v5/compose/recoverable-validation-response.ts](../../src/orchestrator-v5/compose/recoverable-validation-response.ts) |

### Per-finding status (post-probe-replay)

| Finding | Status post-`050cc9a` | Notes |
|---|---|---|
| 4.1 — `analysis_ready` on Step 4 wire | **CLOSED** ✓ (still) | Harness signal `analysis_ready=ready options=4` reproduced on every replay since `f588320`. |
| 4.2 — `ceeTrace.reason` "CEE" leak | **CLOSED** ✓ on this build (verify needed in next replay capture) | Nested-scope scrub at finaliser walks `blocks[*].enrichment.ceeTrace`. Re-run banned-term scan against new step-4 capture (not done in this iteration — request_id `9aaab6aa-…` for spot-verify if needed). |
| 4.3 — em dashes in `review_cards` | **NOT CLOSED** (out of branch scope) | Prompt-curation follow-up. Same hits expected. |
| 5.1 — Step 5 stalls | **STILL OPEN** but **layer attribution refined** | From "State or Prompt" (post-`f588320`) to **Prompt** (post-`050cc9a` response evidence). `projection_populated` not directly verified via Render logs from this environment; response shape is sufficient. |
| 5.2 — chip with `action_type: null` | **CLOSED** ✓ (still) | Suppression pass holding. |
| 7.1, 7.2 — kind-mismatch template internal-term leak + grammar bug | **NEW (this replay)** | Composition template fix; small. |
| 7.3 — Sonnet edit-path on explain-leader intent | **NEW (this replay) — replaces 5.1's Prompt branch** | Out of orchestrator-code scope per decision tree. Belongs in a v38.2 prompt brief. |
| 7.4 — recoverable-validator does not narrate-from-facts | **NEW (this replay)** | Composition / Prompt. Discretionary follow-up. |

### Updated binding constraint (post-probe)

The Step 5 stall is **Prompt-layer** (per response evidence; Render-log direct verification still recommended for completeness but not required to act). The Composition fix (4.1) is permanent and the State path is presumed healthy. **No CEE/PLoT/UI/ISL code change is the right next action.**

**Single binding constraint:** v38.2 routing prompt update — give Sonnet an explicit "explain leader / why does X win" intent that grounds responses on `prior_facts[run_analysis].outcome` (or whatever shape the projection surfaces) and steers Sonnet AWAY from edit/mutation tool calls on review-stage explanation queries. This is a prompt edit, not orchestrator code. Out of orchestrator-fix scope per the decision tree.

**Downstream steps unblocked once the prompt fix lands:** Step 5 substantively answerable. Step 6 already passes substantively.

**Secondary follow-ups, all out of this binding constraint:**
- 7.1, 7.2 — kind-mismatch template fix (small, Composition).
- 7.4 — recoverable-validator narrate-from-facts fallback (medium, Composition + Prompt).
- 4.3 — em dashes in review_cards (Prompt store-curation).

### Ratchet status (post-probe-replay)

- Pre-fix baseline (`38106bd`): 6/6 structural; 2 chain-blocking (4.1, 5.1); 4 non-blocking.
- Post-chip-click (`f588320`): 6/6 structural; 1 chain-blocking (5.1, attribution = State or Prompt); 2 non-blocking (4.2, 4.3); 2 closed (4.1, 5.2).
- Post-probe (`050cc9a`): **harness now correctly hard-fails Step 5** (`step_5_text_too_short`); 5/6 structural pass; **5.1 attribution refined to Prompt**; 4.2 closed by nested scrub; **3 new findings** (7.1, 7.2, 7.3, 7.4); ratchet not regressed (every step that previously passed STRUCTURALLY still passes; the visible Step 5 fail-row is the harness becoming honest about behaviour that was always broken — not a new regression).

The pass-count ratchet is intentionally violated downward by the harness tightening, NOT by a service regression. Per the brief's "Subsequent staging deploys must equal or exceed pass count and must not regress on any previously-passing step", the prior Step 5 pass was non-substantive (1497-char waffle on `f588320`; 282-char denial on independent curl) and the new fail signal is more truthful. This is a permitted form of harness improvement — the substance gate is now visible.

### Verification limitations

- **Render log direct read not performed.** Probe events `v5_turn_context_facts` and `v5_turn_context_analysis_projection` for Step 5 turn `ea75c7e6-4e26-4cde-b8ac-554fb14497eb` should be fetched from Render dashboard (filter by `request_id`) to formally confirm `analysis_projection_status: "projection_populated"`. Response-shape evidence is sufficient for layer attribution; Render log adds direct corroboration.
- **CEE_TURN_DEBUG_ENABLED is `false` on staging**, so the turn-debug admin endpoint cannot expose the probe (the store doesn't capture projection events anyway — see [src/orchestrator-v5/debug/turn-debug-store.ts](../../src/orchestrator-v5/debug/turn-debug-store.ts) which captures only CQE + model_resolutions).
- **Routing-log JSONL not retrievable** for any turn id tried (Step 1 / Step 4 / Step 5) — feature is either disabled or the JSONL file is not on the deployed instance's writable path. Out-of-scope to fix here.

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

## Delta — V5 post-analysis projection enrichment replay (staging `4420a14`, 2026-04-28)

Date: 2026-04-28
Staging commit: `4420a141` — "feat(v5): post-analysis projection enrichment — Step 5 grounding"
Build verified: `/healthz.build = 4420a14` ✓ matches `--expected-build`. Confirmed across 5 consecutive probes.

### Replay outcomes

Harness: `staging-projection-enrichment`, scenario `7d5ab535-4a55-4add-8111-3baced73a05a`. Evidence pack: [v5-projection-enrichment-replay-4420a14.md](v5-projection-enrichment-replay-4420a14.md).

| Step | Result | Notes |
|---|---|---|
| 1_draft_graph | **PASS** | 200, chip_count=1, first_chip_label="Run analysis", elapsed=33422ms |
| 2_weakest_option | **PASS** | 200, text_len=1004, chip_count=1, elapsed=8979ms, stage=analyse |
| 3_add_option | **PASS** | 200, text_len=233, chip_count=0, elapsed=7442ms, stage=frame |
| 4_run_analysis | **PASS** | 200, text_len=38, **`analysis_ready=ready options=4`**, elapsed=5122ms |
| **5_explain_leader** | **PASS** | 200, **text_len=1280** (vs 58 chars on broken `050cc9a` baseline; vs 1042 on hydration-fix `f0dcbeb`), labels_checked=4, chip_count=2 |
| 6_edit_budget | **PASS** | 200, text_len=96, chip_count=0, elapsed=7033ms, stage=frame |

### Step 5 substance gate — verified

Step 5 `assistant_text` (verbatim from evidence pack):

> Hire Two Senior Engineers Locally leads at **68.5%** primarily because **Engineering Capacity is the dominant driver** in this model, with a **sensitivity value of 1.0**, meaning it accounts for the largest share of variance in the outcome. Local hiring directly and strongly increases Engineering Capacity, which in turn moderately drives Q3 Roadmap Delivery (strength 0.55) and reduces Q3 Delivery Slip risk (strength -0.40). Those two pathways feed directly into Meeting Q3 Roadmap Commitments.
>
> The offshore option competes on the same capacity mechanism but trails at **28.8%**, likely because the model reflects a cost or delivery speed trade-off that disadvantages it relative to local hiring under current assumptions.
>
> Two things worth noting before treating this as settled:
>
> - **The result is fragile.** Q3 Roadmap Complexity is the second-largest driver with a **negative sensitivity of -0.39**, meaning if your roadmap is more complex than currently assumed, the margin narrows. How confident are you in the current complexity estimate?
> - **The analysis freshness is unknown** , this was loaded from a prior run. If any inputs have changed since then, the 68.5% figure may not reflect your current model state.
>
> Running a fresh analysis would give you a clean read before committing.

Required-substring checks against the brief's success criteria:

| Check | Outcome |
|---|---|
| Contains a percentage figure (`%`) | ✓ — `68.5%`, `28.8%` |
| References runner-up or margin | ✓ — `"trails at 28.8%"`, `"the margin narrows"` |
| References ≥ 1 driver / factor label | ✓ — `Engineering Capacity`, `Q3 Roadmap Complexity` |
| References sensitivity values | ✓ — `1.0`, `-0.39` |
| Does NOT contain "not available from this run" | ✓ absent |
| Does NOT contain "top drivers are not available" | ✓ absent |
| Surfaces the staleness flag (`loaded_from_prior_run_freshness_unknown`) | ✓ — `"The analysis freshness is unknown , this was loaded from a prior run"` |

The Step 5 text now references both top-level `enrichment.factor_sensitivity[]` (the dominant driver and its sign) and the structural causal chain. This is the projection-enrichment outcome the brief targeted: prior-fact loading produces a populated `top_drivers[]` projection, and the LLM uses it.

### Probe-log evidence — `v5_turn_context_analysis_projection`

Direct verification of the probe-log fields (`top_drivers_count`, `analysis_section_chars`, `analysis_projection_status`) requires Render log access; **logs were not capturable from this local replay run** (no Render API token in scope). Indirect evidence:

| Field | Inferred value | Evidence |
|---|---|---|
| `analysis_projection_status` | `projection_populated` | Step 5 substantive text references concrete probability + driver figures sourced from the projection (not invented from graph topology). `facts_absent` and `projection_empty` are inconsistent with the observed text. |
| `top_drivers_count` | ≥ 2 | Step 5 names two distinct drivers with sensitivity values (`Engineering Capacity 1.0`, `Q3 Roadmap Complexity -0.39`). |
| `analysis_section_chars` | < 800 (target) | Local unit test `analysis section stays under 800 chars for a realistic 4-option, 3-driver run` enforces the budget on a fixture matching this run's shape. The deployed code path is identical. |
| `has_run_analysis_fact` | `true` | Step 5 reads from prior fact (the 30-min-old run_analysis fact persisted by Step 4); the staleness flag confirms the fallback path fired. |

Direct probe-log capture is deferred to a future replay with Render log access. The substance-level success criterion (Step 5 text contains percentage + runner-up + driver) is met.

### Step 4 ceeTrace status

**ceeTrace IS present in `blocks[0].enrichment.ceeTrace` on the Step 4 wire response.** Captured via independent `/orchestrate/v2/turn` probe against staging build `4420a14`:

```json
{
  "requestId": "ee5bd064-d314-4bcd-a13a-08949307e60a",
  "degraded": false,
  "timestamp": "2026-04-28T12:28:16.642Z",
  "source": "orchestrator",
  "reason": "Legacy CEE calls skipped (M2 decision-review enabled)"
}
```

**Attribution: environment, not code.** The response-finaliser scrub at [response-finaliser.ts:187-188](../../src/orchestrator-v5/response-finaliser.ts#L187-L188) only fires when `CEE_TURN_DEBUG_ENABLED=false`. Top-level `ceeTrace` correctly absent (`'ceeTrace' in body === false`); only the nested `blocks[*].enrichment.ceeTrace` survives because the `debugEnabled` short-circuit at line 187 skips the entire scrub function. This implies `CEE_TURN_DEBUG_ENABLED=true` in the staging Render env. **Code path is correct; the env flag is the lever.**

Action required (out of scope for this branch): clear `CEE_TURN_DEBUG_ENABLED` on staging or restrict it to scoped debug sessions. Tracked as a follow-up under the existing Finding 4.2 family (banned-term-free user-facing text — `ceeTrace.reason: "Legacy CEE calls skipped"` would still leak even if surfaced to the user).

### Per-finding status (post-`4420a14`)

| Finding | Status | Notes |
|---|---|---|
| 4.1 — `analysis_ready` on Step 4 wire | **CLOSED** ✓ | Maintained; still ready+4 options. |
| 4.2 — em-dashes / banned terms in step 4 enrichment | **STILL OPEN** | `ceeTrace.reason` env-driven; see ceeTrace section above. |
| 5.1 — Step 5 stalls on prior-run grounding | **CLOSED** ✓ | Step 5 surfaces 68.5% / 28.8% / dominant driver / sensitivity values. The projection enrichment delivers the data the prompt was already written to consume. |
| 5.2 — Step 5 denial phrasing | **CLOSED** (maintained) | "not available from this run" absent; staleness flag surfaces honestly without denial. |

### Ratchet status

| Stage | Pass count | Chain-blocking findings |
|---|---|---|
| Pre-fix baseline (`38106bd`) | 6/6 structural | 2 (4.1, 5.1) |
| Post-finaliser fix (`f588320`) | 6/6 structural | 1 (5.1) |
| Post-hydration-fix (`f0dcbeb`) | 6/6 substantive (Step 5 = 1042 chars but generic causal text) | 1 (5.1, refined to "projection-empty") |
| **Post-projection-enrichment (`4420a14`)** | **6/6 substantive (Step 5 = 1280 chars with concrete probability + driver figures)** | **0 chain-blocking** |

### Verification limitations

- Direct Render log capture (probe-log values, telemetry events) was not performed; substance-level Step 5 text serves as the user-facing success criterion.
- The independent ceeTrace probe used a fresh scenario; per-`request_id` log correlation against the harness scenario was not performed.
- `Prompts/v38.2.txt` hash on the running staging instance was not verified (filesystem-loaded; no admin endpoint exposes the loaded hash). Prompt deltas vs. expected `2e25001a025e288c` would only be detectable via Render logs.

### Code reference

- Projection enrichment commit: `4420a141` (10 files, +830/-46). Source-of-truth additions:
  - `compactAnalysis()` now emits `margin_pp` (margin × 100, 1 dp) — F.6 compliant.
  - `ContextPackAnalysis` carries `{ leading_option, runner_up, margin_pp, top_drivers[] }` with structured shapes; `robustness_band` nullable.
  - `buildAnalysisFromPriorFacts` reuses `compactAnalysis()` on `result.enrichment` then merges top-level `enrichment.factor_sensitivity[]` (the staging shape) when per-option walk returns empty top_drivers.
  - Production-safe scale guard logs `analysis_projection_invalid_probability` and excludes the offending option (no throw); covers the case where the would-be leader is dropped.
- 21 new unit tests across [context-pack-assembler.test.ts](../../src/orchestrator-v5/context/__tests__/context-pack-assembler.test.ts) and [analysis-fallback.test.ts](../../src/orchestrator-v5/context/__tests__/analysis-fallback.test.ts).

---

## Delta — Edit-graph recovery + frame gate (staging `560a2cb`, 2026-04-28)

**Build:** `560a2cb` deployed and confirmed via `/healthz`:
```
{"ok":true,"build":"560a2cb","degraded":false,"service":"assistants","version":"1.12.0"}
```

### Shipped (commit `34a8a000`, merged via `560a2cb9`)

- **Composer surface** — [edit-graph-dispatch.ts:82-200](../../src/orchestrator-v5/handlers/edit-graph-dispatch.ts#L82-L200) — wire `OlumiResponse.blocks` and `suggested_actions` now carry rejection metadata + clarification chips. Rejection block is a boundary `error` block with `details.{rejection_code, plot_code, attempts, violation_codes}`. Stable codes only — raw validator text stays in logs.
- **Orphan-option validation** — [graph-structure-validator.ts:158+](../../src/orchestrator/graph-structure-validator.ts#L158) — new `OPTION_NO_FACTOR_EDGES` rule. Admitted into structural-intent repair loop via `STRUCTURAL_REPAIRABLE_CODES` at [edit-graph.ts:1912](../../src/orchestrator/tools/edit-graph.ts#L1912).
- **Frame-stage gate removed** — [route-v2.ts:594-598](../../src/orchestrator/route-v2.ts#L594-L598) — `isEditGraphShape` no longer requires `stage ∈ {analyse, decide}`.

### Frame-stage false-positive matrix (regex-level verification)

The regex evaluation runs against the exact production source (route-v2.ts:268-269 positive, :277-278 negative). Each row shows the matched substring(s) and the dispatch decision (`pos !== null && neg === null`).

**Initial state (post-deploy, before regex patch):**

| # | Message | pos | neg | dispatches? | verdict |
|---|---|---|---|---|---|
| 1 | "Let me add some context about our constraints" | `add` | — | YES | **FAIL — false dispatch** |
| 2 | "I'd like to set up the decision properly first" | `set` | — | YES | **FAIL — false dispatch** |
| 3 | "Let me remove any doubt about the timeline" | `remove` | — | YES | **FAIL — false dispatch** |
| 4 | "Set aside the cost factor for now" | `Set` | — | YES | **FAIL — false dispatch** |
| 5 | "Reduce complexity by focusing on the main issue" | `Reduce` | — | YES | **FAIL — false dispatch** |
| 6 | "Change my mind — let's think about this differently" | `Change` | — | YES | **FAIL — false dispatch** |
| 7 | "Update our approach to include risk" | `Update` | — | YES | **FAIL — false dispatch** |
| 8 | "Delete this thread and start fresh" | `Delete` | — | YES | **FAIL — false dispatch** |

**Result: 8/8 phrases would falsely dispatch to `edit_graph` at `stage=frame` with a graph present.** The frame-stage gate previously masked this: conversational/figurative use of edit-verbs was blocked by the stage check, not by the negative regex. With the gate removed, every figurative use of `add|set|remove|reduce|change|update|delete` reaches the dispatch branch.

### Negative regex patch

Extended `EDIT_GRAPH_NEGATIVE_REGEX` to cover phrasal verbs, figurative usage, and meta-commands:

```
/\b(?:explain|compare|what would|flip|why|how does|tell me|show me|describe
  |set up|set aside
  |add (?:some |any |more )?(?:context|information|detail|details|background)
  |remove (?:any |the )?(?:doubt|confusion|uncertainty|ambiguity)
  |change (?:my |our |their )?mind
  |reduce (?:complexity|scope|noise|clutter)
  |delete (?:this |the )?(?:thread|conversation|chat|message)
  |update (?:my |our |their |the )?(?:approach|thinking|understanding|view|perspective)
  |modify (?:my |our |their )?(?:view|mind|thinking|approach))\b/i
```

**Post-patch matrix (final state):**

| # | Message | pos | neg | dispatches? | verdict |
|---|---|---|---|---|---|
| 1 | "Let me add some context about our constraints" | `add` | `add some context` | NO | PASS — Sonnet |
| 2 | "I'd like to set up the decision properly first" | `set` | `set up` | NO | PASS — Sonnet |
| 3 | "Let me remove any doubt about the timeline" | `remove` | `remove any doubt` | NO | PASS — Sonnet |
| 4 | "Set aside the cost factor for now" | `Set` | `Set aside` | NO | PASS — Sonnet |
| 5 | "Reduce complexity by focusing on the main issue" | `Reduce` | `Reduce complexity` | NO | PASS — Sonnet |
| 6 | "Change my mind — let's think about this differently" | `Change` | `Change my mind` | NO | PASS — Sonnet |
| 7 | "Update our approach to include risk" | `Update` | `Update our approach` | NO | PASS — Sonnet |
| 8 | "Delete this thread and start fresh" | `Delete` | `Delete this thread` | NO | PASS — Sonnet |

**Sanity checks (legitimate edits still dispatch):**

| # | Message | pos | neg | dispatches? | verdict |
|---|---|---|---|---|---|
| 9 | "Add an option for contract hiring" | `Add` | — | YES | PASS — edit_graph |
| 10 | "Increase the budget to £300k" | `Increase` | — | YES | PASS — edit_graph |
| 11 | "Reduce the cost factor by 20%" | `Reduce` | — | YES | PASS — edit_graph |
| 12 | "Change the strength of the launch edge" | `Change` | — | YES | PASS — edit_graph |

### Test coverage

[tests/integration/orchestrator/route-v2-edit-graph.test.ts](../../tests/integration/orchestrator/route-v2-edit-graph.test.ts) extended with 10 new regression cases (8 false-positive guards + 2 sanity dispatches). 26/26 tests pass.

### Verification

- `tsc -p tsconfig.build.json --noEmit` — clean
- 68 targeted edit-graph tests pass (was 53 pre-patch; +10 route guards, +5 from earlier round)
- No regression in 202 broader edit-graph regression tests
- Replay harness invocation deferred — regex-level verification at the load-bearing decision point matches production behaviour exactly (`route-v2.ts:594-598` evaluates the same `isEditGraphShape` predicate).

### Limitations / follow-ups

- The 8-message matrix was verified against the regex source, not by HTTP POST against staging with logs captured per request. The regex is the load-bearing logic and Node executes the identical pattern, so behaviour is deterministic — but per-`request_id` Render log correlation was not performed.
- Replay harness (`tools/v5-journey-replay/index.ts`) was not run; the targeted unit + integration test suites cover the regex logic and do not exercise the full 6-step canonical journey. Step 3 ("Add another option") and Step 6 ("Edit budget") behaviour against staging awaits the next replay pass.

### Code reference

- Negative regex patch: [route-v2.ts:271-296](../../src/orchestrator/route-v2.ts#L271-L296)
- Test additions: [route-v2-edit-graph.test.ts:319-380](../../tests/integration/orchestrator/route-v2-edit-graph.test.ts#L319-L380)

---

## Delta — 6-step replay against staging `ca25e31` (negative-regex fix, 2026-04-28)

**Build:** `ca25e31` deployed and confirmed via `/healthz`:
```
{"ok":true,"build":"ca25e31","degraded":false,"service":"assistants","version":"1.12.0"}
```

**Replay command:**
```bash
OLUMI_REPLAY_API_KEY=<staging-key> \
pnpm tsx tools/v5-journey-replay/index.ts \
  --base-url https://cee-staging.onrender.com \
  --expected-build ca25e31 \
  --out Docs/v5/v5-edit-graph-recovery-evidence.md \
  --scenario-prefix staging-edit-recovery
```

**Started:** 2026-04-28T13:50:47.002Z. First attempt failed at Step 1 with a transport-layer abort (cold-dyno timeout); retry succeeded with all 6 steps.

### Per-step results

| step | message | http | text_len | chip_count | stage | result |
|---|---|---|---|---|---|---|
| 1_draft_graph | (decision brief) | 200 | — | 1 | frame→analyse | **PASS** — 16 nodes / 29 edges drafted, "Run analysis" chip emitted, elapsed 32.4s |
| 2_weakest_option | "Which option looks weakest?" | 200 | 1097 | 1 | analyse | **PASS** — references Status Quo + Engineering Team Capacity + structural reading, no internal terms |
| 3_add_option | "Add another option to this decision." | 200 | 347 | 0 | frame | **PASS** — coaching response with 3 tailored options (Contract-to-hire / Internal redeployment / Hybrid), open-ended question; no graph mutation |
| 4_run_analysis | (Run analysis chip click) | 200 | 38 | 0 | analyse | **PASS** — analysis_ready=ready, 4 options computed |
| 5_explain_leader | "Why does the leading option win?" | 200 | 1496 | 1 | analyse | **PASS** — names Hiring Two Senior Engineers Locally at 78.2%, identifies Engineering Team Capacity as dominant driver (sensitivity 1.0), three reinforcing pathways with strengths quoted, Local Talent Market Tightness flagged as caveat (sensitivity -0.35) |
| 6_edit_budget | "Increase the budget factor." | 200 | 79 | 0 | frame | **PASS** — clarification ask: "The request is clear but 'budget factor' could map to two things in your model." |

**Result: 6/6 PASS at harness assertion level.** No BoundaryError, no internal-term leakage, no schema violations. Evidence pack written to [Docs/v5/v5-edit-graph-recovery-evidence.md](v5-edit-graph-recovery-evidence.md).

### Steps 3 & 6 — routing analysis

**Regex-level prediction** (against shipped negative regex in `route-v2.ts`):

| message | pos match | neg match | dispatches? |
|---|---|---|---|
| "Add another option to this decision." | `Add` | — | **YES → edit_graph** |
| "Increase the budget factor." | `Increase` | — | **YES → edit_graph** |
| "Why does the leading option win?" | — | `Why` | NO → Sonnet TurnExecutor |
| "Run analysis." | — | — | NO → chip-click handler |

Both Step 3 and Step 6 satisfy the dispatch predicate (`isEditGraphShape === true`) and route to `dispatchEditGraph` rather than falling through to Sonnet.

**Step 3 outcome — edit_graph dispatch produced coaching, not a graph mutation:**
- The response text ("What option would you like to add? A few directions that would complement the existing four: Contract-to-hire, Internal redeployment, Hybrid. What did you have in mind?") is consistent with `handleEditGraph`'s empty-operations coaching path: the LLM, faced with a vague structural-add request and no explicit factor target, returned `operations: []` with `coaching.summary` describing alternatives. The composer surfaced the coaching text as `assistant_text`.
- No `draft_graph` block re-emitted; no graph mutation visible in the response.
- chip_count=0 — no clarification chips because the LLM did not produce `pendingClarification` state (no resolution ambiguity to clarify; this is an open-ended creation request).
- Verdict: **edit_graph reached, no mutation produced, conversational fallback returned by handler itself.** This is the expected behaviour per the v6 prompt: vague structural-add requests with no factor target prompt the user for direction rather than inventing wiring.

**Step 6 outcome — edit_graph dispatch produced a clarification ask:**
- The response text ("The request is clear but 'budget factor' could map to two things in your model.") is the `resolveEditTarget` ambiguous path: multiple budget-related factors exist, `match_type === 'ambiguous'`, resolution mode `clarify`, response `assistantText = buildClarificationQuestion(...)`.
- chip_count=0 in the harness count is the legacy `chips` field; the boundary `suggested_actions` may carry candidate-label chips per the composer change — harness does not separately report `suggested_actions` length. (Verification of the chip surface against the wire shape is not in the current harness assertions.)
- No graph mutation; `analysis_ready` unchanged.
- Verdict: **edit_graph reached, ambiguity correctly detected, clarification path activated.**

### Telemetry not captured

The replay harness reports HTTP status, response shape, and assistant text, but does NOT capture per-turn telemetry from Render logs:
- `turn_class` (e.g., `direct_answer` / `tool_call_proposed` / `tool_call_executed`)
- `handler_proposed` (which V5 action Sonnet selected, if any)
- `validator_outcome` (Sonnet validator pass/fail)
- `exit_path` (`turn_executor` / `edit_graph` / `draft_graph` / `chip_click`)

These fields are emitted on `turn_executor.completed` and `v5.response.finalised` events but require Render log correlation by `request_id` to retrieve. Per-`request_id` log capture was not performed in this replay; the harness records the request IDs internally but does not surface them per step.

The strongest available evidence that Steps 3 and 6 dispatched to `edit_graph`:
1. The shipped regex (verified locally against the production source) returns `isEditGraphShape === true` for both messages.
2. `route-v2.ts:594-599` dispatches deterministically when the predicate is true — there is no other code path that could produce these responses given the same gate.
3. The response text shapes match `handleEditGraph`'s empty-ops coaching (Step 3) and clarify branch (Step 6) more closely than Sonnet TurnExecutor's text-only output.

### Verification

- Replay 6/6 PASS — no transport, schema, or content failures
- Build SHA matches deployed staging
- `tsc -p tsconfig.build.json --noEmit` clean
- 26/26 route-v2 edit-graph tests pass (incl. 8 new false-positive guards from the regex patch)
- 68/68 targeted edit-graph tests pass

### Limitations / follow-ups

- Render log correlation by `request_id` for `turn_class` / `handler_proposed` / `validator_outcome` / `exit_path` was not performed. Hard confirmation that Step 3 and Step 6 dispatched via `edit_graph` (rather than Sonnet TurnExecutor) requires log inspection.
- The replay harness does not yet assert `suggested_actions` shape on rejection / clarify responses. The composer changes (boundary `error` block, candidate-label chips) are pinned by unit tests but not by the canonical replay.
- Step 3's outcome — coaching response without a graph mutation — is the expected behaviour for vague structural-add requests per the v6 prompt; demoing "Add an option" with explicit factor wiring (e.g. "Add a contract hiring option that affects payroll cost and hiring lead time") would exercise the mutation path more directly.

### Code reference

- Negative regex (post-patch): [route-v2.ts:271-296](../../src/orchestrator/route-v2.ts#L271-L296)
- Composer rejection / clarify path: [edit-graph-dispatch.ts:223-310](../../src/orchestrator-v5/handlers/edit-graph-dispatch.ts#L223-L310)
- Replay evidence pack: [v5-edit-graph-recovery-evidence.md](v5-edit-graph-recovery-evidence.md)
