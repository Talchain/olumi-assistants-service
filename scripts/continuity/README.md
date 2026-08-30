# Continuity harness

A standing measurement of whether Olumi's reasoning survives a turn boundary.

```bash
node scripts/continuity/run.mjs                    # whole battery
node scripts/continuity/run.mjs --only ask-answer-referent
node scripts/continuity/run.mjs --replays 3        # assess determinism
node scripts/continuity/run.mjs --list
```

Exit codes: **0** all passed · **1** a case failed (a real product defect) ·
**2** could-not-measure. **2 is never a pass.**

---

## What it is for

Four behavioural failures were caught by hand on 30 Aug 2026. Three of them are
one seam and one is independent:

| Seam | Cases | Mechanism |
|---|---|---|
| **A — the discourse ledger** | `ask-answer-referent`, `pronoun-identity`, `edit-rerun-consequence` | Facts that live only in the shape of the previous turn — the slot just asked about, the entity just named, the run just compared — have no durable home. Consumers fail closed, so a missing record becomes a *confident generic answer* rather than a visible gap. |
| **B — one array, two questions** | `post-analysis-grounding` | A disclosure list is de-duplicated by warning code (right for "which sentences?") and then counted by a consumer asking "how many factors?". Crosses an untyped passthrough, so no contract check catches it. |

The four cases that PASSED are in the battery too. **The passes are the
regressions that matter** — a harness that only encodes today's failures is
silent on the day one of today's successes breaks.

## Two tiers, neither replacing the other

- **Tier 2 — this directory.** Drives the deployed product at
  `POST /proxy/v5/turn` with the UI's Origin, in fresh guest scenarios. Sees
  real flag posture and real model composition. Cannot run per-PR.
- **Tier 1 — `src/orchestrator-v5/__tests__/continuity/`.** Runs in the repo's
  named gate. A *derived* ledger-coverage guard, plus a self-check that proves
  this harness's own instruments can fail. Cannot see deployed behaviour.

## The rules this harness enforces by construction

Not conventions — the runner refuses to proceed when any of these is unmet.

1. **The build is derived, never inherited.** `/healthz` is read and compared;
   a mismatch voids the run.
2. **The redactor is proven before the first capture**, with a positive control
   (a JWT-shaped string must be destroyed) *and* a contrast control (ordinary
   prose must survive). A redactor that eats everything is as broken as one
   that eats nothing.
3. **A case with no control cannot run.** `validateCaseShape` rejects it.
4. **Precondition and discrimination are gates, not assertions.** Failing
   either yields `COULD_NOT_MEASURE` — never `PASS`, never `FAIL`.
5. **Byte-identical arm and control = void.** `not.toEqual` passes when both
   sides are empty; that defect is designed out.
6. **Split replays are a finding**, reported as a distribution and voided,
   never majority-voted.
7. **A trailing global control** must still discriminate at the end of the run.
   If it stops, the whole run is void.

## Anatomy of a case

Every case declares an arm, a **discriminating control that should produce the
opposite outcome**, and a precondition pinned in-test.

```
setup()        → build both worlds (retrying until each is ACHIEVED, not assumed)
precondition() → assert the payload WOULD trigger the behaviour
arm()          → the probe
control()      → the same probe in the opposite world
assertArm()    → what must be true
assertControl()→ what must be true *differently*
diagnostic()   → informational only; never changes a verdict
```

### Why worlds are *achieved*, not assumed

The first live run of this harness **voided itself**. The same brief that had
produced `analysis_ready.status === 'ready'` minutes earlier produced
`needs_user_input` instead — the drafter is non-deterministic about which values
it infers. `draftUntil()` now retries until the required world is reached, and
the precondition still asserts it was. This is not a weakened assertion: it
moves the world from assumed to achieved, so a red means *the product got it
wrong* rather than *the drafter rolled differently today*.

That the harness caught this in its own fixtures, on its first run, is the
design working.

## Wire contract, derived not inherited

Sending `{}` and then deliberately invalid values made the B1 validator
enumerate its own requirements at `caceba1a`:

```
kind        message | system_event
turn_id     uuid          scenario_id uuid
stage       frame | analyse | decide | review
turn_class  frame | clarify | propose | decide | review
source      composer | chip | chip_click | retry
message     string
```

**No graph is sent.** CEE reloads its own persisted graph. Sending one would
fabricate a continuity the product does not have — the precise thing this
harness exists to detect.

### Two field locations that are easy to get wrong

- `analysis_ready` is a **top-level response key**; `analysis_result` is a
  **block type**. Both are real, at different levels.
- Blockers live at **`analysis_state.readiness.blockers`**. There is no
  `analysis_ready.blockers` — a precondition pinned there reads `undefined`,
  compares falsy, and silently pins nothing.

## Status rung

Everything this harness produces is **WIRE-WITNESSED**. No case drives a
browser, so nothing here is JOURNEY-WITNESSED, and a UI render question (does a
confirmation hold emitted with an error shape display as a fault?) is outside
what it can answer. Claims are reported with that rung attached.

## Evidence

Each run writes `scripts/continuity/evidence/<timestamp>-<build>/` containing
every request/response capture (redacted at capture time) and a `report.json`
carrying verdicts, replay distributions, state classes, and the derived build.

State classes are recorded per case (`fresh` / `seeded` / `replayed`): a seeded
session is not evidence about a fresh user.
