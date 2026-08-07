import { describe, it, expect } from 'vitest';

import { composeHandlerFailure } from '../handler-failure-responses.js';
import { HandlerInvocationFailedError } from '../../tools/handler-errors.js';
import type {
  HandlerFailureDetails,
  HandlerInvocationFailedCause,
} from '../../tools/handler-errors.js';
import type { ComposeContext } from '../types.js';

// Intentional test-infrastructure escape: a runtime value outside the typed
// union exercises the exhaustive-never default. This simulates a future
// cause_kind added without a template branch.
const UNKNOWN_CAUSE = 'test_unknown_cause' as HandlerInvocationFailedCause;

const CTX: ComposeContext = { handlerRegistry: {} };

function build(
  cause: HandlerInvocationFailedCause,
  retryable: boolean,
  extra: Omit<HandlerFailureDetails, 'handler_id'> & Record<string, unknown> = {},
): HandlerInvocationFailedError {
  return new HandlerInvocationFailedError('test', {
    cause_kind: cause,
    retryable,
    details: { handler_id: 'run_analysis', ...extra },
  });
}

const FORBIDDEN_WORDS = /\b(recommended|recommendation|winner)\b/i;
const EM_DASH = /[—–]/;

function assertStyle(text: string): void {
  expect(text).not.toMatch(FORBIDDEN_WORDS);
  expect(text).not.toMatch(EM_DASH);
}

describe('composeHandlerFailure — per cause_kind', () => {
  it('args_validation_failed surfaces sanitised specific_issue + scenario status chip', () => {
    const err = build('args_validation_failed', false, {
      specific_issue: 'scenario_id must be a string',
    });
    const { response, template_id, chip_type } = composeHandlerFailure(err, CTX, 'frame');
    expect(template_id).toBe('args_validation_failed');
    expect(response.assistant_text).toContain('scenario_id must be a string');
    expect(response.suggested_actions[0]?.label).toBe('Show scenario status');
    expect(chip_type).toBe('text_prompt');
    assertStyle(response.assistant_text);
  });

  it('scenario_read_failed is semantically retryable but shows soft prompt', () => {
    const err = build('scenario_read_failed', true);
    const { response, template_id, chip_type } = composeHandlerFailure(err, CTX, 'frame');
    expect(template_id).toBe('scenario_read_failed');
    expect(response.suggested_actions[0]?.label).toBe('Try again in a moment');
    expect(response.suggested_actions[0]?.action_type).toBeUndefined();
    expect(chip_type).toBe('text_prompt');
  });

  it('plot_timeout retryable → Retry action chip', () => {
    const err = build('plot_timeout', true);
    const { response, template_id, chip_type } = composeHandlerFailure(err, CTX, 'frame');
    expect(template_id).toBe('plot_timeout');
    expect(response.suggested_actions[0]?.label).toBe('Retry');
    expect(response.suggested_actions[0]?.action_type).toBe('run_analysis');
    expect(chip_type).toBe('action');
  });

  it('plot_error is semantically retryable but shows soft prompt (chip UX decoupled from retryable)', () => {
    const err = build('plot_error', true);
    const { response, template_id, chip_type } = composeHandlerFailure(err, CTX, 'frame');
    expect(template_id).toBe('plot_error');
    expect(response.suggested_actions[0]?.label).toBe('Try again in a moment');
    expect(response.suggested_actions[0]?.action_type).toBeUndefined();
    expect(chip_type).toBe('text_prompt');
  });

  it('plot_payload_invalid surfaces sanitised specific_issue + scenario status chip', () => {
    const err = build('plot_payload_invalid', false, {
      specific_issue: 'graph is missing required edge',
    });
    const { response, template_id } = composeHandlerFailure(err, CTX, 'frame');
    expect(template_id).toBe('plot_payload_invalid');
    expect(response.assistant_text).toContain('graph is missing required edge');
    expect(response.suggested_actions[0]?.label).toBe('Show scenario status');
  });

  it('plot_unknown retryable → Retry chip', () => {
    const err = build('plot_unknown', true);
    const { response, template_id, chip_type } = composeHandlerFailure(err, CTX, 'frame');
    expect(template_id).toBe('plot_unknown');
    expect(response.suggested_actions[0]?.label).toBe('Retry');
    expect(response.suggested_actions[0]?.action_type).toBe('run_analysis');
    expect(chip_type).toBe('action');
  });

  it('analysis_not_completed is semantically retryable but shows scenario status chip', () => {
    const err = build('analysis_not_completed', true, { analysis_status: 'blocked' });
    const { response, template_id, chip_type } = composeHandlerFailure(err, CTX, 'frame');
    expect(template_id).toBe('analysis_not_completed');
    expect(response.assistant_text).toContain('blocked');
    expect(response.suggested_actions[0]?.label).toBe('Show scenario status');
    expect(chip_type).toBe('text_prompt');
  });

  it('analysis_not_ready (NO_GRAPH) surfaces the draft-a-model next-step as prose + recovery chip', () => {
    const err = build('analysis_not_ready', false, {
      reason_code: 'NO_GRAPH',
      next_step: 'Draft or save a model first, then run analysis.',
    });
    const { response, template_id, chip_type } = composeHandlerFailure(err, CTX, 'frame');
    expect(template_id).toBe('analysis_not_ready');
    // The honest, no-internal-ID next-step is surfaced verbatim as the prose.
    expect(response.assistant_text).toBe('Draft or save a model first, then run analysis.');
    // KNOWN COPY LIMITATION: the recovery chip is the shared analysis-not-ready
    // "Review the model" chip — no dedicated "draft a model" chip exists yet. The
    // PROSE is correct for the no-model case; only the chip label leans "fix" rather
    // than "create". A dedicated chip is a follow-up (needs UI/DGAI coordination).
    expect(response.suggested_actions[0]?.id).toBe('chip_prompt_fix_before_analysis');
    expect(chip_type).toBe('text_prompt');
    assertStyle(response.assistant_text);
  });

  it('options_not_configured with first_option_label quotes it in the chip', () => {
    const err = build('options_not_configured', false, {
      first_option_label: 'Keep current plan',
      option_count: 2,
    });
    const { response, template_id, chip_type } = composeHandlerFailure(err, CTX, 'frame');
    expect(template_id).toBe('options_not_configured_with_label');
    expect(response.assistant_text).toContain('Keep current plan');
    expect(response.suggested_actions[0]?.label).toContain('Keep current plan');
    expect(chip_type).toBe('text_prompt');
  });

  it('options_not_configured without first_option_label uses generic chip', () => {
    const err = build('options_not_configured', false, { option_count: 2 });
    const { response, template_id } = composeHandlerFailure(err, CTX, 'frame');
    expect(template_id).toBe('options_not_configured_no_label');
    expect(response.suggested_actions[0]?.label).toBe('Configure an option');
    expect(response.assistant_text).not.toContain('null');
    expect(response.assistant_text).not.toContain('undefined');
  });

  it('options_not_configured with id-shaped first_option_label routes to generic branch (no "Configure that option")', () => {
    const err = build('options_not_configured', false, {
      first_option_label: 'opt_abc',
      option_count: 2,
    });
    const { response, template_id } = composeHandlerFailure(err, CTX, 'frame');
    expect(template_id).toBe('options_not_configured_no_label');
    expect(response.assistant_text).not.toContain('opt_abc');
    expect(response.assistant_text).not.toContain('that option needs');
    expect(response.suggested_actions[0]?.label).toBe('Configure an option');
  });
});

