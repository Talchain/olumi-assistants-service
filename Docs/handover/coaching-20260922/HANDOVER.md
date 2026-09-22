# AI Coaching — successor handover, 22 September 2026

Written at the end of the session that merged #1660 and banked three fixes.
**Every SHA below was verified at the remote by two independent sources**
(`git ls-remote` and `gh api .../git/ref/...`) and every figure was measured in
this session. Anything not proven here is labelled.

---

## CURRENT STATE

| Thing | Value |
|---|---|
| CEE `staging` head | `9b98fcd0a3152b21ad71d97bf3d6f23fbf0afbe7` |
| CEE staging **deployed** build | `9b98fcd` — `/healthz` `ok:true`, `degraded:false`, `schema_write_version 0.55.0` |
| #1659 | **merged** 2026-09-21T22:50:36Z → `bd35cc9e1a838159ec3949a278a89820acb01151` |
| #1660 | **merged** 2026-09-22T00:13:10Z → `9b98fcd0a3152b21ad71d97bf3d6f23fbf0afbe7` |
| Required status check on `staging` | exactly one: `Lint, TypeCheck, Unit Tests` |

So staging is deployed at #1660's merge commit. Nothing is waiting on a deploy.

### Branches banked this session (none merged, none reviewed)

| Branch | Head (40 chars, remote-verified) | What it is |
|---|---|---|
| `feat/durable-turn-identity` | `15d6852e745e0c69bd8d4a0ba3c3b5a18b4b3bc8` | A — replay/idempotency identity |
| `feat/natural-unit-rate-equivalence` | `ccf042921a642ce7bf093aa159532069227bd324` | B — natural-unit edits |
| `feat/single-snapshot-turn-binding` | `e65d0a6d92d0d953f9558758fe54527bc5201835` | C — single-snapshot race |

All three are pushed to `feat/**`, which attaches the required check without
opening a PR. **Opening a PR spends a production draft call** (`perf-gate` is
`pull_request:` unqualified against production `/assist/draft-graph`), so that
is a deliberate choice, not an oversight.

---

## A — DURABLE REPLAY IDENTITY · `feat/durable-turn-identity` @ `15d6852e745e0c69bd8d4a0ba3c3b5a18b4b3bc8`

> ⭐ **READ `REPLAY-REACHABILITY-WITNESS.md` IN THIS DIRECTORY FIRST.** SDL's final
> correction was right that this section originally *inferred* the replay
> mechanism works. It is now **executed**: the deployed `append_turn_atomic_v5`
> decides replay before CAS (lookup line 86, CAS raise line 171, ordering
> control in the same run), and a witness on a throwaway scenario recovers the
> SAME turn row and the SAME receipt version_id with no duplicate turn or
> version, while a genuinely new mutation on the same stale expected hash is
> still refused (`OLGC1`). The mechanism works; the handler path simply never
> reaches it. **Persistence is not at fault — do not reopen SDL.**

### First wrong boundary
`turn-executor.ts` committed every turn under **`context.request_id`**, a
server-minted per-HTTP-request id, not the client's `turn_id`. That id IS the
durable idempotency key — `append_turn_atomic_v5` enforces
`UNIQUE (scenario_id, turn_id)` and the replay lookup is
`SupabaseSessionStore.committedTurnRowId(scenario_id, write.turn_id)` (sole
production caller: `tryFirstWriteExemptRecovery`, `supabase-store.ts:1438`).
`request_id` comes from `getOrGenerateRequestId` — the `x-request-id` header if
it validates, else `randomUUID()` — so **the key moved on every retry**. The
replay lookup found nothing, the write was treated as fresh, and the CAS then
refused it because the original write had moved the graph head. That is the 409. ⛔ **WRONG SYMPTOM — the wire returns HTTP 200 with a phantom duplicate turn; see the ADDENDUM.**

**The repaired replay-before-CAS SQL could not help: there was no prior row
under the key it was handed. This is upstream of persistence — do not send it
back to SDL.**

