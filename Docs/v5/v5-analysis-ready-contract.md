# V5 analysis_ready single-source-of-truth — CEE side

**Brief reference:** "V5 analysis_ready: single source of truth" (received 2026-04-26).
**Diagnostic basis:** [v5-readiness-diagnostic.md](v5-readiness-diagnostic.md).
**Branch:** `claude/v5-analysis-ready-contract` (CEE), off staging HEAD `33c2a872`.
**Status:** CEE side complete; halted for push authorisation. UI side not started — must wait for CEE deploy + one staging session confirming `analysis_ready` present on graph-bearing responses.

## Sequencing (strict — per Paul's clarification)

1. **CEE ships first** (this branch).
2. **CEE deploys** to staging.
3. **One manual staging session** confirms `analysis_ready` present on graph-bearing responses (verify via debug bundle from a fresh scenario; check both the original `draft_graph` response and a follow-up `frame`/`edit_graph` turn).
4. **Then UI side** ships (`DecisionGuideAI` `claude/v5-analysis-ready-contract`): legacy fallback deletion, ordering guard via `computed_at`, debug-bundle fixture tests.

This ordering is strict because if the UI deletes the fallback before CEE emits broadly, production users on the deployed CEE will lose the fallback safety net and see worse behaviour. CEE-first is additive: every wire response gains a field, but no existing behaviour breaks.

## Commits (this branch)

1. `feat(v5): wire analysis_ready + computed_at into compose layer (CEE-1)`
2. `fix(v5): emit analysis_ready from edit-graph + unsupported-action paths (CEE-1.5)`
3. `chore(v5): attach computed_at to draft-graph analysis_ready emission (CEE-2)`
4. `test(v5): analysis_ready contract tests across compose surface (CEE-3)`

## Implementation summary

**New helper:** [src/orchestrator-v5/compose/analysis-ready-emit.ts](../../src/orchestrator-v5/compose/analysis-ready-emit.ts) — `attachComputedAt(payload)`. The single emission-time site that sets `computed_at: ISO8601`. Returns a shallow copy so caller-held references stay timestamp-free (otherwise downstream re-emissions of the same upstream payload would carry the original stamp and the UI ordering guard would mis-order).

