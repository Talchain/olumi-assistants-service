# Draft graph v192b targeted benchmark report

**Date:** 2026-04-15
**Model:** claude-sonnet-4-6 (production)
**Baseline:** draft_graph_v192a
**Run status:** Blocked — Anthropic API credit exhaustion
**Verdict:** Pending — benchmark ready to re-run once credits are replenished

---

## Status

All 90 benchmark attempts (3 runs × 15 fixture variants × 2 duplicate model configs) returned `invalid_request: credit balance is too low`. This is the same credit exhaustion that blocked run 3 of both the v190c and v192a benchmarks on 2026-04-14.

The v192b prompt file has been deployed and verified. The benchmark run is configured and will execute immediately once Anthropic API credits are replenished using the `--resume` flag or a fresh run.

---

## What was completed

### Task 1: Prompt deployed and verified

File: `tools/graph-evaluator/prompts/draft_graph_v192b.txt`
SHA-256: `732558af807329e6cd3c3799a553be6dab046c9c78c2ce1bd6411f667eac965b`
Lines: 903 (vs 896 in v192a)

All three required strings confirmed present:

| String | Present |
|---|---|
| `PATH VERIFICATION` | Yes (1 occurrence, step 8) |
| `Path completeness takes priority` | Yes (1 occurrence, step 8) |
| `baseline-equal edge` | Yes (1 occurrence, contrastive examples) |

### v192b changes vs v192a

Three targeted fixes, no other changes:

1. **PATH VERIFICATION step** added to CONSTRUCTION_FLOW step 8, immediately after the SELECTIVE WIRING CHECK. Explicit instruction: "If removing a structural edge would break an option's only path to the goal, keep the edge."

2. **Precedence hierarchy** stated explicitly: "Path completeness takes priority over selective wiring. Selective wiring takes priority over decorative density."

3. **Contrastive example** added to CONTRASTIVE_EXAMPLES showing:
   - BAD: Status Quo's only controllable edge removed by selective wiring → no path to goal
   - GOOD: Edge retained because it is the only path connecting Status Quo to the goal

4. **FINAL_AUDIT exception** broadened: the selective wiring audit item now explicitly exempts "any edge whose removal would leave an option with no complete path to the goal."

---

## Benchmark configuration (ready to run)

```bash
cd ~/Documents/GitHub/olumi-assistants-service

CASES="03-vague-underspecified,03-vague-underspecified 2,05-product-feature,05-product-feature 2,06-operations-warehouse 2,08-channel-strategy,09-nested-subdecision 2,15-thin-hiring,15-thin-hiring 2,15-thin-hiring 3,23-external-factor-heavy,23-external-factor-heavy 2,23-external-factor-heavy 4,24-bundled-goal-decomposition 3,24-bundled-goal-decomposition 4"

npx tsx tools/graph-evaluator/src/cli.ts \
  --type draft_graph \
  --prompt tools/graph-evaluator/prompts/draft_graph_v192b.txt \
  --models claude-sonnet-4-6 \
  --cases "$CASES" \
  --runs 3
```

Spot-check command (non-affected fixtures):
```bash
npx tsx tools/graph-evaluator/src/cli.ts \
  --type draft_graph \
  --prompt tools/graph-evaluator/prompts/draft_graph_v192b.txt \
  --models claude-sonnet-4-6 \
  --cases "01-simple-binary,02-multi-option-constrained,04-conflicting-constraints,16-rich-saas-pricing,20-currency-euro" \
  --runs 2
```

---

## Expected results (based on v192a analysis)

The 15 affected fixture variants produced 21 `OPTION_NO_GOAL_PATH` violations in v192a, all absent from v190c. The hypothesis from the v192a investigation is that selective wiring removed the only goal-path structural edge for certain options, particularly in:

- **Thin-brief expansions** (03-vague-underspecified, 15-thin-hiring): model adds widened options with no direct baseline intervention, leaving them path-incomplete
- **External-factor-heavy briefs** (23-external-factor-heavy): larger graphs where some option→factor edges were pruned, breaking connectivity
- **Complex multi-option graphs** (05-product-feature, 06-operations-warehouse, 08-channel-strategy, 09-nested-subdecision, 24-bundled-goal-decomposition): similar selective-wiring over-pruning

The PATH VERIFICATION step directly addresses this: by making path completeness an explicit priority before emitting the final edge set, the model should retain the minimum structural edges needed for connectivity.

### Pass criteria once run

| # | Criterion | Target |
|---|---|---|
| 1 | OPTION_NO_GOAL_PATH violations on 15 affected fixtures | ≤2 (from 21 in v192a) |
| 2 | No new violation types not present in v192a | Pass |
| 3 | No fixture mean score regression >0.03 vs v192a | Pass |
| 4 | FORBIDDEN_EDGE count does not increase vs v192a | ≤19 (from 19 in v192a) |

---

## Affected fixtures reference

From v192a analysis:

| Fixture variant | v192a violations | v190c violations |
|---|---|---|
| 03-vague-underspecified | 3× OPTION_NO_GOAL_PATH | 0 |
| 03-vague-underspecified 2 | 1× OPTION_NO_GOAL_PATH | 0 |
| 05-product-feature | 1× OPTION_NO_GOAL_PATH | 0 |
| 05-product-feature 2 | 1× OPTION_NO_GOAL_PATH | 0 |
| 06-operations-warehouse 2 | 1× OPTION_NO_GOAL_PATH | 0 |
| 08-channel-strategy | 1× OPTION_NO_GOAL_PATH | 0 |
| 09-nested-subdecision 2 | 1× OPTION_NO_GOAL_PATH | 0 |
| 15-thin-hiring | 1× OPTION_NO_GOAL_PATH | 0 |
| 15-thin-hiring 2 | 3× OPTION_NO_GOAL_PATH | 0 |
| 15-thin-hiring 3 | 1× OPTION_NO_GOAL_PATH | 0 |
| 23-external-factor-heavy | 2× OPTION_NO_GOAL_PATH + 1× FORBIDDEN_EDGE | mixed |
| 23-external-factor-heavy 2 | 2× OPTION_NO_GOAL_PATH | 0 |
| 23-external-factor-heavy 4 | 2× OPTION_NO_GOAL_PATH | 0 |
| 24-bundled-goal-decomposition 3 | 1× FORBIDDEN_EDGE;OPTION_NO_GOAL_PATH | mixed |
| 24-bundled-goal-decomposition 4 | 1× OPTION_NO_GOAL_PATH | 0 |
| **Total** | **21** | **0** |

---

## Next steps

1. Replenish Anthropic API credits.
2. Run the targeted benchmark using the commands above.
3. Update this report with actual results and verdict.
4. If OPTION_NO_GOAL_PATH violations drop to ≤2: promote v192b to PMS as shipping candidate; run full benchmark to confirm grand mean and no new regressions.
5. If violations persist: inspect response.json files for the failing fixtures to determine whether the model is citing the PATH VERIFICATION step in its topology_plan (proxy for whether the instruction is being followed).
