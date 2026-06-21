# Olumi Golden-Journey Harness v1 — Classified Report

Produced by [tools/golden-journey-harness](../../tools/golden-journey-harness/). Drives the core PoC journey (draft → run analysis → explain → follow-up → mutate → rerun → explain what changed → reload → verify chips → capture debug) and classifies every assertion into one of the six core components.

> **Run context.** This baseline uses the **concrete** mutate step (`Set <captured factor> to 0.5`, see [concrete-mutation-rerun.md](golden-journey-v1-concrete-mutation-rerun.md)). The mutation now works on the hard path: step `5_mutate` went `freshness=stale`, the graph hash **changed** (`eb628374…` → `cea64b54…`), via the typed `handler_id=set_factor_value` — so **A3/A4/A7 PASS** and Component 4 is healthy. The **A5 FAIL** below is an *incidental, variance-prone* finding: `3_explain_leader` returned a thin 84-char response with no grounding on this run, whereas the same step was 1574 chars and richly grounded on the prior run. It is **not** a confirmed systemic defect from one run, and **not** the mutation lane — do not open a fix lane on it without repeated confirmation. A follow-up 5× repeat (see [a5-flap-characterisation.md](golden-journey-v1-a5-flap-characterisation.md)) reproduced **zero** thin responses with stable analysis context → classified **likely LLM variance**. A5 is now treated as **advisory** (reported, but does not hard-gate the exit code; the deterministic replay is the gate).

## Executive verdict

| signal | value |
|---|---|
| Mode | live |
| Findings: pass / inconclusive / fail | 34 / 1 / 1 |
| **Next component to fix** | **5. Science-grounded coaching** (via A5) |
| Diagnostic-trace flag confirmed ON | yes |

## Run metadata

- **Mode:** live
- **Base URL:** https://cee-staging.onrender.com
- **Started at:** 2026-06-21T18:54:16.695Z
- **Branch:** `claude/unruffled-brahmagupta-c387c7`
- **Harness commit:** `f247d2c34eb947a2a8d4b20741e34046f6defbeb`
- **Deployed build (/healthz):** `7479cda`

## Core-component matrix

| # | component | invariants | worst status |
|---|---|---|---|
| 1 | Context management | A2 | [INCONCLUSIVE] inconclusive |
| 2 | Canonical state | A1 | [PASS] pass |
| 3 | AI orchestration | — | — |
| 4 | Typed action/mutation | A3, A4 | [PASS] pass |
| 5 | Science-grounded coaching | A5 | [FAIL] fail |
| 6 | Observability/recovery | A6, A7 | [PASS] pass |

## Invariant results (A1..A7)

| id | invariant | primary component | status | note |
|---|---|---|---|---|
| A1 _(provisional)_ | Analysis state is not contradicted by prose, chips or reload | 2. Canonical state | [PASS] pass | coherent: status=ready freshness=fresh denial=none |
| A2 | AI-facing context contains graph, analysis, blockers, capabilities, recent-turn state | 1. Context management | [INCONCLUSIVE] inconclusive | context completeness not wire-observable for: graph, analysis_state, blockers, capabilities, recent_turn_state — asserted in-process (tests/unit/golden-journey-harness/context-completeness.test.ts). Priority follow-up: flag-gated debug context-summary surface [source=wire (ContextPack not serialised)] |
| A3 | Actions only count when durable state changed | 4. Typed action/mutation | [PASS] pass | durable analysis-affecting graph hash changed after mutation (baseline≠current) — the action counted |
| A4 | Failed/proposed/non-mutating turns never claim success | 4. Typed action/mutation | [PASS] pass | no false success claim (role=draft http=200) |
| A5 | Coaching is grounded in actual graph/analysis/science signals | 5. Science-grounded coaching | [FAIL] fail | analysis is ready but coaching references no real option/factor label, probability, or science signal |
| A6 | Debug output explains what happened | 6. Observability/recovery | [PASS] pass | _diagnostic_trace present: exit_path="draft_graph" correlation_ids ✓ timings=true |
| A7 | Repairs/recoveries are visible, not silent | 6. Observability/recovery | [PASS] pass | repairs surfaced to the user via analysis_ready.model_adjustments (n=2) |

## Journey steps

