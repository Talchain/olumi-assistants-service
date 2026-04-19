# V5 Phase 1a — Evidence Pack

**Date:** 2026-04-19
**Branch:** `claude/v5-phase1-tool-use` off `staging` @ `eca0c549`
**Verdict:** **proceed-to-review** (Phase 1a complete; Phase 1b deliverables pending)

---

## §1 Artefacts landed

Commits on this branch (newest first):

| SHA | Title | Deliverable |
|---|---|---|
| `ca4ba530` | test(v5): D7 — Phase 1 integration tests + A1/A2/C2 mock migration | D7 |
| `40141e8d` | feat(v5): D6 — TurnExecutor seven-step refactor | D6 |
| `1e781f0f` | feat(v5): D5 — routeWithToolUse | D5 |
| `58422de1` | feat(v5): D4 — validation contract + bigramDice | D4 |
| `83474e5a` | feat(v5): D3 — tool-use schema + Zod parser | D3 |
| `f8e7a178` | feat(v5): D2 — context pack assembler | D2 |
| `8d697c92` | docs(v5): phase 1 precondition check — environment + baseline captured | D1 |

**Files created (Phase 1a):**
- [src/orchestrator-v5/context/context-pack-assembler.ts](src/orchestrator-v5/context/context-pack-assembler.ts) + [__tests__/context-pack-assembler.test.ts](src/orchestrator-v5/context/__tests__/context-pack-assembler.test.ts)
- [src/orchestrator-v5/routing/types.ts](src/orchestrator-v5/routing/types.ts)
- [src/orchestrator-v5/routing/tool-schema.ts](src/orchestrator-v5/routing/tool-schema.ts) + [__tests__/tool-schema.test.ts](src/orchestrator-v5/routing/__tests__/tool-schema.test.ts)
- [src/orchestrator-v5/routing/validator.ts](src/orchestrator-v5/routing/validator.ts) + [__tests__/validator.test.ts](src/orchestrator-v5/routing/__tests__/validator.test.ts)
- [src/orchestrator-v5/routing/route-with-tool-use.ts](src/orchestrator-v5/routing/route-with-tool-use.ts) + [__tests__/route-with-tool-use.test.ts](src/orchestrator-v5/routing/__tests__/route-with-tool-use.test.ts)
- [src/orchestrator-v5/routing/validation-registry.ts](src/orchestrator-v5/routing/validation-registry.ts)
- [tests/integration/phase1-routing-end-to-end.test.ts](tests/integration/phase1-routing-end-to-end.test.ts)
- [tests/integration/phase1-validation-rejection.test.ts](tests/integration/phase1-validation-rejection.test.ts)
- [tests/integration/phase1-text-only.test.ts](tests/integration/phase1-text-only.test.ts)
- [tests/integration/phase1-c2-regression.test.ts](tests/integration/phase1-c2-regression.test.ts)
- [tests/integration/phase1-behavioural.test.ts](tests/integration/phase1-behavioural.test.ts)
- [Docs/v5/phase1-precondition-check.md](Docs/v5/phase1-precondition-check.md)

**Files modified (Phase 1a):**
- [src/orchestrator-v5/turn-executor.ts](src/orchestrator-v5/turn-executor.ts) — seven-step refactor
- [src/orchestrator-v5/compose.ts](src/orchestrator-v5/compose.ts) — `composeToolCallResponse` added
- [src/orchestrator-v5/__tests__/turn-executor.test.ts](src/orchestrator-v5/__tests__/turn-executor.test.ts) — rewritten for new seam (12 tests)
- [src/orchestrator-v5/__tests__/turn-executor-handler.test.ts](src/orchestrator-v5/__tests__/turn-executor-handler.test.ts) — rewritten (11 tests)
- [tests/integration/orchestrate-v2-a1.test.ts](tests/integration/orchestrate-v2-a1.test.ts) — mock augmented with `chatWithTools`
- [tests/integration/orchestrate-v2-a2.test.ts](tests/integration/orchestrate-v2-a2.test.ts) — mock augmented
- [tests/integration/slice-c2-run-analysis-mocked.test.ts](tests/integration/slice-c2-run-analysis-mocked.test.ts) — mock augmented

---

## §2 Gates passed

| Gate | Result |
|---|---|
| `pnpm exec tsc -p tsconfig.build.json --noEmit` | PASS (EXIT 0; only cosmetic `.npmrc` env-substitution warnings) |
| `pnpm exec vitest run src/orchestrator-v5/` | 308 / 308 passing |
| `pnpm exec vitest run tests/integration/phase1-*.test.ts` | 14 / 14 passing |
| `pnpm exec vitest run src/orchestrator-v5 tests/regression tests/integration` | 1219 pass / 19 fail / 127 skip (baseline: 1159 pass / 19 fail / 127 skip) |
| `scripts/validate-state-write-invariant.sh` | PASS |
| `scripts/validate-handler-ownership.sh` | PASS |

