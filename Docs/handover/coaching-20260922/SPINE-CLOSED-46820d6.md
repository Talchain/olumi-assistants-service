# The conventional spine is closed — all six behavioural criteria witnessed on deployed staging

**22 Sep 2026 · served `46820d6` (#1688 merged 16:57:01Z) · signed-in · 0 SKIP**

```
### 28 PASS · 3 FAIL · 0 SKIP   on build 46820d6
1=PASS · 2a=PASS · 2b=PASS · 3=PASS · 4=PASS · 5=PASS · 6=PASS · 7=FAIL
```

**Every criterion of the goal's behavioural list passes on `/orchestrate/v2/turn`.**
The only failures are criterion 7 — whether a user *reaches* that route — which
is a release-control decision, not an implementation gap.

## The discriminating witness, one build, both arms

`witness/replay-vs-conflict.mjs` — **11 PASS · 0 FAIL**, against a validated
baseline of **6 PASS · 5 FAIL** on the unfixed build. A green run here is
meaningful because the probe was shown to fail first.

| arm | row | before | after |
|---|---|---|---|
| REPLAY | reconciles to current state (17) | FAIL | **PASS** |
| REPLAY | ⭐ original receipt **PRESERVED** | PASS | **PASS (held)** |
| CONFLICT | does not claim the new value applied | FAIL | **PASS** |
| CONFLICT | states plainly it did not make the change | FAIL | **PASS** |
| CONFLICT | `graph_patch` not `applied` | FAIL | **PASS** (`noop`) |
| CONFLICT | ⭐ prior receipt **ABSENT** | **FAIL (LEAKED)** | **PASS** |

⭐ **The pair is the evidence.** A build that collapsed replay and conflict into
one behaviour would fail one of the two starred rows. They move in opposite
directions, which is exactly what the fix had to achieve.

## What #1688 landed

1. a reused operation id **refuses truthfully** instead of narrating an edit it
   did not make;
2. the reconciliation guard uses the **resolved store**, so the reread is no
   longer dead on the deployed default path (it was testing the optional
   parameter, which the real route never passes);
3. a conflict no longer hands back the **prior operation's receipt** on either
   carrier — found by release control's exact-head review, confirmed by me on
   the wire as `model_version_receipt=LEAKED` before the fix.

## What remains, and it is not implementation

| rows | criterion 7 | owner |
|---|---|---|
| 2 | `/proxy/v5/turn` forwards to the agent route; a user cannot apply a model edit | `PROXY_V5_TARGET` decision |
| 1 | a model created on the user surface mints no receipt (`versions=0`, head `NULL`) — **control in the same run: the conventional route mints one** | agent-lane owner |
