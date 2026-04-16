import { describe, it, expect } from 'vitest';
import { OlumiResponseSchema, FAILURE_USER_TEXT } from '@talchain/schemas/boundary';
import { buildFailureResponse } from '../failure-response.js';
import { INTERNAL_TO_WIRE, type InternalFailure } from '../types.js';

const INTERNAL_CLASSES: InternalFailure[] = [
  'LLM_TIMEOUT',
  'BUDGET_EXCEEDED',
  'STATE_COMMIT_FAILED',
  'UNHANDLED',
];

describe('buildFailureResponse', () => {
  it.each(INTERNAL_CLASSES)(
    'produces an OlumiResponseSchema-valid envelope for %s',
    (cls) => {
      const env = buildFailureResponse(cls, 'frame');
      // Must Zod-validate — this is the wire shape.
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

  it('uses the declared FAILURE_USER_TEXT for assistant_text', () => {
    const env = buildFailureResponse('LLM_TIMEOUT', 'frame');
    expect(env.assistant_text).toBe(FAILURE_USER_TEXT.UPSTREAM_TIMEOUT);
  });

  it('attaches optional details to the error block', () => {
    const env = buildFailureResponse('LLM_TIMEOUT', 'frame', { phase: 'narrate' });
    const block = env.blocks[0]!;
    expect(block.type).toBe('error');
    if (block.type === 'error') {
      expect(block.details).toEqual({ phase: 'narrate' });
    }
  });

  it('emits empty arrays for suggested_actions + insights (A1 scope)', () => {
    const env = buildFailureResponse('UNHANDLED', 'frame');
    expect(env.suggested_actions).toEqual([]);
    expect(env.insights).toEqual([]);
  });

  it('carries the caller-provided stage on the envelope', () => {
    const env = buildFailureResponse('STATE_COMMIT_FAILED', 'decide');
    expect(env.stage_indicator).toBe('decide');
  });
});