**Type extension:** added `computed_at?: string` to `GraphPatchBlockData['analysis_ready']` in [src/orchestrator/types.ts:481-518](../../src/orchestrator/types.ts#L481-L518). The wire schema (`@talchain/schemas/boundary` `OlumiResponseSchema.analysis_ready`) is `passthrough`, so `computed_at` rides through without a vendor-package bump.

**Compose layer:** added optional `analysisReady` parameter to:
- `composeDirectAnswerResponse`, `composeClarifyResponse`, `composeToolCallResponse` ([src/orchestrator-v5/compose.ts](../../src/orchestrator-v5/compose.ts))
- `composeRecoverableValidationResponse` ([src/orchestrator-v5/compose/recoverable-validation-response.ts](../../src/orchestrator-v5/compose/recoverable-validation-response.ts))
- `composeValidationFailure` → `wrapResponse` ([src/orchestrator-v5/compose/validation-failure-responses.ts](../../src/orchestrator-v5/compose/validation-failure-responses.ts))
- `composeUnsupportedActionResponse` ([src/orchestrator-v5/compose/unsupported-action-response.ts](../../src/orchestrator-v5/compose/unsupported-action-response.ts))

Each spreads `analysis_ready: attachComputedAt(input.analysisReady)` into the response when provided; omits the field entirely when not. Boundary `OlumiResponseSchema.parse(env)` round-trips both shapes.

**TurnExecutor wiring:** [src/orchestrator-v5/turn-executor.ts](../../src/orchestrator-v5/turn-executor.ts) at the existing `analysisReadyForTurn` computation site (lines 368-378) — passes the value into all five compose call sites (recoverable, unsupported, tool_call, clarify, coach, converse). Plus a per-turn telemetry log (`event: 'v5.analysis_ready.emit'`) inside `finalizeRun` that records `{turn_class, graph_present, emitted, analysis_ready_status, computed_at}`. This is the soak metric for confirming emission rate before the UI deletes its legacy fallback.

**Edit-graph dispatch:** [src/orchestrator-v5/handlers/edit-graph-dispatch.ts:74-103](../../src/orchestrator-v5/handlers/edit-graph-dispatch.ts#L74-L103) — `editResultToOlumiResponse` now computes `computeStructuralReadiness(editResult.appliedGraph)` and ships it on the response. Closes the gap noted in the diagnostic: `appliedGraph` was already flowing into `commitDirectAnswer.metadata.graph` for persistence; now it also flows onto the wire so the UI store sees readiness immediately rather than after a follow-up turn.

**Draft-graph dispatch:** [src/orchestrator-v5/handlers/draft-graph-dispatch.ts:127-141](../../src/orchestrator-v5/handlers/draft-graph-dispatch.ts#L127-L141) — wraps the existing `result.analysisReady` through `attachComputedAt`. Kept as a separate response builder (not migrated to `composeDirectAnswerResponse`) because draft also carries the unique top-level `draft_graph` block which the standard composers do not emit; documented inline. The shared `attachComputedAt` helper still applies so `computed_at` is consistent across draft / edit / TurnExecutor emissions.

## Paths intentionally NOT wired (documented exclusions)

`buildFailureResponse` paths (LLM_TIMEOUT, LLM_SCHEMA_VIOLATION, BUDGET_EXCEEDED, STATE_COMMIT_FAILED, UNSUPPORTED_ACTION fallback, UNHANDLED, etc.) ship without `analysis_ready`. Rationale: these are infrastructure-failure responses (200 with `error` block, or 5xx). The user-visible meaning is "retry / something went wrong", not "readiness updated". The canvas state on the UI is unchanged through the failed turn so the prior `ceeAnalysisReady` (from the most recent successful emission) is correct. Adding `analysis_ready` to ~15 failure-response sites adds surface area for marginal benefit. The UI's `null`-as-unknown handling (UI-step 6 in the brief) covers the rare case where a user's first server contact is a failure response — the chip stays hidden and the panel shows neutral state, no false blocker.

## Soak telemetry

Every `finalizeRun` emits `event: 'v5.analysis_ready.emit'` with:
- `turn_class` — direct_answer / handler / failed
- `graph_present` — true/false
- `emitted` — true/false (was `analysis_ready` on the response)
- `analysis_ready_status` — ready / needs_user_mapping / needs_user_input / needs_encoding / null
- `computed_at` — emission timestamp or null

**Pre-UI-deletion gate:** filter Render logs for `event: 'v5.analysis_ready.emit' AND graph_present: true AND emitted: false`. Investigate any such turns before the UI deletion ships. Today's known causes: graph fails strict GraphV3 parse (test fixtures and any malformed UI ingress).

## Payload-size delta

Measured with a representative bundle-1-shape payload (3 options, 2 interventions each, baseline detection) — see [.tmp/payload-size-measure.mjs](../../.tmp/payload-size-measure.mjs):

| Baseline envelope | Without analysis_ready | With analysis_ready | Delta |
|---|---|---|---|
| Minimal validator-recoverable response | 261 B | 861 B | **+600 B (+229.9%)** |
| Typical analysis_result envelope | 1,094 B | 1,694 B | **+600 B (+54.8%)** |

Constant `+600 bytes` per response when emitted (intervention values dominate). Cumulative network impact for a 50-turn session: ~30 KB. Negligible compared to typical Sonnet payloads (5-50 KB) or graph payloads (5-50 KB). No first-byte latency impact for streaming responses since `analysis_ready` is a single trailing field on the final event.

If a future scenario shows higher per-option payload (e.g. 10 options × 5 interventions = ~3 KB analysis_ready), reassess; today's typical case is fine.

## Follow-up brief reference

After this brief lands and the UI side is complete, **dispatch the run_analysis model-level routing + add-option intent brief.** The diagnostic flagged that "Proceed." gets routed to a tool call against the decision node with `entity_kind: 'node'` (validator rejects `ENTITY_KIND_MISMATCH`) and that "Let's add an option…" hits `ENTITY_RESOLUTION_AMBIGUOUS`. These are routing-prompt and validator-registry concerns, not analysis_ready concerns, but they are the *upstream reason* the user's two test sessions hit the analysis_ready bug — they couldn't progress to a draft retry because their utterances kept resolving to validator rejections. Without that follow-up, these symptoms recur on the next user session even with a perfect analysis_ready contract.

## Verification

- `npx tsc -p tsconfig.build.json --noEmit` — clean
- `npx vitest run src/orchestrator-v5/` — 58 files, 844 passed, 1 skipped, 0 failures
- `npx vitest run src/orchestrator-v5/compose/__tests__/analysis-ready-emit.test.ts` — 16 new tests, all pass
- `npx vitest run src/orchestrator-v5/handlers/__tests__/edit-graph-dispatch-analysis-ready.test.ts` — 2 new tests, all pass
- Telemetry observed live during turn-executor.test.ts run — emits with `graph_present: true, emitted: true, status: 'needs_user_input'` on the fixture that constructs a complete schema-valid graph; emits with `emitted: false` on minimal fixtures that fail GraphV3 strict parse (expected).

## Halt point

CEE work complete. **No push executed.** Awaiting Paul's authorisation for `git push` to `claude/v5-analysis-ready-contract` and subsequent staging deploy. UI work begins only after CEE staging deploy + verification session per the sequencing rule above.
