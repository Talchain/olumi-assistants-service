# The Agent cannot see the analysis's sensitivity ranking when a user asks what to challenge (25 Sep 2026, about 03:50Z)

## Structural gap (source, at staging `21e3b38`)
- `get_canonical_state` returns `analysis: g.analysis_state` (`agent-capabilities.ts:694`). `analysis_state.robustness` comes from `composeRobustness` (`compose/analysis-state-v1.ts:843`), which carries at most `{ aggregate_level }`.
- There are **no drivers and no sensitivity**, even though the stored run has `enrichment.decision_brief.top_drivers` and `factor_sensitivity`.
- On the AQ-FMC D2 capture, the final model call's input has 0 occurrences of `top_drivers`, `factor_sensitivity` and `importance_rank`.

## Measured effect of projecting it (D2 final hop, gpt-5.6-terra, 3 reps per arm, identical instructions)
**The only change in arm D:** the stored `decision_brief.top_drivers` were added to the tool result's `analysis`. The drivers are Delivery capacity 1, Technical guidance quality 1, Onboarding load 0.25.

| Arm | Challenge pick | Mentions the ranking? |
|---|---|---|
| R (as served) | onboarding load, 3/3 (the 3rd-ranked driver) | 0/3; the pick is asserted |
| D (drivers visible) | onboarding load, 3/3 | at least 2/3, e.g. "delivery capacity and technical-guidance quality are equally influential, but onboarding is the most likely short-horizon constraint" |

## Reading
- Visibility makes the choice **transparent and grounded** (the Agent states the ranking, then argues its choice), but does **not change the pick**.
- The "most important, unsupported" defect the served judge flags (3/8 on `21e3b38`) is partly this: the Agent cannot ground a priority it cannot see.
- **Owner:** Runtime. This is the `get_canonical_state` projection, not AI Quality's to write.
- **Suggested enabling change:** add `top_drivers` (label, sensitivity, direction, value provenance), read from the persisted run, to the Agent's `analysis` view.
- **This is not a morning blocker.**
- **Files:** `drivers-probe/run.cjs`, `drivers-probe/out/`. 6 OpenAI calls.
