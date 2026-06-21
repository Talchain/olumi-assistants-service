# Olumi Golden-Journey Harness v1 — Classified Report

Produced by [tools/golden-journey-harness](../../tools/golden-journey-harness/). Drives the core PoC journey (draft → run analysis → explain → follow-up → mutate → rerun → explain what changed → reload → verify chips → capture debug) and classifies every assertion into one of the six core components.

> **⚠ Interpretation correction (post-run).** The A3 (Typed action/mutation) FAIL below was produced by a **vague** mutate instruction ("make _<factor>_ more important") that the system correctly answered **clarify-first** ("the model is unchanged… tell me the specific factor/value") — so no mutation happened and the back half of the journey was not strongly tested. A follow-up **concrete-mutation rerun** (`Set <factor> to 0.5`) **mutated correctly** (graph hash changed, freshness stale→fresh, win-probs shifted). **Component 4 is therefore NOT a confirmed defect** — see [golden-journey-v1-concrete-mutation-rerun.md](golden-journey-v1-concrete-mutation-rerun.md). No fix lane is opened. The "next component to fix" verdict in the table below reflects this single ambiguous run and should be read with that correction.

## Executive verdict

| signal | value |
|---|---|
| Mode | live |
| Findings: pass / inconclusive / fail | 33 / 1 / 1 |
| **Next component to fix** | **4. Typed action/mutation** (via A3) |
| Diagnostic-trace flag confirmed ON | yes |

## Run metadata

- **Mode:** live
- **Base URL:** https://cee-staging.onrender.com
- **Started at:** 2026-06-21T15:37:36.138Z
- **Branch:** `claude/unruffled-brahmagupta-c387c7`
- **Harness commit:** `ecbab45de4d596a4820808de87c6d7b5b4ed27f4`
- **Deployed build (/healthz):** `7479cda`

## Core-component matrix

| # | component | invariants | worst status |
|---|---|---|---|
| 1 | Context management | A2 | [INCONCLUSIVE] inconclusive |
| 2 | Canonical state | A1 | [PASS] pass |
| 3 | AI orchestration | — | — |
| 4 | Typed action/mutation | A3, A4 | [FAIL] fail |
| 5 | Science-grounded coaching | A5 | [PASS] pass |
| 6 | Observability/recovery | A6, A7 | [PASS] pass |

## Invariant results (A1..A7)

| id | invariant | primary component | status | note |
|---|---|---|---|---|
| A1 _(provisional)_ | Analysis state is not contradicted by prose, chips or reload | 2. Canonical state | [PASS] pass | coherent: status=ready freshness=fresh denial=none |
| A2 | AI-facing context contains graph, analysis, blockers, capabilities, recent-turn state | 1. Context management | [INCONCLUSIVE] inconclusive | context completeness not wire-observable for: graph, analysis_state, blockers, capabilities, recent_turn_state — asserted in-process (tests/unit/golden-journey-harness/context-completeness.test.ts). Priority follow-up: flag-gated debug context-summary surface [source=wire (ContextPack not serialised)] |
| A3 | Actions only count when durable state changed | 4. Typed action/mutation | [FAIL] fail | durable analysis-affecting graph hash UNCHANGED after a mutation step (baseline===current) — a counted action did not change canonical state |
| A4 | Failed/proposed/non-mutating turns never claim success | 4. Typed action/mutation | [PASS] pass | no false success claim (role=draft http=200) |
| A5 | Coaching is grounded in actual graph/analysis/science signals | 5. Science-grounded coaching | [PASS] pass | coaching grounded in graph/analysis/science signals |
| A6 | Debug output explains what happened | 6. Observability/recovery | [PASS] pass | _diagnostic_trace present: exit_path="draft_graph" correlation_ids ✓ timings=true |
| A7 | Repairs/recoveries are visible, not silent | 6. Observability/recovery | [PASS] pass | repairs surfaced to the user via analysis_ready.model_adjustments (n=2) |

## Journey steps

