# decision_review — BASELINE on the served v14 prompt (2026-07-31)

The tool's first real run artefact, and the point of Harness H1: the pending v14
rewrite is Paul-approved **conditional on carrying its own before/after eval**
("do not rewrite blind"). This is the *before*.

**Contract measured:** PMS `decision_review_default` **v14**, sha256
`b4f15305c2bb32e9…` — byte-identical to the manifest's
`live_served_hash_observed` with `served_hash_verified: true`. Not a proxy for
the served prompt; the served prompt.

**Model:** gpt-4.1 (`src/config/model-routing.ts:152`, the registered pin).

---

## Part A — fixture mode (deterministic, zero LLM, zero network)

`pnpm eval:decision-review` → `fixture-mode-report.json`

| | |
|---|---|
| fixtures | 7 |
| candidates scored | 27 (7 good, 20 seeded-bad) |
| candidates passing all 19 dimensions | 7 — exactly the 7 good ones |
| fixtures agreeing with their recorded expectations | 7/7 |
| dimensions with a seeded RED somewhere in the pack | 19/19 |

This half measures the **pack**, not the prompt: it proves each dimension fires
on a defect it was built for and stays quiet on a clean review. It is the CI-safe
half and runs on every PR.

## Part B — the served prompt's REAL output (real gpt-4.1 calls, zero new spend)

`pnpm eval:decision-review --fixtures-dir tools/orchestrator-eval/reports/decision-review-v14-baseline-2026-07-31 --verbose`
→ `live-capture-report.json`

**Provenance:** two deployed-pair captures taken 2026-07-30 against
`cee-staging.onrender.com`, recorded at
`PHASE0-EVIDENCE-2026-07-28/adjudicate-decision-review-raw/{r1,r3}-bodies.json`.
Both carry a populated `decision_review` block produced by a real gpt-4.1 call
against the served v14 prompt. Scoring them costs nothing and measures the thing
that matters — what v14 actually emits — rather than what it emits to a
freshly-invented fixture.

### Result: 18/19 on both runs, and they fail DIFFERENT rules

| run | verdict | failing dimension | the actual string |
|---|---|---|---|
| r1 | 18/19 | `no_internal_vocabulary` (served-prompt-derived) | `readiness_rationale`: *"**The readiness is high** because the current setup outperforms alternatives…"* |
| r3 | 18/19 | `no_dashes` (served-prompt-derived) | `narrative_summary`: *"…leads by a wide margin**—**about 88 percentage points ahead of HubSpot…"* |

Both are breaches of the served prompt's **own** banned list:

- `readiness` is named in the internal-vocabulary ban
  (`Prompts/canonical/decision_review.txt:121`), which instructs the model to say
  what the thing means rather than name the field.
- Em dashes are banned twice — in the terminology block (`:129`, "use commas,
  colons or full stops") and again in the OUTPUT_SCHEMA (`:436`, "No em dash or
  en dash in any string value, anywhere").

And the prompt states the consequence itself (`:486-487`): *"Any output string
containing banned terminology, a raw probability decimal, or an entity id: that
card is discarded."* So on the served prompt's own terms these are discarded
cards reaching users.

**The most informative part of this result is that the two runs failed
DIFFERENT rules.** Same scenario, same prompt, same model: one run leaked a field
name, the other an em dash. That is not a stable defect that a single spot-check
would have characterised — it is a compliance RATE, and n=2 is far too small to
estimate one. Any before/after comparison for the rewrite needs repeated runs per
arm, which is exactly what `tools/conversation-harness/scorer/ab-verdict.ts`
already implements (N≥3, median for quality dims, WORST-run for safety dims).
Treat "18/19" as one sample, never as a score.

### What this baseline does NOT measure — read before quoting it

The captures are RESPONSE-only, so the review-invocation input is reconstructed
from the same payload. Real vs reconstructed, field by field:

| field | state |
|---|---|
| `graph` | REAL (16 nodes, 31 edges, from the `GRAPH_READY` event) |
| `isl_results.option_comparison` / `factor_sensitivity` / `fragile_edges` / `robustness` | REAL (from `blocks[0].enrichment`) |
| `winner` / `runner_up` / margin | REAL (derived from `option_comparison`, cross-checked against `leading_option_id`) |
| `brief` | **NOT RECOVERABLE** — lives in the turn REQUEST, which the probe did not record. Present only so the assembler has a `<BRIEF>` section; feeds no scored dimension. |
| `deterministic_coaching` | **NOT RECOVERABLE** — CEE-internal, never echoed to the wire. |

Two consequences, stated rather than buried:

1. **`tone_alignment` is NOT APPLICABLE on this baseline** and reports so. It
   resolves its row from `deterministic_coaching.readiness` / `headline_type`,
   neither of which survives in a response-only capture. v14's tone compliance is
   therefore **unmeasured**, not measured-and-clean.
2. **`entity_references_grounded` grounds against 16 node ids and ZERO edge ids** —
   the live graph's edges carry no `id` field at all (`{from, to, strength, …}`).
   A bias finding citing an edge would read as ungrounded. It happened not to
   here, so the dimension's green is real but its corpus is narrower than the
   fixture pack's.

The reconstruction biases toward FALSE POSITIVES, not false negatives: a smaller
grounded-number corpus makes `numbers_grounded` more likely to flag, not less. So
a green on this baseline is trustworthy in the direction that matters, and both
reds above are byte-verified against the prompt text.

## Why there was no new paid live run

The brief allowed exactly one double-opt-in live run inside the existing 24-turn
cap. It was **not made, and no substitute was improvised**: no model-provider
credential (`OPENAI_API_KEY` / `ANTHROPIC_API_KEY`) is present in the shell
environment or in `.env.staging.local`, which carries service credentials only
(ADMIN / ASSIST / PLOT / SUPABASE / RENDER / LANGFUSE / SENTRY). Rather than
source a key, the baseline was taken from captures of real calls that had already
been paid for — which is a strictly better artefact anyway: it measures the
DEPLOYED path end to end, not a direct model call reproducing it.

The paid path stays wired, gated, and unused:

```bash
export ORCHESTRATOR_EVAL_LIVE_CANDIDATES=1   # half one
pnpm eval:orchestrator:candidates -- --task decision_review \
  --prompt v14=Prompts/canonical/decision_review.txt \
  --prompt candidate=path/to/rewrite.txt \
  --live --model gpt-4.1-2025-04-14          # half two + explicit model
```

14 turns (2 arms × 7 fixtures), inside the 24-turn hard cap. Both opt-in halves
are required; either alone is refused before any network call.
