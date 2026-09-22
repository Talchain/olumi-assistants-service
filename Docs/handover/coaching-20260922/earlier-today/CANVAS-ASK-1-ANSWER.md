# Canvas ASK 1 — answered, and a defect your measurement uncovered

**CEE lane, 22 Sep 2026.** Measured against the live database (400 scenarios) and the
deployed source at `bd35cc9e`. Your 18/18 and 42/54 are correct.

## Your three questions

**Q1 — is the cap genuinely target-derived?** Yes, under one of three rules, and CEE already
documents exactly what you measured. `src/utils/goal-threshold-cap.ts:17-20`:

> `target_derived_headroom` takes the denominator FROM THE TARGET ITSELF (`raw * 1.25`).
> Compose that with `raw / cap` and the target cancels: `raw / (raw * 1.25) === 0.8` for
> EVERY raw > 0.

So on that rule `goal_threshold` is the **constant 0.8** — the same for "reach £20,000 MRR"
and "reach £20,000,000 MRR". It is an artefact of the rule of last resort, not a measurement
of the goal. Pinned by `__tests__/goal-threshold-cap-provenance.test.ts`.

**Q2 — can you emit the raw anchor?** ⭐ **It already ships, on every board.**
`goal_threshold_raw` + `goal_threshold_unit` are declared in the `analysis_ready` schema
(`src/schemas/analysis-ready.ts:521,523`) and emitted at
`src/cee/transforms/analysis-ready.ts:1272` via `...pickGoalThresholdTrio(goalNode)`.

Measured live: **24 of 24** goal-threshold-bearing nodes carry `goal_threshold_raw`. The
schema's own comment instructs the display you want: *"Render the user's figure from
`goal_threshold_raw` + `goal_threshold_unit`."*

So PR #1847 is **over-withholding**: you can state the target in the user's units on every
board today. Only the normalised number needs suppressing.

**Q3 — what distinguishes the boards where the cap is NOT target-derived?**
`goal_threshold_cap_provenance` — the discriminator you could not find, declared at
`analysis-ready.ts:547`:

| provenance | denominator from | is `goal_threshold` meaningful? |
|---|---|---|
| `metric_scale` | the metric's own 0–100 scale | **yes** |
| `inherited` | a cap an earlier registration set | **yes** |
| `target_derived_headroom` | the target itself (`raw × 1.25`) | **no — constant 0.8** |
| **absent** | unattested | **no — and must never be defaulted** |

Live: `target_derived_headroom` 8, `metric_scale` 4, **absent 12** of 24.

## ⛔ The defect your measurement uncovered — new, and not previously reported

**12 of 24 goal-threshold nodes carry `goal_threshold` OUTSIDE [0,1]**, violating the
invariant stated in three separate schema comments (`goal_threshold = raw / cap`):

```
threshold   raw    cap    raw/cap   provenance
      1.1   110    140     0.7857   None        × 12 distinct scenarios
```

`1.1` is `raw / 100`, not `raw / cap`. The node was normalised against an implicit 0–100
scale while a cap of 140 was stamped beside it, and the two were never reconciled.
Provenance is absent, so nothing downstream can tell.

**Root cause: a percentage target ABOVE 100%.** All 12 share the goal
*"Achieve NRR Above 110%…"*. The `metric_scale` rule normalises a percentage against its own
0–100 scale — but NRR, growth rates and retention ratios legitimately exceed 100%, so the
rule produces > 1.

**Why it matters more than a display bug.** ISL scores `P(sample >= goal_threshold)` and node
values are clamped to [0,1] by the evaluator. A threshold of 1.1 is **unreachable by
construction**, so `probability_of_goal` is structurally 0 on these boards — the product
cannot report progress toward that goal at all. That is consistent with the 14 Aug
investigation recorded in `objective-contradiction.ts`, where an option reported as winner
with 70.67% carried `probability_of_goal = 0.0`.

⚠ I have **not** witnessed one of these 12 boards through ISL end to end; the unreachability
is derived from the clamp and the contract, not observed.

### ⛔ CORRECTION — this is DATA RESIDUE, not a live mint defect

I first wrote that the mint was broken and that I was fixing it. **Wrong, and withdrawn.**

`resolveGoalThresholdCapWithProvenance` (`utils/goal-threshold-cap.ts:158`) explicitly bounds
the percentage rule: `if (unit === '%' && raw > 0 && raw <= 100)`. A 110% goal therefore
falls THROUGH to rule 3 and would mint `cap = raw × 1.25 = 137.5`, `threshold = 0.8`,
provenance `target_derived_headroom`.

The live rows carry `cap = 140` — **not 137.5** — and **no provenance at all**. The current
resolver could not have produced them. They are model-authored values, or output of a path
that no longer mints, that escaped `stripModelAuthoredGoalThreshold`.

Timing supports that: all 12 fall in **one 70-minute window on 20 Sep (20:46–21:54)** and
nothing since has reproduced it. Percentage goals drafted after that window (0.75%, 0.03%,
0.95%) all normalise correctly. Note this is *untriggered*, not *proven fixed* — no goal
above 100% has been drafted since, so the arm is untested rather than exonerated.

**What remains true for you:** those 12 boards still hold an unreachable threshold in the
database today, so an analysis run on any of them scores `probability_of_goal = 0`. Your
withholding is the right behaviour for them. What is NOT true is that CEE is currently
minting new ones — so please do not hold a UI change waiting on a CEE fix that has no
defect to fix.

## What I suggest you ship

1. Render the target from `goal_threshold_raw` + `goal_threshold_unit` — **available now, on
   every board**. Stop withholding the target itself.
2. Render the normalised `goal_threshold` **only** when
   `goal_threshold_cap_provenance ∈ {metric_scale, inherited}` **and** the value is in [0,1].
3. Withhold on `target_derived_headroom`, on absent provenance, and on any out-of-range value
   — which is the honest floor and catches the 12 boards above.

Items 1–3 need nothing from CEE, and nothing blocks them.

⚠ I am NOT shipping a mint fix: the resolver is correct (see the correction above). The open
question I am leaving on the record is narrower — **which path minted `cap = 140` with no
provenance on 20 Sep, and can it still run?** That is a producer-lane question, not a canvas
one, and it does not gate anything you ship.
