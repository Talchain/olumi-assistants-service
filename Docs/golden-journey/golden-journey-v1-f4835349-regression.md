# Olumi Golden-Journey Harness v1 — Classified Report

Produced by [tools/golden-journey-harness](../../tools/golden-journey-harness/). Drives the core PoC journey (draft → run analysis → explain → follow-up → mutate → rerun → explain what changed → reload → verify chips → capture debug) and classifies every assertion into one of the six core components.

## Executive verdict

| signal | value |
|---|---|
| Mode | replay |
| Findings: pass / inconclusive / fail | 13 / 2 / 1 |
| Fails: gating / advisory | 0 / 1 |
| **Next component to fix** | **3. AI orchestration** (via A10) — _advisory only (not a gate; deterministic replay is the gate)_ |
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
- **Branch:** `eval/post-analysis-proof`
- **Harness commit:** `ed93c0ad463012ebfd04b067b1d25feb3c0b6a8c`

## Core-component matrix

| # | component | invariants | worst status |
|---|---|---|---|
| 1 | Context management | A2, A9 | [INCONCLUSIVE] inconclusive |
| 2 | Canonical state | A1 | [PASS] pass |
| 3 | AI orchestration | A10 | [FAIL] fail |
| 4 | Typed action/mutation | A4, A8 | [PASS] pass |
| 5 | Science-grounded coaching | — | — |
| 6 | Observability/recovery | A6, A7 | [PASS] pass |

## Invariant results (A1..A7)

| id | invariant | primary component | status | note |
|---|---|---|---|---|
| A1 _(provisional)_ | Analysis state is not contradicted by prose, chips or reload | 2. Canonical state | [PASS] pass | coherent: status=ready freshness=fresh denial=none |
| A2 | AI-facing context contains graph, analysis, blockers, capabilities, recent-turn state | 1. Context management | [INCONCLUSIVE] inconclusive | context completeness not wire-observable for: graph, analysis_state, blockers, capabilities, recent_turn_state — asserted in-process (tests/unit/golden-journey-harness/context-completeness.test.ts). Priority follow-up: flag-gated debug context-summary surface [source=wire (ContextPack not serialised)] |
| A3 | Actions only count when durable state changed | — | — not evaluated | — |
| A4 | Failed/proposed/non-mutating turns never claim success | 4. Typed action/mutation | [PASS] pass | no false success claim (role=draft http=200) |
| A5 | Coaching is grounded in actual graph/analysis/science signals | — | — not evaluated | — |
| A6 | Debug output explains what happened | 6. Observability/recovery | [PASS] pass | _diagnostic_trace present: exit_path="draft_graph" correlation_ids ✓ timings=true |
| A7 | Repairs/recoveries are visible, not silent | 6. Observability/recovery | [PASS] pass | graceful turn (http=200, no hidden error envelope, no silent repair) |
| A8 | A non-committing change request never claims a mutation it did not durably make | 4. Typed action/mutation | [PASS] pass | no phantom success (role=mutate_intent clarify=false claims_mutation=false hash_observable=true hash_moved=false handler_id=none proposal_only=true) |
| A9 | AI-facing context is observable on the wire (not only in-process) | 1. Context management | [INCONCLUSIVE] inconclusive | no turn exposed an AI-facing context summary on the wire (_context_summary / _diagnostic_trace.context_summary absent on all 3 turns) — A2 context completeness cannot be proven live, only in-process. ACCEPTANCE REQUIREMENT: emit a flag-gated context summary (canonical-state M3) carrying graph + analysis_state + blockers + capabilities + recent_turn_state. |
| A10 | Simple deterministic turns stay within an advisory latency budget | 3. AI orchestration | [FAIL] fail | wrongful LLM escalation: deterministic-eligible turn (role=mutate_intent) made 1 LLM call(s) (11347ms) — should be handled by the deterministic gate; the escalation adds latency + nondeterminism |
| A11 | Premortem / challenge prompts are handled safely (no overclaiming or invented doctrine) | — | — not evaluated | — |

