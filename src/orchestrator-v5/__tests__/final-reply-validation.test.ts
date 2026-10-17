import { describe, expect, it } from 'vitest';
import type { OlumiResponse } from '@talchain/schemas/boundary';
import { isFinalisedV5Response, ReplyValidationError, validateFinalReply } from '../response-finaliser.js';
import type { Limit } from '../agent-lane/reasoning-limits.js';

const candidate = (): OlumiResponse => ({ response_version: 2, assistant_text: 'Consider what evidence would resolve the uncertainty.',
  blocks: [], suggested_actions: [], insights: [], stage_indicator: 'frame' });

describe('B4 final validation inside the finaliser', () => {
  it('checks the re-finalised object and returns that same branded object', () => {
    let checked: OlumiResponse | undefined;
    const result = validateFinalReply(candidate(), {}, { check: body => {
      expect(isFinalisedV5Response(body)).toBe(true); checked = body; return [];
    } });
    expect(result).toBe(checked);
    expect(result.assistant_text).toBe(candidate().assistant_text);
  });

  it('carries a typed failure without changing or partially deleting the reply', () => {
    const body = candidate();
    expect(() => validateFinalReply(body, {}, { check: () => [{ check: 'a', code: 'unlicensed' }] })).toThrow(ReplyValidationError);
    expect(body).toEqual(candidate());
  });

  it('a failed checker never becomes an unchecked success', () => {
    try {
      validateFinalReply(candidate(), {}, { check: () => { throw new Error('reader unavailable'); } });
      throw new Error('validation unexpectedly succeeded');
    } catch (error) {
      expect(error).toBeInstanceOf(ReplyValidationError);
      expect((error as ReplyValidationError).failures).toEqual([{ check: 'a', code: 'validator_unavailable' }]);
    }
  });

  it('e: the stage 2b typed hook has no veto or prose-append behaviour', () => {
    const limits: readonly Limit[] = [{ owner: 'B', code: 'existing_code', effect: 'claim_withheld',
      scenario_id: 's', graph_identity_hash: 'g', subjects: [], withheld_claims: ['existing_typed_claim'],
      what: 'Unchecked explanatory data must never be appended.', next: { kind: 'none' } }];
    const result = validateFinalReply(candidate(), {}, { reasoning_limits: limits, check: () => [] });
    expect(result.assistant_text).toBe(candidate().assistant_text);
    expect(result).not.toHaveProperty('reasoning_limits');
  });
});
