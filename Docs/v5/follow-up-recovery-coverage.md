# Follow-up brief: recovery coverage gaps in handler-failure and chip-click paths

**Origin:** ChatGPT review of the recovery-chips + decision_review resilience branch (P0 items #1/#2 and Improvement #10).
**Status:** Out of scope for the current branch. Captured here for a separate work item.

---

## Why this is needed

The recovery-chips work landed at the egress safety layer (`buildFailureResponse` in [src/orchestrator-v5/failure-response.ts](../../src/orchestrator-v5/failure-response.ts)), but two failure paths bypass that layer and so still produce sub-spec user experience:

1. **Handler-side PLoT failures** (`plot_timeout`, `plot_error`, `plot_unknown`, `plot_payload_invalid`) flow through [composeHandlerFailureResponse](../../src/orchestrator-v5/compose/handler-failure-responses.ts), which has its own per-cause chips and copy. The chips exist (so this isn't a P0 dead-end), but the copy contains tone-violating words the brief explicitly forbids:
   - `plot_error` → "The analysis service encountered an error. This is on our end."
   - `plot_unknown` → "The analysis service was unreachable. Try again in a moment."
   - `plot_timeout` → "The analysis is taking longer than usual. Your model might be very complex."
   - Forbidden terms hit: **"error"**, **"AI service" / "analysis service"**, **"failed"** appears in cause names.

2. **Chip-click `run_analysis` failures** flow through [src/orchestrator/route-v2.ts:459](../../src/orchestrator/route-v2.ts) and return a 500 BoundaryError with **no recovery chip**. So the "Run analysis again" action chip emitted by the recovery layer is a one-shot — if the click itself fails, the user is dead-ended.

3. **No render-time forbidden-term guard.** The current guard is enforced inside `recovery-chips.ts` exports only. A rendered-string sweep across all failure composers would catch the gap above and prevent regression.

---

## Tasks

### Task A — route handler-side PLoT failures through `buildRecoveryChip`

**Where to wire it.** Not inside `composeHandlerFailure` — that composer's `ComposeContext` only carries `{ graph?: GraphLookup, handlerRegistry }` and has no access to `previousUserMessage`, `scenarioId`, `turnId`, `isRetry`, or handler telemetry context. Wiring there would require either threading new context through `composeHandlerFailure`'s signature or duplicating values that already exist upstream.

The clean wiring point is the turn-executor's `translateExecuteError` branch in [src/orchestrator-v5/turn-executor.ts](../../src/orchestrator-v5/turn-executor.ts) where `HandlerInvocationFailedError` is currently handed to `composeHandlerFailure`. All recovery context is already in scope there (`payload`, `requestId`, `context`, `proposedHandlerIdForLog`, `analysisReadyForTurn`).

**Steps:**

1. In `translateExecuteError`'s `HandlerInvocationFailedError` branch, intercept PLoT cause kinds (`plot_timeout`, `plot_error`, `plot_unknown`, `plot_payload_invalid`) BEFORE calling `composeHandlerFailure`.
2. Map cause kind → `RecoveryFailureType`:
   - `plot_timeout` → `PLOT_TIMEOUT`
   - `plot_error` / `plot_unknown` / `plot_payload_invalid` → `PLOT_HTTP_ERROR`
3. Call `buildRecoveryChip` with `recoveryCtx()` (already closured in the turn-executor) and the structural-readiness flag from `analysisReadyForTurn?.status === 'ready'`.
4. Build the response envelope with the recovery preface as `assistant_text`, the existing wire `error_code` (`INTERNAL_ERROR` via `INTERNAL_TO_WIRE.HANDLER_INVOCATION_FAILED`), and the recovery chips.
5. Emit `v5.recovery_chip_served` via `emitRecoveryChipServed` (already exported from `recovery-chips.ts`).
6. Preserve the existing `turn_executor.failure_response` telemetry shape (`failure_origin`, `error_code`, `template_used`, `chip_attached`, `chip_type`, `retryable`) so dashboards keep working — set `template_used` to a new value like `'recovery_plot_timeout'` / `'recovery_plot_error'` so the cutover is queryable.
7. Non-PLoT cause kinds (`args_validation_failed`, `scenario_read_failed`, `analysis_not_completed`, `analysis_blocked`, `analysis_failed`, `options_not_configured`) keep flowing through `composeHandlerFailure` — those have validated, audience-appropriate copy already.

Note that the PLoT recovery chip table already exists in `recovery-chips.ts` — no new mapping needed; just wire the existing helper in at the right call site.

### Task B — chip-click `run_analysis` failure path

In [src/orchestrator/route-v2.ts:459](../../src/orchestrator/route-v2.ts), the chip-click handler currently returns a 500 BoundaryError on:
- HandlerInvocationFailedError (PLoT timeout/error)
- Handler thrown
- Result invalid
- Commit failure

Each of those should return a 200 OlumiResponse with a recovery chip equivalent to what the routed run_analysis path produces, OR a 500 with a chip-bearing envelope the UI can still parse. The contract decision (200 vs 500 + chip body) should mirror what route-v2.ts already does for routed-path failures, so chip-click and routed-path failures produce visually identical fallback UI.

Practically: factor a shared "chip-click failure-to-response" helper that takes the failure type + readiness flag and returns the same `OlumiResponse` shape `buildFailureResponse` produces, then call it from every failure branch in the chip-click handler.

### Task C — render-time forbidden-term guard

Add a single test that:
1. Walks `composeHandlerFailure` (exported from [compose/handler-failure-responses.ts](../../src/orchestrator-v5/compose/handler-failure-responses.ts)) across every `HandlerInvocationFailedCause` value.
2. Walks `composeValidationFailure` (exported from [compose/validation-failure-responses.ts](../../src/orchestrator-v5/compose/validation-failure-responses.ts)) across every `ValidationErrorCode`.
3. Walks `buildFailureResponse` across every `InternalFailure`.
4. For each rendered envelope, scans `assistant_text` and every `chip.label` against `FORBIDDEN_USER_TEXT_TERMS` from [recovery-chips-forbidden-terms.ts](../../src/orchestrator-v5/compose/recovery-chips-forbidden-terms.ts).

This catches the gap in handler-failure-responses.ts copy and prevents future regressions across all composers.

---

## What must NOT change

- No prompt or schema files.
- No PLoT, ISL, or UI repos.
- No stabilisation code (`staleness-prefix.ts`, `deterministic-value-update.ts`).
- No `as unknown` / `as any` casts in production source.
- The recovery layer's contract from the parent branch (assistant_text override, error_code preservation, telemetry shape).

---

## Verification

```bash
pnpm exec tsc -p tsconfig.build.json --noEmit
pnpm test src/orchestrator-v5/

# Render-time forbidden-term guard
pnpm test src/orchestrator-v5/compose/__tests__/forbidden-terms-render-guard.test.ts

# Spot-check the composers no longer produce "error" / "AI service"
grep -rn "AI service\|analysis service\|encountered an error" \
  src/orchestrator-v5/compose/handler-failure-responses.ts \
  src/orchestrator-v5/turn-executor.ts  # 0
```