## Journey steps

| step | role | http | status | evidence |
|---|---|---|---|---|
| `1_draft` | draft | 200 | [PASS] pass | http=200 text_len=114 chips=1 exit_path=draft_graph trace=present timings={total:50000} draft={total:49000,parse:30000} |
| `2_run_analysis` | analysis | 200 | [PASS] pass | http=200 text_len=66 analysis_status=ready freshness=fresh hash_at_run=acfa3515ac current_hash=acfa3515ac chips=1 exit_path=chip_click trace=present timings={total:8000} plot={handler_total:7700,status:computed} |
| `9_mutate_intent` | mutate_intent | 200 | [FAIL] fail | http=200 text_len=396 analysis_status=ready freshness=fresh hash_at_run=acfa3515ac current_hash=acfa3515ac chips=1 exit_path=turn_executor trace=present timings={total:11347,routing:10500,llm_calls:1} |
| `11_verify_chips` | evaluation | — | [PASS] pass | evaluation over captured turns — exercises A4, A7: Verify chips/actions across the mutate + rerun turns (no false-success chips; rerun affordance after stale). |
| `12_capture_debug` | evaluation | — | [PASS] pass | evaluation over captured turns — exercises A6, A10: Capture the debug/context trace (_diagnostic_trace + _timings + latency) from every turn into the report. |

## Findings (fails + inconclusives)

| invariant | status | gating? | severity | component | step | evidence |
|---|---|---|---|---|---|---|
| A10 | fail | advisory | low | 3. AI orchestration | 9_mutate_intent | wrongful LLM escalation: deterministic-eligible turn (role=mutate_intent) made 1 LLM call(s) (11347ms) — should be handled by the deterministic gate; the escalation adds latency + nondeterminism |
| A2 | inconclusive | — | medium | 1. Context management | — | context completeness not wire-observable for: graph, analysis_state, blockers, capabilities, recent_turn_state — asserted in-process (tests/unit/golden-journey-harness/context-completeness.test.ts). Priority follow-up: flag-gated debug context-summary surface [source=wire (ContextPack not serialised)] |
| A9 | inconclusive | — | high | 1. Context management | — | no turn exposed an AI-facing context summary on the wire (_context_summary / _diagnostic_trace.context_summary absent on all 3 turns) — A2 context completeness cannot be proven live, only in-process. ACCEPTANCE REQUIREMENT: emit a flag-gated context summary (canonical-state M3) carrying graph + analysis_state + blockers + capabilities + recent_turn_state. |

## Coverage caveats (what this run did NOT prove)