| step | role | http | status | evidence |
|---|---|---|---|---|
| `1_draft` | draft | 200 | [PASS] pass | http=200 text_len=861 analysis_status=ready freshness=none current_hash=eb628374e2 repairs=2 chips=3 exit_path=draft_graph trace=present draft={total:60461,parse:60351,parse_llm:58490,normalise:0,enrich:5,repair:25,repair_fired:false,repair_attempts:0,validation:54,threshold:54,package:11,boundary:12} |
| `2_run_analysis` | analysis | 200 | [PASS] pass | http=200 text_len=162 analysis_status=ready freshness=fresh hash_at_run=eb628374e2 current_hash=eb628374e2 chips=2 exit_path=chip_click trace=present |
| `3_explain_leader` | explain | 200 | [FAIL] fail | http=200 text_len=84 analysis_status=ready freshness=fresh hash_at_run=eb628374e2 current_hash=eb628374e2 chips=2 exit_path=turn_executor trace=present timings={total:32423,ctx:673,ctx_pack:11,ctx_chars:20495,llm_calls:1} |
| `4_follow_up` | follow_up | 200 | [PASS] pass | http=200 text_len=1608 analysis_status=ready freshness=fresh hash_at_run=eb628374e2 current_hash=eb628374e2 chips=1 exit_path=turn_executor trace=present timings={total:16079,ctx:921,ctx_pack:10,ctx_chars:20798,routing:14799,handler:1,compose:4,commit:334,handler_id:explain_results,cache:hit,cache_read_tokens:7110,cache_create_tokens:0,input_tokens:5119,llm_calls:1} |
| `5_mutate` | mutate | 200 | [PASS] pass | http=200 text_len=253 analysis_status=ready freshness=stale hash_at_run=eb628374e2 current_hash=cea64b5484 chips=1 exit_path=turn_executor trace=present timings={total:930,ctx:650,ctx_pack:3,ctx_chars:22892,handler:3,compose:111,commit:155,handler_id:set_factor_value,llm_calls:0} |
| `6_rerun_analysis` | rerun_analysis | 200 | [PASS] pass | http=200 text_len=162 analysis_status=ready freshness=fresh hash_at_run=cea64b5484 current_hash=cea64b5484 chips=2 exit_path=chip_click trace=present |
| `7_explain_what_changed` | explain_changed | 200 | [PASS] pass | http=200 text_len=253 analysis_status=ready freshness=fresh hash_at_run=cea64b5484 current_hash=cea64b5484 chips=0 exit_path=turn_executor trace=present timings={total:1055,ctx:928,ctx_pack:12,ctx_chars:23302,llm_calls:0} |
| `8_reload` | reload | 200 | [PASS] pass | http=200 text_len=1367 analysis_status=ready freshness=fresh hash_at_run=cea64b5484 current_hash=cea64b5484 chips=1 exit_path=turn_executor trace=present timings={total:12908,ctx:568,ctx_pack:6,ctx_chars:23442,routing:12151,handler:0,compose:3,commit:173,handler_id:explain_results,cache:hit,cache_read_tokens:7110,cache_create_tokens:0,input_tokens:5926,llm_calls:1} |
| `9_verify_chips` | evaluation | — | [PASS] pass | evaluation over captured turns — exercises A4, A7: Verify chips/actions across the mutate + rerun turns (no false-success chips; rerun affordance after stale). |
| `10_capture_debug` | evaluation | — | [PASS] pass | evaluation over captured turns — exercises A6: Capture the debug/context trace (_diagnostic_trace + _timings) from every turn into the report. |

## Findings (fails + inconclusives)

| invariant | status | severity | component | step | evidence |
|---|---|---|---|---|---|
| A5 | fail | medium | 5. Science-grounded coaching | 3_explain_leader | analysis is ready but coaching references no real option/factor label, probability, or science signal |
| A2 | inconclusive | medium | 1. Context management | — | context completeness not wire-observable for: graph, analysis_state, blockers, capabilities, recent_turn_state — asserted in-process (tests/unit/golden-journey-harness/context-completeness.test.ts). Priority follow-up: flag-gated debug context-summary surface [source=wire (ContextPack not serialised)] |

## Coverage caveats (what this run did NOT prove)

