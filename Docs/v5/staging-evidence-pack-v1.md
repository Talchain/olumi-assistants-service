# V5 A2 — Staging evidence pack v1

**Generated:** 2026-04-17
**Scope:** 8 scenarios covering A2 clarify-turn-class + pre-narrate classifier behaviour
**Pack status:** **INCOMPLETE — blocked on staging feature-flag configuration and Netlify deploy verification.** See §Blockers.

---

## Deploy state

### CEE (olumi-assistants-service)

| Attribute | Value |
|---|---|
| staging branch HEAD | `589cab4e` (fix(v5/a2): audit hardening) |
| Build deployed to Render | `589cab4` (confirmed via `/healthz`) |
| Server version | `1.12.0` |
| Server degraded | `false` |
| V5 route `/orchestrate/v2/turn` | **❌ 404 not registered** — `ENABLE_V5_ORCHESTRATOR` env var not set to `true` on Render CEE staging |

**Correction to prior audit 5:** The earlier 401-without-auth probe was misread. The server's auth middleware returns 401 for any path (including non-existent ones) when the key is missing, so 401 alone did not prove the V5 route was registered. With the key supplied, `/orchestrate/v2/turn` returns 404, identical to any unknown path — the route is **not registered**. This is gated by `config.features.orchestratorV5`, which reads `ENABLE_V5_ORCHESTRATOR`. See [src/config/index.ts:299,670](../../src/config/index.ts#L299).

### UI (DecisionGuideAI)

| Attribute | Value |
|---|---|
| staging branch HEAD | `7761986f` (chore(deps): regenerate package-lock.json) |
| Merge commit | `5d5ec3d8` (Merge `ui/ai-panel-tranche-1` into staging) |
| Merge-base | `b6b1222a` |
| GitHub Actions "Contract Validation" | ✅ success |
| GitHub Actions "TypeScript + Lint" | ✅ success |
| GitHub Actions "Production Build" | ✅ success |
| GitHub Actions "Full Test Suite" | ❌ 1 failure: `useConversation.hook.spec.ts:347` — pre-existing tranche-1 tech debt, not A2-related (see §Pre-existing failures) |
| GitHub Actions "Staging Gate" | ❌ blocked by Full Test Suite |
| Netlify build | **❓ status unknown** — GitHub check-suite reports "queued" for 5+ minutes; could not locate staging URL to probe directly |
| PR #119 | ✅ closed as superseded |
| `ui/ai-panel-tranche-1-followup` branch | ✅ deleted from origin |

---

## Blockers preventing live scenario capture

1. **CEE V5 feature flag is off on staging.** Paul needs to set `ENABLE_V5_ORCHESTRATOR=true` on the Render `cee-staging` service. Until then, every `/orchestrate/v2/turn` request returns 404 regardless of payload.

2. **Netlify deploy status unverified.** GitHub commit check-suite shows Netlify as "queued"; check-suite state is not authoritative (Render check-suite was also "queued" despite the CEE deploy actually succeeding). Paul's Netlify dashboard can confirm. The UI staging URL wasn't locatable from the repo (no `netlify.toml` hints, no README references, no env.example mention).

3. **UI VITE_ENABLE_V5_ORCHESTRATOR flag.** Even after Netlify build succeeds, the UI's V5 adapter only engages when `VITE_ENABLE_V5_ORCHESTRATOR === 'true'`. Paul needs to confirm this is set on the Netlify environment for staging.

4. **Live reproduction of failure scenarios is fundamentally not feasible.** Scenarios 3-8 below (timeouts, budget exceeded, contamination, unsupported class) require server-side mocking of the LLM response. Real staging runs against a real LLM provider; we cannot force a timeout, inject contamination, or make the classifier emit an out-of-union `turn_class`. Those scenarios are **test-level evidence only**. Scenarios 1-2 (direct_answer / clarify success) can be captured live once the flag is flipped.

---

## Pre-existing failures surfaced by this merge (NOT caused by A2)

**`src/canvas/conversation/__tests__/useConversation.hook.spec.ts` — 27 failures on `ui/ai-panel-tranche-1` branch alone.**

