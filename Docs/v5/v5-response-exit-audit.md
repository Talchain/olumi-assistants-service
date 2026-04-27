# V5 response exit audit

**Phase 0 of the "V5 response finaliser: structurally guaranteed analysis_ready" brief.** Maps every HTTP exit path that returns an `OlumiResponse` (or a `BoundaryError`) from the V5 dispatch in `src/orchestrator/route-v2.ts`, so the response finaliser can be wired at a single (or minimal) convergence point rather than per-composer.

**Verified at:** branch `claude/v5-response-finaliser` HEAD `14e1966b` (off staging `33c2a872` plus the four CEE-1..3 commits from the previous brief). Confirmed with `git diff 33c2a872..HEAD -- src/orchestrator/route-v2.ts` — zero changes to route-v2.ts since the audit fixture, so the line numbers below are authoritative.

> **External review correction (2026-04-27).** An external CC review caught two P1 gaps in the original implementation: (1) the grep gate enforced "do not write `analysis_ready` directly" but did NOT enforce "every 200-OK send must go through the finaliser" — a new `reply.code(200).send` could bypass without writing the field; (2) the egress-drift fallback was sent unfinalised, contradicting this doc's claim that fallbacks are stamped. Both are fixed in commit `<filled in by commit>` by introducing a `sendFinalised200` helper that is the SOLE 200-OK exit site in route-v2.ts. The helper finalises the candidate, validates egress, and on drift finalises the validator-built fallback before sending. The grep gate now also fails when `reply.code(200).send` appears anywhere in route-v2.ts outside the helper body. Sections below describe the post-fix architecture; the original per-site wiring is no longer accurate.

## Exit-point table

| # | Path | Dispatch / producer | Exit line in `route-v2.ts` | HTTP | Body shape | Goes through finaliser? |
|---|---|---|---|---|---|---|
| 1 | Pre-flight failure | `runPreFlight` | 185 | `pre.status` (often 422) | `BoundaryError` | No (legitimate skip — request never reached dispatch) |
| 2 | System event commit fail | `dispatchSystemEvent` (commit threw) | 225 | 500 | `BoundaryError` | No (500 skip — see below) |
| 3 | System event egress drift | `dispatchSystemEvent` → `validateEgress.fallback` | 233 | 200 | `OlumiResponse` (egress fallback) | **Yes** (200-OK convergence) |
| 4 | System event success | `dispatchSystemEvent` → `validateEgress.value` | 235 | 200 | `OlumiResponse` | **Yes** |
| 5 | Chip-click handler fail | `dispatchChipClickRunAnalysis` outcome `handler_failure` | 276 | 500 | `BoundaryError` | No (500 skip) |
| 6 | Chip-click result invalid | outcome `handler_result_invalid` | 286 | 500 | `BoundaryError` | No (500 skip) |
| 7 | Chip-click commit fail | outcome `commit_failed` | 296 | 500 | `BoundaryError` | No (500 skip) |
| 8 | Chip-click egress drift | outcome `ok` → `validateEgress.fallback` | 305 | 200 | `OlumiResponse` (egress fallback) | **Yes** |
| 9 | Chip-click success | outcome `ok` → `validateEgress.value` | 307 | 200 | `OlumiResponse` | **Yes** |
| 10 | Chip-click uncaught throw | catch block at 323 | 323 | 500 | `BoundaryError` | No (500 skip) |
| 11 | Draft graph commit fail | `dispatchDraftGraph` (commitPerformed=false) | 368 | 500 | `BoundaryError` | No (500 skip) |
| 12 | Draft graph egress drift | `dispatchDraftGraph` → `validateEgress.fallback` | 376 | 200 | `OlumiResponse` (egress fallback) | **Yes** |
| 13 | Draft graph success | `dispatchDraftGraph` → `validateEgress.value` | 378 | 200 | `OlumiResponse` | **Yes** |
| 14 | Draft graph uncaught throw | catch block at 399 | 399 | 500 | `BoundaryError` | No (500 skip) |
| 15 | Edit graph commit fail | `dispatchEditGraph` (commitPerformed=false) | 448 | 500 | `BoundaryError` | No (500 skip) |
| 16 | Edit graph egress drift | `dispatchEditGraph` → `validateEgress.fallback` | 456 | 200 | `OlumiResponse` (egress fallback) | **Yes** |
| 17 | Edit graph success | `dispatchEditGraph` → `validateEgress.value` | 458 | 200 | `OlumiResponse` | **Yes** |
| 18 | Edit graph uncaught throw | catch block at 474 | 474 | 500 | `BoundaryError` | No (500 skip) |
| 19 | TurnExecutor commit fail | `runTurnExecutor` (commit_performed=false) | 539 | 500 | `BoundaryError` | No (500 skip) |
| 20 | TurnExecutor egress drift | `runTurnExecutor` → `validateEgress.fallback` | 548 | 200 | `OlumiResponse` (egress fallback) | **Yes** |
| 21 | TurnExecutor success | `runTurnExecutor` → `validateEgress.value` | 551 | 200 | `OlumiResponse` | **Yes** |