route-v2's own nine `commitDirectAnswer` branches already used
`ingress.turn_id`, and `turn-fence-prehandler.ts readIngressTurnIdentity` claims
`v5_turn_fence (scenario_id, turn_id)` from the same body field. Only
handler-routed turns — every graph mutation — keyed differently.

### The fix
One injection in the `commitTurn` closure that all ~36 executor commit sites
funnel through, placed **after** `...commitMeta` (the two injections above it
are defaults a call site may override; this is a guarantee). `durableTurnId =
payload.turn_id` when it is a non-empty string — the fence's own predicate —
else `requestId` for non-fenced callers.

### Tests
RED-first `src/orchestrator-v5/__tests__/durable-turn-identity.test.ts`:
4 tests, all 4 RED at base for the right reason (`expected 'dddd…' to be
'bbbb…'`), all 4 GREEN after. Executes `runTurnExecutor`, not the object edited.
One test binds the commit key to the FENCE key by calling the fence's own parser
rather than repeating a literal.

### Mutants — 4 of 4 died
| Mutant | Result |
|---|---|
| M1 remove the injection (revert the fix) | 4 failed |
| M2 `durableTurnId = requestId` | 4 failed |
| M3 inject BEFORE `...commitMeta` (a default, not a guarantee) | 4 failed |
| M4 inject only on graph-bearing commits | 4 failed |

Working tree clean after every restore (`dirty=0`).

### Collateral corrected
Two suites selected committed writes by the request id; one said so in a comment
that read as a contract (`brief-persistence-composed-roundtrip.test.ts`). Both
now select by the payload's own `turn_id`.
`npm run typecheck` exit 0; schemas pin verified `0.55.0`.

### CI / review state
Required check `Lint, TypeCheck, Unit Tests` was **in_progress** at hand-over.
`Security Audit`, `Typecheck Drift`, `check-schemas`, `Validate OpenAPI`,
`Integration Tests` all success. `Graph Evaluator (advisory)` failure — it is
advisory, is not a required context, and is red on other heads too.
**No review requested.**

### Exact next action
1. Read the required check at exactly `15d6852e745e0c69bd8d4a0ba3c3b5a18b4b3bc8`,
   filtering on `.status == "completed"` **before** `.conclusion`.
2. If green, open the PR and request an independent review.
   **This is NOT low risk** — it changes the durable key of a user's model
   writes — so it must not be self-merged.
3. The client half is unwired and belongs to the UI lane:
   `DecisionGuideAI/src/canvas/conversation/deliveryUnknown.ts` already contains
   `retrySafety()` with a `request_id_reused` branch, written 3 Sep and
   deliberately not wired. **With this CEE fix the reused identity is
   `payload.turn_id`, not `X-Request-Id`** — that file's five-hop derivation is
   now one hop out of date and must be corrected when it is wired.

---

## B — NATURAL UNIT EQUIVALENCE · `feat/natural-unit-rate-equivalence` @ `ccf042921a642ce7bf093aa159532069227bd324`

### First wrong boundary
**CQE extraction** — `src/orchestrator-v5/context/cqe/extract-quantities.ts`.
Established by EXECUTING the chain, not reading it:

```
"change hiring cost to £62 per month"  → unit 'GBP', value 62
"change hiring cost to £62/month"      → unit 'GBP', value 62
"set hiring cost to £62 a month"       → unit 'GBP', value 62
"change hiring cost to £62"            → unit 'GBP', value 62   ← CONTROL
```

Byte-identical to the bare amount. The denominator is not in the extractor's
unit vocabulary and is not recoverable downstream: `raw_text` is truncated at
the amount. Canonical state was correct throughout. **It belongs in CEE, not
Model Generation.**

The gate was NOT the defect: `unitComparisonKey('£') ≠ unitComparisonKey('£/month')`
⇒ `unit_mismatch`, and that refusal is correct for the input it receives. Its
docblock forbids widening it to strip punctuation — rightly, `£/month` vs
`£/day` is a real rescale.

