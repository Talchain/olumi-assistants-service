/**
 * buildFailureResponse — egress safety layer.
 *
 * Asserts the post-recovery contract:
 *   - assistant_text is the recovery preface (not the legacy
 *     FAILURE_USER_TEXT[wireCode] copy).
 *   - blocks[0].error_code is the wire code, preserved for machine
 *     consumers.
 *   - suggested_actions carries at least one chip on every InternalFailure
 *     except DECISION_REVIEW_FAILED (which is handled out-of-band and
 *     never lands here).
 *   - retryable flag and caller details are preserved on blocks[0].details.
 */

import { afterEach, beforeEach, describe, it, expect } from 'vitest';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';

import { setTestSink } from '../../utils/telemetry.js';
import { buildFailureResponse, type FailureResponseRecoveryContext } from '../failure-response.js';
import { INTERNAL_TO_WIRE, type InternalFailure } from '../types.js';

const INTERNAL_CLASSES: InternalFailure[] = [
  'LLM_TIMEOUT',
  'BUDGET_EXCEEDED',
  'STATE_COMMIT_FAILED',
  'UNHANDLED',
  'UNSUPPORTED_ACTION',
];

const PREVIOUS_USER_MESSAGE = 'Why does the leading option win?';

function recoveryCtx(
  overrides: Partial<FailureResponseRecoveryContext> = {},
): FailureResponseRecoveryContext {
  return {
    previousUserMessage: PREVIOUS_USER_MESSAGE,
    analysisReady: false,
    scenarioId: 'scen-a',
    turnId: 'req-1',
    isRetry: false,
    handlerId: null,
    ...overrides,
  };
}

