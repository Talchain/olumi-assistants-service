# Olumi Golden-Journey Harness v1 — Classified Report

Produced by [tools/golden-journey-harness](../../tools/golden-journey-harness/). Drives the core PoC journey (draft → run analysis → explain → follow-up → mutate → rerun → explain what changed → reload → verify chips → capture debug) and classifies every assertion into one of the six core components.

## Executive verdict

| signal | value |
|---|---|
| Mode | replay |
| Findings: pass / inconclusive / fail | 35 / 1 / 0 |
| Fails: gating / advisory | 0 / 0 |
| **Next component to fix** | **1. Context management** (via A2) |
| Gating verdict | no gating fails (advisory fails do not gate) |
| Diagnostic-trace flag confirmed ON | yes |

## Gating doctrine

- **Deterministic + safety invariants gate** (A3, A6, A7 — structural; a fail is a real regression).
- **LLM-semantic *quality* invariants advise** (A5 coaching-grounding — variance-prone; reported, not exit-gating).
- **A4 stays gating** despite reading assistant text: it is a safety/honesty invariant (no claiming a mutation that did not happen), where a false-fail is the safe direction and trust rests on the Brief 4 structural-honesty detector — not free-text quality.
- **A1 is advisory _for now_** (still provisional; prose/context-observability dependent). It **graduates to gating** once canonical-state **M3 `_context_summary`** + the canonical state object make coherence wire-grounded.
- **M3 double role:** unblocks **A2** live context observability (in-process-only until then) AND closes the residual **A5** content-level uncertainty by exposing the actual context the model received during future thin-response checks.

## Run metadata

- **Mode:** replay
- **Started at:** replay (deterministic fixture)
- **Branch:** `claude/unruffled-brahmagupta-c387c7`
- **Harness commit:** `bd1111637f6d4d21a3f7126926d53982fb61fe91`

## Core-component matrix

| # | component | invariants | worst status |
|---|---|---|---|
| 1 | Context management | A2 | [INCONCLUSIVE] inconclusive |
| 2 | Canonical state | A1 | [PASS] pass |
| 3 | AI orchestration | — | — |
| 4 | Typed action/mutation | A3, A4 | [PASS] pass |
| 5 | Science-grounded coaching | A5 | [PASS] pass |
| 6 | Observability/recovery | A6, A7 | [PASS] pass |

## Invariant results (A1..A7)

| id | invariant | primary component | status | note |
|---|---|---|---|---|
| A1 _(provisional)_ | Analysis state is not contradicted by prose, chips or reload | 2. Canonical state | [PASS] pass | coherent: status=ready freshness=fresh denial=none |
| A2 | AI-facing context contains graph, analysis, blockers, capabilities, recent-turn state | 1. Context management | [INCONCLUSIVE] inconclusive | context completeness not wire-observable for: graph, analysis_state, blockers, capabilities, recent_turn_state — asserted in-process (tests/unit/golden-journey-harness/context-completeness.test.ts). Priority follow-up: flag-gated debug context-summary surface [source=wire (ContextPack not serialised)] |
| A3 | Actions only count when durable state changed | 4. Typed action/mutation | [PASS] pass | durable analysis-affecting graph hash changed after mutation (baseline≠current) — the action counted |
| A4 | Failed/proposed/non-mutating turns never claim success | 4. Typed action/mutation | [PASS] pass | no false success claim (role=draft http=200) |
| A5 | Coaching is grounded in actual graph/analysis/science signals | 5. Science-grounded coaching | [PASS] pass | coaching grounded in graph/analysis/science signals |
| A6 | Debug output explains what happened | 6. Observability/recovery | [PASS] pass | _diagnostic_trace present: exit_path="draft_graph" correlation_ids ✓ timings=true |
| A7 | Repairs/recoveries are visible, not silent | 6. Observability/recovery | [PASS] pass | graceful turn (http=200, no hidden error envelope, no silent repair) |

## Journey steps

| step | role | http | status | evidence |
|---|---|---|---|---|
| `1_draft` | draft | 200 | [PASS] pass | http=200 text_len=162 chips=1 exit_path=draft_graph trace=present timings={total:52000,ctx:80} draft={total:51000,parse:32000} |
| `2_run_analysis` | analysis | 200 | [PASS] pass | http=200 text_len=188 analysis_status=ready freshness=fresh hash_at_run=a1b2c3d4e5 current_hash=a1b2c3d4e5 chips=1 exit_path=chip_click trace=present timings={total:8200} plot={handler_total:7800,req:7600,status:computed} |
| `3_explain_leader` | explain | 200 | [PASS] pass | http=200 text_len=279 analysis_status=ready freshness=fresh hash_at_run=a1b2c3d4e5 current_hash=a1b2c3d4e5 chips=1 exit_path=turn_executor trace=present timings={total:5400,routing:5100} |
| `4_follow_up` | follow_up | 200 | [PASS] pass | http=200 text_len=228 analysis_status=ready freshness=fresh hash_at_run=a1b2c3d4e5 current_hash=a1b2c3d4e5 chips=0 exit_path=turn_executor trace=present timings={total:4900} |
| `5_mutate` | mutate | 200 | [PASS] pass | http=200 text_len=125 analysis_status=ready freshness=stale hash_at_run=a1b2c3d4e5 current_hash=b2c3d4e5f6 chips=1 exit_path=turn_executor trace=present timings={total:6100} |
| `6_rerun_analysis` | rerun_analysis | 200 | [PASS] pass | http=200 text_len=182 analysis_status=ready freshness=fresh hash_at_run=b2c3d4e5f6 current_hash=b2c3d4e5f6 chips=0 exit_path=chip_click trace=present timings={total:8000} plot={handler_total:7700,status:computed} |
| `7_explain_what_changed` | explain_changed | 200 | [PASS] pass | http=200 text_len=236 analysis_status=ready freshness=fresh hash_at_run=b2c3d4e5f6 current_hash=b2c3d4e5f6 chips=0 exit_path=turn_executor trace=present timings={total:5200} |
| `8_reload` | reload | 200 | [PASS] pass | http=200 text_len=164 analysis_status=ready freshness=fresh hash_at_run=b2c3d4e5f6 current_hash=b2c3d4e5f6 chips=0 exit_path=turn_executor trace=present timings={total:5000} |
| `9_verify_chips` | evaluation | — | [PASS] pass | evaluation over captured turns — exercises A4, A7: Verify chips/actions across the mutate + rerun turns (no false-success chips; rerun affordance after stale). |
| `10_capture_debug` | evaluation | — | [PASS] pass | evaluation over captured turns — exercises A6: Capture the debug/context trace (_diagnostic_trace + _timings) from every turn into the report. |