| component | caveat | detail |
|---|---|---|
| 1. Context management | A2 asserted in-process only | AI-facing context completeness (A2) is proven by the committed in-process test, NOT on the live system — the ContextPack is never serialised on the wire. It stays in-process / wire-inconclusive until the canonical-state M3 `_context_summary` debug surface lands (then A2 becomes wire-observable in the live report). |
| 4. Typed action/mutation | Mutate covers the scalar value-edit path only | The mutate step drives a concrete scalar value-edit (`Set <captured factor> to 0.5`) — a REAL durable mutation via the deterministic value-update gate (set_factor_value semantics; observed live exit_path=`edit_graph`). This is scalar-value-edit coverage; it is NOT typed-ops / typed add_option apply coverage. Add a typed-ops / add_option journey when that path exists (guardrail #3). |

## assistant_text per step (redacted)

### `1_draft`

```
I've built a first decision model for "Deliver Q3 Roadmap Commitments on Time".

Options compared
• Hire Two Senior Engineers Locally
• Engage Offshore Partner
• Continue with Current Team (Status Quo)
• Introduce Tiered Pricing to Fund

What the model is weighing
• Main trade-off: Hiring and Staffing Spend balanced against Local Senior Headcount Added
• Assumption to check: A short offshore pilot on a non-critical workstream would reveal coordination overhead before it threatens Q3 roadmap commitments
• Worth a look: Tiered pricing revenue is entirely unvalidated; if conversion is slow, the gradual hiring path may deliver no capacity within the six-month window

Your brief covered the main points; adding detail on the lighter areas would sharpen the comparison.

Next, run the analysis to see how the options compare and what could shift the outcome.
```
Chips:
- **Run analysis** — "Run analysis." action_type=`run_analysis`
- **Review model** — "Walk me through the model so I can review it before running the analysis."
- **What assumptions matter most?** — "Which assumptions in this model matter most to check before I run the analysis?"

### `2_run_analysis`

```
Hire Two Senior Engineers Locally currently leads by 55 percentage points, but treat this as provisional: the result is sensitive to Local Senior Headcount Added.
```
Chips:
- **Explain the result** — "Please explain the analysis result in plain language." action_type=`explain_results`
- **What could change the outcome?** — "What could change the outcome of this analysis?" action_type=`what_would_flip`

### `3_explain_leader`

```
I couldn't complete that turn cleanly, but your current analysis is still available.
```
Chips:
- **Explain results** — "Explain the result" action_type=`explain_results`
- **Re-run analysis** — "Run the analysis" action_type=`run_analysis`

### `4_follow_up`

```
Hire Two Senior Engineers Locally comes out ahead in 70% of simulations, while Introduce Tiered Pricing to Fund Gradual Hiring manages just 15% — a gap of 55 percentage points. The core reason is that the local hire option drives Local Senior Headcount Added directly and strongly, which in turn lifts both Engineering Delivery Capacity and Q3 Roadmap Commitment Confidence through moderate positive causal links. Tiered pricing takes a longer, less certain route: it first needs to generate Revenue Uplift, which has only a weak positive link to Engineering Delivery Capacity, and the hiring it funds happens gradually rather than immediately. That delay is a real problem for a six-month Q3 deadline. Tiered pricing does have one structural advantage — Revenue Uplift carries a moderate negative link to Staffing Cost Overrun, meaning it partially self-funds and reduces cost risk. But that benefit is not enough to close the delivery gap within your timeframe. The result is fragile overall, though, because the relationship between Local Senior Headcount Added and Engineering Delivery Capacity is the most vulnerable assumption in your model. If those two new hires take longer to reach full productivity than assumed — which Local Engineering Talent Market Tightness could worsen — the margin narrows and tiered pricing becomes more competitive.

The evidence that would most improve confidence is real-world support for the link from 'Local Senior Headcount Added' to 'Engineering Delivery Capacity' rather than the current model estimate, since it is the assumption most likely to change the outcome.
```
Chips:
- **Explore what would change this** — "Explore what would change the result." action_type=`what_would_flip`

### `5_mutate`

```
Updated Hiring and Staffing Spend from £0 to £0.5. This makes the last analysis stale. Re-run analysis to see how this affects the results.

This change affects the model. The current analysis may not reflect it. Run the analysis to see updated results.
```
Chips:
- **Run analysis again** — "Run the analysis again." action_type=`run_analysis`

### `6_rerun_analysis`

```
Hire Two Senior Engineers Locally currently leads by 57 percentage points, but treat this as provisional: the result is sensitive to Local Senior Headcount Added.
```
Chips:
- **Explain the result** — "Please explain the analysis result in plain language." action_type=`explain_results`
- **What could change the outcome?** — "What could change the outcome of this analysis?" action_type=`what_would_flip`

### `7_explain_what_changed`

```
Hire Two Senior Engineers Locally still leads. Its lead has widened by about 2 percentage points. The result is now moderately stable, where before it was sensitive to your assumptions. If you want to test this further, ask what would change the result.
```

### `8_reload`

```
Hire Two Senior Engineers Locally comes out ahead in 73% of simulations, with Engage Offshore Partner as the runner-up at 16% — a margin of 58 percentage points. The result is moderately stable, meaning it holds under most plausible variations but is not immune to assumption changes.

The three strongest drivers are Local Senior Headcount Added (very strong positive influence), Revenue Uplift from Tiered Pricing (moderate positive influence), and Local Engineering Talent Market Tightness (moderate negative influence).

The most vulnerable assumptions in your model are the relationships from Local Senior Headcount Added to Engineering Delivery Capacity, and from Local Senior Headcount Added to Q3 Roadmap Commitment Confidence. If the two new hires take longer to reach full productivity than assumed — which a tight local talent market could worsen — the margin narrows. The relationship between Offshore Partner Engaged and Coordination and Integration Overhead is also flagged as a vulnerable assumption, meaning the offshore option carries more delivery risk than its headline probability suggests.

The evidence that would most improve confidence is real-world support for the link from 'Local Senior Headcount Added' to 'Engineering Delivery Capacity' rather than the current model estimate, since it is the assumption most likely to change the outcome.
```
Chips:
- **Explore what would change this** — "Explore what would change the result." action_type=`what_would_flip`
