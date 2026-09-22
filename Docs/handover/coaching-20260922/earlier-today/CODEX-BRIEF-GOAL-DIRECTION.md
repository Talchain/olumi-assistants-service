# Review brief — `goal_direction`: the product ranks "reduce" goals backwards

Two branches, one capability. **Land in order or reject both.** CEE alone is a key PLoT
drops at its allowlist; PLoT alone is a passthrough with no producer. Neither changes any
wire byte on its own, which is deliberate — each is safe to sit unmerged, and safe to land
first.

| # | Repo | Branch | Head (40) | Required check |
|---|---|---|---|---|
| 1 | `plot-lite-service` | `feat/goal-direction-passthrough` | `3e3c3bad35fe49c8aebfc95a4cd03ec806d959da` | `safety` = success |
| 2 | `olumi-assistants-service` | `feat/goal-direction-minimise-only` | `88906ce9399006d05fec4af7c9b8a1be5fd43915` | `Lint, TypeCheck, Unit Tests` = success |

⚠ `Graph Evaluator (advisory)` is RED on #2 — **it is RED on staging's own head `e717e19d`
too** (control run). Advisory, pre-existing, unrelated. Do not gate on it and do not add it
to the shrink-only ratchet.

## The defect

ISL's deployed contract (`build c00f507`) accepts
`goal_direction: 'maximise' | 'minimise' | 'target'` and honours it. Neither CEE nor PLoT
sent it — 0 occurrences at both deployed shas, against a 211-occurrence `goal_threshold`
contrast control. So ISL ran the maximiser UNATTESTED on every analysis, and for a goal
that is a quantity to reduce that crowns the WORST option. ISL says so in its own contract
text: *"required whenever the goal is a quantity to reduce (cost, churn, risk), where the
historical rule crowned the worst option."*

Measured directly against `isl-staging`, goal node "Monthly churn", one variable, seed 7,
400 samples:

```
absent      : opt_high 0.98125   <- the option that MAXIMISES churn leads
'minimise'  : opt_low  0.98125   <- the ranking flips
'maximise'  : opt_high 0.98125   <- byte-identical to absent (the CONTROL)
```

## What I most want attacked

**1. The minimise-only asymmetry — is it right, or is it cowardice?**
I emit `minimise` and never `maximise`. My argument: `maximise` is byte-identical to sending
nothing, so it cannot improve an answer, while a misclassification would newly break an
increase-goal that is correct today. That makes exposure one-sided — increase and
undetermined are untouched, and the only class that changes is the one that is 100% wrong
now. **Argue the opposite if you think explicit attestation is worth having on every run**
(e.g. so ISL's warning clears and operators stop seeing `GOAL_DIRECTION_UNATTESTED`). I may
be trading a real signal for a safety property I overvalued.

**2. The `'target'` guard in PLoT.** ISL refuses an unsatisfiable `target` sense **at parse,
with a 422 that fails the whole analysis**, not just the direction. I drop `target` unless
`goal_threshold` AND `goal_threshold_frame` are both present. Check I have not inverted the
condition, and that dropping (rather than erroring) is the right call — my reasoning is that
it yields exactly today's outcome instead of an outage.

**3. The classifier's false-`decrease` rate is the whole risk.** A wrong direction INVERTS
the ranking, which is worse than today's consistent error. I reuse `deriveGoalIntent` rather
than writing a second classifier — it has a confusion matrix over 73 real harvested labels,
opposite-direction twins, and `undetermined` as default. **Please attack the case I could
not construct: a label that classifies `decrease` but whose goal is genuinely to increase.**
If one exists this is unsafe.

## Evidence already run, so you do not repeat it

- **RED-first:** PLoT 18/18 fail at base → 18/18 pass. CEE 23/23 pass, with the prose
  measured before and after.
- **PLoT mutants, 4/4 killed**, each by a different subset: removing the `target` guard (2
  fail), defaulting to `maximise` (1 fail — this one specifically proves the "omits the key"
  test is not vacuous), accepting any string (3), guard on `minimise` instead of `target` (4).
- **CEE mutants, 4/4 killed after a fix.** ⚠ **M4 SURVIVED first time** — dropping the
  blank-label guard left every end-to-end assertion green, because a blank label reaches the
  classifier and washes out to the same `undefined`. `readGoalLabel` is exported and promises
  `null`; nothing pinned it. I added discriminating cases at that boundary and it now dies
  (3 failures). Recorded because it is a real coverage lesson, not a clean sweep.
- **Isolation** proved by writing a sentinel, both repos. Lint 0, typecheck 0 both sides.
- **Controls run:** `multi-constraint.test.ts` has 11 failures **at base as well**
  (`spawnServer`, pre-existing). `Graph Evaluator` red on base. Neither is mine.
- **The drift gate** holds `V2_RUN_ALLOWED_KEYS` to exact equality with
  `contracts/openapi.yaml`; both updated. `structural-keys.generated.ts` regenerated with
  `tools/gen-structural-keys.mjs` (one line) — the pre-push validator caught that, my tests
  could not, because they call the translator rather than the route.

## What I could NOT verify

- **No live witness of the two landed together.** Each is inert alone by design, so the
  end-to-end flip is proven only on my direct ISL probe, not through the product.
- **`GoalDirectionType` is defined locally in PLoT.** `@talchain/schemas` 0.55.0 exports
  `GoalThresholdFrame` but has **no** `GoalDirection` (verified against the vendored tarball
  with `GoalThresholdFrame` as contrast control). It should move to the shared package when
  this lands — flagging rather than hiding it.
- **Sequencing.** The August objective-contradiction investigation warns: *"never ship the
  target wiring without the copy in the same wave."* The existing contradiction disclosure is
  already live, so I believe that is satisfied — **please confirm**, because if it is not,
  a user could see a flipped ranking with no explanation of what changed.
