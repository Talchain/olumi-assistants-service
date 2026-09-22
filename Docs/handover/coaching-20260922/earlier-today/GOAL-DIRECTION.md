# The product ranks "reduce" goals backwards — and ISL's fix is already live

**Measured 21 Sep 2026 against deployed `isl-staging` (`build: c00f507`), deployed PLoT
`350b0fb6`, deployed CEE `e717e19d`.**

## Verdict

For any decision whose goal is a **quantity to reduce** — cost, churn, risk, time —
the product today ranks the option that makes it **worst** as the leader.

ISL shipped the mechanism to fix this. **Nobody upstream sends it.**

## The measurement

Goal node labelled "Monthly churn"; one lever; two options. One variable.

| `goal_direction` | winner | win probability | warning |
|---|---|---|---|
| **absent — today's behaviour** | `opt_high` (**maximises churn**) | 0.98125 | `GOAL_DIRECTION_UNATTESTED` |
| `'minimise'` | `opt_low` | 0.98125 | — |
| `'maximise'` | `opt_high` | 0.98125 | — |

`maximise` is byte-identical to absent, which proves the default is `maximise`.
`minimise` flips the ranking completely. The warning clears when the field is stamped.

## The gap, stated exactly

ISL's deployed request contract carries:

```
goal_direction: 'maximise' | 'minimise' | 'target' | null
```

> *"'minimise' = smallest wins — required whenever the goal is a quantity to reduce
> (cost, churn, risk), where the historical rule crowned the worst option."*

Occurrences of `goal_direction` at the deployed shas:

| Repo | Sha | Occurrences |
|---|---|---|
| ISL | `c00f507` | supported, and honoured — measured above |
| **PLoT** | `350b0fb6` | **0** |
| **CEE** | `e717e19d` | **0** |

Contrast control, same trees and method: `goal_threshold` has 211 occurrences in PLoT,
`include_voi` 15. The probe sees fields that are there.

`GOAL_DIRECTION_UNATTESTED` fired on **every** analysis measured today, live and probe alike.

## Why this matters more than it looks

The estate already documented the underlying defect — `objective-contradiction.ts` records a
14 Aug investigation finding that *"the option comparison never evaluates the user's stated
objective"*, with a measured control:

```
no target                      : hold 0.7067 | raise_small 0.0152 | raise_big 0.2782
goal_threshold=0.3 delta       : hold 0.7067 | raise_small 0.0152 | raise_big 0.2782
CONTROL (flip churn edge sign) : hold 0.2845 | raise_small 0.0165 | raise_big 0.6990
```

and the headline: *the option reported as winner with 70.67% carries
`probability_of_goal = 0.0`*.

That module **makes the contradiction visible; it does not fix it**, and it records the fix
as *"goal decomposition, a four-service change"*.

**That estimate is now out of date.** ISL has unilaterally built and deployed the receiving
end. The remaining work is two changes, not four services:

1. **PLoT** — forward `goal_direction` on the ISL request (one field on the type, one line in
   `translator-v3.ts`, mirroring how `value_frame` was added).
2. **CEE** — determine the goal's direction and send it.

## CEE already has the classifier

`objective-contradiction.ts` ARM A (`detectDirectionalContradiction`) already reads a goal
label to establish intended direction, and it was built to this estate's NL-predicate rules:

- corpus from **outside the author's head** — 73 real goal-node labels harvested by script
  from every fixture and live capture in the repo;
- a confusion matrix in `__tests__/objective-contradiction.corpus.test.ts`;
- every case has an opposite-direction twin;
- **UNDETERMINED is the default** and the surface is silent where direction cannot be
  determined.

That last property is exactly what makes it safe as a `goal_direction` source: it declines
rather than guesses, and an omitted field reproduces today's behaviour precisely.

## ⛔ The risk that governs sequencing

A **wrong** direction inverts the ranking — strictly worse than today, because today's error
is at least consistent. So:

- send `goal_direction` **only** where the classifier is determinate; omit it otherwise;
- the PLoT passthrough is inert until CEE sends something, so it can land first and alone;
- pair the first wire-up with the existing `objective-contradiction` disclosure, per that
  investigation's own sequencing warning: *"never ship the target wiring without the copy in
  the same wave."*

## Bearing on the coaching doctrine

Olumi may say an option is *most likely to achieve their goal*. Today that sentence rests on
an assumption ISL states it is making and nobody has attested — and for a reduce-goal it is
inverted. This is the single cheapest change that makes that claim true.

---

## Status: PLoT half built

Branch `feat/goal-direction-passthrough` in a fresh clone of `staging` (`350b0fb6`).

- `goal_direction` on the ISL request type, request-gated forwarding
- `parseGoalDirection` declines anything unrecognised rather than defaulting
- the `'target'` sense is dropped unless `goal_threshold` **and**
  `goal_threshold_frame` are both present, because ISL refuses an unsatisfiable
  target at parse with a **422 that fails the whole analysis**, not just the direction
- both request gates (preValidation allowlist + Ajv `additionalProperties:false`)
  and `contracts/openapi.yaml`, which the drift gate holds to exact equality
- `RunRequestV3.goal_direction` — caught by typecheck, not by my tests, because
  the tests call the translator directly rather than the route

**Evidence:** RED 18/18 at base → GREEN 18/18. Four mutants, all killed, each by a
different targeted subset:

| Mutant | Failed | What it proves |
|---|---|---|
| remove the `target` guard | 2 | the guard is load-bearing |
| default to `'maximise'` when unattested | 1 | **the "omits the key" test is not vacuous** |
| `parseGoalDirection` accepts any string | 3 | the decline list discriminates |
| guard fires on `minimise` instead of `target` | 4 | the guard is specific to `target` |

Isolation proved by writing a sentinel. `lint` 0, `typecheck` 0.
`multi-constraint.test.ts` has **11 failures at base as well** (`spawnServer`) —
control run, pre-existing, not caused by this change.

## The CEE half — the classifier already exists

`objective-contradiction.ts:384` exports

```ts
deriveGoalIntent(goalLabel: unknown): GoalIntent
// GoalDirection = 'increase' | 'decrease' | 'undetermined'
```

backed by three corpus test files, including a 73-label corpus harvested by script
from real fixtures and captures, and a reviewer corpus. The mapping is direct:

| `deriveGoalIntent` | `goal_direction` |
|---|---|
| `'increase'` | `'maximise'` |
| `'decrease'` | `'minimise'` |
| `'undetermined'` | **omit the key** — today's behaviour, unchanged |

`'undetermined'` being the classifier's default is exactly what makes this safe: it
declines rather than guessing, and an omitted key reproduces current behaviour
byte-for-byte.

⚠ Per that investigation's own sequencing warning, the first wire-up should ship in
the same wave as the existing `objective-contradiction` disclosure.
