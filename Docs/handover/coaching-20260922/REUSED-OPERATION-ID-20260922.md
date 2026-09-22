# A reused operation id is told its edit happened. It didn't. (`a459d23`, 22 Sep)

**Found by asking criterion 3 the other half of its own question.** The spine
witness tested "a genuinely stale different operation refuses truthfully" only as
a **concurrent** race. The durable key's other failure mode — the *same* id
carrying a *different* instruction — was never probed.

## Measured, two trials, deterministic, 3s settle to exclude a late write

```
turn T1  "change Sales Cycle Length to 14"  -> applied, value 14, 1 turn row
turn T1  "change Sales Cycle Length to 25"  -> HTTP 200, value STILL 14, 1 turn row

assistant_text: "Updated Sales Cycle Length from 14 months to 25 months."
blocks[0]: graph_patch  status:"applied"  after:{value:1.25, raw_value:25, unit:"months"}
blocks[1]: ui_directive
```

The idempotency key **held** — no second write, no second turn row. The
**narration and the wire contract both lied**, and lied toward the number the
user had just typed, which is the hardest kind to catch.

## It refutes a rationale that was written, not measured

`supabase-store.ts` recorded that a `request_hash` mismatch fell back to
*"the caller composes fresh text … never a wrong answer, only no answer."*
Fresh text is composed **from the proposed patch** — that fallback IS the
mechanism that produces the wrong answer. I wrote that comment in #1685 without
measuring what "today's behaviour" actually was.

⭐ **The lesson is the cheap one:** a sentence about current behaviour inside a
fix is a claim, and claims get measured. This one cost one probe.

## #1685 does not cover it — and that is not a criticism of #1685

#1685's predicate keys on `request_hash` **equality**, so `replayedPriorTurn` is
`false` here and its reconciliation never fires. Its same-request path is right
and common; this is a different trigger needing a different answer (**refuse**,
not *"already recorded"*). Fix: **PR #1688**, stacked on #1685 because it extends
that PR's pre-read — building it independently would add a second pre-read.

## ⛔ My first test suite let a mutant live, in the half that mattered

The caller tests inject a store outcome directly, so they prove what `commit.ts`
**does with** a verdict, never that the store **produces** one. A mutant
collapsing the mismatch arm to `'replay'` passed **all 9**. Tested the object I
edited; not the chain that reaches it.

| mutant | after fixing the suite |
|---|---|
| collapse detection into `'replay'` | **2 failed** |
| drop the `priorTurnConflict` assignment | **1 failed** |
| relabel conflict prose to "already recorded" | **2 failed** |
| restored | **18/18 pass** |

## Witness rows added to criterion 3 (`witness/spine.mjs`)

- `a reused turn_id writes nothing` — PASS today (the key works)
- `a reused turn_id does NOT claim the new value was applied` — **FAIL today**
- `a reused turn_id does NOT emit an APPLIED patch` — **FAIL today**

So the honest baseline grows to **25 assertions**; the goal is further from met
than the previous run implied, and now says so for the right reason.

## Reach, stated honestly

**Not reachable through today's DGAI client** — it mints a fresh `turn_id` per
turn and reuses one only on a genuine retry, where the message is identical.
This is a **wire-contract** defect: the durable key does not bind the request it
identifies. It matters because the spine must serve **a second consumer (the
OpenAI route)**, and a second producer reusing an id with different content is
exactly the shape that gets a confident lie.
