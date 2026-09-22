# #1679 deployed — criterion 5 PASSES, and it passed for the RIGHT reason

**22 Sep 2026 · deployed `c6f6dec` (staging `c6f6decb4e54fc77e06e367d57428955e2eec900`) · signed-in · 0 SKIP**

```
### 20 PASS · 5 FAIL · 0 SKIP   on build c6f6dec
criterion roll-up: 1=PASS · 2a=PASS · 2b=FAIL · 3=FAIL · 4=PASS · 5=PASS · 6=PASS
```

| build | assertions | result |
|---|---|---|
| `c12a54d` | 22 | 16 / 6 |
| `a459d23` (#1686) | 25 | 19 / 6 |
| **`c6f6dec` (#1679)** | 25 | **20 / 5** |

## The row that matters, and why its *detail string* is the evidence

```
PASS [5] the two reads never silently disagree — refused truthfully, no mixing
```

⭐ **This is the row that would have lied.** The original assertion was
`diverged ? FAIL : PASS`, where `diverged` was falsy whenever the `run_analysis`
handler-fact row was missing — and a refusal, which is exactly what #1679
introduces, plausibly writes no such row. **The fix's success state and the
probe's blind spot were the same observation.** It would have gone green after
this deploy without proving anything.

It now classifies explicitly, and `INDETERMINATE` is a **FAIL**. The detail
string says `refused truthfully, no mixing`, which means it matched the
**refusal copy** — *"Your model changed while this analysis was being prepared,
so I stopped rather than mix two versions of it."* — not the absence of data.

Two things are therefore witnessed at once:

1. **Criterion 5 of the goal is met on deployed staging** — one analysis turn
   cannot silently mix model revisions.
2. **The composed refusal survives egress.** This estate has five egress layers
   that delete `assistant_text` and three that rewrite it, and two lanes have
   shipped copy that never reached the exit. The pre-merge probe on a sibling
   cause predicted it would carry; the deployed run confirms it on the real one.

## What remains — 5 rows, two PRs, no residue

| rows | criterion | owner |
|---|---|---|
| 3 | **2b** replay narrates an edit it did not make | **#1685** — green at `4cd3ee29…`, awaiting verdict |
| 2 | **3** a reused turn_id claims the new value was applied | **#1688** — stacked on #1685 |

Nothing regressed: the 19 that passed on `a459d23` still pass, including the
capped-scale corruption control (`persisted value=0.2`, untouched) and
`a reused turn_id writes nothing` — the durable key still holds, which #1688
must not weaken while fixing the narration.

**Status rung: JOURNEY-WITNESSED on deployed staging, 22 Sep 2026** — criteria
1, 2a, 3(concurrent), 4, 5, 6.


---

## ⛔ A hole in this very witness, found straight after the deploy

Criterion 5 exercises the **diverged** case only. **A build whose refusal fired
on EVERY analysis would satisfy every row above and still be catastrophic** — the
witness would read 20/5 while no user could obtain a result at all. A
target-passes assertion is worth nothing without a control that proves the probe
can tell the two apart.

Measured on `c6f6dec`, plain analysis, no concurrent edit:

```
HTTP 200
blocks: analysis_result, coaching, ui_directive
handler fact row written : YES (56eacec6adfe)
analysis_ready.freshness : fresh  reason=graph_hash_match
spuriously REFUSED       : false
"Move Upmarket to Enterprise scored highest against your goal in 68% of runs…"

HAPPY PATH INTACT: true
```

**#1679 did not over-refuse.** Two permanent rows now pin it (`5b`), taking the
harness to **27 assertions**:

- `CONTROL — an UNDISTURBED analysis still completes` (answered · not refused ·
  carries an `analysis_result` block · wrote a handler fact)
- `CONTROL — and reports itself FRESH`

⭐ This is the fourth time auditing the witness has found it weaker than it
looked, and the fourth time the correction made the number honest rather than
flattering.
