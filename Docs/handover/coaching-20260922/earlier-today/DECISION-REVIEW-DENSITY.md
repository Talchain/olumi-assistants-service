# What the Decision Review call actually buys — measured, 100 live runs

**Source:** `v5.decision_review.completed` telemetry, CEE staging, 24h to 21 Sep 2026.
n = 100 paired input/output samples. Deployed CEE `e717e19d`.

## The headline

`scenario_contexts` output is **exactly 2 on 100 of 100 runs**, while the input it is
drawn from varies from 5 to 19.

```
(fragile_edges_in, scenario_contexts_out):
  (7,2)×25  (8,2)×18  (9,2)×13  (10,2)×11  (6,2)×8  (11,2)×5  (5,2)×4  (12,2)×4
```

⚠ **This is the model's own raw output, not a CEE truncation.** The count-cap rules in
`decision-review-enricher.ts:483` are explicitly **TELEMETRY-ONLY** — they are counted for
the A/B signal and do *not* drop or trim the review. So the invariance is the model filling
a quota, not exercising judgement about how many contexts matter.

Combined with the already-established fact that CEE **unconditionally overwrites** both the
trigger and the consequence (`prose-fact-agreement.ts:535-536`, re-derived at the deployed
sha), the model's entire surviving contribution to this field is: **choose 2 edges from a
ranked list of 5–19.** Every word it writes about them is replaced.

## Full density table (n=100)

**What CEE feeds the model**

| field | zero | median | max |
|---|---|---|---|
| `enrichment_robustness_fragile_edges_count` | 0% | 8 | 19 |
| `enrichment_factor_sensitivity_count` | 0% | 4 | 8 |
| `enrichment_option_comparison_count` | 0% | 4 | 5 |
| **`enrichment_results_count`** | **100%** | **0** | **0** |

**What the model returns**

| field | zero | median | max | read |
|---|---|---|---|---|
| `output_scenario_contexts_count` | 0% | 2 | 2 | **invariant — a quota** |
| `output_key_assumptions_count` | 0% | 3 | 3 | invariant — a quota |
| `output_decision_quality_prompts_count` | 0% | 2 | 2 | invariant — a quota |
| `output_story_headlines_count` | 0% | 4 | 5 | near-invariant |
| `output_evidence_enhancements_count` | 42% | 1 | 3 | genuinely variable |
| **`output_flip_thresholds_count`** | **93%** | **0** | 1 | **asked for, almost never produced** |
| **`output_bias_findings_count`** | **86%** | **0** | 1 | **asked for, almost never produced** |

## Findings, in value order (one of three retracted on inspection)

**1. `scenario_contexts` is a selection problem wearing a reasoning problem's clothes.**
Fixed count, overwritten prose, ranked input already in hand. The smallest safe
simplification is to select the 2 edges deterministically in CEE and compose the entry from
the same facts the overwrite already uses, then stop asking the model for the field.

⛔ **Order is load-bearing:** `phase3-blocks.ts:3220` builds the user-visible blocks *from*
`dr.scenario_contexts`. Removing it from the prompt before CEE composes it would make those
blocks vanish. Compose first, then stop asking.

⚠ Join on the `(from_id, to_id)` **pair**, not the id string: `fragile_edges[].edge_id` uses
`from->to` while `edge_e_values[].edge_id` uses `from::to`. `edgeFlipKey()` already does this.

**2. Two fields are paid for on every call and delivered on almost none.**
`flip_thresholds` 93% empty, `bias_findings` 86% empty. Either the prompt is asking for
something the model cannot ground in the supplied enrichment, or the shape gate is rejecting
them silently. Worth one falsification before either is removed — an empty field still costs
prompt tokens on every run, but removing a field the model *could* fill would lose real value.

**3. ~~`enrichment_results_count` is zero on 100 of 100 runs.~~ RETRACTED — not a defect.**
The measurement is right; my reading of it was wrong. `decision-review-enricher.ts:1887`
documents `enrichment_results_count` / `_option_comparison_count` /
`_decision_brief_options_count` as **"option-source presence per the PR #180 fallback
chain. Whichever is non-empty drives narrative"**. A zero here is one member of a
three-way chain being inactive while `option_comparison` (median 4) carries the data — the
designed behaviour, not a gap. ISL's results reach the prompt separately under
`isl_results` (~8096 chars per `section_chars`). Nothing to fix, and no prompt weight to
reclaim.

