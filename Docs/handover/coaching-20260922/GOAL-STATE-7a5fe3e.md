# Goal state — CEE `7a5fe3e`, UI `d299880b`, 22 Sep 2026

## Conventional route — COMPLETE AND WITNESSED

```
### 31 PASS · 0 FAIL · 0 SKIP   on build 7a5fe3e
1=PASS · 2a=PASS · 2b=PASS · 3=PASS · 4=PASS · 5=PASS · 6=PASS · 7=PASS
```

Every criterion of the completion condition, on the build users are served,
signed-in throughout so **no receipt row was vacuously skipped**. Plus the
discriminating replay-vs-conflict witness at **11 PASS / 0 FAIL**, whose two
starred rows move in opposite directions — replay **preserves** its receipt,
conflict **omits** it.

Criterion 7 passed because release control set `PROXY_V5_TARGET=orchestrator` at
20:08Z. That single change restored the user's surface to the route where the
receipt and `analysis_ready` guarantees already held — which is why the two
defects I had reported on the user surface disappeared without either of my
implementations landing.

## OpenAI route — MEASURED AND REPORTED, awaiting an accepted bound

`AGENT_LANE_ENABLED=true`, `AGENT_LANE_PREVIEW=false` — **mounted in full mode,
not fronted to users.**

| | state on `/agent/v1/turn` |
|---|---|
| analysis reaches the shared spine | **SATISFIED** — handler fact + turn row |
| `analysis_result` block reaches the client | **SATISFIED** — improved since `a76f1a0`, where `blocks` was `[]` |
| a user-authorised mutation commits | UNSATISFIABLE — value unchanged, 0 turn rows |
| a receipt is minted | UNSATISFIABLE — 0 versions |
| a retry is distinguishable | UNSATISFIABLE — no durable `(scenario_id, turn_id)` key |
| **speaks the user-facing unit** | ⛔ **DEFECT, 3/3** — quotes the stored `0.45` and says *"the model does not state its unit"* while the node carries `unit: months`, `raw_value: 9`. Conventional control **0/2**. |

⛔ **I reported that units defect once and WITHDREW it as intermittent (1 of 2),
under `preview=true`.** At 3/3 with a clean same-request control it stands. The
withdrawal was the error, not the finding.

⚠ **The refusal text changed with the mode** — no longer *"read-only preview"*
but *"I can't apply that through the available change mechanism"*. In full mode
it refuses for a **different reason**.

## The live risk, stated plainly

**These are findings about a route that is mounted but not fronted.** If
`PROXY_V5_TARGET` is flipped back to `agent` without fixing them, users
immediately meet: no committed edits, no receipts, no retry identity, and a
reply quoting an internal 0–1 figure while denying the unit it holds.

That is the bound. It is **truthful** — the route refuses rather than lying about
writes — but its acceptance is release control's, not this lane's.