describe('composeHandlerFailure — shape and safety', () => {
  it('every response carries an INTERNAL_ERROR block with failure_origin=handler + error_code', () => {
    const err = build('plot_timeout', true);
    const { response } = composeHandlerFailure(err, CTX, 'analyse');
    const block = response.blocks[0];
    expect(block?.type).toBe('error');
    if (block?.type === 'error') {
      expect(block.error_code).toBe('INTERNAL_ERROR');
      expect(block.details?.failure_origin).toBe('handler');
      expect(block.details?.error_code).toBe('plot_timeout');
      expect(block.details?.retryable).toBe(true);
    }
  });

  it('every cause_kind returns exactly one chip and a typed chip_type', () => {
    const causes: HandlerInvocationFailedCause[] = [
      'args_validation_failed',
      'scenario_read_failed',
      'plot_timeout',
      'plot_error',
      'plot_payload_invalid',
      'plot_unknown',
      'analysis_not_completed',
      'options_not_configured',
    ];
    for (const c of causes) {
      const { response, chip_type } = composeHandlerFailure(build(c, false), CTX, 'frame');
      expect(response.suggested_actions.length).toBe(1);
      expect(['action', 'text_prompt', 'entity_suggestion']).toContain(chip_type);
    }
  });

  it('no reachable cause_kind hits the fallback template', () => {
    const causes: HandlerInvocationFailedCause[] = [
      'args_validation_failed',
      'scenario_read_failed',
      'plot_timeout',
      'plot_error',
      'plot_payload_invalid',
      'plot_unknown',
      'analysis_not_completed',
      'options_not_configured',
    ];
    for (const c of causes) {
      const { template_id } = composeHandlerFailure(build(c, false), CTX, 'frame');
      expect(template_id).not.toBe('fallback');
    }
  });

  it('unknown cause_kind falls back gracefully (no throw) with retry chip', () => {
    const err = build(UNKNOWN_CAUSE, true);
    const { response, template_id, chip_type } = composeHandlerFailure(err, CTX, 'frame');
    expect(template_id).toBe('fallback');
    expect(response.assistant_text.length).toBeGreaterThan(0);
    expect(response.suggested_actions.length).toBe(1);
    expect(chip_type).toBe('action');
  });

  it('handler_id is always present in error.details', () => {
    const err = build('plot_timeout', true);
    expect(err.details.handler_id).toBe('run_analysis');
  });
});