- Root cause: the Tranche 1 commit `f841cac0 feat(ui): AI panel Tranche 1 — surgical V4 fixes` refactored `useConversation.ts` without updating this test suite. The test expects `mockStreamTurn` to be called, but Tranche 1's routing changed and it isn't.
- Verified pre-existing: I ran `vitest` directly on the `ui/ai-panel-tranche-1` worktree (which had not yet been merged to staging) and reproduced the same failures.
- Not A2-related: my A2 UI commit (`2fa943f6`) only touches `src/v5/eligibility.ts` JSDoc + 2 files under `src/v5/__tests__/`. It does not touch `useConversation.ts` or `useConversation.hook.spec.ts`.
- Also surfaced: the UI repo had drift between `package.json` (referencing `@talchain/schemas@0.4.0`) and `package-lock.json` (still pointing at `0.3.0`), which blocked `npm ci` in CI. This drift originated in A1 commit `b6b1222a` (which updated `pnpm-lock.yaml` but not `package-lock.json`). Fixed by commit `7761986f`.

**Suggested follow-ups (out of A2 scope):**
- Update `useConversation.hook.spec.ts` to match Tranche 1's refactored routing, OR revisit whether `mockStreamTurn` is still the right seam.
- Decide whether the UI repo should keep both `package-lock.json` and `pnpm-lock.yaml`, or drop `pnpm-lock.yaml` (introduced incidentally by A1).

---

## 8-scenario evidence

For each scenario below, the table records:
- **Wire response** (CEE `OlumiResponse` envelope shape, when live-captured or test-proven)
- **UI render** (how the assistant-text and/or typed-error block renders)
- **Telemetry** (key fields from `turn_executor.completed`)
- **Status** — `live` (captured from staging now), `test-proven` (covered by unit/integration tests, verifiable via suite), or `blocked` (needs staging flag flip)

### Scenario 1 — Direct answer success

User sends an unambiguous message like "Give me a short framing for this decision."

| Field | Expected value |
|---|---|
| HTTP status | 200 |
| `assistant_text` | LLM-generated prose, 2-3 paragraphs |
| `blocks` | `[]` |
| `suggested_actions` | `[]` |
| `insights` | `[]` |
| `stage_indicator` | `"frame"` |
| `turn_class` (completed event) | `"direct_answer"` |
| `llm_calls_used` | `2` (classifier + narrate) |
| `commit_performed` | `true` |
| `failure_type` | `null` |
| `stages_completed` contains | `classify`, `dispatch`, `compose`, `commit` |

**UI render:** Clarifying text appears as a regular assistant message bubble. No error UI. No chips.

**Status: blocked** — staging flag off. Test-proven via [tests/integration/orchestrate-v2-a1.test.ts](../../tests/integration/orchestrate-v2-a1.test.ts) "happy path" and [src/orchestrator-v5/__tests__/turn-executor.test.ts](../../src/orchestrator-v5/__tests__/turn-executor.test.ts) "happy path (direct_answer success)".

### Scenario 2 — Clarify success

User sends an ambiguous message like "help me" or "not sure".

| Field | Expected value |
|---|---|
| HTTP status | 200 |
| `assistant_text` | A short clarifying question (e.g. "What decision are you weighing?") |
| `blocks` | `[]` |
| `suggested_actions` | `[]` |
| `insights` | `[]` |
| `stage_indicator` | `"frame"` |
| `turn_class` (completed event) | `"clarify"` |
| `llm_calls_used` | `2` |
| `commit_performed` | `true` |
| `failure_type` | `null` |

**UI render:** Clarifying question appears as a regular assistant message bubble (structurally identical to direct_answer render; `turn_class` is CEE-telemetry-only, not on the wire envelope).

**Status: blocked** — staging flag off. Test-proven via [tests/integration/orchestrate-v2-a2.test.ts](../../tests/integration/orchestrate-v2-a2.test.ts) "clarify-happy" and [src/orchestrator-v5/__tests__/turn-executor.test.ts](../../src/orchestrator-v5/__tests__/turn-executor.test.ts) "happy path (clarify success)".

### Scenario 3 — Classifier timeout

Classifier call exceeds `LLM_BUDGET_NARRATE_MS`.

| Field | Expected value |
|---|---|
| HTTP status | 200 |
| `blocks[0].type` | `"error"` |
| `blocks[0].error_code` | `"UPSTREAM_TIMEOUT"` |
| `blocks[0].details.phase` | `"classify"` |
| `assistant_text` | `FAILURE_USER_TEXT["UPSTREAM_TIMEOUT"]` |
| `turn_class` (completed event) | `null` (classifier never resolved) |
| `llm_calls_used` | `0` (classifier did not complete with usable output) |
| `commit_performed` | `false` |
| `failure_type` | `"UPSTREAM_TIMEOUT"` |

