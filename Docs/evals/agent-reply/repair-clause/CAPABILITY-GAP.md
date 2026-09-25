# The run's constraint repair names a capability the OpenAI Agent lane does not have

Recorded 25 Sep 2026, about 02:12Z, while RC's repair probe (5825466265) runs on served `e39f6e0`. This is a **source finding**. The probe result is appended below when it lands.

## The ask the user sees
The run says: "Tell me which part of your model it applies to and I will record it there; this one stays on the model. Then run the analysis again."
- **Where it comes from:** `src/orchestrator-v5/coaching/constraint-gap-copy.ts`, via `unmeasuredTargetRepairAsk` and `unmeasuredTargetRepairStep`. It appears in the `analysis_result` block's `summary`.
- **What its own docstring says:** "'I will record it there' is a live capability (`add_constraint`, a registered V5 handler …)".

## What the OpenAI Agent lane can do (staging `e39f6e0`, `agent-tools.ts`)
- **The Agent's tools:** `get_canonical_state`, `propose_model_change`, `authorise_change`, `run_analysis`, `build_model_from_brief`, `propose_assumptions`, `propose_new_option`, `propose_option_interventions`, `propose_starting_point`.
- **`propose_model_change`** takes only `{from_label, to_label, direction, rationale}`, which means it can only add a link.
- **There is no `add_constraint`,** and no way to move a limit onto another model part.

## Consequence
- On this lane, the repair is **a remedy in copy with no reachable control**. The user answers "it applies to churn", but the Agent has no write that can record it. The limit stays unchecked on the re-run.
- **#1872** (the C3-copy PR) makes the Agent relay that repair faithfully (4/16 → 11/16). That is more truthful than the invented fixes it replaces, but it relays a promise the lane cannot keep.
- **The fix is either:**
  - a constraint-binding capability in the Agent lane (Runtime's files, `agent-tools.ts` and `agent-capabilities.ts`); or
  - repair copy that, on the Agent lane, names only what the lane can do.

## Probe result (served `e39f6e0`, about 02:20Z; OpenAI only on every turn)
**Sequence:** construction → chip approval → Run 1 → the user answers the repair ("The limit applies to <the model's own node>.") → Run 2.

| Journey | Run 1 | Answer turn | Run 2 |
|---|---|---|---|
| Pricing ("…applies to Monthly churn.") | unchecked (`constraint_verdict_withheld`) | `get_canonical_state` only; no write; no control. "That is already how the model is connected … the analysis produces a modelled *change* in churn, while your limit is an absolute level" | **still unchecked** |
| Hiring ("…applies to Annual salary spend.") | unchecked | `get_canonical_state` only; no write. "That link is already present … annual salary spend is … derived … with an assumed starting value of £0/year. Does the cap cover incremental salaries only, or total company payroll?" | **still unchecked** |

**What was already there:** in both journeys, the limit is **already bound** to the node the user names (`goal_constraints[].node_id` = `monthly_churn` or `annual_salary_spend`).

**Correction to the source finding above:** the missing tool is not the first failure. The binding already exists.

**The first remaining failure:** the constrained node is **derived, with no measured starting level**. Churn is modelled as a change; salary spend starts at an assumed £0/year.
- So the limit cannot be scored whichever part the user names.
- The run's repair ask ("which part of your model it applies to") is a **dead end** in both standard journeys.
- **The real missing input is the level or frame:** the current churn level, or whether the cap covers incremental or total payroll. That is what the hiring Agent asked, and what the so-called invented fixes pointed towards.

**A second defect in passing:** the user said "under 4%", but the stored operator is `<=` (label "Monthly churn < 4percent", operator "<=").