| step | role | http | status | evidence |
|---|---|---|---|---|
| `1_draft` | draft | 200 | [PASS] pass | http=200 text_len=750 analysis_status=ready freshness=none current_hash=2d083dae0e repairs=2 chips=3 exit_path=draft_graph trace=present draft={total:54791,parse:54743,parse_llm:52963,normalise:1,enrich:3,repair:22,repair_fired:false,repair_attempts:0,validation:0,threshold:0,package:8,boundary:11} |
| `2_run_analysis` | analysis | 200 | [PASS] pass | http=200 text_len=151 analysis_status=ready freshness=fresh hash_at_run=2d083dae0e current_hash=2d083dae0e chips=2 exit_path=chip_click trace=present |
| `3_explain_leader` | explain | 200 | [PASS] pass | http=200 text_len=1574 analysis_status=ready freshness=fresh hash_at_run=2d083dae0e current_hash=2d083dae0e chips=1 exit_path=turn_executor trace=present timings={total:16454,ctx:680,ctx_pack:12,ctx_chars:18780,routing:15337,handler:1,compose:4,commit:405,handler_id:explain_results,cache:miss,cache_read_tokens:0,cache_create_tokens:7110,input_tokens:4554,llm_calls:1} |
| `4_follow_up` | follow_up | 200 | [PASS] pass | http=200 text_len=1865 analysis_status=ready freshness=fresh hash_at_run=2d083dae0e current_hash=2d083dae0e chips=1 exit_path=turn_executor trace=present timings={total:28294,ctx:937,ctx_pack:9,ctx_chars:20591,routing:27006,handler:1,compose:2,commit:330,handler_id:explain_results,cache:hit,cache_read_tokens:7110,cache_create_tokens:0,input_tokens:5010,llm_calls:1} |
| `5_mutate` | mutate | 200 | [PASS] pass | http=200 text_len=121 chips=1 exit_path=edit_graph trace=present |
| `6_rerun_analysis` | rerun_analysis | 200 | [FAIL] fail | http=200 text_len=151 analysis_status=ready freshness=fresh hash_at_run=2d083dae0e current_hash=2d083dae0e chips=2 exit_path=chip_click trace=present |
| `7_explain_what_changed` | explain_changed | 200 | [PASS] pass | http=200 text_len=161 analysis_status=ready freshness=fresh hash_at_run=2d083dae0e current_hash=2d083dae0e chips=0 exit_path=turn_executor trace=present timings={total:1001,ctx:878,ctx_pack:9,ctx_chars:23062,llm_calls:0} |
| `8_reload` | reload | 200 | [PASS] pass | http=200 text_len=1253 analysis_status=ready freshness=fresh hash_at_run=2d083dae0e current_hash=2d083dae0e chips=1 exit_path=turn_executor trace=present timings={total:13778,ctx:759,ctx_pack:7,ctx_chars:23021,routing:12656,handler:2,compose:3,commit:346,handler_id:explain_results,cache:hit,cache_read_tokens:7110,cache_create_tokens:0,input_tokens:5665,llm_calls:1} |
| `9_verify_chips` | evaluation | — | [PASS] pass | evaluation over captured turns — exercises A4, A7: Verify chips/actions across the mutate + rerun turns (no false-success chips; rerun affordance after stale). |
| `10_capture_debug` | evaluation | — | [PASS] pass | evaluation over captured turns — exercises A6: Capture the debug/context trace (_diagnostic_trace + _timings) from every turn into the report. |

## Findings (fails + inconclusives)

| invariant | status | severity | component | step | evidence |
|---|---|---|---|---|---|
| A3 | fail | high | 4. Typed action/mutation | 6_rerun_analysis | durable analysis-affecting graph hash UNCHANGED after a mutation step (baseline===current) — a counted action did not change canonical state |
| A2 | inconclusive | medium | 1. Context management | — | context completeness not wire-observable for: graph, analysis_state, blockers, capabilities, recent_turn_state — asserted in-process (tests/unit/golden-journey-harness/context-completeness.test.ts). Priority follow-up: flag-gated debug context-summary surface [source=wire (ContextPack not serialised)] |

## Coverage caveats (what this run did NOT prove)

