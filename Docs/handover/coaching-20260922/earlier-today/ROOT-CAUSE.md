# The 4% churn constraint — root cause, measured end to end (21 Sep 2026)

> **Rev 3.** Revs 1–2 named two defects that turned out not to exist. Both came from
> reading LOCAL working trees that were stale against deployed. Retractions at the bottom.
> Every claim below is measured at an endpoint, a deployed sha, or the database.

## Verdict

**Nothing in the chain is broken.** CEE extracts the limit, stamps the frame correctly,
PLoT normalises and forwards it, ISL receives it, and CEE's verdict machinery correctly
withholds the leading option and discloses the limit to the user.

The limit is **structurally unevaluable**, because its target node is a **factor**.

## The measured cause

Scenario `95703b18…`, the live 4% churn limit:

| Fact | Value | Source |
|---|---|---|
| `value_frame` | `'level'` | persisted `graph.goal_constraints` |
| `unit` / `provenance` | `'fraction'` / `'explicit'` | same |
| target node `ab78e513` | **`kind: 'factor'`** | persisted `graph.nodes` |
| `observed_state` keys | value, unit, raw_value, declared_scale, factor_type, source, extractionType, uncertainty_drivers | same |
| `observed_state.baseline` | **absent** | same |
| `data.baseline` | **absent** (`data` is empty) | same |

It therefore fails **two** of ISL's conversion rungs, independently:

1. `CONSTRAINT_NOT_CONVERTIBLE / missing_target_baseline` — a `level` frame needs
   `observed_state.baseline` on the target to convert into the samples' frame. It is absent.
2. `CONSTRAINT_NOT_CONVERTIBLE / target_parameter_uncertainty_shifts_base` — and even with
   a baseline it would still refuse, because PLoT synthesises a ParameterUncertainty for
   **every factor node with an observed value** (`translator-v3.ts:668`), and ISL will not
   convert a level against an origin that varies per sample.

CEE already knows rung 2 is unfixable by minting: `mintStatedTargetBaselines` excludes
factors by design — *"factors get a PLoT ParameterUncertainty that makes the conversion
refuse — a baseline is inert there (2.877 measured arm H)"*.

**So there is no path in the current architecture to evaluate a level constraint whose
target is a factor.** That is the root cause, and it is a cross-service design question,
not a patch.

## ISL's refusal ladder — measured directly against `isl-staging` (`build: c00f507`)

One variable, synthetic graph:

| `value_frame` | target node state | `constraint_analysis` | code |
|---|---|---|---|
| absent | — | ABSENT | `CONSTRAINT_FRAME_UNSPECIFIED` (`frame_not_stamped`) |
| `delta` | — | PRESENT | — |
| `level` | no `observed_state` | ABSENT | `CONSTRAINT_NOT_CONVERTIBLE` (`missing_target_baseline`) |
| `level` | `observed_state`, no `baseline` | ABSENT | `CONSTRAINT_NOT_CONVERTIBLE` (`missing_target_baseline`) |
| `level` | target carries a ParameterUncertainty | ABSENT | `CONSTRAINT_NOT_CONVERTIBLE` (`target_parameter_uncertainty_shifts_base`) |
| `level` | `observed_state.baseline`, **no PU on target** | **PRESENT** | — |

With the last row ISL answers **and discriminates between options**:
`opt_a prob_satisfied = 0.0075` vs `opt_b = 0.86`. That is the coaching answer the product
cannot currently give for this model.

⛔ **Do not stamp `delta` to silence the warning.** On the same graph `delta` returns
`prob_satisfied = 1.0` for **both** options — a confident, meaningless answer. ISL's refusal
is safer than a wrong number.

## The three candidate fixes — for a decision, not for me to pick

| | Change | Cost |
|---|---|---|
| **A** | ISL converts a level against a per-sample base | ISL refuses this on scientific grounds; its message says the origin varies per sample |
| **B** | PLoT does not synthesise a PU for a node that is a constraint target | loses `factor_sensitivity` for exactly the node the user cares most about |
| **C** | The model carries a limited quantity as an **outcome**, not a factor | model-compiler semantics; likely correct — a quantity you set a limit on and want scored is an outcome of the decision, not an exogenous input |

**C** looks right and is consistent with the architecture's own logic, but it belongs to the
Model Compiler domain, not this lane.

## Retracted from revs 1–2

- ❌ *"PLoT's constraint normaliser drops `value_frame`."* **False.** Deployed PLoT
  (`350b0fb6`) declares it (`engine-v3.ts:531`), preserves it through normalisation
  (`intervention-normaliser.ts:1485`) and the temporal filter (`constraint-filter.ts:213`),
  and forwards it by presence (`translator-v3.ts:1020`). Read from a stale local tree.
- ❌ *"PLoT pins `@talchain/schemas` 0.2.1 and cannot know about `value_frame`."* **False** —
  the deployed tip imports `GoalThresholdFrameType` from the package. Stale tree again.
