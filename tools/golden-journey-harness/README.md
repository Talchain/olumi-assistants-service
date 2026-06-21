# Golden-Journey Harness v1

Drives the core Olumi PoC journey and classifies every failure into one of six
core components, so a reader can answer **"which component must fix this next?"**

```
draft model → run analysis → explain result → follow-up → mutate/value-edit →
rerun → explain what changed → reload → verify chips/actions → capture debug
```

It makes one thing visible and repeatable: whether the AI experience is reliably
grounded in **canonical state, context, orchestration, typed actions, and
science-backed coaching**.

## The seven invariants → six components

| id | invariant | primary component |
|----|-----------|-------------------|
| A1 | analysis state not contradicted by prose, chips, or reload _(provisional)_ | 2. Canonical state |
| A2 | AI-facing context has graph, analysis, blockers, capabilities, recent-turn state | 1. Context management |
| A3 | actions only count when durable state changed | 4. Typed action/mutation |
| A4 | failed/proposed/non-mutating turns never claim success | 4. Typed action/mutation |
| A5 | coaching grounded in graph/analysis/science signals | 5. Science-grounded coaching |
| A6 | debug output explains what happened | 6. Observability/recovery |
| A7 | repairs/recoveries are visible, not silent | 6. Observability/recovery |

`pass` / `fail` / `inconclusive`. **Inconclusive ≠ pass:** when a required signal
is missing (no diagnostic trace, no `current_graph_hash`), the invariant is
`inconclusive` AND a high-severity Component-6 finding — a missing-observability
gap blocks the harness from proving the system, so it is never silently green.

## Run

**Deterministic replay** (CI-safe; no network — runs the classifier over a
recorded transcript):

```bash
pnpm tsx tools/golden-journey-harness/index.ts \
  --replay tools/golden-journey-harness/fixtures/golden-journey-v1.json \
  --out Docs/golden-journey/golden-journey-v1-report.md
```

**Live** (drives the real `POST /orchestrate/v2/turn`):

```bash
# localhost
pnpm tsx tools/golden-journey-harness/index.ts --base-url http://localhost:3000

# cee-staging (set the ASSIST key; enable the trace flags server-side first)
export OLUMI_REPLAY_API_KEY='<staging-assist-key>'
pnpm tsx tools/golden-journey-harness/index.ts \
  --base-url https://cee-staging.onrender.com --scenario-prefix gj-v1 --trace-confirmed
```

Exit codes: `0` no fails · `1` ≥1 fail · `2` harness error · `3` auth/preflight/deploy halt.

`--trace-confirmed` asserts `CEE_DIAGNOSTIC_TRACE_ENABLED` is ON, so a missing
trace **fails** A6 instead of being inconclusive (dispatch guardrail #5). Without
it, A6 auto-derives expectation from whether any turn actually returned a trace.

## What is NOT proven on the live wire

- **A2** is asserted **in-process only** (`tests/unit/golden-journey-harness/context-completeness.test.ts`)
  because the `ContextPack` is never serialised. It stays wire-inconclusive until
  the canonical-state **M3 `_context_summary`** debug surface lands.
- The **mutate** step drives a concrete scalar value-edit (`Set <captured factor>
  to 0.5`) — a real durable mutation that routes through the **typed scalar
  handler** (observed live: `handler_id=set_factor_value`,
  `exit_path=turn_executor`). This is **typed scalar value-edit** coverage,
  **not** typed-ops / typed `add_option` apply coverage; add a typed-ops journey
  when that path exists.

## Layout

| file | role |
|------|------|
| `components.ts` | 6-component taxonomy + `Finding` type |
| `observation.ts` | wire-body superset + `TurnObservation` + accessors |
| `invariants.ts` | pure A1..A7 classifiers + `evaluateJourney` |
| `journey.ts` | the 10-step journey + hash-memory threading |
| `report.ts` | classified markdown report + 6-component matrix |
| `index.ts` | CLI (live + `--replay`) |
| `fixtures/golden-journey-v1.json` | brief + per-step milestones + reference transcript |

Reuses (does not fork) `../v5-journey-replay/` for the HTTP client, deploy gate,
preflight, redaction, forbidden-term scan, timings formatter, and the mutation /
clarification / denial-phrase detectors.