### Reachability, measured live
300 most recently-updated scenario graphs: **63 (21%) carry ≥1 rate-shaped
factor unit** — 59 × `£/month`, 7 × `£ ARR per customer`, plus `accounts/month`,
`£/day`, `£/year`, `contacts per week`. Contrast control: `scale` 494, `£` 291,
`%` 109.

### The general fix, in producer-then-consumer order
1. `readRateDenominator(message, quantity)` in
   `routing/deterministic-value-update.ts`, beside the existing
   `deriveOperator(message, quantity)` — **anchored on the text CQE consumed**,
   so the period must IMMEDIATELY follow the amount, over a **closed** period
   list. `mapCqeQuantityToProposalValue(quantity, message?)` composes the
   canonical `/` spelling. Call sites: two in `turn-executor.ts` (pass
   `payload.message`), one in `compound-value-update-chain.ts` (passes
   `part.segmentText`, per-part, matching that file's own guard (c)).
2. `unitComparisonKey` folds two more **spellings and nothing else**: the
   currency alphabet (delegating to `utils/currency-alphabet.ts`, which already
   owns that vocabulary — a new `currencyAlphabetKey` export, one copy) and the
   rate separator (`a/b ≡ a / b ≡ a per b`, denominator folded from the closed
   list).

### Tests and controls
`src/orchestrator-v5/routing/__tests__/natural-rate-unit.test.ts`, 18 tests.
9 RED at base; the other 7 were the CONTROLS, which is the point — they pass at
base so they cannot be what the fix makes pass. Controls: bare amount invents
nothing · `per` inside the factor label · unitless stays unitless · scale class
unchanged (`classifyUnitScaleClass('£/month') === classifyUnitScaleClass('£')`)
· the real gate still refuses `£/day` and a bare `£` against `£/month` · the
non-equivalence pins.

### Mutants — 4 of 4 died, but only AFTER a survivor was fixed
| Mutant | Result |
|---|---|
| U1 drop the immediate-anchor requirement (whole-message scan) | **SURVIVED** first time |
| U2 append `/month` to every currency amount | 3 failed |
| U3 fold every denominator to one constant | 2 failed |
| U4 revert the currency-alphabet fold | 1 failed |

⚠ **U1 surviving is the most useful fact in this section.** The false-positive
control (`£ ARR per customer`) was not load-bearing for the anchor — the CLOSED
PERIOD LIST was catching it, because `customer` is not a period. Two anchor
controls were added (a period BEFORE the amount; a period AFTER other words)
and U1 then died. Do not delete those two controls.

Regression: 188 spec files / 5,548 tests green across `routing/__tests__` and
`d1-shared/__tests__`, including the pre-existing `unit-comparison-key.test.ts`
opposite-direction twins. `npm run typecheck` exit 0.

### Deliberately NOT done
`mapCqeQuantityToProposalValue` maps `percentage_points` → `'%'`. The extractor
keeps the distinction (`raw: "percentage_points"`); the mapper collapses it and
its own comment gives a reason (the delta operator carries the point semantics).
Arguable for a set, defensible for a delta — recorded as an observation in
`B-natural-unit-first-wrong-boundary.md`, **not folded into this change**. One
live factor is stored as `'percentage points'`, which `unitComparisonKey` does
not equate with `'pp'`; separate question.

### CI / review state
Required check **in_progress** at hand-over. `Integration Tests` and
`Validate OpenAPI` success; `Graph Evaluator (advisory)` failure (advisory).
**No review requested.**

### Exact next action
Read the required check at exactly `ccf042921a642ce7bf093aa159532069227bd324`;
if green, open the PR and request independent review. **Not low risk** — it
changes the unit persisted on a user's factor.

---

## C — SINGLE-SNAPSHOT RACE · `feat/single-snapshot-turn-binding` @ `e65d0a6d92d0d953f9558758fe54527bc5201835`

### State: coded, green locally, NOT reviewed, NOT CI-verified

Work was stopped at handover per instruction. Everything is committed and
pushed; **there are no uncommitted changes anywhere.**

### The exact failing test, and the coordination answer
`src/orchestrator-v5/__tests__/run-analysis-single-snapshot.test.ts`, banked by
SDL on `feat/single-snapshot-run-analysis` @
`b1af565d9c931a5e3d505755f48e239936f5ae61`.

**Re-executed in this session at the POST-MERGE staging tip `9b98fcd0`** —
still RED, same two hashes SDL reported (`08efc1d87bd245cb` freshness vs
`038423e339e50c1a` fact), control still passing. **So #1660 does not close it.**
That corroborates by execution what the Core lane had measured by file list
(#1660 touches neither call site, positive control `route-v2` = 1). The race is
**unowned**, not parked behind a PR.

### First wrong boundary
A `run_analysis` turn reads `scenarios.graph` TWICE with nothing joining them:

- **read A** `build-turn-context.ts` `loadPersistedScenarioStateStrict` → the
  turn's FRESHNESS verdict;
- **read B** `tools/registry.ts` `DEFAULT_SCENARIO_READER` →
  `loadScenarioSnapshotForRunAnalysis` → stamps `graph_hash_at_run` on the
  run_analysis fact.

A write between A and B makes the two describe different persisted states,
silently, with no refusal.

### The fix as implemented (review this decision first)
The banked test admits reuse OR refusal and rejects only silent divergence.
**This REFUSES**, because reusing read A would change WHAT GETS ANALYSED (a
~30s-old graph) — a semantic change to the product — whereas refusing changes
only availability on a genuinely concurrent write and leaves every non-racing
turn byte-identical.

Files:
- **NEW** `src/orchestrator-v5/run-analysis-snapshot-binding.ts` — an
  AsyncLocalStorage binding (`bindAnalysisSnapshotForTurn` via `enterWith`,
  `runWithBoundAnalysisSnapshot` for tests, `currentBoundAnalysisSnapshot`), the
  total derivation `analysisGraphIdentityOf`, the `NO_CLAIM` symbol, and
  `AnalysisSnapshotDivergedError`.
- `src/orchestrator-v5/turn-executor.ts` — binds read A's identity for EVERY
  turn immediately after `buildTurnContext` (not only run_analysis turns: the
  reader is reached from more than one branch, and a hand-listed set of binding
  sites is the maintained-mirror defect).
- `src/orchestrator-v5/build-turn-context.ts` — the refusal inside
  `loadScenarioSnapshotForRunAnalysis`, placed BEFORE the null-graph branch so a
  graph DELETED mid-turn is not answered with "draft a model first".
- `src/orchestrator-v5/__tests__/run-analysis-single-snapshot.test.ts` — SDL's
  reproduction preserved verbatim apart from the binding wrapper (commented in
  place), plus four controls.

**Why a context and not a parameter:** `ScenarioReader` is
`(scenarioId, signal?)`, the handler passes only the signal, and production
resolves a process-memoised registry. An `expectedGraphHash` parameter would be
a guard with no producer — the shape SDL's own scope note refused to ship.

### ⚠ The measured trap, do not undo it
`computeAnalysisAffectingGraphHash` **THROWS** on a persisted graph it cannot
project. An unguarded producer turned five green tests red with
`TypeError: nodes.map is not a function`, on the legacy graphs the product
deliberately serves as `freshness: unknown`. Hence one total derivation and a
THIRD state: **`NO_CLAIM` ≠ `null`**. `null` = "no graph", which two reads can
agree on; `NO_CLAIM` = "unhashable", about which nothing can be compared, so the
guard stands down rather than inventing agreement OR divergence.

### Test status
`run-analysis-single-snapshot.test.ts` 6/6 green (SDL's control + SDL's
reproduction, now satisfied via the refusal branch + 4 added controls). The
three suites the unguarded version broke are green again.
`npm run typecheck` exit 0.

**The 306-file regression completed: 301 passed, 5 failed — and the 5 are load
flakes, measured rather than assumed.** All five pass when re-run alone
(5 files / 40 tests, exit 0). Four failed as bare `Test timed out in 5000ms`
and the fifth as a latency assertion (`expected 1633 to be less than 1030`);
none asserts on a symbol this branch touches, and the set differed between two
runs of the same tree. Load average at the time was **26.45**, above the
threshold of 25 at which this repo's own `guard-load.sh` declares local numbers
void ("at load 43-67 a PRISTINE baseline produced 26 failures across 23 files").

⚠ An EARLIER 306-file run failed differently and that one was REAL: five tests
red with `TypeError: nodes.map is not a function` from the unguarded producer.
That is the trap described below, and it is fixed. Do not confuse the two runs.

**CI is the authority. Read the required check at the head, not this table.**

### Known gap the successor must decide
`AnalysisSnapshotDivergedError` is caught by the run_analysis handler's generic
reader catch and re-wrapped as `HandlerInvocationFailedError('scenario_read_failed',
retryable: true)`. Retryable is the **correct disposition**, but the user-facing
copy will read as an infra failure rather than "the model changed while this was
being prepared". Giving it its own `cause_kind` touches a closed telemetry enum,
so it was **not** done. Decide before merging.

### Exact next action
Re-run the 306-file regression at `e65d0a6d92d0d953f9558758fe54527bc5201835`,
read the required check, then get an independent review of the **refuse vs
reuse** decision before anything else — that is the only judgement in this
branch that is not settled by measurement.

---

## D — FIVE BRANCHES FROM EARLIER THE SAME DAY, FINISHED AND UNREVIEWED

⚠ **These were missing from the first draft of this handover and would have been
lost.** All five are alive at the remote, verified by `git ls-remote` at
stand-down. None is merged; none has a review.

| Repo | Branch | Head (40 chars, remote-verified) |
|---|---|---|
| PLoT | `feat/goal-direction-passthrough` | `3e3c3bad35fe49c8aebfc95a4cd03ec806d959da` |
| CEE | `feat/goal-direction-minimise-only` | `88906ce9399006d05fec4af7c9b8a1be5fd43915` |
| CEE | `feat/coaching-structure-marking` | `a2d7c5bcabe9d2ee092cdb078e0e0b7f51393f71` |
| CEE | `fix/nested-quotes` | `30ee4f097624f8b53bb5f7552ea5141a671eb24e` |
| CEE | `fix/receipt-guard-consequences` | `96f6db5bae04d35d85d61e1a6f3af98684af92b4` |

**What they are.** The two `goal-direction` branches are one change across the
seam: PLoT forwards the user's attested `goal_direction` to ISL (gated, with a
`target` guard because ISL 422s on `target` without `goal_threshold` AND
`goal_threshold_frame`), and CEE emits it — **minimise only**, deliberately,
because the label-intent deriver returns `undetermined` for phrasings like
"Improve conversion rate" and emitting a guess would be worse than emitting
nothing. Without them, reduce-goals rank backwards at ISL. The brief written for
the reviewer is `earlier-today/CODEX-BRIEF-GOAL-DIRECTION.md`.
`fix/nested-quotes` fixes label quoting that mangled nested quotes;
`fix/receipt-guard-consequences` turns the goal-target receipt guard's
enforcement into a returned contract (`withholdGraphWrite` /
`withholdReceiptFacts`) instead of prose the caller restates;
`feat/coaching-structure-marking` adds the no-colon `sectionHeader()` the UI
lane asked for.

⛔ **The PLoT branch's last push was blocked by the husky pre-push hook**
(`structural-keys.generated.ts` drift) and the failure was initially masked
because `PUSH_EXIT` had captured `tail`'s status, not git's. It was regenerated
with `tools/gen-structural-keys.mjs` and the SHA above IS at the remote — but
**re-verify before building on it**, and never read a push's exit code through a
pipe.

### Exact next action for D
Treat them as a review queue, not as new work. The PLoT/CEE pair must land
together or not at all — CEE emitting a direction PLoT does not forward is
inert, and PLoT forwarding one CEE never emits is a guard with no producer.

---

## E — EVIDENCE THAT IS **NOT** BANKED, AND WHERE IT IS

`/Users/paulslee/Documents/GitHub/output/` is **6.2 GB across 64,613 files** and
**is not a git repository**. It holds ~200 directories spanning many lanes and
several weeks (canvas, panel, producer, core, SDL, recovery bundles), so it was
NOT committed wholesale: most of it is not this lane's to publish, and a 6.2 GB
commit would be its own incident.

**What WAS lifted into this repo** (`earlier-today/`): the eight constraint-chain
derivations and the panel-lane open-question register. Together with the two
first-wrong-boundary documents beside this file, that is the whole of this
lane's written output for 21–22 Sep.

**What is therefore local-disk-only, on this machine:** everything else under
`output/`. If the successor is on a different machine, that material does not
travel. Named so it is a disclosure rather than a silent gap.

### Open question still on the register
`earlier-today/PANEL-LANE-BLOCKED-NOW.md` carries one unanswered item for the
producer lane: **which path minted `goal_threshold_cap = 140` with no
provenance, and can it still run?** The current resolver cannot have produced it
— it bounds the percentage rule at `raw <= 100` and would mint `137.5`, not
`140`, with provenance `target_derived_headroom`. So those rows are residue from
a retired path or model authorship. Not this lane's to close.

### Canvas ASK 2 — unanswered, and correctly so
Canvas asked a second question (747 of 1850 rendered factors carry no value;
`display_value` present on 7 of 8 factors but declared in no schema). It was
**not** answered: the valueless-factor root cause belongs to the Brief→Canonical
producer lane and the ranking half to analysis/ISL. ASK 1 **was** answered and
delivered (`earlier-today/CANVAS-ASK-1-ANSWER.md`), including a correction — my
first reply claimed the `goal_threshold` mint was broken and that I was taking
it; the resolver is correct and the claim was withdrawn in the delivered file.

---

## PROVEN FACTS (measured this session — do not re-derive)

1. Handler-routed committed turn ids agree with the fence **16/341 (4.7%)**;
   every other class **372/659 (56.4%)**. Sample: the 1000 most recent
   `v5_conversation_turns` rows over 7 days (PostgREST caps the page at 1000 —
   a sample, not a manifest), joined client-side against all `v5_turn_fence`
   rows for the same 359 scenarios. The contrast control fires.
2. `OrchestratorTurnRequest.client_turn_id` (`orchestrator/types.ts:117`,
   commented "Client-generated turn ID for idempotency") has **zero readers
   estate-wide** — two occurrences in the whole tree, the declaration and a
   comment excluding it from hashing. Legacy v1. Not the live carrier.
3. **63 of 300** most recently-updated boards carry a rate-shaped factor unit.
4. CQE returns byte-identical results for `"£62 per month"` and `"£62"`.
5. `classifyUnitScaleClass('£/month') === classifyUnitScaleClass('£')` — both
   `unknown`. Carrying the denominator moves no scale verdict.
6. `computeAnalysisAffectingGraphHash` throws on unparseable persisted graphs.
7. SDL's single-snapshot reproduction still REDs at `9b98fcd0`, post-#1660.
8. The only required context on `staging` is `Lint, TypeCheck, Unit Tests`.
   `Graph Evaluator` is advisory and red on multiple heads.
9. The UI already derived the replay-identity chain independently on 3 Sep and
   left `retrySafety()` written-but-unwired in `deliveryUnknown.ts`.

## WHAT NOT TO RE-INVESTIGATE

- Whether persistence/SQL is at fault for replay recovery. **It is not** — the
  identity is destroyed upstream, in CEE. Do not send it back to SDL.
- Whether #1660 fixes the single-snapshot race. **It does not** — executed
  post-merge, same hashes.
- Whether the unit gate should be loosened. **It should not** — the gate is
  correct for its input; the defect is upstream of it.
- Whether `client_turn_id` is the carrier. It is dead.
- Whether the `£ ARR per customer` case is a false positive risk. It is; it is
  already controlled, along with two anchor controls U1 required.

## NEXT THREE ACTIONS

1. Read the required check at each of the three 40-char heads (filter
   `.status == "completed"` before `.conclusion`; `total_count == 0` is silence,
   not success). Fix anything red.
2. Open PRs for A and B and request **independent** review. All three branches
   are model-writing changes, so none is LOW RISK and none may be self-merged.
3. For C, re-run the 306-file regression and get the **refuse vs reuse**
   decision reviewed before merging.

## SCOPE BOUNDARY

AI Coaching owns only reusable deterministic correctness and fallback-path
health: replay/idempotency identity · single-snapshot consistency ·
action/input normalisation · write/receipt truth · analysis/constraint
correctness · context/state integrity.

**Do NOT expand:** bespoke conversational routing · new chips or handlers ·
broad prompt/controller architecture · cosmetic copy.

The current CEE route is the fallback/hedge. The OpenAI connected witness is the
programme's primary architecture test; this lane's job is to keep the
deterministic foundations and the fallback path trustworthy while that runs.

---

## F — THE LOCAL CLONES HOLD UNBANKED COMMITS THAT ARE **NOT** THIS LANE'S

Measured at stand-down, per repo, as `rev-list --count <branch> --not --remotes`
over every local branch:

| Local clone | Branches holding commits on NO remote | Commits |
|---|---|---|
| `DecisionGuideAI` | 116 | **312** |
| `olumi-assistants-service` | 68 | **123** |
| `plot-lite-service` | 27 | **141** |

**576 commits across 211 local branches exist on this machine and nowhere else.**
Largest single branches: PLoT `feat/engine-m1-guardrails` (27),
`feat/i-modes-inference-distinction` (14), `feat/templates-v1.2-clean` (12),
`feat/d1-determinism-single-source` (12); CEE `claude-cee/review-deliverable` (10).

⛔ **NONE of it was pushed, and that is deliberate.** It is other lanes' and
earlier sessions' work, on two PUBLIC repositories, which I have not read.
Pushing 576 unread commits to publish them would be a worse outcome than leaving
them where they are, and it is outside this lane's scope boundary either way.
This is a **pre-existing estate condition** — the clone census has recorded it
before — not something this session created.

**What the successor needs to know:** if the fresh account runs on a different
machine, that work does not travel. Whoever owns each branch has to decide, and
`scripts/clone-census.sh` is the tool that enumerates it (exit `2` =
could-not-measure = failure, never a pass).

### Two smaller items in the same class
- `plot-lite-service` has `CLAUDE.md` **staged but uncommitted** (`M ` in the
  index) on branch `docs/claude-md-restructure`, plus deletions of vendored
  ephemera (`.tooling/` 68 entries, `evidence/`, `tmp_release/`, `handoff/`).
  **Contrast control run: ZERO dirty files under `src/`, `tests/`, `contracts/`
  or `scripts/`** — so no authored source is uncommitted there, and no branch in
  that clone has unpushed commits relative to its own upstream.
- This lane's three code branches and this docs branch are the only things this
  session authored, and all four are at the remote, verified twice each.

---

# ⭐ SUCCESSOR ADDENDUM — 22 September 2026, later the same day

**Read this before acting on "NEXT THREE ACTIONS" above — those three are DONE.**

## What changed

**All three required checks were green.** A, B and C all passed `Lint, TypeCheck,
Unit Tests` at the exact heads recorded above. **PRs are now open for everything
in this handover**, and the D branches are in the queue too:

| PR | Branch | Note |
|---|---|---|
| CEE #1677 | `feat/durable-turn-identity` | A |
| CEE #1678 | `feat/natural-unit-rate-equivalence` | B — **head moved to `99b2826642c78e0e7e3a94bd8cb8b374a1caac9e`**, second fix added |
| CEE #1679 | `feat/single-snapshot-turn-binding` | C — carries the refuse-vs-reuse question + a measured blast radius |
| PLoT #365 + CEE #1680 | goal-direction | **atomic pair — PLoT FIRST** |
| CEE #1681 | `fix/receipt-guard-consequences` | |
| CEE #1682 | `fix/nested-quotes` | lower priority |
| CEE #1683 | `feat/coaching-structure-marking` | lowest priority; a `wip` commit sits in its history |

**Nothing has been merged. There are still no reviews anywhere in the CEE repo.**

## Three corrections to the body of this handover

1. ⛔ **"Opening a PR spends a production draft call" is NO LONGER TRUE.**
   `perf-gate.yml` on `staging` has no `pull_request:` trigger (only `main`
   does). Control: **13 workflow runs across three fresh PR heads, 0 Performance
   Gate.** The "push to `feat/**`, never open a PR" workaround is retired — which
   is why the whole queue above could finally be opened.

2. ⛔ **The replay failure mode is NOT a 409.** Witnessed at the wire: the retry
   returns **HTTP 200 — "Sales Cycle Length is already set to 14 months."** with a
   different `mutation_id` and a phantom duplicate turn in the user's history. No
   error anywhere. See `WIRE-REPLAY-WITNESS-20260922.md`.

3. ⚠ **`fix/**` branches get NO required check at all.** `ci.yml` runs it on
   `push: feat/**`. `fix/nested-quotes` and `fix/receipt-guard-consequences` both
   showed `total_count` 1 with the required context **absent** — silence, not
   success. Opening their PRs put them under CI for the first time.

## What is now proven that was not

- **The wire path is executed.** `WIRE-REPLAY-WITNESS-20260922.md` + the runnable
  harness in `witness/`. Re-running it after #1677 deploys is one command.
- **The deployed `append_turn_atomic_v5` decides replay BEFORE CAS** (lookup 82-86;
  `IF NOT v_turn_preexisting` 92→176; `OLGC1` at 168, nested inside), and
  `v5_claim_turn_fence` is idempotent. **Persistence and the fence are both
  correct.** This supersedes the 21 Sep note saying the migration was unshipped.
- ⭐ **The UI already sends a stable `turn_id` across a retry**
  (`retryLast:6283 → :3895 → buildPayload:201`). **#1677 needs NO UI change**, and
  it *restores* the retry affordance the UI removed from the wait-expiry and
  proxy-timeout paths. ⛔ But `deliveryUnknown.ts retrySafety()` concludes safety
  from reusing **`X-Request-Id`** — **false after #1677**; do not wire it as written.
- **C's blast radius:** of 5,534 `run_analysis` turns in 14 days, 20.7% overlap
  another turn, **1.6% overlap a graph-mutating handler, 0 overlap a proven write**
  (positive control: 1,193 turns did set `model_version_created`). `run_analysis`
  p50 is 42 s. Refusing is cheap; the recommendation is on #1679.

## The one blocker that needs a human

**The receipt half of the replay acceptance contract cannot be witnessed by any
key-authed harness.** Guest scenarios mint no `model_versions` (deployed v5 line
66), and a shared-key caller is refused `scenario_requires_authenticated_owner` on
an owned one. It needs a **staging test account**. Asked on programme issue #63;
unanswered at the time of writing. Until it is resolved, a GREEN witness proves
turn identity and no-duplicate, **not** receipt recovery — do not report it as the
full contract.

## Scenarios left on the shared database

Three, all guest, all titled `ZZZ-COACHING-REPLAY-WITNESS-20260922`:
`2fe77bff-…`, `800ed635-…`, `21ae5630-…` (the last is the one cited in the
witness). No pre-existing scenario was modified — control: the source board
`105baa8c-…` still shows `updated_at` 2026-09-19.
