# Morning brief — 23 Sep 2026, overnight session

Written for a manual test first thing. **Served build: `c94208cbf000c199fee34922a483ad277d7d63be`, live 03:02:43Z.** Five deploys overnight: `bdad785a` (#1713) → `bf86ce4a` (#1691) → `66b810dd` (#1705) → `da14f03b` (#1707) → `c94208cb` (#1708).

---

> **Served build: `e38feb4c23e3`, deployed 04:05:14Z — and it now EQUALS the staging tip.**
> That deploy carries another lane's *"fix(cee): stop the first brief 500ing on an unparseable
> factor observe"*, which is directly relevant to your test. An earlier version of this banner said
> that fix was **not** deployed; it landed at 04:05:14Z, so **that caveat no longer applies** — if
> your first brief 500s, it is not this known one.

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

## 2. Expect it to still be slow — it is FOUR PROVIDER CALLS plus one real PLoT call

**Fully attributed overnight, no residual.** The journey is **ONE HTTP request containing TWO
turns** — the tell is `v5.run_analysis.auto_run_after_draft` at the end of the trace: a draft
streams, then the analysis runs in the same request.

| leg | n | median | min–max | what it is |
|---|---|---|---|---|
| `parse_ms` | 14 | **~23s** | 19.9–28.5 | one draft model call — **`claude-sonnet-4-6`**, measured |
| `coaching_pass_ms` | 10 | **~20.8s** | 17.3–23.6 | one **claude-sonnet-4-6** call, NESTED in validation |
| **draft turn total** | 14 | **~48s** | 24.0–80.8 | 24–34s when coaching is skipped |
| **PLoT `/v2/run`** | 9 | **22.3s** | **19.3–42.1** | the only genuine non-LLM work |
| `decision_review` | 9 | **16.3s** | 13.2–20.4 | one **claude-sonnet-5** call |
| **analysis half** | 9 | **38.6s** | | |

**Journey ≈ 48s + 39s ≈ 87s** = four sequential provider calls (~23 + ~21 + ~16 = 60s) + one real
PLoT call (~22s) + **~2s of everything else combined**.

⛔ **There is no significant compute anywhere.** `threshold_sweep_ms` p50 = **1 millisecond**
(max 69ms) · `normalise_ms` 2ms · `package_ms` 13ms · `boundary_ms` 13ms · `repair_ms` 109ms.
Any "it is the analytical sweep / a Monte Carlo sample budget" explanation is dead. I had one; see §4.

### ⛔⛔ I WAS WRONG ABOUT THE LEVER — staged delivery ALREADY EXISTS, and you already see the graph at ~36s

**Retracted within the hour, and this one is a repeat of a lesson I had already banked.** I wrote
here that the response "WAITS ~21s for an optional UI-only enrichment" and that deferring the
coaching pass would cut ~21s off time-to-first-model. **Both halves are false.**

`cee/unified-pipeline/index.ts` emits **`GRAPH_READY` at line 1371**; the coaching pass begins at
**line 1383 — after it.** The file says so directly:

> *"The graph is repaired HERE, and the ~20 s coaching pass has not started … Emitting here is what
> turns one silent blob into staged delivery, and it needs NO reordering: the split the design asked
> for already exists in the current stage order."*

**And my exact proposal was already evaluated and rejected by this estate:**

> *"The design's Q3 CEE-1 also said 'reorder coaching after package+boundary'. **That is REFUTED and
> deliberately NOT done**: Stage 5 (Package) is a CONSUMER of the coaching pass's output …
> Reordering would make Package emit canonical-empty coaching, changing the BUFFERED route's
> response bytes — breaking both 'the buffered route stays byte-identical' and the equivalence pin."*

### ⭐ So the number that describes YOUR wait is not 87s

The estate's own staged-frame measurements (`cee2-live-latency.md`, 3 runs, per chunk):

| frame | median | what you see |
|---|---|---|
| **`GRAPH_READY`** | **35.8s** | **your graph — repaired structure, node identity stable** |
| `COACHING_READY` | 59.2s | coaching arrives as its OWN later frame |
| `COMPLETE` | 60.9s | terminal payload (worst run 63,957ms) |

**~87s is the request's wall clock; time-to-first-graph is far shorter, and coaching is already
off that critical path.** Which relocates the lever onto **`parse` — one draft model call,
`claude-sonnet-4-6`, p50 21,224ms of provider latency** — because that is what `GRAPH_READY`
actually waits for. Coaching is not on it, and neither is `decision_review`.

⚠ The "~36s" in the table above is the estate's **July-era** figure. The two sections below
supersede it in both respects: the current derived value is **~23.4s** (stage sum), and the
model is **`claude-sonnet-4-6`**, not o4-mini. Both corrections were made after that table
was written — read them before quoting this one.

### ⭐ And the 35.8s above is STALE — derived from current data, first graph is ~23s

Those staged-frame figures are the estate's, but they are **July-era**: the same comment dates the
probe ("the 28 Jul live probe measured at ~33 s of a ~53 s draft") and `cee2-live-latency.md` is
3 runs. I can derive the current number from my own n=1,200, because the stages before the
`GRAPH_READY` emit are enumerated in `index.ts`:

| stage (in order, all BEFORE the emit at :1371) | p50 |
|---|---|
| Stage 1 Parse (:968) | **23,178ms** |
| Stage 2 Normalise (:984) | 2ms |
| Stage 3 Enrich (:1028) | 87ms |
| Stage 4 Repair | 109ms |
| **sum → time-to-first-graph** | **≈ 23.4s** |

**So first graph is ~23s today, not ~36s** — and `GRAPH_READY ≈ parse` almost exactly, because
everything else on the path totals **~200ms**.

⭐ **That makes the lever a single number: the draft model call.** `parse_llm_ms` is p50 **21,224ms**
and it is **the provider's own reported latency** (`index.ts:942` — `timings.parse_llm_ms =
ctx.llmMeta.provider_latency_ms`), not a wall-clock measurement that might be hiding our own work.
**91% of time-to-first-graph is ONE draft model call, and ~200ms of it is ours.** Nothing in CEE's
pipeline, tool layer or request assembly can move it — only the call itself: model choice, output
size, or streaming the graph as it generates.

### ⛔ Correction: the draft is NOT o4-mini — and the env var does not tell you the model

I wrote "one o4-mini call" above. **Wrong.** I took it from a log line
`calling OpenAI for chat completion model=o4-mini` that shares a timestamp with
`cee.validation_pipeline.pass2_call_start model=o4-mini` — **it is Pass 2, not the draft.** The
parse call happens ~22s before the log window I had open, so I never actually saw it.

Measured instead, `model.resolution` on staging, **59/59 events**:

```
task = "draft_graph"   resolved_model = "claude-sonnet-4-6"
provider = "anthropic" resolution_source = "store_model_config"
```

⚠⚠ **And the env var disagrees with reality.** `CEE_MODEL_DRAFT_GRAPH = claude-sonnet-5` on both
staging and production, but the wire resolves **`claude-sonnet-4-6`** — the prompt store's
`modelConfig` **overrides the env var**, and `resolution_source` is the only field that tells you.
Anyone tuning the draft model by env var alone would be changing nothing.

**What the 21.2s is NOT:** extended thinking. `CEE_DRAFT_GRAPH_THINKING = false` on staging **and**
production, so `parse.ts:425` never attaches a `thinking` block. And `reasoning_effort` appears
**only** in `src/routes/admin.testing.ts` — it is not on the production path at all. So this is
**plain generation**, which leaves **output token volume** as the named knob
(`CEE_MAX_TOKENS_DRAFT`, else `getAffordableDraftTokens(DRAFT_LLM_TIMEOUT_MS)`).

⚠ Registry drift worth someone's attention: `claude-sonnet-4-6` is declared
`averageLatencyMs: 2000`, `maxTokens: 8192`, `extendedThinking: false`. **Measured draft provider
latency p50 is 21,224ms — 10.6× the declared figure**, and `config/timeouts.ts` builds budget
ladders on registry latencies. (My earlier "3.5× overstatement" line compared o4-mini's registry
entry against the draft's measured latency — two different models. Withdrawn; this is the right
comparison.)

⚠ I have NOT re-measured the frames directly — `GRAPH_READY` is an SSE frame, not a log event, so it
does not appear in the log timeline I used. The ~23.4s is a **sum of measured stages on the
enumerated path**, which is why I am giving both it and the estate's older 35.8s rather than
replacing one with the other.

⚠ Note `GRAPH_READY` is explicitly **provisional** — `assist.v1.draft-graph-staged.ts:51` says the
pipeline can still fail or degrade after it, and the client is required to discard it and render the
terminal payload in named cases. So "you see a graph at 36s" is not "the turn succeeded at 36s".

### ⛔ A load-bearing comment is refuted

`plot-client.ts:561` justifies its retry policy on "*staging p95 for a real `/v2/run` is ~5s*".
**Measured median 22.3s, min 19.3s, max 42.1s, n=9 — not one sample under 19s.** Off by ~4×, and
it is the stated basis of a retry decision.

The construction half is still **61% reasoning tokens** (`in 838 / out 3404 incl. 2070 reasoning`),
and **graph size barely matters** (`r(nodes,duration)=0.293`, under 9% of variance): on your own
brief a **26-node** graph took **48.9s** while a **15-node** one took **77.9s**.

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

**The gap is real but it is an OWNED provider-latency gap, not an unowned compute gap.**
**The full end-to-end attribution — including the PLoT and `decision_review` legs that the
unified-pipeline event does NOT cover — is in §2; the table below is the dispatch:**

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

## 10. ✅ RESOLVED — the P0 IS now witnessed on the build that serves

**This section previously read "UNVERIFIED on the build that now serves — and I cannot close that
gap". It is closed.** Not by me: by ordinary signed-in traffic once the new build went live.

Measured on `v5_conversation_turns` for the window since the current build went live
(`e38feb4c23e3`, 04:05:14Z):

| build | signed-in turns | `model_version_created` |
|---|---|---|
| **`e38feb4c23e3` (serving now)** | **68** | **41** |
| `e8cf4c68f150` (previous) — contrast control | 12 | 10 |

Against **0 of 959** before the fix. So construction receipts are minting on the build you will be
testing, and the ladder rung for the P0 moves from DEPLOYED to **WIRE-WITNESSED on the serving
build**.

⚠ Read the 41 correctly: it is a **count of turns that minted a receipt**, not a success rate. Only
construction/registration turns mint versions, so 41-of-68 is not "27 failures" — the denominator
includes signed-in turns that were never supposed to mint one. The claim this supports is "receipts
are being minted on the serving build", nothing stronger.

**The original text of this section follows, for provenance.**

### (superseded) ⛔ The P0 is UNVERIFIED on the build that now serves

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