| component | caveat | detail |
|---|---|---|
| 1. Context management | A2 asserted in-process only | AI-facing context completeness (A2) is proven by the committed in-process test, NOT on the live system — the ContextPack is never serialised on the wire. Priority follow-up (guardrail #2): a flag-gated debug context-summary surface so A2 becomes wire-observable in the live report. |
| 4. Typed action/mutation | Mutate validates the V4-style path only | The mutate step drives `edit_graph_generic` (the proven deterministic path). This validates the CURRENT path only and is NOT typed-path coverage. Migrate the step to the typed mutation path (typed add_option / typed ops) when that path exists (guardrail #3). |

## assistant_text per step (redacted)

### `1_draft`

```
I've built a first decision model for "Meet Q3 Roadmap Commitments with Sustainable Capacity".

Options compared
• Hire Two Senior Engineers Locally
• Engage Offshore Partner
• Continue with Current Team (Status Quo)
• Introduce Tiered Pricing to Fund

What the model is weighing
• Main trade-off: Hiring and Scaling Budget balanced against Local Senior Hire
• Assumption to check: Senior local hires typically take 2-3 months to reach full productivity; if Q3 starts in under 3 months, this path may not deliver in time
• Worth a look: Consider a hybrid path

Your brief covered the main points; adding detail on the lighter areas would sharpen the comparison.

Next, run the analysis to see how the options compare and what could shift the outcome.
```
Chips:
- **Run analysis** — "Run analysis." action_type=`run_analysis`
- **Review model** — "Walk me through the model so I can review it before running the analysis."
- **What assumptions matter most?** — "Which assumptions in this model matter most to check before I run the analysis?"

### `2_run_analysis`

```
Hire Two Senior Engineers Locally currently leads by 58 percentage points, but treat this as provisional: the result is sensitive to Local Senior Hire.
```
Chips:
- **Explain the result** — "Please explain the analysis result in plain language." action_type=`explain_results`
- **What could change the outcome?** — "What could change the outcome of this analysis?" action_type=`what_would_flip`

### `3_explain_leader`

```
Hire Two Senior Engineers Locally comes out ahead in 71% of simulations, 58 percentage points clear of the Engage Offshore Partner option, because the model's strongest driver works almost entirely in its favour.

Local Senior Hire has a very strong positive influence on Q3 Roadmap Delivery Capacity, and that outcome is the primary path to your goal. When you choose local hiring, this relationship fires at full strength. The other options either don't activate it at all (offshore, status quo) or activate it only indirectly and more slowly (tiered pricing, which funds hiring gradually rather than immediately).

Engineering Talent Market Tightness works against the local hire option by making recruitment harder and slower, and Time to Productive Contribution adds a further drag, since new hires don't contribute from day one. These are the two forces most likely to erode the lead. However, the model currently treats them as moderate influences, not strong enough to overcome the very strong positive pull of Local Senior Hire itself.

The result carries moderate stability, meaning it holds under most plausible variations but is sensitive to your assumptions about how quickly local hires become productive and how tight the talent market really is. Those two assumptions are worth pressure-testing before you commit.

The evidence that would most improve confidence is real-world support for the link from 'Local Senior Hire' to 'Q3 Roadmap Delivery Capacity' rather than the current model estimate, since it is the assumption most likely to change the outcome.
```
Chips:
- **Explore what would change this** — "Explore what would change the result." action_type=`what_would_flip`

### `4_follow_up`

```
Engage Offshore Partner comes out ahead in only 14% of simulations, 58 percentage points behind the local hire option. The gap is large enough that this is not a close call under your current assumptions.

The core problem for the offshore option is that its primary path to Q3 Roadmap Delivery Capacity is weak. The Offshore Partnership factor has only a weak positive connection to delivery capacity, compared to the moderate positive connection that Local Senior Hire carries. So even when offshore is activated at full strength, it simply does not move the delivery capacity needle as much.

On top of that, the offshore option carries a risk that the local hire option does not: Coordination and Integration Overhead. That risk has a moderate positive connection from Offshore Partnership, and feeds a negative drag on your goal. The model treats this as a weak negative influence on the final outcome, but it is also flagged as one of the most vulnerable assumptions in the model, meaning if coordination overhead turns out to be worse than assumed, the offshore case weakens further.

What offshore does not do is activate the Local Senior Hire factor at all, so it misses the strongest driver in the model entirely.

The one area where offshore is structurally comparable is Long-Term Team Capability, where both options carry a weak positive connection. But that path has only a weak link to your goal, so it does not compensate for the delivery capacity gap.

In short, offshore trails because it activates a weaker delivery path, adds a coordination risk, and bypasses the model's strongest driver altogether.

The evidence that would most improve confidence is real-world support for the link from 'Local Senior Hire' to 'Q3 Roadmap Delivery Capacity' rather than the current model estimate, since it is the assumption most likely to change the outcome.
```
Chips:
- **Explore what would change this** — "Explore what would change the result." action_type=`what_would_flip`

### `5_mutate`

```
The model is unchanged so far. Tell me the specific factor, edge, option, or value to change, and I'll apply it directly.
```
Chips:
- **Cancel — keep model unchanged** — "Cancel that change — keep the model as it is."

### `6_rerun_analysis`

```
Hire Two Senior Engineers Locally currently leads by 58 percentage points, but treat this as provisional: the result is sensitive to Local Senior Hire.
```
Chips:
- **Explain the result** — "Please explain the analysis result in plain language." action_type=`explain_results`
- **What could change the outcome?** — "What could change the outcome of this analysis?" action_type=`what_would_flip`

### `7_explain_what_changed`

```
Hire Two Senior Engineers Locally still leads. The size of its lead is essentially unchanged. If you want to test this further, ask what would change the result.
```

### `8_reload`

```
Hire Two Senior Engineers Locally leads, coming out ahead in 71% of simulations, 58 percentage points clear of the runner-up, Engage Offshore Partner, which leads in only 14% of simulations. The result carries moderate stability, meaning it holds under most plausible variations but is not immune to assumption changes.

The three strongest drivers are Local Senior Hire, which has a very strong positive influence on Q3 Roadmap Delivery Capacity; Engineering Talent Market Tightness, which pulls in the opposite direction with a moderate negative influence; and Engineering Team Size, which adds a moderate positive influence.

The most vulnerable assumptions in the model are the relationship between Local Senior Hire and Q3 Roadmap Delivery Capacity, the link from Q3 Roadmap Delivery Capacity to the goal itself, and the connection between Offshore Partnership and Coordination and Integration Overhead. If the first of those turns out to be weaker than assumed, the case for local hiring weakens with it.

The evidence that would most improve confidence is real-world validation of how quickly local senior hires actually lift delivery capacity, since that relationship is both the strongest driver and the most vulnerable assumption in the model.
```
Chips:
- **Explore what would change this** — "Explore what would change the result." action_type=`what_would_flip`
