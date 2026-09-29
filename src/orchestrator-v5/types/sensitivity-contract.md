# Sensitivity sign contract — PLoT → CEE

**Status:** Documentation only (Phase 2 workstream D). No adapter
normalisation is performed in CEE. Producer-side inconsistencies have
been identified and escalated; this document captures the current
contract as it stands at the outer-envelope boundary.

## Outer-envelope convention (CEE consumes this)

The fields CEE reads from the PLoT response envelope follow this
convention:

| Field path                                 | Sign convention                                    |
| ------------------------------------------ | -------------------------------------------------- |
| `factor_sensitivity[*].elasticity`         | **Unsigned magnitude** ∈ [0, ∞).                   |
| `factor_sensitivity[*].direction`          | `'positive'` \| `'negative'` \| `'neutral'`.       |
| `decision_brief.top_drivers[*].direction`  | `'positive'` \| `'negative'` \| `'neutral'`.       |

Semantics:

- `direction === 'positive'` → the factor increases the leading
  option's win probability when its value increases.
- `direction === 'negative'` → the factor decreases the leading
  option's win probability when its value increases.
- `direction === 'neutral'` → no significant effect (or below the
  reporting threshold).

The signed display value used inside CEE for prose and chips is:

```
sensitivity_value =
    direction === 'neutral'  ? 0
  : direction === 'negative' ? -elasticity
  :                            elasticity
```

`neutral` maps to `0` — it has **no directional signal**, so the near-zero
influence band renders "has little effect" rather than a strengthen/weaken
claim. It must NOT fall through to the positive branch.

This rule is the shared `resolveInfluenceDirection` / `toSignedInfluenceValue`
pair in
[`src/orchestrator/context/influence-direction.ts`](../../orchestrator/context/influence-direction.ts),
used by both derive paths (`deriveTopDrivers`,
`deriveTopDriversFromTopLevel`) and both sign-reattachment sites
([`context-pack-assembler.ts`](../context/context-pack-assembler.ts)
`projectAnalysis` and the chip-click dispatch) — never re-implement it
locally. The decision-review-enricher passes raw `elasticity` + `direction`
through unchanged; consumers (the decision-review prompt) re-apply the sign on
their side.

## Inner-envelope (ISL) convention — DO NOT consume directly

Inside the envelope, `_meta.payloads.isl_response.factor_sensitivity[*]`
uses a **signed elasticity** convention (negative magnitude for
`direction: 'negative'` entries). This is the raw ISL output and is
**not** the contract surface CEE reads. Consuming this field directly
would double-invert the sign relative to the outer-envelope contract.

CEE intentionally only reads top-level paths
(`factor_sensitivity`, `top_drivers`, `decision_brief`) — never the
nested `_meta.payloads.*` debug bundles.

## Known producer-side inconsistency (escalation)

A staging capture (`tests/fixtures/cross-service/v5-turn.run-analysis.staging.json`)
shows the following internal contradiction:

- `factor_sensitivity[*]` reports 3 of 5 factors with
  `direction: 'negative'`.
- `decision_brief.top_drivers[*]` reports all 5 factors with
  `direction: 'positive'`.

Both arrays describe the same set of factors. They cannot both be
correct. The CEE side honours the convention as documented above and
ships consistent prose for whichever surface it reads, but **the two
PLoT-side surfaces disagree with each other**.

A contract test (`tests/contract/sensitivity-sign-contract.test.ts`)
asserts the inconsistency on the captured fixture so future CEE work
sees a pinned reproduction. The fix is producer-side and out of scope
for Phase 2.

## What CEE deliberately does NOT do

- **No sign normaliser** in the decision-review-enricher. Adding one
  would risk double-inverting if the producer ever fixes the inner
  signed-elasticity vs outer unsigned-elasticity inconsistency.
- **No adapter logic** that papers over `top_drivers` vs
  `factor_sensitivity` direction disagreements. CEE picks the
  authoritative source per surface (`factor_sensitivity` for prose
  drivers; `top_drivers` only when a decision-brief surface explicitly
  reads it) and lets the producer-side inconsistency surface to ops.

## Test coverage

- [`tests/contract/sensitivity-sign-contract.test.ts`](../../../tests/contract/sensitivity-sign-contract.test.ts)
  — pins the negation rule (`direction === 'negative'` → `-elasticity`)
  and the producer-inconsistency reproduction on the staging fixture.
- [`src/orchestrator-v5/context/__tests__/context-pack-assembler.test.ts`](../context/__tests__/context-pack-assembler.test.ts)
  — pre-existing coverage for the `top_drivers` projection path.
