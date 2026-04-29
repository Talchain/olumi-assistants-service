import { describe, expect, it, beforeEach, afterEach } from 'vitest';

import { setTestSink } from '../../../utils/telemetry.js';
import {
  buildRecoveryChip,
  emitRecoveryChipServed,
  FORBIDDEN_USER_TEXT_TERMS,
  recoveryFailureTypeFromInternal,
  type RecoveryFailureType,
} from '../recovery-chips.js';
import type { InternalFailure } from '../../types.js';

const PREVIOUS = 'Why does the leading option win?';

function expectNoForbiddenTerms(value: string, label: string): void {
  for (const term of FORBIDDEN_USER_TEXT_TERMS) {
    const re = new RegExp(`\\b${term}\\b`, 'i');
    expect(value, `${label} should not contain "${term}": ${value}`).not.toMatch(re);
  }
}

describe('recovery-chips: buildRecoveryChip', () => {
  it('LLM_TIMEOUT → "Try again" prompt-style with previous user message', () => {
    const result = buildRecoveryChip({
      failureType: 'LLM_TIMEOUT',
      previousUserMessage: PREVIOUS,
      analysisReady: false,
    });
    expect(result.assistantText).toBe('That took longer than usual.');
    expect(result.chips).toHaveLength(1);
    expect(result.chips[0]?.label).toBe('Try again');
    expect(result.chips[0]?.action_type).toBeUndefined();
    expect(result.chips[0]?.message).toBe(PREVIOUS);
  });

  it('LLM_UNAVAILABLE → "Try again" prompt-style', () => {
    const result = buildRecoveryChip({
      failureType: 'LLM_UNAVAILABLE',
      previousUserMessage: PREVIOUS,
      analysisReady: false,
    });
    expect(result.assistantText).toBe("I couldn't complete that just now.");
    expect(result.chips).toHaveLength(1);
    expect(result.chips[0]?.label).toBe('Try again');
    expect(result.chips[0]?.action_type).toBeUndefined();
    expect(result.chips[0]?.message).toBe(PREVIOUS);
  });

  it('PLOT_HTTP_ERROR + analysisReady=true → "Run analysis again" action chip', () => {
    const result = buildRecoveryChip({
      failureType: 'PLOT_HTTP_ERROR',
      previousUserMessage: PREVIOUS,
      analysisReady: true,
    });
    expect(result.assistantText).toBe("Analysis couldn't complete right now.");
    expect(result.chips).toHaveLength(1);
    expect(result.chips[0]?.label).toBe('Run analysis again');
    expect(result.chips[0]?.action_type).toBe('run_analysis');
    expect(result.chips[0]?.message).toBe('Run the analysis');
  });

  it('PLOT_HTTP_ERROR + analysisReady=false → "Review model setup" prompt chip', () => {
    const result = buildRecoveryChip({
      failureType: 'PLOT_HTTP_ERROR',
      previousUserMessage: PREVIOUS,
      analysisReady: false,
    });
    expect(result.chips).toHaveLength(1);
    expect(result.chips[0]?.label).toBe('Review model setup');
    expect(result.chips[0]?.action_type).toBeUndefined();
    expect(result.chips[0]?.message).toBe(
      'What do I need to fix before running the analysis?',
    );
  });

  it('PLOT_TIMEOUT respects the same ready guard as PLOT_HTTP_ERROR', () => {
    const ready = buildRecoveryChip({
      failureType: 'PLOT_TIMEOUT',
      previousUserMessage: PREVIOUS,
      analysisReady: true,
    });
    const notReady = buildRecoveryChip({
      failureType: 'PLOT_TIMEOUT',
      previousUserMessage: PREVIOUS,
      analysisReady: false,
    });
    expect(ready.assistantText).toBe('The analysis took longer than expected.');
    expect(ready.chips[0]?.action_type).toBe('run_analysis');
    expect(notReady.chips[0]?.action_type).toBeUndefined();
    expect(notReady.chips[0]?.label).toBe('Review model setup');
  });

  it('HANDLER_ERROR → prompt-style with previous user message', () => {
    const result = buildRecoveryChip({
      failureType: 'HANDLER_ERROR',
      previousUserMessage: PREVIOUS,
      analysisReady: false,
    });
    expect(result.assistantText).toBe("I couldn't complete that step.");
    expect(result.chips[0]?.label).toBe('Try again');
    expect(result.chips[0]?.action_type).toBeUndefined();
    expect(result.chips[0]?.message).toBe(PREVIOUS);
  });

  it('ZOD_REPAIR_FAILED → prompt-style with previous user message', () => {
    const result = buildRecoveryChip({
      failureType: 'ZOD_REPAIR_FAILED',
      previousUserMessage: PREVIOUS,
      analysisReady: false,
    });
    expect(result.assistantText).toBe("I couldn't structure that response correctly.");
    expect(result.chips[0]?.label).toBe('Try again');
    expect(result.chips[0]?.action_type).toBeUndefined();
  });

  it('DECISION_REVIEW_FAILED → no chip, only assistant text', () => {
    const result = buildRecoveryChip({
      failureType: 'DECISION_REVIEW_FAILED',
      previousUserMessage: PREVIOUS,
      analysisReady: true,
    });
    expect(result.chips).toHaveLength(0);
    expect(result.assistantText).toContain('Analysis completed');
  });

  it('LLM_DENIAL → "Try again" prompt-style', () => {
    const result = buildRecoveryChip({
      failureType: 'LLM_DENIAL',
      previousUserMessage: PREVIOUS,
      analysisReady: false,
    });
    expect(result.assistantText).toBe(
      "I wasn't able to help with that. Could you rephrase?",
    );
    expect(result.chips[0]?.label).toBe('Try again');
    expect(result.chips[0]?.action_type).toBeUndefined();
  });
});

