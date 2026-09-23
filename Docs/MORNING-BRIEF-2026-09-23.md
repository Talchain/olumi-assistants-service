# Morning brief — 23 Sep 2026, overnight session

Written for a manual test first thing. **Served build: `c94208cbf000c199fee34922a483ad277d7d63be`, live 03:02:43Z.** Five deploys overnight: `bdad785a` (#1713) → `bf86ce4a` (#1691) → `66b810dd` (#1705) → `da14f03b` (#1707) → `c94208cb` (#1708).

---

## 1. Test this first — the P0 your manual test failed on is fixed

Brief: `Should I hire a Tech lead or two developers to increase velocity?`

**What changed:** a first construction now creates **and returns** a canonical model version + receipt. Before tonight it created the graph and never reached the version writer at all.

| | `graph_registration` turns | version created | NULL |
|---|---|---|---|
| before deploy | **959** | **0** | 959 |
| after 02:08 deploy | 14 | **7** | 2 |

### ⛔ SIGN IN BEFORE TESTING, or this will look broken

Split by authentication, n = 14 since the deploy. The pattern is total:

| signed in? | registrations | version created |
|---|---|---|
| **yes** | **7** | **7 TRUE** |
| no (guest) | 7 | **0** (5 `false`, 2 `NULL`) |

**7 of 7 signed-in registrations mint a canonical version. 0 of 7 guest ones do** — and that is **correct by design**: the deployed `append_turn_atomic_v5` gates on `v_user_id IS NOT NULL`, so a guest never gets a version. A key-authed harness cannot witness a receipt for the same reason.

**As a guest you will see no version and no receipt, which looks exactly like the bug we just fixed.**

⚠ **Correcting my own earlier claim:** I first reported this as "2 of 2" on n = 2. Direction right, evidence thin — and the thin version would have let a guest test read as a regression. The honest claim is **7 of 7 signed-in**, guests correctly excluded.

*(Cosmetic, noted so nobody re-investigates it: guests split 5 `false` / 2 `NULL`. Both mean "no version" — the carrier returns `kind: 'none'` where the RPC simply does not stamp the flag.)*

**Still WIRE-WITNESSED, not JOURNEY-WITNESSED.** I observed the database on the deployed build; I did not drive a browser. **Your test is the journey witness.**

**What to look for:** after the first model is built, the Agent should be able to name the version it became. If it cannot, the receipt is not reaching the conversation layer even though the row exists.

---

## 2. Expect it to still be slow, and know why

**~51s construction + ~44s analysis ≈ 95s to a first analysis result.** Roughly half has no provider call at all.

The construction half is **61% reasoning tokens**, not output. The banked budget evidence for the `whole` role says it plainly:

> `in 838 / out 3404 incl. 2070 reasoning, 54.4 s`

which matches the measured construction p50 of **54.4s** across n=1,579 turns.

**Graph size barely matters:** `r(nodes, duration) = 0.293`, so size explains **under 9%** of the variance. On your own brief a **26-node** graph took **48.9s** while a **15-node** one took **77.9s**.

⛔ **I withdrew my own earlier advice here.** I told Release Control compaction was the dominant latency lever. It is not. Compaction touches the 39% that is output; it cannot touch the 61% that is reasoning.

---

## 3. Merge order I would recommend

| # | PR | why |
|---|---|---|
| 1 | **#1717** `d3c4098366e7ab1b2a478041a4ca6c8ea1ca6814` | push+PR pair doubles **every** required check; the other half of the queue problem. Awaiting exact-head verdict. |
| 2 | **#1710** (Model Gen) | compaction — **merge for UX, not latency**. 26 nodes is unusable on a canvas and the 13→26 spread on one brief is the real defect. Expect ~14s, not 30s. |
| 3 | **#1701** `74dad3bf1fdf273329aaa9bbb157b05cd8a65e55` | request assembly + latency instrumentation. Green, awaiting verdict. |

**The decision only you or Model Gen can make:** A/B `reasoning_effort: 'medium'` vs `'high'` on the `whole` role in `agent-lane/model-budgets.ts`, scored on wall time **and** whether a valid graph returns. Plausibly **20–30s off every first turn** — far more than compaction. I did **not** change it, because the same file records that Sol starved of reasoning budget *"consumed the entire budget on reasoning and emitted NO structured answer"*. Starving reasoning is a measured total-failure mode, not a tuning knob.

---

## 4. A gap nobody owns — and it is the single biggest one

`run_analysis` is **~42s of the ~95s journey, with ZERO provider calls**, and no lane is assigned to it.

Measured, n = **1,667** over 7 days:

| | secs |
|---|---|
| avg | 42.1 |
| **p10** | **33.0** |
| p50 | 44.0 |
| p90 | 52.6 |
| max | 84 |
| stddev | 13.0 |

**Even the fastest 10% take 33 seconds.** And graph size does not drive it:

```
r(nodes, duration) = -0.225      r(edges, duration) = -0.029
```

The correlation is **negative** — bigger graphs analyse marginally *faster*. By band: 10–11 nodes 40.5s (n=22), 12–15 nodes 41.7s (n=1,061), 16–19 nodes 47.2s (n=452).

**What I established:** the time is **not** CEE waiting. I read `plot-client.ts` and `run-analysis.ts` at the served SHA and found **no poll loop, no sleep, no fixed delay** — CEE's `/v2/run` cap is 75s and sits above PLoT's own budget. So the ~42s is genuinely spent downstream in PLoT/ISL.

**MECHANISM NOW IDENTIFIED** (I read `plot-lite-service` read-only; I did not touch it):

- PLoT defaults to **1000 Monte Carlo samples** — `engine-v3.ts:436` *"Number of Monte Carlo samples (default: 1000)"*, `assembly/decision-brief.ts:47` `n_samples_default: 1000`. Bounded 100–10000 by `input-validation.ts`.
- **CEE only sends `n_samples` when the snapshot already carries one** — `run-analysis.ts:901` `if (snapshot.n_samples !== undefined)`. So for a normal first analysis CEE sends nothing and **the 1000 default applies by omission.** (Contrast control: `goal_constraints` appears 8× in the same payload, so the probe is not blind.)
- A fixed sample budget is exactly what produces a high floor that does not scale with node count — which is what the data shows.
- PLoT already has a **`samples_reduced`** path that CEE surfaces to the user (`run-analysis.ts:1607, 1849`), so reducing samples is **supported, disclosed behaviour** rather than a hack.

**⚠ THE TRADE, WHICH IS REAL — samples buy statistical confidence.** `trust/confidence-calibrated.ts:46` gates on `k_samples >= 1000`. Going below that plausibly downgrades what the product may honestly claim about its own confidence. This is the same shape as the `reasoning_effort` trade: not a free knob, a decision about what the product is allowed to say.

**Still unverified:** that wall time scales roughly linearly with sample count. I did not measure it. If it does, 1000 → 300 would take ~42s toward ~15s — larger than compaction and `reasoning_effort` combined. **Owner: whoever owns PLoT / Scientific Compute, not me.**

**Why this matters for sequencing:** compaction (#1710) targets 39% of the construction half; `reasoning_effort` targets 61% of it. **Neither touches this 42s at all.** If the journey needs to feel fast, this is the largest single lever and it currently has no owner.

---

## 5. What landed overnight

Three deploys, from an estate that could not ship at all at 00:26:

1. `bdad785aab22` — **#1713**, CI concurrency groups. The binding constraint: **63 queued runs against 1 runner**, rising to 83, with 25 open PRs. Independently reviewed by Model Generation, who measured 109 queued and found only **8** genuinely stale runs — proving cancellation could not fix it. Queue then fell to 34 with 45 auto-cancellations.
2. `bf86ce4aeeec` — **#1691**, the construction receipt (section 1).
3. Both live and serving.

---

## 6. Five of my own errors, caught and converted to guards

Recorded because the pattern matters more than the individual slips.

1. **Bricked a PR by cancelling a required check.** A `cancelled` required check reads as `BLOCKED`, not stale, and a manual cancel has no successor run to overwrite it. Re-ran it; warned the other lane, which had cancelled 20 of its own.
2. **My watcher marked a REVIEW_REQUEST as `[APPROVE]`** because the body said *"The APPROVE at bc1ae66a is void"*. In a merge loop that could have merged an unapproved PR. Markers are now line-anchored, and **no marker authorises a merge — the comment gets read.**
3. **Pushed twice without re-requesting review**, so my request named a head two commits stale and a ready reviewer was blocked on me. Now: re-request in the same action as the push.
4. **My own instrumentation filed the product's largest provider call as "overhead"** — `build_model_from_brief` makes its own provider call inside a tool dispatch, so 54s landed in `tool_ms`. Fixed by letting a tool report `provider_ms`, clamped so it cannot over-claim.
5. **Three mis-aimed probes**, each caught by a contrast control rather than by re-reading: a `server.ts` probe returning 0 for target *and* control; `git show` returning empty read as absence; looking for the projection in `build-model.ts` when the result is assembled in the capability layer.

The premerge guard also blocked a merge I was confident in, for two reasons that were both real. It is the authority, not my reading of it.

---

## 7. Open, waiting on people

- **#1717** and **#1701** — exact-head verdicts.
- **#1698** — I stood down; three REVIEW_REQUESTs existed for one head and duplicated owners is how tonight's #1691 waste happened. Another lane drives it at `83c1ae6d`.
- **`reasoning_effort` A/B** — Model Generation's call (section 3).
- **`run_analysis` ~44s** — unassigned (section 4).

---

## 8. The ~40s will measure itself once #1701 lands — no env change needed

My timing instrumentation (`agent_lane.turn_timings`: `provider_ms` / `tool_ms` / `overhead_ms` / `tool_provider_ms` / call counts) is gated on the estate's own timing flags:

```ts
if (!config.cee.timingDebugEnabled && !config.features.diagnosticTraceEnabled) return;
```

Measured in the served Render env just now (125 vars, fully paginated):

```
V5_TIMING_DEBUG               = false
CEE_DIAGNOSTIC_TRACE_ENABLED  = true     <- the gate is a disjunction
```

**So the second disjunct is already true on staging.** The moment #1701 merges, real provider-versus-overhead numbers start flowing into the logs with no env change and no default-ON decision.

⚠ **Correcting myself:** in #1701's review request I asked the reviewer whether this should be default-ON, *"because otherwise the ~40s stays unmeasured until someone sets `V5_TIMING_DEBUG=true`"*. That question rested on a false premise — I had not checked the served env before asking it. Withdrawn.

**Contrast control, so the absence claim is sound:** `agent_lane.route_mounted` appears once on staging while `agent_lane.turn_timings` is absent — which is exactly right, because #1701 is not merged yet. The probe sees the emission when it exists.

**What this buys:** the ~40s unexplained portion of construction becomes a measured split rather than an inference, which is what would settle whether it is provider time or our own pipeline — the one question my whole latency argument tonight rests on.

---

## 9. ⚠ A turn-fence change landed on the registration path at 03:21 — what to do if your test shows no receipt

**#1706 — `fix(registration): a graph registration takes its place in the turn fence`** merged and deployed as `e8cf4c68f150` (build started 03:21:39Z). That is Release Control's P0 item 2: the estate was logging

```
V5 turn fence — a GRAPH WRITE reached the store with no ingress fence handle; it is proceeding UNFENCED
```

so registrations were bypassing the fence that stops a superseded turn clobbering a newer one. Correct fix, and it belongs on that path.

**But it lands directly on top of the receipt work**, and the fence's job is to **refuse** writes it judges superseded. A refused registration writes no graph, and no graph means no version — which would present exactly like the P0 regressing.

**So if your test shows no receipt, check in this order:**

1. **Were you signed in?** Guests never get a version (section 1). This is by far the likeliest explanation.
2. **Did the registration get fenced?** Look for a `graph_write_refused` / `superseded` fence log on your scenario. If the fence refused it, the receipt is *correctly* absent and the bug is the fence being too eager, not the carrier.
3. **Only then** suspect the carrier itself.

**Evidence as of 03:25Z, on the build BEFORE the fence change** (`c94208cb`): signed-in **7 registrations → 7 versions**; guest **10 → 0**. I have a waiter on the `e8cf4c68` deploy to re-verify that ratio against the build that actually serves it — because a fence change on the write path is exactly the kind of thing that turns a passing invariant into a failing one, and the pre-change numbers would not show it.

---

## 10. ⛔ The P0 is UNVERIFIED on the build that now serves — and I cannot close that gap

`e8cf4c68f150` went **live at 03:23:35Z**, carrying #1706's turn-fence change on the registration path.

**Registration turns on that build: 0.** So the post-fence signed-in ratio is **0 of 0**, which is indistinguishable from success and proves nothing. I am not reporting it as holding.

| build | signed-in registrations | versions created | status |
|---|---|---|---|
| `c94208cb` (previous) | 7 | **7** | verified |
| **`e8cf4c68` (SERVING NOW)** | **0** | — | **VACUOUS — unverified** |

**Why I cannot close it myself:** a version is only minted for a signed-in owner (the RPC gates on `v_user_id IS NOT NULL`), and a service-key harness is refused with `scenario_requires_authenticated_owner`. There is no path from here to a signed-in registration without a browser session. Nothing has organically hit the route since 03:23 either.

**So your first test IS the verification of the current build.** Concretely:

- **If a receipt appears** — the P0 holds across the fence change, and that is the journey witness this has been missing all night.
- **If it does not** — work section 9's order: signed in? fenced? only then the carrier. The fence is the *new* variable here and the first thing I would suspect after authentication.

⭐ **Stated plainly because the temptation ran the other way:** it would have been easy to write "P0 still holds on the new build" on the strength of an empty result set. Every absence claim tonight needed a non-vacuity control, and this one fails it. **Verified on the previous build, unverified on this one.**

---

## 11. ⚠ After #1717 lands, a stacked PR will have NO required check — and no signal that it is missing

#1717 (`25bf0e91…`) has an independent exact-head APPROVE and merges as soon as its required check goes green. It narrows `push` to `[main, staging]` and keeps `pull_request` on `[main, staging]`.

**The reviewer surfaced a consequence I had not stated**, and it is the sharper half of the trade:

> stacked PRs whose base is not `main`/`staging` get **none** of these five workflows, because `pull_request` filters on the **base** branch.

So after this lands:

| what you do | checks you get |
|---|---|
| PR into `staging`/`main` | full set, including the required `Lint, TypeCheck, Unit Tests` |
| push to `feat/**` with no PR | none (accepted trade) |
| **PR stacked onto another feature branch** | **none of these five — silently** |

**Why this is worse than the `feat/**` loss:** it is invisible. A stacked PR shows **no checks at all** rather than a red one, and on this estate silence has repeatedly been misread as green. `ci.yml` carries the **sole required context**, so someone stacking onto a feature branch gets nothing to satisfy and no indication anything is absent.

It matches the estate's pre-existing rule that stacked PRs get zero checks, which is why the reviewer approved and why landing it tonight is still right — the queue relief is real and measured. But it extends that hole to the required check.

**Practical rule after this lands: base PRs on `staging`, not on another feature branch.** If a stack is unavoidable, re-target the tip PR at `staging` before asking for a verdict, or it cannot be merge-cleared and nothing will tell you why.