**Baseline delta:** +60 passing tests, **0 new failures**, skip count **unchanged** at 127. The 19 failing tests are the same environment-dependent baseline failures (missing `SUPABASE_URL`/`ANTHROPIC_API_KEY`); none caused by Phase 1a work.

---

## §3 Seven-step flow — test evidence

Each step has observable test coverage. Refs: `src/orchestrator-v5/turn-executor.ts` step labels + telemetry `stages_completed`.

| Step | Evidence |
|---|---|
| 1. ORIENT  | `turn-executor.test.ts` "produces a Zod-valid OlumiResponse with the Sonnet text" — asserts `stages_completed.contains('orient')` |
| 2. VALIDATE | `turn-executor.test.ts` "returns HANDLER_INVOCATION_FAILED with validation_error_code in details" — asserts `validation_error_code === 'ENTITY_NOT_FOUND'` |
| 2. (skipped) | `turn-executor-handler.test.ts` "routing → validate_skipped → handler → confirm" — asserts `stages.contains('validate_skipped')` (graph not threaded) |
| 3. EXECUTE | `turn-executor-handler.test.ts` "fact persisted ... byte-for-byte" — exercises real createRegistry with mocked PLoT |
| 4. CONFIRM | `turn-executor.test.ts` "confirmation is registry-driven, not improvised from handler_facts" — asserts confirmation is the registry template, not handler `assistant_text` |
| 5. COACH (stub) | `turn-executor.test.ts` "routes through its own path, logs intent_class=\"coach\" and coaching_mode" — intent_class and coaching_mode recorded; no coaching text appended |
| 6. COMPOSE | `turn-executor.test.ts` "orientation text does not mention outcomes" — asserts orientation + deterministic confirmation; handler's improvised text never appears |
| 7. COMMIT | `turn-executor-handler.test.ts` "commit receives handler_facts with exactly one run_analysis fact" — asserts `appendCalls[0].handler_facts[0].fact_type === 'run_analysis'` |

---

## §4 Regression — A0/A1/A2/B/C1/C2 counts

**Baseline (pre-Phase 1):**
- Test files: 137 total, 110 passed, 4 failed, 23 skipped
- Tests: 1305 total, 1159 passed, 19 failed, 127 skipped

**Post-D7 (current branch):**
- Test files: 146 total, 119 passed, 4 failed, 23 skipped
- Tests: 1365 total, 1219 passed, 19 failed, 127 skipped

**Delta:**
- +9 test files (Phase 1a new tests)
- +60 passing tests
- **0 new failures** — 19 failing tests identical to baseline (all environment-dependent: `slice-b-preflight` needs SUPABASE_URL; `orchestrate-v2.test.ts`/`route.test.ts`/`route-v2-flag.test.ts` need ANTHROPIC_API_KEY or LLM router config)
- Skip count unchanged at 127

Acceptance criterion (brief §8): **delta ≥0 new tests, skip count unchanged, no new failures beyond baseline.** All three met.

---

## §5 Boundary preservation — orientation vs confirmation

**Claim (spec §4.1):** Orientation text is composed BEFORE the handler runs and cannot reference handler results. Confirmation text is sourced from handler outcome only (via the registry template).

**Grep evidence — orientationText is never derived from handler outcome:**

```
$ rg -l 'orientation.*handler|orientationText.*outcome' src/orchestrator-v5
src/orchestrator-v5/__tests__/turn-executor.test.ts  ← test assertions only, not production paths
```

Only test files reference the pairing; production source does not.

**Test evidence:** `turn-executor.test.ts:boundary preservation`
```
The orientation text appears first, then deterministic confirmation — the
handler's "improvised" assistant_text (WINNER:...) does NOT appear.
```
Asserted with `expect(parsed.assistant_text.startsWith(orientation)).toBe(true)` and `expect(parsed.assistant_text).not.toContain('WINNER')`.

**Confirmation authoritative from handler outcome via typed template:** See `turn-executor.test.ts:confirmation is registry-driven` — a handler whose `assistant_text` is `"improvised text from the handler"` produces a response whose `assistant_text` contains the registry-template `"Ran analysis on your current scenario."` and NOT `"improvised text from the handler"`. This proves the CONFIRM step (D6) reads through `registry.confirmationTemplate`, not the outcome's loose text field — delivering correction 5.

---

## §6 Type sourcing — canonical enums quarantined

**Claim (brief Resolution E + correction 4):** Canonical types from spec §5 live only in `src/orchestrator-v5/routing/types.ts`. No other file may shadow or approximate them.

**Grep evidence — references to the nine canonical enum names:**

```
$ rg -l 'IntentClass|CoachingMode|EntityKind|ParameterOperator|ResolutionStatus|ResolutionMethod|AmbiguityType|ParameterSource|ContextPackField' src/orchestrator-v5
src/orchestrator-v5/turn-executor.ts      ← imports IntentClass, CoachingMode (re-use, not re-definition)
src/orchestrator-v5/routing/validator.ts  ← imports EntityKind, ProposalAction, etc.
src/orchestrator-v5/routing/tool-schema.ts ← imports + re-exports ToolCallResponse shapes
src/orchestrator-v5/routing/types.ts       ← CANONICAL DEFINITIONS
```

