/**
 * V5 alpha hardening Phase 2.6 — recoverable handler-response composer tests.
 *
 * Direct unit tests for `composeRecoverableHandlerResponse` and
 * `isRecoverableHandlerCause`. The locked recoverable cause-kinds (per
 * `Docs/v5/v5-p1-1-handler-failure-scope.md`) compose a clean
 * direct-answer-style 200 body with no error block and at least one
 * chip; fatal cause-kinds are excluded from the recoverable list and
 * surface via the existing `composeHandlerFailure` 500 path.
 */

import { describe, expect, it } from 'vitest';

import { HandlerInvocationFailedError } from '../../tools/handler-errors.js';
import type { HandlerInvocationFailedCause } from '../../tools/handler-errors.js';
import { HANDLER_VALIDATION_REGISTRY } from '../../routing/validation-registry.js';
import type { ComposeContext } from '../types.js';
import {
  RECOVERABLE_HANDLER_CAUSES,
  isRecoverableHandlerCause,
} from '../recoverable-handler-causes.js';
import { composeRecoverableHandlerResponse } from '../recoverable-handler-response.js';

const STAGE = 'analyse' as const;
const COMPOSE_CTX: ComposeContext = {
  graph: undefined,
  handlerRegistry: HANDLER_VALIDATION_REGISTRY,
};

function makeError(
  cause_kind: HandlerInvocationFailedCause,
  details: Record<string, unknown> = {},
): HandlerInvocationFailedError {
  return new HandlerInvocationFailedError('test failure', {
    cause_kind,
    retryable: false,
    details: { handler_id: 'run_analysis', ...details },
  });
}

describe('isRecoverableHandlerCause', () => {
  it('returns true for every locked recoverable cause', () => {
    const expected: HandlerInvocationFailedCause[] = [
      'args_validation_failed',
      'options_not_configured',
      'analysis_blocked',
      'parameter_invalid_at_execute',
      'entity_not_found_in_graph',
      'entity_kind_mismatch_at_execute',
      'precondition_unmet_at_execute',
    ];
    for (const cause of expected) {
      expect(isRecoverableHandlerCause(cause), `${cause} should be recoverable`).toBe(true);
    }
  });

  it('returns false for every fatal / infrastructure / contract-mismatch cause', () => {
    const fatal: HandlerInvocationFailedCause[] = [
      'scenario_read_failed',
      'plot_payload_invalid',
      'plot_error',
      'plot_timeout',
      'plot_unknown',
      'analysis_not_completed',
      'analysis_failed',
      'graph_invariant_violated',
    ];
    for (const cause of fatal) {
      expect(isRecoverableHandlerCause(cause), `${cause} should be fatal`).toBe(false);
    }
  });

  it('locked-set size matches the documented War-Room list (7)', () => {
    expect(RECOVERABLE_HANDLER_CAUSES.size).toBe(7);
  });
});

describe('composeRecoverableHandlerResponse', () => {
  it.each([
    ['args_validation_failed', { specific_issue: 'missing scenario_id' }],
    ['options_not_configured', { first_option_label: 'Hire Senior Engineer' }],
    ['analysis_blocked', {}],
    ['parameter_invalid_at_execute', { specific_issue: 'value out of range' }],
    ['entity_not_found_in_graph', {}],
    ['entity_kind_mismatch_at_execute', {}],
    ['precondition_unmet_at_execute', {}],
  ] as const)(
    '%s — composes a clean-body 200 response with no error block',
    (cause, details) => {
      const error = makeError(cause, details);
      const composed = composeRecoverableHandlerResponse(error, COMPOSE_CTX, STAGE);

      // Clean body: response_version, assistant_text, no error block.
      expect(composed.response.response_version).toBe(2);
      expect(composed.response.assistant_text).toBeTruthy();
      expect(composed.response.assistant_text.length).toBeGreaterThan(0);
      expect(composed.response.blocks).toEqual([]);
      expect(composed.response.stage_indicator).toBe(STAGE);

      // At least one chip — recovery guidance must be actionable.
      expect(composed.response.suggested_actions.length).toBeGreaterThanOrEqual(1);

      // Template + chip-type are surfaced for telemetry.
      expect(composed.template_id).not.toBe('fallback');
      expect(composed.template_id).not.toBe('unknown_validation_code');
      expect(composed.chip_type).toMatch(/^(action|text_prompt|entity_suggestion)$/);
    },
  );

  it('does NOT include an INTERNAL_ERROR block (regression guard for the fatal-vs-recoverable boundary)', () => {
    const error = makeError('analysis_blocked');
    const composed = composeRecoverableHandlerResponse(error, COMPOSE_CTX, STAGE);
    const errorBlock = composed.response.blocks.find(
      (b) => (b as { type?: string }).type === 'error',
    );
    expect(errorBlock).toBeUndefined();
  });

  it('does NOT leak the cause_kind into user-facing assistant_text', () => {
    // Cause kinds are internal field names; they must never reach user copy.
    const causes: HandlerInvocationFailedCause[] = [
      'args_validation_failed',
      'options_not_configured',
      'analysis_blocked',
      'parameter_invalid_at_execute',
      'entity_not_found_in_graph',
      'entity_kind_mismatch_at_execute',
      'precondition_unmet_at_execute',
    ];
    for (const cause of causes) {
      const composed = composeRecoverableHandlerResponse(makeError(cause), COMPOSE_CTX, STAGE);
      expect(composed.response.assistant_text, cause).not.toContain(cause);
      expect(composed.response.assistant_text, cause).not.toContain('cause_kind');
      expect(composed.response.assistant_text, cause).not.toContain('handler_id');
    }
  });

  it('chip messages are non-empty and product-voice (no internal field names)', () => {
    const composed = composeRecoverableHandlerResponse(
      makeError('options_not_configured', { first_option_label: 'Hire' }),
      COMPOSE_CTX,
      STAGE,
    );
    for (const chip of composed.response.suggested_actions) {
      expect(chip.label.length).toBeGreaterThan(0);
      expect(chip.message.length).toBeGreaterThan(0);
      expect(chip.label).not.toContain('cause_kind');
      expect(chip.message).not.toContain('cause_kind');
      expect(chip.label).not.toContain('handler_id');
      expect(chip.message).not.toContain('handler_id');
    }
  });
});