describe('recovery-chips: previousUserMessage fallback', () => {
  it.each([
    ['empty string', ''],
    ['whitespace only', '   '],
    ['null', null as unknown as string],
    ['undefined', undefined as unknown as string],
  ])('falls back to "Try that again" when previousUserMessage is %s', (_label, value) => {
    const result = buildRecoveryChip({
      failureType: 'LLM_TIMEOUT',
      previousUserMessage: value,
      analysisReady: false,
    });
    expect(result.chips[0]?.message).toBe('Try that again');
  });

  it('action-type chip messages are unaffected by fallback (PLOT ready)', () => {
    const result = buildRecoveryChip({
      failureType: 'PLOT_HTTP_ERROR',
      previousUserMessage: '',
      analysisReady: true,
    });
    expect(result.chips[0]?.message).toBe('Run the analysis');
  });

  it('"Review model setup" chip uses fixed message regardless of fallback', () => {
    const result = buildRecoveryChip({
      failureType: 'PLOT_HTTP_ERROR',
      previousUserMessage: '',
      analysisReady: false,
    });
    expect(result.chips[0]?.message).toBe(
      'What do I need to fix before running the analysis?',
    );
  });
});

describe('recovery-chips: tone guard (user-facing strings only)', () => {
  const FAILURE_TYPES: readonly RecoveryFailureType[] = [
    'LLM_TIMEOUT',
    'LLM_UNAVAILABLE',
    'PLOT_HTTP_ERROR',
    'PLOT_TIMEOUT',
    'HANDLER_ERROR',
    'ZOD_REPAIR_FAILED',
    'DECISION_REVIEW_FAILED',
    'LLM_DENIAL',
  ];

  it.each(FAILURE_TYPES)('%s produces no forbidden user-facing terms', (failureType) => {
    for (const analysisReady of [true, false]) {
      const result = buildRecoveryChip({
        failureType,
        previousUserMessage: 'A user message that talks about an option label',
        analysisReady,
      });
      expectNoForbiddenTerms(result.assistantText, `${failureType} assistantText`);
      for (const chip of result.chips) {
        expectNoForbiddenTerms(chip.label, `${failureType} chip.label`);
        expectNoForbiddenTerms(chip.message, `${failureType} chip.message`);
      }
    }
  });

  it('user-facing strings avoid em dashes and exclamation marks', () => {
    for (const failureType of FAILURE_TYPES) {
      const result = buildRecoveryChip({
        failureType,
        previousUserMessage: PREVIOUS,
        analysisReady: failureType.startsWith('PLOT_'),
      });
      expect(result.assistantText, `${failureType}`).not.toMatch(/[—!]/);
      for (const chip of result.chips) {
        expect(chip.label, `${failureType} label`).not.toMatch(/[—!]/);
        // Messages may echo the previous user message (chip.message === PREVIOUS),
        // so we only enforce no em dash / exclamation on the labels and the
        // fixed message strings.
      }
    }
  });
});

