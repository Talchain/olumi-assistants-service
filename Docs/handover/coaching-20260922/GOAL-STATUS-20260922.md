# Spine trustworthiness — status against the completion criteria
**22 Sep 2026 · deployed staging `c12a54d` · executed, not inferred**

| # | criterion | state | evidence |
|---|---|---|---|
| 1 | a user-authorised real mutation **commits exactly once** under stable operation identity | ✅ **PASS** | committed `turn_id` **equals the client's**; 11/11 signed-in acceptance |
| 2a | exact retry **recovers without duplicate state** | ✅ **PASS** | Δturns 0, Δversions 0, **same `version_id`** recovered |
| 2b | …and **without misleading success narration** | ❌ **FAIL** | replay after an intervening change replies *"Updated … from 17 to 14"* while the persisted value stays 17. Fix in **PR #1685**, **not deployed** |
| 3 | a genuinely stale **different** operation **refuses truthfully** | ✅ **PASS** | two concurrent different mutations → one `HTTP 409 GRAPH_DIVERGED` (`graph_write_conflict`, `retryable:false`, with `recovery_action`), one applied; **1 turn, exactly one claimed success** |
| 4 | natural user units preserve **real unit safety** | ✅ **PASS** | `12 months` / `15 month` now apply; **`20 weeks` still refused** (*"uses months; the value provided is in week"*); stored unit stays `months` |
| 5 | one analysis turn **cannot silently mix model revisions** | ❌ **FAIL** | race reproduced at the wire, 3/6 trials, deterministic **0.8–1.5 s** window, **HTTP 200 with no warning**. Fix in **PR #1679**, **not deployed** |
| 6 | authoritative **reread / receipt / state agree** | ✅ **PASS** | 5/5 durable: `current_model_version_id` = version id · version hash = scenario hash · turn `mutation_id` = version `mutation_id` · `source_turn_id` = committed turn · `model_version_created` true. Product reread: *"Sales Cycle Length is currently set to 33 months"*, matching persisted state |

**4 of 6 pass on the deployed build. Both failures are fixed in open PRs that are green on the required check and unmerged.**

---

## Misleading narration — systematically bounded, not sampled

A battery of six edge-case mutations, each reply checked against persisted state:

| probe | claims "Updated" | value changed | verdict |
|---|---|---|---|
| `to 25` | yes | yes | truthful |
| `to -5` | yes | yes | truthful |
| `to one million` | yes | yes | truthful |
| `to about 30ish` | no | no | truthful — *"I wasn't sure what value to use… so I haven't changed anything"* |
| `Nonexistent Factor to 10` | no | no | truthful — *"isn't part of this model, so I can't apply that update"* |
| `change Sales Cycle Length` (no value) | no | no | truthful — *"I need a new value to apply"* |

**6/6 matched persisted reality.** Combined with the replay probes, **the only known misleading-narration case is the one #1685 fixes.** That is a bounded result from systematic probing, not an absence claim from a single happy path.

## Bounded, NOT release-critical

- **`-5 months` and `1,000,000 months` are accepted** into canonical state and versioned. Truthful (it said it updated and it did) and user-authorised — "humans remain the authors" — but there is no plausibility warning. A **validation** gap, not a spine-integrity one. Downstream analysis quality is Model Generation's territory.
- **`"what is X set to?"` is misrouted to the setter**, replying *"I haven't changed anything… not what to set it to."* Three other phrasings reread correctly (*"…is currently set to 33 months"*). **It does not mutate and refuses truthfully**, so it is safely bounded. Sibling of open PR #1546 (*"An advice question is not a change instruction"*), which fixes a different handler and different copy.

## What completion now requires

**Deploying #1679 and #1685.** Both are green on the required context; neither is LOW RISK, so neither is self-merged. No further Core code is needed from this lane for criteria 2b and 5 — only the merge and a post-deploy re-run of the banked harness.
