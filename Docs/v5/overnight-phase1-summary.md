# V5 Phase 1 — Overnight summary

**Phase 1a verdict:** `proceed-to-review`
**Phase 1b status:** `completed`
**Branch:** `claude/v5-phase1-tool-use` (off `staging` @ `eca0c549`)
**Push status:** branch pushed; PR open against `staging`; no merge

---

## What shipped

### Phase 1a (must-ship)

| Deliverable | Commit | Verdict |
|---|---|---|
| D1 precondition check | `8d697c92` | proceed |
| D2 context pack assembler (11 tests) | `f8e7a178` | proceed |
| D3 tool-use schema + Zod parser (18 tests) | `83474e5a` | proceed |
| D4 validator + bigramDice (19 tests) | `58422de1` | proceed |
| D5 routeWithToolUse (15 tests) | `1e781f0f` | proceed |
| D6 TurnExecutor seven-step refactor (23 tests) | `40141e8d` | proceed |
| D7 integration + regression tests (14 tests) | `ca4ba530` | proceed |
| D8 evidence pack | `1589915f` | proceed |

### Phase 1b (opportunistic — all landed)

| Deliverable | Commit |
|---|---|
| D9 compound detector (10 tests) | `5d3dd195` |
| D10 routing log JSONL (10 tests) | `43b466d8` |
| D11 invariant script extensions (4 new checks) | `fa244016` |
| D12 this handoff | (pending after write) |

---

## Seven-step flow status

All seven steps from spec §4.1 are wired in [src/orchestrator-v5/turn-executor.ts](src/orchestrator-v5/turn-executor.ts):

| Step | Status | Notes |
|---|---|---|
| 1. ORIENT | Live | Calls `routeWithToolUse` with assembled ContextPack |
| 2. VALIDATE | Live / Skipped | Live when `graphLookup` is injected (tests); skipped in production with telemetry until graph state is threaded through the V5 payload |
| 3. EXECUTE | Live | Reuses existing `HandlerRegistry` (contract unchanged) |
| 4. CONFIRM | Live | Registry-driven typed template (correction 5) |
| 5. COACH | **Stub** | `return null`; Sonnet's intent_class="coach" classification is preserved in telemetry for Phase 2 measurability (correction 2) |
| 6. COMPOSE | Live | `composeToolCallResponse` for execute; `composeDirectAnswerResponse` for converse/coach; `composeClarifyResponse` for clarify |
| 7. COMMIT | Live | `commitDirectAnswer` via `append_turn_atomic` (unchanged) |

---

## Regression

| | Baseline (pre-D1) | Post-D12 (current) | Delta |
|---|---:|---:|---:|
| Test files | 137 | 148 | +11 |
| Passing tests | 1159 | 1239 | **+80** |
| Failing tests | 19 | 19 | **0** (same environment-dep failures) |
| Skipped tests | 127 | 127 | **0** |
| Total tests | 1305 | 1385 | +80 |

**Baseline failures unchanged:** `slice-b-preflight.test.ts` (SUPABASE_URL), `orchestrate-v2.test.ts` / `route-v2-flag.test.ts` / `route.test.ts` (ANTHROPIC_API_KEY / LLM router config).

**Invariant scripts:** `validate-state-write-invariant.sh` PASS; `validate-handler-ownership.sh` PASS (11 checks including new D11 Phase 1 guards).

**BI-01:** preserved across every turn path (verified in turn-executor + turn-executor-handler + phase1-routing + phase1-validation-rejection + phase1-text-only + phase1-c2-regression + phase1-behavioural).

---

## Resolution outcomes

| # | Resolution | Outcome |
|---|---|---|
| A | Classifier replacement | Inline replacement — TurnExecutor now calls `routeWithToolUse` directly. `classify.ts` / `dispatch.ts` retained but unused; their tests still pass. |
| B | Context pack location | New module `src/orchestrator-v5/context/context-pack-assembler.ts`. |
| C | Anthropic SDK tool-use pattern | `tools: [OLUMI_ACTION_TOOL]` + `tool_choice: { type: 'auto' }` — production path. Tool-call = routing proposal; text-only = inferred `converse`. |
| D | Entity plausibility | Bigram Dice coefficient (`bigramDice()` in validator.ts); threshold `SUSPICIOUS_DICE_THRESHOLD = 0.15`. Conservative: flags for clarification, never silently overrides. |
| E | Type sourcing | All nine spec §5 enums defined only in `src/orchestrator-v5/routing/types.ts` with QUARANTINE header. D11 grep enforcement landed. |
| F | Routing log persistence | JSONL file append to `logs/v5-routing-logs.jsonl`. No Supabase write; fact contract preserved. |

Correction outcomes:

1. Spec/plan mismatch → recorded as acknowledged exception in evidence pack §7.1.
2. Coach intent path → distinct code path in TurnExecutor; intent_class="coach" + coaching_mode in telemetry; runtime behaviour matches direct_answer. Measurability test `coach vs converse distinction` proves it.
3. Compound detector header → file-header comment labels the heuristic TEMPORARY per spec's "explicit temporary policy" framing.
4. Local enum quarantine → QUARANTINE header in `routing/types.ts`; D11 grep enforces no redeclaration elsewhere.
5. Typed-per-handler confirmation → `HandlerValidationDeclaration.confirmation_template` field; `renderConfirmation` in TurnExecutor calls through it; test `confirmation is registry-driven` proves it isn't derived from handler `assistant_text`.

---

## Questions for Paul

From evidence pack §8:

1. **Spec file missing** — should `olumi-v5-architecture-specification-v2.md` be committed before Phase 2 dispatches?
2. **`LLM_BUDGET_INTERPRET_MS`** — is substituting `ORCHESTRATOR_TIMEOUT_MS` acceptable, or do you want a new env var?
3. **`classify.ts` / `dispatch.ts` retirement** — delete in a follow-up commit on this branch, or defer to a separate brief?
4. **Graph state threading through V5 payload** — is this slated for a near-term brief? Validation's entity-existence + Dice-suspicion checks will start firing as soon as it lands.
5. **run_analysis confirmation template** — current text matches the pre-refactor `assistant_text` ("Ran analysis on your current scenario."). Should it evolve to reference the winning option's label/probability? (That changes what the confirmation reads from — explicitly bounded out of Phase 1 scope.)

---

## Push recommendation

**Proceed.** The branch implements Phase 1a + 1b in full; all gates green; regression delta is +80 passing tests and zero new failures; invariants preserved. This is an architectural refactor with higher blast radius than C2 — per brief §6, merge waits on Paul review.

Open the PR against `staging` with the evidence pack as the body. Do not force-push, do not merge overnight.

---

## Commit ladder (branch HEAD working backwards)

```
(D12) this handoff
fa244016  feat(v5): D11 — extend handler-ownership invariant for Phase 1
43b466d8  feat(v5): D10 — routing log (JSONL file, Phase 1b)
5d3dd195  feat(v5): D9 — compound detector (Phase 1b)
1589915f  docs(v5): D8 — Phase 1a evidence pack
ca4ba530  test(v5): D7 — Phase 1 integration tests + A1/A2/C2 mock migration
40141e8d  feat(v5): D6 — TurnExecutor seven-step refactor (Phase 1a)
1e781f0f  feat(v5): D5 — routeWithToolUse (Phase 1a)
58422de1  feat(v5): D4 — validation contract + bigramDice (Phase 1a)
83474e5a  feat(v5): D3 — tool-use schema + Zod parser (Phase 1a)
f8e7a178  feat(v5): D2 — context pack assembler (Phase 1a)
8d697c92  docs(v5): phase 1 precondition check
```