## What this corrects

My pre-compaction note said *"one live witness turn returned ZERO `scenario_contexts`, so it
is not emitted on every review — quantify emission rate before claiming a number."*
**Refuted at n=100: emission is 100%, and the count never varies.** The saving is therefore
larger and far more predictable than that caveat implied, not smaller. The single witness was
not representative.

---

# Verdict: the optimisation target is latency and authorship, not a prompt diet

I went looking for tokens to reclaim. The measurements say that is the wrong target.

## 1. Decision Review dominates the user's wait

| | p50 | p90 | max |
|---|---|---|---|
| `v5.decision_review.completed duration_ms` (n=100) | **17.5s** | 21.7s | 26.3s |
| containing PLoT `/v2/run` (n=5, plus traced runs at 27.9 / 46.8 / 48.7s) | 23.2s | — | 27.8s |

⚠ The `/v2/run` sample is small (n=5 in the log window), so treat the ratio as indicative
rather than exact. But a 17.5s p50 blocking LLM call inside a 23–49s analysis is the
dominant component by any reading, and **no run completed in under 14.4s**.

## 2. What the 17.5 seconds buys

Mostly fixed-count lists, and prose that deterministic code then corrects or replaces:

- `scenario_contexts` — exactly 2, every run; both trigger and consequence **overwritten**
- `key_assumptions` 3, `decision_quality_prompts` 2, `story_headlines` ~4 — invariant quotas
- `flip_thresholds` empty 93%, `bias_findings` empty 86%
- `framing_check` — 0/100, no consumer anywhere

## 3. The model is being asked to state numbers it gets wrong

`M1_REVIEW_NUMBERS_CORRECTED`, same 24h window:

- **23 runs** carried at least one corrected figure (floor, not exact — the completions
  denominator paged out at 100 with `hasMore: true`)
- 59 corrections total; p50 **2 per affected run**, max 8
- **drift p50 14%, max 25%**
- most-corrected field: **`narrative_summary` (22)** — the headline the user actually reads —
  then `readiness_rationale` (5), three `scenario_contexts.*.consequence` entries (13
  combined), `bias_findings[0].description` (2)

The guard is doing exactly the right thing and should stay. But it means the product spends
17.5 seconds asking a model to produce figures, then deterministically repairs them on
roughly a quarter of runs, at a median 14% error.

## 4. Prompt weight, for completeness — and why it is not the lever

`FIELD_SPECIFICATIONS` is 14,430 of 42,838 chars (33.7% of the prompt).

| field | prompt cost | live yield |
|---|---|---|
| `bias_findings` | 2,165 (5.1%) | 86% empty |
| `flip_thresholds` | 1,386 (3.2%) | 93% empty |
| `scenario_contexts` | 873 (2.0%) | always 2, prose overwritten |
| `framing_check` | 236 (0.6%) | 0/100, no consumer |

⛔ **I nearly spent a prompt-store version bump on `framing_check`** — provably dead, and
worth 0.6%. Even the two big empties together are 8.3%, and "empty 86% of the time" may be
*correct*: a bias finding should only fire when there is a bias, and the ~1-in-8 runs where
it does may be the highest-value coaching in the product. Removing them to reclaim 8% of a
prompt would be trading real coaching for a rounding error on latency.

## 5. What I would actually do, in order

1. **Stop asking the model for figures it is handed anyway.** It has the computed numbers in
   its enrichment; it restates them and gets them wrong at 14% median drift. Give it the
   rendered figures as tokens to place, not values to reproduce. This targets the
   most-corrected field (`narrative_summary`) and is squarely the stated architecture —
   deterministic code owns calculation, the model owns prose.
