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

## 2. Expect it to still be slow — and it is FOUR PROVIDER CALLS, not compute

**Measured overnight, n=1,200, instrument `cee.unified_pipeline.stage_timings` which was already
deployed on staging.** Window 2026-09-18 → 2026-09-23.

A slow turn decomposes, p50:

```
total 53.6s = parse              23.2s   <- ONE provider call (parse_llm_ms 21.2s = 91% of it)
            + validation_pipeline 28.8s
                  \__ coaching_pass 20.9s   <- ONE OpenAI chat completion, NESTED inside validation
            + ~1.9s   EVERYTHING non-LLM, combined
```

The nesting is derived, not assumed: `total - (parse + validation)` has p50 **1,882ms**, whereas
`total - (parse + coaching + validation)` overshoots by p50 **-18,626ms**, and
`validation >= coaching` holds in **894/992 = 90.1%**.

**The journey is roughly four sequential provider calls of ~21-23s each. Everything that is not a
provider call totals about two seconds per turn.**

⛔ **There is no significant compute anywhere.** `threshold_sweep_ms` p50 = **1 millisecond**
(max 69ms). `normalise_ms` 2ms · `package_ms` 13ms · `boundary_ms` 13ms · `repair_ms` 109ms.

The construction half is still **61% reasoning tokens** — banked evidence for the `whole` role reads
`in 838 / out 3404 incl. 2070 reasoning, 54.4 s`. **Graph size barely matters**
(`r(nodes,duration) = 0.293`, under 9% of variance); on your own brief a **26-node** graph took
**48.9s** while a **15-node** one took **77.9s**.

⛔ **Two of my own claims died here.** I told Release Control compaction was the dominant lever
(it is not — it touches output, not the 61% that is reasoning), and I then said the analysis half
was a fixed Monte Carlo sample budget (see §4).

## 3. Merge order I would recommend

| # | PR | why |
|---|---|---|
| 1 | **#1717** `d3c4098366e7ab1b2a478041a4ca6c8ea1ca6814` | push+PR pair doubles **every** required check; the other half of the queue problem. Awaiting exact-head verdict. |
| 2 | **#1710** (Model Gen) | compaction — **merge for UX, not latency**. 26 nodes is unusable on a canvas and the 13→26 spread on one brief is the real defect. Expect ~14s, not 30s. |
| 3 | **#1701** `74dad3bf1fdf273329aaa9bbb157b05cd8a65e55` | request assembly + latency instrumentation. Green, awaiting verdict. |

**The decision only you or Model Gen can make:** A/B `reasoning_effort: 'medium'` vs `'high'` on the `whole` role in `agent-lane/model-budgets.ts`, scored on wall time **and** whether a valid graph returns. Plausibly **20–30s off every first turn** — far more than compaction. I did **not** change it, because the same file records that Sol starved of reasoning budget *"consumed the entire budget on reasoning and emitted NO structured answer"*. Starving reasoning is a measured total-failure mode, not a tuning knob.

---

## 4. ⛔ RETIRED — "a 42s gap nobody owns" was my claim, and it was wrong twice over

I reported `run_analysis` as **~42s with ZERO provider calls** and called it the single biggest
unowned gap. I repeated it in this brief, in `#63` and in two PR comments. **Both halves were wrong.**

**Error 1 — the mechanism.** I said the time was a *fixed 1000-sample Monte Carlo downstream in
PLoT/ISL*. I inferred that from a config constant and never measured it. The analytical sweep
(`threshold_sweep_ms`) has a **p50 of 1 millisecond**.

**Error 2 — "zero provider calls".** This came from `llm_calls_used = 0` in 1,606 of 1,670 rows, and
I re-affirmed it as "non-vacuous" on that basis. **`llm_calls_used` counts the v5 ROUTING call only.**
Joining the timing events back to the logs by `request_id`:

| turn class | total_ms | `coaching_pass_ms` | `llm_usage` | `calling OpenAI` |
|---|---|---|---|---|
| `run_analysis` (n=9) | 44,786–61,399 | 17,265–23,608 | **2** | **1** |
| draft, coaching present (n=1) | 80,833 | 21,218 | **1** | **1** |
| draft, coaching absent (n=4) | **24,021–34,109** | — | **0** | **0** |

Coaching present ⇔ provider calls present, **10/10**; absent ⇔ zero, **4/4**. One of those
`run_analysis` turns logs the literal line `calling OpenAI for chat completion`.

⚠ **Practical consequence for anyone reading dashboards: `llm_calls_used` is not a provider-call
count.** It under-reports, and I built a whole argument on it.

**The gap is real but it is an OWNED provider-latency gap, not an unowned compute gap:**

