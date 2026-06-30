# Golden-Journey Harness v1

Drives the core Olumi PoC journey and classifies every failure into one of six
core components, so a reader can answer **"which component must fix this next?"**

```
draft model → run analysis → explain result → follow-up → mutate/value-edit →
rerun → explain what changed → reload → non-committing edit-intent → premortem →
verify chips/actions → capture debug
```

It makes one thing visible and repeatable: whether the AI experience is reliably
grounded in **canonical state, context, orchestration, typed actions, and
science-backed coaching**.

## The invariants → six components

A1–A7 are the core journey invariants; **A8–A11 are the blind-spot-closure
invariants for the four lived post-analysis defects**.

| id | invariant | primary component |
|----|-----------|-------------------|
| A1 | analysis state not contradicted by prose, chips, or reload _(provisional)_ | 2. Canonical state |
| A2 | AI-facing context has graph, analysis, blockers, capabilities, recent-turn state | 1. Context management |
| A3 | actions only count when durable state changed | 4. Typed action/mutation |
| A4 | failed/proposed/non-mutating turns never claim success | 4. Typed action/mutation |
| A5 | coaching grounded in graph/analysis/science signals | 5. Science-grounded coaching |
| A6 | debug output explains what happened | 6. Observability/recovery |
| A7 | repairs/recoveries are visible, not silent | 6. Observability/recovery |
| **A8** | **no phantom success** — a turn that did not durably mutate never claims it did (lived defect 1) · **gating** · role-agnostic; the graph hash is authoritative (a non-mutating handler is not proof); opening-anchored claim detection avoids descriptive false-positives | 4. Typed action/mutation |
| **A9** | **AI-facing context is observable on the wire**, not only in-process (lived defect 2) · _inconclusive = acceptance requirement_ | 1. Context management |
| **A10** | **simple deterministic turns stay within an advisory latency budget** AND **deterministic-eligible turns don't wrongfully escalate to an LLM** (lived defect 3) · _advisory_ | 3. AI orchestration |
| **A11** | **premortem/challenge prompts handled safely** — no overclaiming/invented doctrine (lived defect 4) · _advisory_ | 3. AI orchestration |

`pass` / `fail` / `inconclusive`. **Inconclusive ≠ pass:** when a required signal
is missing (no diagnostic trace, no `current_graph_hash`, no wire context summary),
the invariant is `inconclusive` AND surfaced as a **CEE acceptance requirement** —
a missing-observability gap blocks the harness from proving the system, so it is
never silently green.

**Gating:** only `status==='fail' && !advisory` sets a non-zero exit code. A8 gates
(safety/honesty, like A4); A10/A11 are advisory; A9/A2 inconclusives are acceptance
requirements (non-gating but RED in the matrix and listed under "CEE acceptance
requirements" in the report).

## Run

**Deterministic replay — all-green self-test** (CI-safe; no network; expected exit 0):

```bash
pnpm tsx tools/golden-journey-harness/index.ts \
  --replay tools/golden-journey-harness/fixtures/golden-journey-v1.json \
  --out Docs/golden-journey/golden-journey-v1-report.md
```

**Deterministic replay — RED baseline of the four lived defects** (expected exit 1;
A8 gating fail + A10/A11 advisory + A9/A2 acceptance requirements):

```bash
pnpm tsx tools/golden-journey-harness/index.ts \
  --replay tools/golden-journey-harness/fixtures/golden-journey-v1-defects.json \
  --out Docs/golden-journey/golden-journey-v1-defects-baseline.md
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

Exit codes: `0` no **gating** fails · `1` ≥1 gating fail · `2` harness error · `3` auth/preflight/deploy halt.

**Gating vs advisory.** The deterministic replay is the stable regression gate.
Semantic, LLM-variance-prone checks — **A5** (coaching grounding) and **A1** while
provisional — are **advisory**: reported (and shown in the report's `gating?` column)
but they do **not** set a non-zero exit code on their own. Only gating fails
(A3/A4/A6/A7) gate. A lone live A5 fail is therefore not a hard regression — see the
[A5 flap characterisation](../../Docs/golden-journey/golden-journey-v1-a5-flap-characterisation.md).
A5 strengthens once canonical-state **M3 `_context_summary`** lands.

`--trace-confirmed` asserts `CEE_DIAGNOSTIC_TRACE_ENABLED` is ON, so a missing
trace **fails** A6 instead of being inconclusive (dispatch guardrail #5). Without
it, A6 auto-derives expectation from whether any turn actually returned a trace.

## Gating doctrine

The principle behind which invariants gate the exit code:

- **Deterministic and safety invariants gate.** `A3` (durable-state-changed),
  `A6` (debug/observability), `A7` (recovery/repair-visible) are structural and
  deterministic — a fail is a real regression.
- **LLM-semantic *quality* invariants advise.** `A5` (coaching grounding) reads
  generated prose for quality and is variance-prone, so it is reported but does
  not gate.
- **`A4` stays gating even though it reads assistant text** — it is a
  safety/honesty invariant (a turn must not *claim* a mutation it did not make).
  A false-fail there is the safe direction, and its trustworthiness rests on the
  Brief 4 structural-honesty detector (success-claim vs durable-state /
  clarify-or-proposed shape), not on free-text quality.
- **`A1` is advisory *for now*** because it is still provisional and depends on
  prose + context observability we cannot yet ground on the wire.

**A1's advisory status is temporary.** Once canonical-state **M3
`_context_summary`** and the canonical state object make coherence
wire-grounded, A1 should **graduate to a true gating invariant**.

**M3 has a double role.** It (1) unblocks **A2** live context observability
(A2 is in-process-only until then), and (2) closes the residual **A5**
content-level uncertainty by exposing the actual context the model received
during future thin-response checks — so a thin A5 response can then be
attributed to context vs pure LLM variance.

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
| `fixtures/golden-journey-v1.json` | brief + per-step milestones + all-green reference transcript (self-test, exit 0) |
| `fixtures/golden-journey-v1-defects.json` | RED-baseline transcript reproducing the four lived defects (A8/A9/A10/A11) |
| `fixtures/golden-journey-v1-f4835349-regression.json` | sanitized reproduction of the real lived turn (row `a9da06f2`): honest proposal (A8 pass) + wrongful LLM escalation (A10 advisory). No real scenario data. |

Reuses (does not fork) `../v5-journey-replay/` for the HTTP client, deploy gate,
preflight, redaction, forbidden-term scan, timings formatter, and the mutation /
clarification / denial-phrase detectors.