2. **Compose `scenario_contexts` deterministically** and then stop asking for it. Its prose
   is already 100% replaced; the model's only surviving contribution is choosing 2 edges from
   a ranked list CEE already holds.
   ⛔ Order: `phase3-blocks.ts:3220` builds the user-visible blocks *from* `dr.scenario_contexts`.
   Compose first, then stop asking, or the blocks vanish.
3. **Ask whether this call should block the analysis at all.** 17.5s p50 for coaching prose,
   in front of a result the deterministic pipeline has already computed, is a product
   question rather than a prompt question — and it is worth more than every token saving on
   this page combined.
4. `framing_check` — remove it whenever the prompt is next versioned for another reason.
   Not worth its own change.

---

## ⛔ Addendum: do NOT replace the `scenario_contexts` selector. Measured, n=197.

I set out to build the deterministic composer. The measurement says don't.

Splitting the model's contribution into **prose** and **selection**
(`v5.decision_review.prose_fact_violation`, 100 events, 24h):

| | total | per run | read |
|---|---|---|---|
| `qualified_consequences` (consequence overwritten) | **197** | 2 | **100% of prose replaced** |
| `corrected_triggers` (edge HAD an established fact) | **186** | 2 | **94% selection hit rate** |
| `qualified_triggers` (edge had NO fact) | 11 | 0 | 6% |

**The prose contribution is zero and the selection contribution is 94%.**

Every field of an entry is already composed deterministically — `composeSupportedTrigger`
builds the trigger from enrichment labels only ("no label guessed from model prose"), and
the consequence is a constant. **The deterministic composer I was going to build already
exists.** The model's sole surviving contribution is choosing which 2 edges.

A deterministic selector filtering on `requirement !== null` would be 100% fact-supported by
construction, beating 94%. But that is not the whole comparison: with a median of 8 fragile
edges per run, "has a fact" does not *rank*. The model appears to be choosing the 2 most
decision-relevant edges among those with facts, and **there is no ground truth in the
telemetry for relevance**, so I cannot show a deterministic pick would not be worse.

**Verdict: leave it.** Trading an unmeasurable relevance signal on a 94%-accurate selector
for a 2.0% prompt saving is a bad trade, and it would be exactly the "deterministic rewriting
of valid AI reasoning" the architecture principle warns against. The prose side is already
fully deterministic; that half of the job is done.

**What survives from this whole investigation as genuinely actionable:** the
`narrative_summary` number-restating defect (§3 above) — 23 runs, median 2 corrections,
median 14% drift, on the field the user actually reads. That is the model being asked to
reproduce values rather than place them, and it is the one finding here where deterministic
code and the model are fighting over the same job.

---

## The one actionable defect, traced to its mechanism

`decision-review-enricher.ts:1215` puts `win_probability: winProb` into the prompt as the
**raw ISL fraction** (`readNumber(r.win_probability) ?? 0`, so 0–1).

To write the narrative the model must multiply by 100 and round. PLoT's correction record
shows what that produces:

```
field: narrative_summary   original_text "49"   corrected_text "57"
isl_source: comparison.<option>.win_probability   isl_value 0.57425   drift_percent 15
```

**49 is not a rounding error on 57.4** — it is a plausible-looking invented figure. Across
the window: 23 runs affected, median 2 corrections each, drift p50 14% / max 25%, and
`narrative_summary` is the most-corrected field (22 of 59).

So the model is handed a correct value and asked to perform and present a calculation. That
is precisely the division the architecture already states: deterministic code owns
calculation, the model owns prose.

**The fix is to hand it rendered tokens, not values** — `"57%"` rather than `0.57425` — so
the prose places a figure instead of deriving one.

⚠ **Not urgent, and deliberately not done tonight.** `M1_REVIEW_NUMBERS_CORRECTED` already
catches and repairs these before the user sees them, so this is a robustness and cost
improvement, not a live correctness bug. It also requires a `decision_review` prompt-store
version (the prompt is store-served at **v16**; `stagingVersion 16` / `activeVersion 11`, so
`src/prompts/defaults.ts` is inert for it). Changing what the model is asked to do on every
analysis is not a thing to rush at the end of a long session — it wants its own wave, with a
witness, while the existing guard keeps users safe in the meantime.