| target | p50 | owner |
|---|---|---|
| `coaching_pass_ms`, nested in validation | **20.9s** (39% of turn) | **Conventional AI Coaching** |
| `parse_llm_ms` | **21.2s** (40% of turn) | **Model Generation / OpenAI path** |
| 25,000ms validation abandonment cap — fires 29/1200 (2.4%) and **those turns still complete** | — | shared / Release Control |
| `repair_fired` **0 of 1,200** (`REPAIR_SKIPPED` in the logs; `repair_ms` p50 109ms, so it runs and declines) | — | Model Generation |

⭐ **The cheapest evidence that speed is available:** a hard 25s abandonment cap on the validation
pipeline **already exists and already fires on 2.4% of turns, and those turns still return a usable
result.** Separately, 179 turns carry no coaching pass at all and complete in **p50 24.0s vs 55.1s**.
⚠ That second figure is correlational — I have not shown those 179 are the same work minus coaching.
The abandonment cap is the sound evidence; the 179 are a strong prior.

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

## 8. What is ALREADY instrumented on staging — no env change, no merge, nothing to build

I spent much of the night about to build a latency instrument. **It already exists**, and my
earlier claim in this slot ("the ~40s will measure itself once #1701 lands") was wrong in a way
worth recording, because it would have had you waiting on a merge for data you already have.

Two separate events, two separate gates — and I conflated them for hours:

| event | gate | env value | what it covers |
|---|---|---|---|
| `cee.unified_pipeline.stage_timings` | diagnostic trace | **`CEE_DIAGNOSTIC_TRACE_ENABLED=true`** | **the slow turns** — 12 stage fields, n=1,200 retained |
| `v5.turn_executor.stage_timings` | diagnostic trace | same | turns **under ~10s** (total_ms 881–10,134) |
| handler-level `plot_request_ms` / `plot_status` | **`V5_TIMING_DEBUG`** | **`false`** on staging and prod, **`true` on cee-demo** | never recorded on staging |

So the PLoT split is dark, but **it does not matter** — the stage fields already account for the
whole turn to within ~1.9s.

⛔ **A fix I designed and then killed, because checking stopped it.** I was about to widen the
handler gate to `timingDebugEnabled || diagnosticTraceEnabled`, reasoning that the second disjunct
is already true on staging so it needed no env change. **`CEE_DIAGNOSTIC_TRACE_ENABLED` is also
`true` on cee-production** (118 vars, fully paginated) — so that one-line change would have
switched timing instrumentation on **in production**, against the explicit design at
`run-analysis.ts:970` ("default-OFF production runs make zero `Date.now()` calls"). Not done.

⚠ **I mis-read this instrument twice before getting it right, and a control caught it both times,
not re-reading.** First I searched logs for `text=stage_timings` and treated the hits as one
population — they are two different events. Then I reported the slow event as carrying "only
`total_ms`" — it carries twelve stage fields; I had grepped for the *other* event's field names.

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

## 11. #1717 was RE-CUT overnight — an existing guard caught it, and the result is strictly better

The version described in the earlier draft of this section (`25bf0e91…`, narrowing `push` to
`[main, staging]` on all five workflows) **failed its required check** and was never merged.

```
× only the paid CI job is variable-gated; required code checks retain their gate
  FAIL tests/unit/ci/staging-journey-smoke.test.ts
  AssertionError: expected [ 'main', 'staging' ] to deeply equal [ 'main', 'staging', 'feat/**' ]
```

`tests/unit/ci/staging-journey-smoke.test.ts` already pinned `ci.yml`'s triggers exactly. ⭐ **The
guard caught what two agents missed:** the PR carried an independent exact-head APPROVE, and the
reviewer's check #2 had verified `push: [main, staging]` in all five files — correctly, against my
*stated intent*. Neither of us checked that intent against the test that encoded the opposite.

**Current head `c50e7ba31f7fd2825ee07be8136efeadf0184682`**, re-requested for review:
`ci.yml`'s `on:` block is restored to staging's form verbatim, and only the four workflows with
**zero** guard coverage stay narrowed (`contract-schemas`, which fired on every push to every
branch; `test-skip-guard` and `telemetry-validation`, which were `push: ['*']`; `graph-evaluator`).

Three things this fixes versus the earlier cut:

| | earlier cut | now |
|---|---|---|
| `feat/**` push, no PR | lost its required check (accepted trade) | **keeps it — trade gone** |
| PR stacked on a feature branch | lost **the required check**, silently | loses only four advisory/contract workflows |
| queue relief | yes | **retained** (the worst offender fired on every branch) |

**The practical rule still holds and is worth keeping: base PRs on `staging`, not on another
feature branch.** A stacked PR shows *no checks at all* rather than a red one, and on this estate
silence has repeatedly been misread as green.

⚠ One thing to check me on: I restored `ci.yml` with `git checkout origin/staging --`, so the
**whole file** is staging's, not just its `on:` block. #1713's concurrency stanza is asserted intact
by a YAML check in the commit, but that is the failure mode if it ever looks wrong.