**UI render:** TypedErrorRenderer displays "An upstream service did not respond in time. Please retry."

**Status: test-proven only** — not reproducible live. Covered by [src/orchestrator-v5/__tests__/turn-executor.test.ts](../../src/orchestrator-v5/__tests__/turn-executor.test.ts) "maps classify upstream timeout to UPSTREAM_TIMEOUT with phase='classify'".

### Scenario 4 — Narrate timeout (after successful classify)

Classifier succeeds; narrate call exceeds its budget.

| Field | Expected value |
|---|---|
| HTTP status | 200 |
| `blocks[0].error_code` | `"UPSTREAM_TIMEOUT"` |
| `blocks[0].details.phase` | `"narrate"` |
| `turn_class` (completed event) | `"direct_answer"` or `"clarify"` (whichever classifier resolved) |
| `llm_calls_used` | `1` (classifier completed) |
| `commit_performed` | `false` |
| `failure_type` | `"UPSTREAM_TIMEOUT"` |

**UI render:** TypedErrorRenderer displays upstream-timeout message.

**Status: test-proven only** — covered by turn-executor.test.ts "maps narrate upstream timeout to UPSTREAM_TIMEOUT with phase='narrate'" and "clarify branch narrate timeout: turn_class=clarify + llm_calls_used=1".

### Scenario 5 — Budget exceeded mid-classify

Outer `TURN_BUDGET_MS` elapses while classifier call is in flight.

| Field | Expected value |
|---|---|
| HTTP status | 200 |
| `blocks[0].error_code` | `"TURN_BUDGET_EXCEEDED"` |
| `blocks[0].details.budget_ms` | the configured outer budget |
| `turn_class` (completed event) | `null` |
| `llm_calls_used` | `0` |
| `commit_performed` | `false` |
| `failure_type` | `"TURN_BUDGET_EXCEEDED"` |

