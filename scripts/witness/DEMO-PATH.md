# The click path that shows the OpenAI PoC at its best

Verified end to end on served `0415b19` (and `d2afc2c`, `4fd2703` before it) by
`scripts/witness/morning-check.sh`. **26 of 28 gates pass**; the two that fail are the two
traps below, and this path avoids both.

Use `https://staging--olumi.netlify.app/?ai=openai#/canvas` — `?ai=openai` must be in the
**page query**, not the hash, or navigation drops it and you land on Conventional.

## The path

| # | Do this | What you should see | Measured |
|---|---|---|---|
| 1 | Paste a decision brief (a few sentences, with at least one figure and a goal) | A model appears: ~3 options, 4–8 factors, every option wired to the goal. Then **"Use as starting assumptions"** | ~50–65 s, 5–6 OpenAI calls, 0 Anthropic |
| 2 | **Click "Use as starting assumptions"** | Values land; the model becomes runnable | **~6–11 s, ZERO model calls** |
| 3 | Click **Run** | One grounded interpretation: a leader named *and* qualified, or the leader withheld when options do not separate | **~13–18 s, exactly ONE model call** |
| 4 | Ask a follow-up ("which assumption would change that most?") | A substantive answer; the conversation survives | ~14 s |

Step 2 is the one to dwell on: **an approval that writes the user's values and makes the
model analysable, with no model call at all.** That is the deterministic-tool claim, and it
is witnessed rather than asserted.

Step 3 is where the product's character shows. Real replies from the served build:

> *"The current model is **too fragile to put one option forward**: small changes in
> assumptions can change the ordering."*

> *"**Slow Line Down** leading in **77%** of simulated runs, versus 23%… its lead is
> moderately stable, **not a near tie**."*

> *"**Invest in product-led motion** scored highest in **41%** of runs, but the analysis
> treats this as a **close call**. The result is **not yet robust** — small changes could
> flip it."*

Model-relative every time, and it declines to name a winner when the options do not
separate. `leader_claim` carried `{permitted: false, withheld_reason:
"options_do_not_separate"}` on that last one — the structured gate and the prose agreed.

## ⚠ Two things to avoid, both measured, both with fixes pending

**1. Do NOT press Run before approving.** The brief turn offers a `Run` chip alongside the
approve chip (#1792). Pressing it returns a *provisional* answer and empties
`suggested_actions` — **the approve chip disappears**, so the caveated answer has no offered
way to be grounded. Approve first, then Run. *(Fix specified: carry the outstanding proposal
forward at final assembly, guarded on `outstanding().length === 1`. Gate 9.)*

**2. A stated goal figure may be listed as not modelled.** "What I Was Given" can report a
figure the model holds as its goal — e.g. "£3m of new ARR" — as absent, because the goal
threshold has no anchoring surface in the fidelity manifest. *(Fix in PR #1812. Gate 8b.)*

## If something looks wrong

`bash scripts/witness/morning-check.sh` answers what the **served** build actually does in
about five minutes, and it checks the served source for each fast path before testing it, so
it can never report green for code the deployment does not carry. Without git (which hangs
in `~/Documents` on iCloud-evicted objects):

```sh
gh api "repos/Talchain/olumi-assistants-service/contents/scripts/witness/morning-check.sh?ref=morning-check" \
  --jq .content | base64 -d > /tmp/mc.sh
ENVF=/Users/paulslee/Documents/GitHub/olumi-assistants-service/.env.staging.local bash /tmp/mc.sh
```

**Not yet on the served build:** FP1 (the first-brief fast path) is held by Release Control —
both carriers are blocked, one for an unrepaired write race and one on an uninstalled
migration. Step 1's ~60 s is the cost of that hold; the rest of the journey does not depend
on it.
