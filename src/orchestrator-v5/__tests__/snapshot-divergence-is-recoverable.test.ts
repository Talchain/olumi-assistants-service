/**
 * A SNAPSHOT DIVERGENCE MUST NOT BE AN HTTP 500 THAT LOSES THE TURN.
 *
 * ── THE DEFECT (independent review, BLOCKING) ──────────────────────────────
 * `AnalysisSnapshotDivergedError` was caught by the generic reader catch and
 * re-wrapped as `HandlerInvocationFailedError('scenario_read_failed')`. Traced
 * end to end that is not a copy problem, it is a 500 that loses the turn:
 *
 *   scenario_read_failed is NOT in RECOVERABLE_HANDLER_CAUSES
 *     -> INTERNAL_TO_WIRE.HANDLER_INVOCATION_FAILED = 'INTERNAL_ERROR'
 *     -> commitPerformed is still false (the lifecycle commit is AFTER dispatch)
 *     -> route-v2 `if (commit_performed === false)` -> HTTP 500 BoundaryError
 *
 * So a concurrent edit produced HTTP 500 / INTERNAL_ERROR with NEITHER the user
 * turn NOR the assistant turn persisted — the P0 alert class. As implemented,
 * REFUSE traded a rare silent-wrong-graph for a 500 that loses the turn.
 *
 * ⛔ THE PR BODY SAID A DEDICATED CAUSE WOULD "TOUCH A CLOSED TELEMETRY ENUM".
 *    THAT IS WRONG, AND I CHECKED RATHER THAN REPEATING IT.
 *    `HandlerInvocationFailedCause` is a LOCAL TypeScript union
 *    (`tools/handler-errors.ts`); `cause_kind` appears nowhere in
 *    `@talchain/schemas`. Its own docblock says the union exists precisely so
 *    "new handlers add their tags here". No publish, no wire code, no migration.
 *
 * PRECEDENT, TWICE, IN THIS FILE'S OWN COMMENTS: `analysis_engine_busy` was
 * added for exactly this reason — "Surfacing it as a 500 INTERNAL_ERROR was a
 * false claim about the system's health" — and `analysis_not_ready` before it.
 * This is the third instance of one pattern, not a new mechanism.
 */
import { describe, it, expect } from 'vitest';

import { RECOVERABLE_HANDLER_CAUSES } from '../compose/recoverable-handler-causes.js';
import { composeHandlerFailureBody } from '../compose/handler-failure-responses.js';
import { HandlerInvocationFailedError } from '../tools/handler-errors.js';

/** The error the run_analysis reader boundary now raises on a divergence. */
function divergence(): HandlerInvocationFailedError {
  return new HandlerInvocationFailedError('Analysis snapshot diverged', {
    cause_kind: 'analysis_snapshot_diverged',
    retryable: true,
    details: { handler_id: 'run_analysis', scenario_id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa' },
  });
}

describe('a snapshot divergence recovers gracefully instead of 500ing', () => {
  it('RED: the cause is RECOVERABLE, so the turn is not lost', () => {
    expect(
      RECOVERABLE_HANDLER_CAUSES.has('analysis_snapshot_diverged'),
      'a concurrent edit is the user\'s own model moving — it is not infrastructure failure',
    ).toBe(true);
  });

  it('RED: the composer has its own branch, so it cannot fall through to `fallback`', () => {
    const out = composeHandlerFailureBody(divergence());
    // A recoverable cause with no branch here hits the exhaustive default,
    // produces `template_id: 'fallback'`, and is deliberately failed loud to a
    // 500 — which is the very outcome this change exists to remove.
    expect(out.template_id).not.toBe('fallback');
    expect(out.template_id).toBe('analysis_snapshot_diverged');
  });

  it('the copy is TRUTHFUL — it says the model moved, not that something broke', () => {
    const text = composeHandlerFailureBody(divergence()).body.assistant_text;
    expect(text).toMatch(/chang|moved|updated/i);
    expect(text, 'must not blame the user\'s model or claim a fault').not.toMatch(/wrong with your model|error|failed/i);
  });

  it('offers a re-run affordance rather than a dead end', () => {
    const out = composeHandlerFailureBody(divergence());
    expect(out.body.suggested_actions?.length ?? 0).toBeGreaterThan(0);
  });

  it('CONTROL — a genuine infra read failure stays FATAL, so real breakage is not hidden', () => {
    expect(RECOVERABLE_HANDLER_CAUSES.has('scenario_read_failed')).toBe(false);
  });
});