Precedence: outer-wall-clock abort takes priority over any inner LLM_TIMEOUT the adapter might have reported (Paul's constraint 7).

**UI render:** TypedErrorRenderer displays "That took longer than we allow for a single turn. Please retry."

**Status: test-proven only** — covered by turn-executor.test.ts "outer budget aborts during slow classifier → BUDGET_EXCEEDED, llm_calls_used=0, turn_class=null".

### Scenario 6 — Budget exceeded mid-narrate

Classifier completes; outer budget elapses during narrate.

| Field | Expected value |
|---|---|
| HTTP status | 200 |
| `blocks[0].error_code` | `"TURN_BUDGET_EXCEEDED"` |
| `turn_class` (completed event) | `"direct_answer"` or `"clarify"` |
| `llm_calls_used` | `1` (classifier completed) |
| `commit_performed` | `false` |
| `failure_type` | `"TURN_BUDGET_EXCEEDED"` |

**UI render:** Same as scenario 5.

**Status: test-proven only** — covered by turn-executor.test.ts "outer budget aborts during narrate (after successful classify) → BUDGET_EXCEEDED, llm_calls_used=1, turn_class resolved".

### Scenario 7 — Contamination stripped, response succeeds (BI-02)

LLM returns output containing XML-like tags or banned terms.

| Field | Expected value |
|---|---|
| HTTP status | 200 |
| `assistant_text` | sanitised text (tags stripped, em-dashes replaced) |
| `blocks` | `[]` |
| `turn_class` (completed event) | `"direct_answer"` or `"clarify"` |
| `llm_calls_used` | `2` |
| `commit_performed` | `true` |
| `failure_type` | `null` |
| Telemetry event `turn_executor.contamination_narrate` fires | yes, with `turn_class` field |

**UI render:** Normal assistant message bubble with the sanitised text.

**Status: test-proven only** — covered by turn-executor.test.ts "BI-02 contamination (sanitiser in-band)" and "clarify-branch contamination also emits the telemetry event".

### Scenario 8 — Unsupported turn_class from valid classifier output (P0)

Classifier returns well-formed JSON such as `{"turn_class":"propose"}` — a value outside the `A2TurnClass` union.

| Field | Expected value |
|---|---|
| HTTP status | 200 |
| `blocks[0].error_code` | `"INTERNAL_ERROR"` |
| `blocks[0].details.reason` | `"unhandled_turn_class"` |
| `assistant_text` | `FAILURE_USER_TEXT["INTERNAL_ERROR"]` |
| `turn_class` (completed event) | `null` |
| `llm_calls_used` | `0` |
| `commit_performed` | `false` |
| `failure_type` | `"INTERNAL_ERROR"` |

**Critical invariant:** This must NOT map to `LLM_UNAVAILABLE`. A well-formed classifier output with an unsupported `turn_class` is a P0 invariant breach (contract says the LLM cannot return this), not a recoverable schema violation. Paul's correction 3.

**UI render:** TypedErrorRenderer displays "Something went wrong on our side. Please retry."

**Status: test-proven only** — covered by turn-executor.test.ts "UNHANDLED tripwire (A2: valid JSON but unsupported class)" and classify.test.ts "unsupported class → UnhandledTurnClassError (P0)".

---

## Test-suite evidence summary

The 8 scenarios' behaviour is fully specified by the 159 tests in the CEE A0+A1+A2 scope:

| Test file | Tests | Covers scenarios |
|---|---:|---|
| `src/orchestrator-v5/__tests__/classify.test.ts` | 15 | 2, 3, 8 + schema violation taxonomy |
| `src/orchestrator-v5/__tests__/clarify.test.ts` | 7 | 2, 4, 7 |
| `src/orchestrator-v5/__tests__/dispatch.test.ts` | 10 | 1-8 (seam-level) |
| `src/orchestrator-v5/__tests__/turn-executor.test.ts` | 27 | 1-8 (end-to-end incl. telemetry) |
| `src/orchestrator-v5/__tests__/compose.test.ts` | 4 | 1, 2 (envelope shape) |
| `src/orchestrator-v5/__tests__/budgets.test.ts` | 10 | 5, 6 (budget independence) |
| `src/orchestrator-v5/__tests__/sanitise.test.ts` | — | 7 (contamination) |
| `src/orchestrator-v5/__tests__/failure-response.test.ts` | — | 3, 4, 5, 6, 8 (envelope wire shape) |
| `tests/integration/orchestrate-v2.test.ts` | 7 | route boundary (B1) |
| `tests/integration/orchestrate-v2-a1.test.ts` | 5 | 1, 3, 4, 5, 7 |
| `tests/integration/orchestrate-v2-a2.test.ts` | 4 | 2, 4, 7, BI-01 |
| Plus A0 / server-boot / prompts defaults | — | boundary contract, route registration |
| **Total** | **159** | all 8 scenarios + BI-01 + BI-02 + constraint-7 precedence |

The full scoped test run also completed green in the pre-push hook (568 UI tests on the UI repo side at push time; pre-existing `useConversation.hook.spec.ts` failure is not in the pre-push smoke scope).

---

## Unblock sequence (for Paul)

To complete the live evidence pack:

1. **Set `ENABLE_V5_ORCHESTRATOR=true`** on the `cee-staging` service in Render dashboard. Redeploy (or restart). Verify `/orchestrate/v2/turn` no longer 404s (with key).
2. **Confirm Netlify staging URL** — check Netlify dashboard for the `decisionguide-ai` (or equivalent) site. Confirm build triggered by `staging` push completed. Capture the staging URL.
3. **Set `VITE_ENABLE_V5_ORCHESTRATOR=true`** on the Netlify staging environment. Trigger a redeploy if needed.
4. **Drive scenarios 1 + 2 from the staging UI** with real inputs:
   - Scenario 1: unambiguous message → real classifier → narrate → direct_answer envelope.
   - Scenario 2: ambiguous message → real classifier → clarify → clarify envelope.
   Capture wire responses (from browser devtools or BFF logs) + screenshots of the UI bubble.
5. **Scenarios 3-8 remain test-only.** They cannot be produced in a live environment without injecting mocks into the staging LLM seam, which is out of scope and would require a staging-specific test-mock feature flag. The 159-test suite is the authoritative evidence.

---

## Known follow-ups (logged separately)

- **UI useConversation.hook.spec.ts tech debt** (pre-existing on tranche-1, surfaced by merge): 27 failures in that file need Tranche 1's routing changes reflected. Out of A2 scope; Paul's call.
- **UI dual lockfile question**: `package-lock.json` (CI-validated) + `pnpm-lock.yaml` (dev-only, introduced by A1) coexist. Decide canonical.
- **Netlify staging URL discoverability**: no `netlify.toml` context configured; no README reference. Worth adding for future sessions.
- **CEE `ENABLE_V5_ORCHESTRATOR` flag flip**: staging deploy includes A2 code but doesn't route it. Flip when ready to accept traffic.