**5 dispatch families × {success, egress-drift fallback} = 10 200-OK sites that the finaliser must wire.**
**11 500 / `BoundaryError` sites legitimately skip** — see decision below.

## Convergence

Every 200-OK V5 HTTP exit passes through `validateEgress()` ([src/validators/b1.ts:137](../../src/validators/b1.ts#L137)) before `reply.code(200).send(...)`. No exit bypasses it. No V5 routes exist outside `src/orchestrator/route-v2.ts` (confirmed by `grep -rn "reply.send\|reply.code" src/` — every V5-relevant site is in route-v2.ts).

**Post-fix design — `sendFinalised200` helper.** The finaliser is wired at a SINGLE site rather than five: `sendFinalised200(reply, requestId, exitPath, response, ctx)` in route-v2.ts is the sole sanctioned `reply.code(200).send` call. Each of the five dispatch families (system-event, chip-click, draft-graph, edit-graph, TurnExecutor) calls the helper instead of touching `reply` directly. The helper:

1. Finalises the candidate response (`finaliseV5Response(candidate, ctx)`) — stamps `analysis_ready` when `ctx.analysisReady` is provided.
2. Validates the post-finalise shape (`validateEgress(finalised, requestId)`) — schema check sees the post-stamped shape, so a future schema tightening (e.g. requiring `computed_at` to be ISO-formatted) catches drift in the finaliser itself.
3. **On egress drift, also finalises the validator-built fallback** before sending, so the wire response carries `analysis_ready` even when the upstream produced a malformed envelope. The fallback is a hard-coded schema-valid `OlumiResponse`; the finaliser only adds the passthrough `analysis_ready` field, so the post-finalise fallback remains schema-valid (we don't re-validate to avoid recursive-failure complexity for negligible safety gain).
4. Emits `v5.response.finalised` telemetry with the actual wire shape (the soak metric for confirming emission rate).
5. Sends.

**Enforcement.** The grep gate at `scripts/check-no-direct-analysis-ready.sh` now has TWO rules:

- No composer / handler / TurnExecutor may write `analysis_ready` directly (catches direct property assignment, dot-assignment, dynamic-key assignment, object-literal property).
- No `reply.code(200).send(...)` may appear in `src/orchestrator/route-v2.ts` outside the body of `sendFinalised200`. Adversarially verified: injecting `return reply.code(200).send({ ... })` anywhere else in route-v2.ts fires the gate with exit code 1.

This closes the route-exit bypass that the previous wiring (one `validateEgress` + `reply.send` per dispatch family) left unenforced.

## Decision: 500 / BoundaryError paths skip the finaliser

Eleven exits return `BoundaryError` (status 500 or pre-flight 422). They legitimately do not carry `analysis_ready`:

- **No canvas mutation occurred.** The user's UI store still holds the most recent successful `ceeAnalysisReady` (from a prior turn). Stamping a fresh readiness on an error response would be misleading — it implies "the server thinks readiness changed", but readiness depends on graph state which the failed turn did not change.
- **`BoundaryError` is a typed error envelope, not an `OlumiResponse`.** Different schema. Adding analysis_ready would require schema changes in `@talchain/schemas` for marginal benefit.
- **The UI's null-as-unknown handling (Phase 5) covers the rare case where a user's first server contact is a failure response.** Chip stays hidden, neutral state, no false blocker.

Each 500 site gets a one-line inline comment: `// 500: infrastructure failure — no analysis_ready stamped (UI retains prior store value)`. This prevents a future developer from "fixing" the omission by adding analysis_ready to error responses, which would silently invalidate the prior-store-value invariant.

## Egress-drift fallback handling

`validateEgress` returns `{ ok: false, fallback }` when the upstream produced a response that fails `OlumiResponseSchema.parse`. The fallback is a hard-coded envelope with `error_code: 'EGRESS_CONTRACT_VIOLATION'`. **The finaliser stamps the fallback too**, implemented inside `sendFinalised200`:

```
const finalised = finaliseV5Response(candidate, ctx);
const egress = validateEgress(finalised, requestId);
const wireBody = egress.ok ? egress.value : finaliseV5Response(egress.fallback, ctx);
```

This is correct because:
- It IS an `OlumiResponse` (passes the schema)
- The user receives a 200 with this fallback; the UI treats it as a normal turn for state-update purposes
- Without `analysis_ready`, the UI store would lose the wire-driven readiness for this turn — same problem the brief is solving for the success case

The stamped value is the dispatch's `analysisReady` (computed from the same graph state the original response would have used). This means even when the upstream produced a malformed envelope, the UI still gets a coherent readiness view.

## Dispatch result types — extension plan

To pass the precomputed payload from each dispatch path to the finaliser without composer involvement, each dispatch result type gets an optional `analysisReady?: AnalysisReadyPayload` field:

| Dispatch result type | File:line | Source of `analysisReady` |
|---|---|---|
| `DispatchSystemEventResult` | [system-events/dispatch.ts:39](../../src/orchestrator-v5/system-events/dispatch.ts#L39) | Always undefined — system events (undo/redo/etc.) carry no graph state |
| `DispatchChipClickRunAnalysisResult` | [handlers/chip-click-dispatch.ts:78](../../src/orchestrator-v5/handlers/chip-click-dispatch.ts#L78) | Computed from post-run graph on `outcome: 'ok'` only; `undefined` on the three failure outcomes (matches the failure-skip rule) |
| `DispatchDraftGraphResult` | [handlers/draft-graph-dispatch.ts:65](../../src/orchestrator-v5/handlers/draft-graph-dispatch.ts#L65) | The pipeline's rich `result.analysisReady` (already exposed on `DraftGraphResult`) |
| `DispatchEditGraphResult` | [handlers/edit-graph-dispatch.ts:69](../../src/orchestrator-v5/handlers/edit-graph-dispatch.ts#L69) | `computeStructuralReadiness(editResult.appliedGraph)` (moved from inside `editResultToOlumiResponse` per CEE-1.5; now produced as a sibling field on the dispatch result) |
| `TurnExecutorRunResult` | [turn-executor.ts:137](../../src/orchestrator-v5/turn-executor.ts#L137) | `analysisReadyForTurn` (already computed at lines 368-378; surface as a top-level field, not inside telemetry) |

After this surfacing, route-v2.ts wires each `validateEgress` site as `validateEgress(finaliseV5Response(dispatchResult.response, { analysisReady: dispatchResult.analysisReady }), requestId)`. Five sites, one pattern.

## Composer reverts — to remove after wiring

The previous brief (`claude/v5-analysis-ready-contract` commits `0462a1c6` / `8f82285f` / `15231c37` / `14e1966b`) added per-composer `analysisReady` parameters and conditional emission. The finaliser replaces all of it. Six files revert:

| File | Lines to revert |
|---|---|
| [src/orchestrator-v5/compose.ts](../../src/orchestrator-v5/compose.ts) | `analysisReady?` param on three composers + conditional spreads |
| [src/orchestrator-v5/compose/recoverable-validation-response.ts](../../src/orchestrator-v5/compose/recoverable-validation-response.ts) | `analysisReady` arg + conditional spread |
| [src/orchestrator-v5/compose/validation-failure-responses.ts](../../src/orchestrator-v5/compose/validation-failure-responses.ts) | `analysisReady` on `composeValidationFailure` + `wrapResponse` + conditional spread |
| [src/orchestrator-v5/compose/unsupported-action-response.ts](../../src/orchestrator-v5/compose/unsupported-action-response.ts) | `analysisReady` on `ComposeUnsupportedActionInput` + conditional spread |
| [src/orchestrator-v5/handlers/draft-graph-dispatch.ts](../../src/orchestrator-v5/handlers/draft-graph-dispatch.ts) | `attachComputedAt` call + conditional spread inside `draftResultToOlumiResponse`; surface `result.analysisReady` raw on `DispatchDraftGraphResult` instead |
| [src/orchestrator-v5/handlers/edit-graph-dispatch.ts](../../src/orchestrator-v5/handlers/edit-graph-dispatch.ts) | `computeStructuralReadiness` call + `attachComputedAt` + conditional spread inside `editResultToOlumiResponse`; move the `computeStructuralReadiness` call into `dispatchEditGraph` and surface on `DispatchEditGraphResult` |

`turn-executor.ts` also reverts the seven `analysisReady: analysisReadyForTurn` arg-passes (one per compose call site) and the `v5.analysis_ready.emit` log inside `finalizeRun` — the latter moves to route-v2.ts as `v5.response.finalised`.

## Verification of finaliser contract (post-implementation)

```bash
grep -rn "analysis_ready" src/orchestrator-v5/ \
  | grep -v "__tests__" \
  | grep -v "response-finaliser" \
  | grep -v "analysis-ready-emit" \
  | grep -v "computeStructuralReadiness" \
  | grep -v "AnalysisReadyPayload"
```

After the finaliser lands, the only remaining hits should be:
- TurnExecutor's `analysisReadyForTurn` computation site
- Dispatch-result type field declarations (`analysisReady?: AnalysisReadyPayload`)
- The route-v2.ts finaliser invocations themselves
- Documentation comments

Anything else is a contract violation.