describe('recovery-chips: recoveryFailureTypeFromInternal', () => {
  const TABLE: Array<[InternalFailure, string | undefined, RecoveryFailureType]> = [
    ['LLM_TIMEOUT', undefined, 'LLM_TIMEOUT'],
    ['BUDGET_EXCEEDED', undefined, 'LLM_TIMEOUT'],
    ['LLM_RATE_LIMITED', undefined, 'LLM_UNAVAILABLE'],
    ['LLM_SCHEMA_VIOLATION', undefined, 'LLM_UNAVAILABLE'],
    ['LLM_SCHEMA_VIOLATION', 'schema_repair_failed', 'ZOD_REPAIR_FAILED'],
    ['LLM_SCHEMA_VIOLATION', 'empty_response', 'LLM_UNAVAILABLE'],
    ['LLM_REQUEST_INVALID', undefined, 'HANDLER_ERROR'],
    ['STATE_COMMIT_FAILED', undefined, 'HANDLER_ERROR'],
    ['HANDLER_INVOCATION_FAILED', undefined, 'HANDLER_ERROR'],
    ['HANDLER_RESULT_INVALID', undefined, 'HANDLER_ERROR'],
    ['UNHANDLED', undefined, 'HANDLER_ERROR'],
    ['UNSUPPORTED_ACTION', undefined, 'HANDLER_ERROR'],
  ];

  it.each(TABLE)('%s with cause=%s → %s', (internal, cause, expected) => {
    expect(recoveryFailureTypeFromInternal(internal, cause)).toBe(expected);
  });
});

describe('recovery-chips: emitRecoveryChipServed', () => {
  let captured: Array<{ event: string; data: Record<string, unknown> }> = [];

  beforeEach(() => {
    captured = [];
    setTestSink((event, data) => {
      captured.push({ event, data });
    });
  });

  afterEach(() => {
    setTestSink(null);
  });

  it('emits v5.recovery_chip_served with the right fields', () => {
    const chips = [{ id: 'chip_prompt_retry', label: 'Try again', message: 'foo' }];
    emitRecoveryChipServed({
      failureType: 'LLM_TIMEOUT',
      chips,
      scenarioId: 'scen-a',
      turnId: 'req-1',
      isRetry: false,
      handlerId: null,
    });
    expect(captured).toHaveLength(1);
    expect(captured[0]?.event).toBe('v5.recovery_chip_served');
    expect(captured[0]?.data).toMatchObject({
      failure_type: 'LLM_TIMEOUT',
      chip_labels: ['Try again'],
      scenario_id: 'scen-a',
      turn_id: 'req-1',
      is_retry: false,
      handler_id: null,
    });
  });

  it('builder is pure: buildRecoveryChip emits no telemetry on its own', () => {
    buildRecoveryChip({
      failureType: 'LLM_TIMEOUT',
      previousUserMessage: PREVIOUS,
      analysisReady: false,
    });
    expect(captured).toHaveLength(0);
  });

  it('emits handler_id when supplied', () => {
    emitRecoveryChipServed({
      failureType: 'HANDLER_ERROR',
      chips: [{ id: 'chip_prompt_retry', label: 'Try again', message: 'foo' }],
      scenarioId: 'scen-a',
      turnId: 'req-1',
      isRetry: true,
      handlerId: 'run_analysis',
    });
    expect(captured[0]?.data.handler_id).toBe('run_analysis');
    expect(captured[0]?.data.is_retry).toBe(true);
  });
});