describe('buildFailureResponse', () => {
  beforeEach(() => {
    setTestSink(() => {});
  });
  afterEach(() => {
    setTestSink(null);
  });

  it.each(INTERNAL_CLASSES)(
    'produces an OlumiResponseSchema-valid envelope for %s',
    (cls) => {
      const env = buildFailureResponse(cls, 'frame', undefined, recoveryCtx());
      const parsed = OlumiResponseSchema.parse(env);
      expect(parsed.response_version).toBe(2);
      expect(parsed.blocks).toHaveLength(1);
      const block = parsed.blocks[0]!;
      expect(block.type).toBe('error');
      if (block.type === 'error') {
        expect(block.error_code).toBe(INTERNAL_TO_WIRE[cls]);
        expect(block.severity).toBe('error');
      }
    },
  );

  it('overrides assistant_text with the recovery preface (LLM_TIMEOUT)', () => {
    const env = buildFailureResponse('LLM_TIMEOUT', 'frame', undefined, recoveryCtx());
    expect(env.assistant_text).toBe('That took longer than usual.');
  });

  it('preserves wire error_code while overriding assistant_text', () => {
    const env = buildFailureResponse('LLM_TIMEOUT', 'frame', undefined, recoveryCtx());
    const block = env.blocks[0]!;
    expect(env.assistant_text).toBe('That took longer than usual.');
    if (block.type === 'error') {
      expect(block.error_code).toBe('UPSTREAM_TIMEOUT');
    }
  });

  it('attaches optional details to the error block (alongside the Group 3 retryable flag)', () => {
    const env = buildFailureResponse(
      'LLM_TIMEOUT',
      'frame',
      { phase: 'narrate' },
      recoveryCtx(),
    );
    const block = env.blocks[0]!;
    expect(block.type).toBe('error');
    if (block.type === 'error') {
      expect(block.details).toMatchObject({ phase: 'narrate', retryable: true });
    }
  });

  it('attaches at least one recovery chip on every error envelope', () => {
    for (const cls of INTERNAL_CLASSES) {
      const env = buildFailureResponse(cls, 'frame', undefined, recoveryCtx());
      expect(env.suggested_actions.length).toBeGreaterThan(0);
    }
  });

  it('carries the caller-provided stage on the envelope', () => {
    const env = buildFailureResponse('STATE_COMMIT_FAILED', 'decide', undefined, recoveryCtx());
    expect(env.stage_indicator).toBe('decide');
  });

  // Group 3 Task B — retryable flag on details.
  describe('retryable flag (Group 3 Task B)', () => {
    it('sets retryable:true for STATE_COMMIT_FAILED (transient persistence failure)', () => {
      const env = buildFailureResponse('STATE_COMMIT_FAILED', 'frame', undefined, recoveryCtx());
      const block = env.blocks[0]!;
      if (block.type === 'error') {
        expect(block.details).toMatchObject({ retryable: true });
      }
    });

    it('sets retryable:true for LLM_TIMEOUT (transient upstream failure)', () => {
      const env = buildFailureResponse('LLM_TIMEOUT', 'frame', undefined, recoveryCtx());
      const block = env.blocks[0]!;
      if (block.type === 'error') {
        expect(block.details).toMatchObject({ retryable: true });
      }
    });

    it('sets retryable:false for UNHANDLED (permanent / structural)', () => {
      const env = buildFailureResponse('UNHANDLED', 'frame', undefined, recoveryCtx());
      const block = env.blocks[0]!;
      if (block.type === 'error') {
        expect(block.details).toMatchObject({ retryable: false });
      }
    });

    it('sets retryable:false for BUDGET_EXCEEDED (retry will hit the same budget)', () => {
      const env = buildFailureResponse('BUDGET_EXCEEDED', 'frame', undefined, recoveryCtx());
      const block = env.blocks[0]!;
      if (block.type === 'error') {
        expect(block.details).toMatchObject({ retryable: false });
      }
    });

    it('sets retryable:false for LLM_SCHEMA_VIOLATION (model-pathology)', () => {
      const env = buildFailureResponse('LLM_SCHEMA_VIOLATION', 'frame', undefined, recoveryCtx());
      const block = env.blocks[0]!;
      if (block.type === 'error') {
        expect(block.details).toMatchObject({ retryable: false });
      }
    });

    it('preserves caller details when retryable is added', () => {
      const env = buildFailureResponse(
        'STATE_COMMIT_FAILED',
        'frame',
        { phase: 'commit' },
        recoveryCtx(),
      );
      const block = env.blocks[0]!;
      if (block.type === 'error') {
        expect(block.details).toEqual({ retryable: true, phase: 'commit' });
      }
    });
  });

  // v5-exclusive-cee P0 follow-up: UNSUPPORTED_ACTION surfaces the "declared
  // V5ActionType but no handler registered in this deployment" case as a
  // typed FEATURE_NOT_ENABLED wire code, distinct from the generic
  // INTERNAL_ERROR that UNHANDLED produces. Clients can distinguish a
  // declared-but-unbuilt feature from a generic internal bug.
  describe('UNSUPPORTED_ACTION wire mapping (v5-exclusive-cee)', () => {
    it('maps to wire FEATURE_NOT_ENABLED', () => {
      expect(INTERNAL_TO_WIRE.UNSUPPORTED_ACTION).toBe('FEATURE_NOT_ENABLED');
    });

    it('produces an envelope with FEATURE_NOT_ENABLED error_code', () => {
      const env = buildFailureResponse(
        'UNSUPPORTED_ACTION',
        'frame',
        { reason: 'handler_not_registered', handler_id: 'set_factor_value' },
        recoveryCtx(),
      );
      const parsed = OlumiResponseSchema.parse(env);
      const block = parsed.blocks[0]!;
      expect(block.type).toBe('error');
      if (block.type === 'error') {
        expect(block.error_code).toBe('FEATURE_NOT_ENABLED');
        expect(block.details).toMatchObject({
          retryable: false,
          reason: 'handler_not_registered',
          handler_id: 'set_factor_value',
        });
      }
    });

    it('is NOT retryable (retrying the same unsupported action will hit the same block)', () => {
      const env = buildFailureResponse('UNSUPPORTED_ACTION', 'frame', undefined, recoveryCtx());
      const block = env.blocks[0]!;
      if (block.type === 'error') {
        expect(block.details).toMatchObject({ retryable: false });
      }
    });
  });
});