## Findings (fails + inconclusives)

| invariant | status | gating? | severity | component | step | evidence |
|---|---|---|---|---|---|---|
| A2 | inconclusive | — | medium | 1. Context management | — | context completeness not wire-observable for: graph, analysis_state, blockers, capabilities, recent_turn_state — asserted in-process (tests/unit/golden-journey-harness/context-completeness.test.ts). Priority follow-up: flag-gated debug context-summary surface [source=wire (ContextPack not serialised)] |

## Coverage caveats (what this run did NOT prove)

| component | caveat | detail |
|---|---|---|
| 1. Context management | A2 asserted in-process only | AI-facing context completeness (A2) is proven by the committed in-process test, NOT on the live system — the ContextPack is never serialised on the wire. It stays in-process / wire-inconclusive until the canonical-state M3 `_context_summary` debug surface lands (then A2 becomes wire-observable in the live report). |
| 4. Typed action/mutation | Mutate covers the typed scalar value-edit path only | The mutate step drives a concrete scalar value-edit (`Set <captured factor> to 0.5`) — a REAL durable mutation that routes through the TYPED scalar handler (observed live: handler_id=`set_factor_value`, exit_path=`turn_executor`, llm_calls=0). This is genuine typed scalar-value coverage — NOT the old vague `edit_graph_generic` no-op, and NOT typed-ops / typed add_option apply coverage. Add a typed-ops / add_option journey when that path exists (guardrail #3). |
| 5. Science-grounded coaching | Live A5 is advisory, not a hard gate | The DETERMINISTIC REPLAY is the stable regression gate. Live semantic checks (A5 coaching-grounding; A1 while provisional) are ADVISORY: a lone live fail does not gate (non-zero exit) unless reproduced across repeated calls or backed by deterministic context evidence. A5 already keys on GROUNDING TOKENS (option/factor label, probability, science enrichment), NOT response length. A 5× repeat of explain_leader on a constant scenario reproduced zero thin/ungrounded responses with stable analysis context — the earlier single thin response classified as likely LLM variance. A5 strengthens once the canonical-state M3 `_context_summary` surface exposes the actual context the model received. |

## assistant_text per step (redacted)

### `1_draft`

```
Your decision model is ready, with three options and a few cost and delivery factors. You can run the analysis whenever you're ready, or refine the options first.
```
Chips:
- **Run analysis** — "Run analysis." action_type=`run_analysis`

### `2_run_analysis`

```
Analysis complete. Hire two senior engineers currently leads with about 62% probability against the goal, ahead of Engage an offshore partner. The result is sensitive to the Budget factor.
```
Chips:
- **Explain the result** — "Why does the leading option win?" action_type=`explain_result`

### `3_explain_leader`

```
Hire two senior engineers leads at roughly 62% because it improves delivery speed most directly while keeping Budget within range. The margin over Engage an offshore partner is meaningful but the result is sensitive to the Budget factor, so it's worth confirming that assumption.
```
Chips:
- **What would flip this?** — "What would flip this?" action_type=`what_would_flip`

### `4_follow_up`

```
Engage an offshore partner sits at about 26%, the runner-up. It trails Hire two senior engineers mainly because its effect on delivery speed is weaker for the same Budget. If the Budget assumption changed, that gap would narrow.
```

### `5_mutate`

```
Updated Budget from 0 to 0.5. This makes the last analysis stale. Re-run the analysis to see how this changes the comparison.
```
Chips:
- **Run analysis again** — "Run analysis." action_type=`run_analysis`

### `6_rerun_analysis`

```
Re-ran the analysis on the updated model. Hire two senior engineers still leads, now at about 58%, with Engage an offshore partner at 30%. The Budget factor matters more than before.
```

### `7_explain_what_changed`

```
After making Budget more important, the leading option is unchanged — Hire two senior engineers still leads, though its margin narrowed from about 62% to 58%. Engage an offshore partner gained ground because it is less Budget-sensitive.
```

### `8_reload`

```
Here is the current analysis: Hire two senior engineers leads at about 58%, ahead of Engage an offshore partner at 30%. This reflects the updated Budget importance.
```