describe('composeHandlerFailure — PLoT typed failure codes (code-keyed honest copy)', () => {
  it('plot_error + GRAPH_TOO_COMPLEX → simplify copy + simplify chip, not "on our end"/retry', () => {
    const err = build('plot_error', true, {
      plot_primary_code: 'GRAPH_TOO_COMPLEX',
      plot_critique_codes: ['GRAPH_TOO_COMPLEX'],
    });
    const { response, template_id, chip_type } = composeHandlerFailure(err, CTX, 'frame');
    expect(template_id).toBe('plot_error_graph_too_complex');
    expect(response.assistant_text).toContain('too complex');
    expect(response.assistant_text).not.toContain('This is on our end');
    expect(response.suggested_actions[0]?.label).toBe('Simplify my model');
    expect(response.suggested_actions[0]?.action_type).toBeUndefined();
    expect(chip_type).toBe('text_prompt');
    assertStyle(response.assistant_text);
  });

  it('analysis_blocked + GRAPH_TOO_COMPLEX → same honest copy through the recoverable branch', () => {
    const err = build('analysis_blocked', false, {
      plot_primary_code: 'GRAPH_TOO_COMPLEX',
    });
    const { response, template_id } = composeHandlerFailure(err, CTX, 'frame');
    expect(template_id).toBe('analysis_blocked_graph_too_complex');
    expect(response.assistant_text).toContain('too complex');
    assertStyle(response.assistant_text);
  });

  it.each([
    ['ISL_TIMEOUT', 'timed out'],
    ['ISL_NETWORK_ERROR', 'reach'],
    ['ISL_ERROR', 'engine'],
    ['PLOT_INTERNAL_ERROR', 'on our side'],
  ] as const)('analysis_failed + %s → honest per-class copy with retry chip', (code, fragment) => {
    const err = build('analysis_failed', true, { plot_primary_code: code });
    const { response, template_id, chip_type } = composeHandlerFailure(err, CTX, 'frame');
    expect(template_id).toBe(`analysis_failed_${code.toLowerCase()}`);
    expect(response.assistant_text.toLowerCase()).toContain(fragment);
    expect(response.suggested_actions[0]?.action_type).toBe('run_analysis');
    expect(chip_type).toBe('action');
    assertStyle(response.assistant_text);
  });

  it('analysis_failed + ISL_REJECTED → adjust-the-model copy, no retry action chip', () => {
    const err = build('analysis_failed', true, { plot_primary_code: 'ISL_REJECTED' });
    const { response, template_id, chip_type } = composeHandlerFailure(err, CTX, 'frame');
    expect(template_id).toBe('analysis_failed_isl_rejected');
    expect(response.assistant_text.toLowerCase()).toContain('adjust');
    expect(response.suggested_actions[0]?.action_type).toBeUndefined();
    expect(chip_type).toBe('text_prompt');
    assertStyle(response.assistant_text);
  });

  it('plot_error with UNKNOWN code → byte-identical generic copy (conscious-promotion doctrine)', () => {
    const err = build('plot_error', true, { plot_primary_code: 'SOME_FUTURE_CODE' });
    const { response, template_id, chip_type } = composeHandlerFailure(err, CTX, 'frame');
    expect(template_id).toBe('plot_error');
    expect(response.assistant_text).toBe('The analysis service encountered an error. This is on our end.');
    expect(response.suggested_actions[0]?.label).toBe('Try again in a moment');
    expect(chip_type).toBe('text_prompt');
  });

  it('plot_error with NO code → byte-identical generic copy (absent-code fallback)', () => {
    const err = build('plot_error', true);
    const { response, template_id } = composeHandlerFailure(err, CTX, 'frame');
    expect(template_id).toBe('plot_error');
    expect(response.assistant_text).toBe('The analysis service encountered an error. This is on our end.');
  });

  it('PLoT-authored plot_user_message is never rendered (diagnostics carry only)', () => {
    const err = build('plot_error', true, {
      plot_primary_code: 'GRAPH_TOO_COMPLEX',
      plot_user_message: 'UNSAFE upstream prose with fac_1a2b3c4d id leak',
    });
    const { response } = composeHandlerFailure(err, CTX, 'frame');
    expect(response.assistant_text).not.toContain('UNSAFE upstream prose');
    expect(response.assistant_text).not.toContain('fac_1a2b3c4d');
  });
});