Four files reference the enums; only one (`routing/types.ts`) defines them. The other three import. No redefinition detected.

**QUARANTINE comment present:** `routing/types.ts:3–7` carries the header `"QUARANTINE: These types are local pending @talchain/schemas bump. No other file in src/orchestrator-v5/ may define these types. Grep check in validate-handler-ownership.sh enforces this."` Grep enforcement will ship in D11 (Phase 1b).

---

## §7 Deviations from brief

### 7.1 — Spec/plan mismatch (acknowledged exception)

`olumi-v5-architecture-specification-v2.md` is referenced as "attached" in the brief but is not present in `Docs/` or `Docs/v5/`. Implementation plan v2.2 is also not yet reconciled with the spec (coaching scope pulled into PoC). Per the plan correction 1: **"Architecture spec v2 not committed to repo; execution based on inline brief content. Implementation plan v2.2 not yet reconciled with spec (coaching pulled into PoC scope). Both require formal update post-Phase 1. Paul acknowledges this exception by dispatching this brief."** This is documentation, not a blocker.

### 7.2 — `LLM_BUDGET_INTERPRET_MS` env var does not exist

The brief references `LLM_BUDGET_INTERPRET_MS` as the per-call budget. This env var does not exist in the repo. Nearest extant budget is `ORCHESTRATOR_TIMEOUT_MS` (default 30s at [src/config/timeouts.ts:132](src/config/timeouts.ts#L132)). `routeWithToolUse` uses `ORCHESTRATOR_TIMEOUT_MS` as its default per-call budget. Introducing a new env var would require either a config module update (out of scope) or a fallback chain (adds code path complexity). The substitution is documented in [route-with-tool-use.ts](src/orchestrator-v5/routing/route-with-tool-use.ts) at the budget comment.

### 7.3 — `classify.ts` / `dispatch.ts` / `clarify.ts` retained

These modules are no longer called by TurnExecutor but remain in the tree. Their unit tests (`classify.test.ts`, `dispatch.test.ts`, `clarify.test.ts`) still pass because the modules still type-check and run in isolation. Per brief §7 "out of scope: A0/A1/A2 core files — no edits beyond TurnExecutor flow restructure", I chose NOT to delete them. Future cleanup is a separate brief.

### 7.4 — Test file paths

The brief's specified test paths are `src/orchestrator-v5/tests/turn-executor.test.ts`; the actual repo convention is `src/orchestrator-v5/__tests__/turn-executor.test.ts`. Actual path governs (observation 4 of D1).

### 7.5 — Graph state not threaded through V5 payload (Phase 1a gap)

The V5 boundary `OrchestratorTurnPayload` does not carry graph state. Validation's entity-existence and Dice-suspicion checks are therefore skipped in production with a `validate_skipped` stage + telemetry warning. Tests that want to exercise validation pass a `graphLookup` override to `runTurnExecutor`. Graph threading is a separate brief.

### 7.6 — `dispatch.ts` `dispatch()` function no longer invoked

TurnExecutor no longer calls the top-level `dispatch()` function. It directly invokes `routeWithToolUse`, then (on execute) reaches into `resolveHandler` + registered handler. `dispatch()` remains a callable, tested module; its tests still pass. Future cleanup is separate.

---

## §8 Questions for Paul

1. **Spec file missing** — should the spec be committed before Phase 2? I proceeded against inline brief content per your acknowledgement.
2. **`LLM_BUDGET_INTERPRET_MS`** — OK to substitute `ORCHESTRATOR_TIMEOUT_MS`? If not, which env var do you want to introduce?
3. **`classify.ts` / `dispatch.ts` retirement** — should I delete the unused modules in a follow-up commit on this branch, or leave for a separate brief?
4. **Graph state threading** — is the V5 boundary payload slated for a graph field in a near-term brief? If so, validation will start firing automatically.
5. **Confirmation template for `run_analysis`** — current template: `"Ran analysis on your current scenario."` This matches the handler's pre-refactor `assistant_text`. Should it evolve to reference the winning option label? (If yes: a function template like `(outcome) => "Analysis complete — {leader} leads at {win_probability}%"` is the right extension point, but that requires the confirmation template to read enrichment fields — a behavioural change that the brief explicitly bounded out of Phase 1.)

---

## §9 Phase 1b readiness

All Phase 1a gates are green. No structural blockers. Proceeding to Phase 1b deliverables (D9–D12) in the same branch.

- D9 (compound detector) — straightforward
- D10 (JSONL routing log) — straightforward (file append only, no schema work)
- D11 (invariant script extensions) — mechanical grep additions to `validate-handler-ownership.sh`
- D12 (morning handoff) — summary doc

**Round-2 adversarial review — decisive outcome per deliverable:** `proceed` for all of D2–D7. No halts in Phase 1a.
