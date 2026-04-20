# MC-29 boundary fail-closed — review pack

**Brief:** `v5-group2-model-routing-hygiene` Task C
**Date:** 2026-04-20
**Branch:** `claude/v5-model-routing-hygiene`
**Severity:** BLOCKER (boundary contract v1.1 §4.2, codebase audit §4.2.9 / §6.1 row 5)

## 1. What changed

Replaced the two soft-gate log-and-continue sites in [src/cee/unified-pipeline/stages/boundary.ts](../../src/cee/unified-pipeline/stages/boundary.ts) with fail-closed behaviour. Both sites now set `ctx.earlyReturn` with HTTP 502 and a typed `CEEErrorResponseV1` envelope carrying `reason: "egress_contract_violation"`.

- **Site 1 (strict-mode validation, lines 132-161 pre-fix):** `validateStrictModeV3` failure now blocks with a typed error instead of logging and continuing.
- **Site 2 (Zod validation, lines 240-298 pre-fix):** `CEEGraphResponseV3.safeParse` failure now blocks instead of passing the raw body through. The dev escape hatch (`config.cee.boundaryAllowInvalid`) is preserved verbatim for local/test.

## 2. Caller inventory

Only one direct caller of `runStageBoundary`:

| Caller | File:line | Classification | Action required |
|---|---|---|---|
| `runUnifiedPipeline` | [src/cee/unified-pipeline/index.ts:638](../../src/cee/unified-pipeline/index.ts#L638) | V5-active (the only unified pipeline) | None — uses existing `drainEarlyReturn(ctx)` at [index.ts:657](../../src/cee/unified-pipeline/index.ts#L657) which now surfaces our typed 502. |

Transitive (route-level and tool-level) — every caller of `runUnifiedPipeline`:

| Caller | File:line | Classification | Impact |
|---|---|---|---|
| `POST /assist/v1/draft-graph` | [src/routes/assist.v1.draft-graph.ts:528](../../src/routes/assist.v1.draft-graph.ts#L528) | V5-active (current primary route) | Returns `{ statusCode, body }` verbatim via `reply.code(statusCode).send(body)` — no transformation of error bodies. Invalid V3 egress now surfaces as HTTP 502 + typed envelope. |
| `POST /assist/v1/draft-graph-stream` | [src/routes/assist.v1.draft-graph-stream.ts:473](../../src/routes/assist.v1.draft-graph-stream.ts#L473) | V5-active (streaming variant) | Identical propagation pattern. Invalid V3 egress will now produce a 502 in the streaming route too. The streaming route should be exercised post-deploy to confirm its error-surfacing path handles the typed envelope gracefully (likely no change needed — it forwards `{ statusCode, body }` as the non-streaming route does). |
| `handleDraftGraph` (V4 orchestrator tool) | [src/orchestrator/tools/draft-graph.ts:162](../../src/orchestrator/tools/draft-graph.ts#L162) | Legacy V4 (intra-process tool call, not HTTP) | Invokes `runUnifiedPipeline` as a function call. The caller inspects `pipelineResult.statusCode` and `.body`; under MC-29, a 502 result will propagate to V4 tool-error handling. This path is dormant under V5 routing (V5 uses the handlers in `src/orchestrator-v5/tools/`) but lives in the tree. Confirm V4 tool-error path does not swallow the typed envelope — noted for review, out of scope for this brief. |

The existing `catch (boundaryErr)` at [index.ts:639](../../src/cee/unified-pipeline/index.ts#L639) remains as a safety net for genuinely unexpected throws (e.g., transform bugs). My fix does not throw; it sets `earlyReturn`. The catch block is correct to keep — it covers a different failure class.

## 3. Error class and response path

**Error code:** `CEE_VALIDATION_FAILED` (existing OpenAPI enum value) — the brief permits "nearest equivalent" when `BoundaryError` §4.3 is not materialised in the pipeline. Introducing a new `CEE_EGRESS_CONTRACT_VIOLATION` code would require regenerating the OpenAPI spec, which is outside the scope of this brief. The semantic distinction is carried in the `reason` field and `details`.

**Envelope shape:** `CEEErrorResponseV1` produced by `buildCeeErrorResponse()`:

```json
{
  "schema": "cee.error.v1",
  "code": "CEE_VALIDATION_FAILED",
  "message": "Egress contract violation (zod_v3 | strict_mode_v3): <errMsg>",
  "retryable": false,
  "source": "cee",
  "request_id": "<requestId>",
  "reason": "egress_contract_violation",
  "details": {
    "validator": "zod_v3" | "strict_mode_v3",
    "boundary": "B1",
    "direction": "response",
    "stage": "boundary",
    "issue_count": <n>,          // Zod case only
    "validation_issues": [...]   // Zod case only (trimmed to 5)
  },
  "trace": { "request_id": "...", "correlation_id": "..." },
  "_pipeline_outcome": { ... }
}
```

**Mapping to `BoundaryError` §4.3 (for future contract materialisation):**

| BoundaryError field | Source in this fix |
|---|---|
| `error` | `code` (`CEE_VALIDATION_FAILED`) |
| `boundary` | `details.boundary` (`"B1"`) |
| `direction` | `details.direction` (`"response"`) |
| `validator` | `details.validator` (`"zod_v3"` or `"strict_mode_v3"`) |
| `details` | `details.validation_issues` |
| `request_id` | `request_id` (top-level) |
| `retryable` | `retryable` (always `false` for egress contract violations) |

**Propagation path:** `boundary.ts` sets `ctx.earlyReturn` → `drainEarlyReturn(ctx)` at [index.ts:657](../../src/cee/unified-pipeline/index.ts#L657) returns it → `attachPipelineOutcome` adds `_pipeline_outcome` sibling → the route handler at [draft-graph.ts:528](../../src/routes/assist.v1.draft-graph.ts#L528) returns `{ statusCode: 502, body: <envelope> }` via `reply.code(statusCode).send(body)`.

**HTTP status 502 rationale:** B1 egress invalid = the CEE pipeline (upstream of the route from the route's perspective) produced malformed data. 502 Bad Gateway signals upstream failure distinctly from 422 (caller fault) and 500 (unhandled exception), consistent with the spec v3.2 §13 requirement that failure responses carry a specific reason rather than a generic fallback.

## 4. Telemetry / metric rename mapping (for dashboards)

Update dashboards, alerts, and log-query aggregations from the old names to the new names in one cycle. Old names drop to zero after deploy; do not keep emitting both.

| Old name | New name | Field |
|---|---|---|
| `pipeline.soft_gate_degraded` | `pipeline.boundary_fail_closed` | `event` (pino log) |
| `CEE_V3_STRICT_MODE_DEGRADED` | `CEE_EGRESS_CONTRACT_VIOLATION` | `error_code` on `cee.boundary.blocked` telemetry event |
| `CEE_V3_VALIDATION_DEGRADED` | `CEE_EGRESS_CONTRACT_VIOLATION` | `error_code` on `cee.boundary.blocked` telemetry event |

**Note:** the HTTP response body uses `code: CEE_VALIDATION_FAILED` (the existing OpenAPI enum). The telemetry event payload carries `error_code: CEE_EGRESS_CONTRACT_VIOLATION` to preserve semantic distinction for dashboards without touching the OpenAPI spec. The `reason: egress_contract_violation` field in the envelope carries the same distinction for clients.

Stage-name rename in `ctx.pipelineOutcome.warnings[]`: unchanged (still `boundary_strict_mode` and `boundary_v3_validation`), but the shape gained an optional `blocked: boolean` field distinct from the existing `degraded: boolean`. Dashboards that read `warnings[].degraded` will see `false` for MC-29 fail-closed cases (was `true` under the soft-gate). Use `warnings[].blocked === true` to identify MC-29-originated blocks.

## 5. Remaining C9 debt (out of scope for this brief)

### Hit 2: `src/routes/assist.v1.draft-graph.ts:404`

**File:line:** [src/routes/assist.v1.draft-graph.ts:404](../../src/routes/assist.v1.draft-graph.ts#L404)
**Classification:** B1 **ingress** soft-gate on readiness validation when strict mode is off.
**Severity assessment:** moderate. Different risk profile from MC-29: user-input rather than egress contract. The spec currently permits "low readiness + strict mode off" to proceed to generation, so the pattern here is arguably by-design rather than a contract violation.
**Recommendation:** file a separate ticket if Paul wants ingress tightening. Do not change in this brief — out of scope.

### Hit 3: `src/services/session-cache.ts:130`

**File:line:** [src/services/session-cache.ts:130](../../src/services/session-cache.ts#L130)
**Classification:** Not a contract violation. Internal cache resilience pattern ("Never throws — logs errors and continues") for Redis/in-memory fallback.
**Severity assessment:** non-issue. Cache miss ≠ validation failure. Throwing on cache write errors would harm availability without data-integrity benefit.
**Recommendation:** close as non-issue. No action required.

## 6. Tests

### Stage-level unit tests ([src/cee/unified-pipeline/stages/__tests__/boundary.test.ts](../../src/cee/unified-pipeline/stages/__tests__/boundary.test.ts))

Ten tests, all passing. Cover:
- Happy path: valid V3 → `finalResponse` set, `earlyReturn` unset.
- Strict-mode failure: `earlyReturn` with 502, `CEE_VALIDATION_FAILED`, `reason: egress_contract_violation`, `details.validator: strict_mode_v3`, `details.boundary: "B1"`, `details.direction: "response"`. `finalResponse` unset. Warning recorded with `degraded: false, blocked: true`.
- Zod failure: `earlyReturn` with 502, `details.validator: zod_v3`, `issue_count`, `validation_issues[]`.
- Dev escape hatch: `boundaryAllowInvalid=true` passes through (preserved).
- V2 and V1 paths unaffected (no strict-mode / Zod logic).

### Route-level integration test ([tests/integration/cee.draft-graph.fail-closed.test.ts](../../tests/integration/cee.draft-graph.fail-closed.test.ts))

Two tests, passing. Exercise the full `runUnifiedPipeline` wrapper — stages 1-6 plus `drainEarlyReturn` plus `attachPipelineOutcome`:

- `returns HTTP 502 with CEE_VALIDATION_FAILED and reason egress_contract_violation`: feeds an invalid V3 body via a mocked `transformResponseToV3`, runs the full pipeline with `LLM_PROVIDER=fixtures`, and asserts the result is `{ statusCode: 502, body: { code: 'CEE_VALIDATION_FAILED', reason: 'egress_contract_violation', retryable: false, source: 'cee', details: { validator: 'zod_v3', boundary: 'B1', direction: 'response' } } }`.
- `does NOT return a 200 fallback envelope when egress validation fails`: negative assertion that the previous soft-gate 200-with-packaged-graph path is dead.

This is the critical proof: the typed 502 reaches the route-level caller intact. The previous soft-gate path (200 + fallback body) is dead.

### Grep acceptance

```
$ grep -nE "log.*and.*continue|soft[-_ ]gate|warn.*invalid.*continue" src/cee/unified-pipeline/stages/boundary.ts
134:    // Previously a soft-gate log-and-continue; now sets ctx.earlyReturn with
294:    // Fail-closed per boundary contract v1.1 §4.2 (was: Track 1 soft gate).
```

The only remaining hits are historical comments explaining the fix (not the pattern itself). The brief's acceptance bar is "zero hits at or near line 132" — the old soft-gate code block is gone.

## 7. Out-of-scope items noted

- OpenAPI enum extension to add `CEE_EGRESS_CONTRACT_VIOLATION` as a first-class response `code`. Current approach uses `CEE_VALIDATION_FAILED` + `reason` to avoid regenerating the spec mid-brief. File follow-up ticket if the distinction should surface to clients through the typed code.
- Ingress fail-closed at [assist.v1.draft-graph.ts:404](../../src/routes/assist.v1.draft-graph.ts#L404) — see §5 hit 2.

### Task A follow-up debt: uncovered `getAdapter` call sites

Task A wired per-request `resolution_source` logging in [parse.ts](../../src/cee/unified-pipeline/stages/parse.ts) only. Other active `getAdapter` call sites do not yet emit `model.resolution` or call `recordModelResolution`. They will continue to use `getAdapter` transparently (returns the same adapter) but resolution data for those calls will not appear in `GET /admin/v1/turn-debug/:turn_id`. Tracked debt, to be addressed in a follow-up brief:

V5-active sites (highest priority for follow-up):
- [src/orchestrator-v5/classify.ts:128](../../src/orchestrator-v5/classify.ts#L128) (`turn_classifier`)
- [src/orchestrator-v5/llm-adapter.ts:65](../../src/orchestrator-v5/llm-adapter.ts#L65) (`direct_answer_narrate`)
- [src/orchestrator-v5/routing/route-with-tool-use.ts:369](../../src/orchestrator-v5/routing/route-with-tool-use.ts#L369) (`direct_answer_narrate`)

CEE pipeline sites (mid priority):
- [src/cee/clarifier/question-generator.ts:152](../../src/cee/clarifier/question-generator.ts#L152)
- [src/cee/clarifier/answer-processor.ts:153](../../src/cee/clarifier/answer-processor.ts#L153)
- [src/cee/unified-pipeline/stages/repair/plot-validation.ts:178](../../src/cee/unified-pipeline/stages/repair/plot-validation.ts#L178)
- [src/cee/unified-pipeline/stages/repair/orchestrator-validation.ts:29](../../src/cee/unified-pipeline/stages/repair/orchestrator-validation.ts#L29)
- [src/cee/validation-pipeline/validate-graph.ts:54](../../src/cee/validation-pipeline/validate-graph.ts#L54)

Legacy V4 sites (low priority, dormant under V5 routing):
- [src/orchestrator/tools/dispatch.ts](../../src/orchestrator/tools/dispatch.ts) (multiple call sites)
- [src/orchestrator/parallel-generate.ts:312](../../src/orchestrator/parallel-generate.ts#L312)
- [src/orchestrator/deterministic/pipeline-v4.ts:617](../../src/orchestrator/deterministic/pipeline-v4.ts#L617)
- [src/orchestrator/pipeline/pipeline.ts:209](../../src/orchestrator/pipeline/pipeline.ts#L209)

Per-route handlers (lowest priority; most are single-shot utility routes):
- `src/routes/assist.{clarify-brief,critique-graph,suggest-options,explain-diff,v1.decision-review,v1.edit-graph}.ts`
- `src/server.ts` (several `getAdapter()` calls for health/chat probes)

Recommendation: a single follow-up brief migrates all V5-active sites to `getAdapterWithResolution` + `recordModelResolution`, leaving legacy V4 untouched. A shared invocation seam was considered during Task A design and rejected: the router has no access to `request_id` and threading it via AsyncLocalStorage is invasive. The explicit-caller pattern trades some boilerplate for zero runtime coupling.
