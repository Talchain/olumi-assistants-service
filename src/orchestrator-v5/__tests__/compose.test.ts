import { describe, it, expect } from 'vitest';
import { OlumiResponseSchema } from '@talchain/schemas/boundary';
import { composeDirectAnswerResponse } from '../compose.js';

describe('composeDirectAnswerResponse', () => {
  it('produces an OlumiResponseSchema-valid success envelope', () => {
    const env = composeDirectAnswerResponse({
      assistant_text: 'hello world',
      stage: 'frame',
    });
    const parsed = OlumiResponseSchema.parse(env);
    expect(parsed.response_version).toBe(2);
    expect(parsed.assistant_text).toBe('hello world');
    expect(parsed.blocks).toEqual([]);
    expect(parsed.suggested_actions).toEqual([]);
    expect(parsed.insights).toEqual([]);
    expect(parsed.stage_indicator).toBe('frame');
  });

  it('omits any session state / lineage fields not on the schema (constraint 6)', () => {
    const env = composeDirectAnswerResponse({ assistant_text: 'x', stage: 'frame' });
    // .strict() rejects extra fields; verify none leaked.
    expect(Object.keys(env).sort()).toEqual(
      [
        'assistant_text',
        'blocks',
        'insights',
        'response_version',
        'stage_indicator',
        'suggested_actions',
      ].sort(),
    );
  });
});