| component | caveat | detail |
|---|---|---|
| 1. Context management | A2 asserted in-process only | AI-facing context completeness (A2) is proven by the committed in-process test, NOT on the live system — the ContextPack is never serialised on the wire. It stays in-process / wire-inconclusive until the canonical-state M3 `_context_summary` debug surface lands (then A2 becomes wire-observable in the live report). |
| 4. Typed action/mutation | Mutate covers the typed scalar value-edit path only | The mutate step drives a concrete scalar value-edit (`Set <captured factor> to 0.5`) — a REAL durable mutation that routes through the TYPED scalar handler (observed live: handler_id=`set_factor_value`, exit_path=`turn_executor`, llm_calls=0). This is genuine typed scalar-value coverage — NOT the old vague `edit_graph_generic` no-op, and NOT typed-ops / typed add_option apply coverage. Add a typed-ops / add_option journey when that path exists (guardrail #3). |
| 5. Science-grounded coaching | Live A5 is advisory, not a hard gate | The DETERMINISTIC REPLAY is the stable regression gate. Live semantic checks (A5 coaching-grounding; A1 while provisional) are ADVISORY: a lone live fail does not gate (non-zero exit) unless reproduced across repeated calls or backed by deterministic context evidence. A5 already keys on GROUNDING TOKENS (option/factor label, probability, science enrichment), NOT response length. A 5× repeat of explain_leader on a constant scenario reproduced zero thin/ungrounded responses with stable analysis context — the earlier single thin response classified as likely LLM variance. A5 strengthens once the canonical-state M3 `_context_summary` surface exposes the actual context the model received. |
| 1. Context management | A9 — context observability is a CEE acceptance requirement | A9 tracks whether the wire exposes an AI-facing context summary (`_context_summary` / trace.context_summary). It is absent on every path today, so A9 is INCONCLUSIVE and recorded as a CEE acceptance requirement — NOT a pass. The blind spot turns green only when the canonical-state M3 context summary lands; until then A2 can be proven in-process only. |
| 3. AI orchestration | A10 — latency is advisory + environment-variance-prone | A10 captures per-turn `_timings.turn.total_ms` (fallback: client elapsed) and flags simple deterministic turns (llm_calls=0) against a tight advisory budget; LLM/draft/analysis turns use generous budgets. It NEVER gates the exit code — latency varies with cache state, model load and network. The latency summary table reports every turn so deterministic-turn improvement is trackable across runs. |
| 4. Typed action/mutation | A8 — non-committing-intent coverage needs the hash trio | A8 proves a change *request* that should not commit never claims a mutation it did not make. The phantom-success verdict is wire-grounded to `current_graph_hash` vs the pre-turn graph hash; when the hash trio is absent A8 is INCONCLUSIVE (acceptance requirement: emit the hash on edit-intent turns), never a pass. |

## CEE acceptance requirements (close these to turn the baseline green)

Each row is something the harness **could not prove** because the signal is not observable today — recorded as an acceptance requirement, **not** a pass. Closing these (mostly wire-surfacing on the CEE side) is what lets the corresponding invariant graduate to a real pass/fail.

| invariant | component | requirement (evidence) |
|---|---|---|
| A2 | 1. Context management | context completeness not wire-observable for: graph, analysis_state, blockers, capabilities, recent_turn_state — asserted in-process (tests/unit/golden-journey-harness/context-completeness.test.ts). Priority follow-up: flag-gated debug context-summary surface [source=wire (ContextPack not serialised)] |
| A9 | 1. Context management | no turn exposed an AI-facing context summary on the wire (_context_summary / _diagnostic_trace.context_summary absent on all 3 turns) — A2 context completeness cannot be proven live, only in-process. ACCEPTANCE REQUIREMENT: emit a flag-gated context summary (canonical-state M3) carrying graph + analysis_state + blockers + capabilities + recent_turn_state. |

## Latency summary (A10 — advisory)

Per-turn wall-clock from `_timings.turn.total_ms` (fallback: client elapsed). **Simple deterministic turns** (`llm_calls=0`) are the class tracked for latency improvement; budgets are advisory and never gate the exit code.

| step | role | total_ms | class | budget_ms | llm_calls | verdict |
|---|---|---|---|---|---|---|
| `1_draft` | draft | 50000 | draft | 60000 | — | within |
| `2_run_analysis` | analysis | 8000 | analysis | 12000 | — | within |
| `9_mutate_intent` | mutate_intent | 11347 | llm | 12000 | 1 | within |

## assistant_text per step (redacted)

### `1_draft`

```
Your decision model is ready, with two options and a few delivery factors. Run the analysis whenever you're ready.
```
Chips:
- **Run analysis** — "Run analysis." action_type=`run_analysis`

### `2_run_analysis`

```
Analysis complete. Option A leads with about 60% against the goal.
```
Chips:
- **Explain the result** — "Why does the leading option win?" action_type=`explain_result`

### `9_mutate_intent`

```
Being transparent about what happened: the change was rejected by the structural rules because the new risk linked directly to an option, which the model's structure doesn't allow. The underlying concern is still encodable two clean ways: introduce a factor for it between the option and the delivery outcome, or loosen an existing link to encode the same scepticism. Which would you like to try?
```
Chips:
- **Continue with the proposed update** — "Continue with the proposed factor." action_type=`edit_graph`
