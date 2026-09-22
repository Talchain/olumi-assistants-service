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
refused it because the original write had moved the graph head. That is the 409.

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