- ❌ *"PLoT discards ISL's refusal reason."* **False** — `run.ts:3962` merges ISL's
  `inference_warnings` faithfully, carrying code, message, field and severity.
- ❌ *"`codes: []` reaching CEE is a defect."* **False, and it is by design.** CEE's
  `CONSTRAINT_NOT_DECISION_GRADE_CODES` deliberately excludes the ISL codes; the verdict is
  reached by **precedence rule 3** (a ratified constraint with no score) instead of rule 1,
  and the limit IS disclosed. Pinned by
  `run-analysis-unanchored-constraint-remedy.test.ts`, which states this in terms.

## Adjacent finding, not chased

`GOAL_DIRECTION_UNATTESTED` fires on **every** run measured today: *"No objective sense was
stated for the goal node, so options were ranked by largest goal value. That is an
assumption, not the team's stated aim."* The product ranks by "biggest number wins" without
being told the goal's direction. Worth its own root-cause pass.

## Method note

Three greps in this investigation ran against local working trees; **two of the three trees
were stale against deployed** (PLoT local `af990d46` vs deployed `350b0fb6`; CEE local
`710a75ee` vs deployed `e717e19d`). Every false finding in revs 1–2 came from those two
trees. Endpoint, deployed-sha and database measurements were unaffected. The error was
caught because the deployed tip already contained a comment naming the exact failure mode
I had just "discovered".

---

# Rev 4 — the mis-kinding is systematic, and it disables CEE's own fix

Rev 3 said the churn constraint fails because its target is a `factor`, and flagged that this
needed confirming across scenarios before anyone treated it as a compiler rule. Confirmed,
and it is worse than one scenario: **the same mis-kinding silently disables the mint CEE
already wrote to solve this.**

## Population (Supabase, 400 scenarios, 15–22 Sep)

| | |
|---|---|
| scenarios carrying any `goal_constraints` | **9 of 400** (2.25%) |
| constraints total | 10 |
| target kinded `factor` | 6 |
| target kinded `goal` | 4 |
| **target kinded `outcome` or `risk`** | **0** |
| target structurally downstream (has parents) but kinded `factor` | 5 |
| **targets carrying `observed_state.baseline`** | **0 of 10** |
| `value_frame` stamped `level` | 8 (2 unstamped) |

## The chain, each link measured

1. **Constraint targets are never kinded `outcome`/`risk`** — 0 of 10 live.
2. `mintStatedTargetBaselines` gates on exactly that
   (`compound-goals.ts:928`: `if (node.kind !== "outcome" && node.kind !== "risk") continue;`),
   so it is **structurally unable to fire on any constraint in the estate**.
3. Live telemetry agrees: `cee.compound_goal.target_baseline_minted` fired **0 times on every
   one of 7 days** sampled, while `extraction` ran 59–96/day and constraints were `integrated`
   1–5/day.
4. No baseline ⇒ ISL refuses a `level` constraint with `CONSTRAINT_NOT_CONVERTIBLE /
   missing_target_baseline` — the 100% blocker, applying to every constraint, not just churn.
5. For the 6 `factor` targets there is a **second, independent** refusal: PLoT synthesises a
   ParameterUncertainty for every factor with an observed value
   (`translator-v3.ts:668`), and ISL will not convert a level against a per-sample origin.

## Why this sharpens the fix

Rev 3 recommended option **C** (carry a limited quantity as an outcome, not a factor) on
architectural grounds. The measurement turns that from a preference into the single change
that unblocks the chain: kinding a downstream constraint target `outcome` simultaneously

- makes it eligible for `mintStatedTargetBaselines` (link 2),
- stops PLoT synthesising the PU that blocks conversion (link 5),
- and leaves ISL's level path with the baseline it requires (link 4).

⚠ The 4 `goal`-kinded targets are a **separate case** — goals have their own threshold mint
and are not served by this. They should not be swept into the same change.

⚠ **`baseline` is necessary but still not sufficient.** The mint is deliberately RELAY-ONLY:
it mints only from an actual present-state statement in the brief ("Churn is currently 12%").
Kinding the node correctly makes the mint *possible*; whether it *fires* then depends on the
brief stating a current level. That second question is unmeasured and should not be assumed.

## Probe note — an instrument defect found and fixed mid-measurement

The Render log API intermittently returns a bare `{"message": ...}` error. Parsed with
`d.get("logs", [])` that reads as **n=0, indistinguishable from a genuine absence** — a probe
reporting quiet when it is not. It produced three days of false zeros in this very
investigation before the contrast control caught it. `rlog2.sh` + `rlog_safe.py` now exit
non-zero on any response lacking a `logs` key, with a control proving the guard fires on the
error shape and passes a genuine empty result. **Every per-day count above was re-run through
the hardened probe.**
